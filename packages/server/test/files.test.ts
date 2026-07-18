// Slice 2 (ATTRIBUTE_TYPES_FILES_SCALARS): the files presign chokepoint and
// its cost safeguards (§6/§7), plus the by-value descriptor path end-to-end —
// capture a multi photo, then assert the reporting projection flattened it with
// positional segments (§9) and the ledger flipped pending → committed (§8).

import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { insertPendingAttachment, putConfig } from '../src/host';
import { appRouter } from '../src/router';
import { attachments, rptActivities, rptAttributes } from '../src/db/schema';
import type { BlobStore } from '../src/services/blob';
import type { ConfigRaw } from '@fluxus/engine';

const SCOPE = 'test/files';

// A stub blob store — the presign logic under test is ours; the signed URL is
// R2's. Records the keys it was asked to sign.
const signed: string[] = [];
const blob: BlobStore = {
  configured: true,
  presignUpload: async (key) => { signed.push(key); return `https://put.example/${key}`; },
  presignGet: async (key) => `https://get.example/${key}`,
};

// Minimal self-contained SDM: a widget with a code, a multi photo attribute,
// and a single-file attribute with an accept filter.
const config: ConfigRaw = {
  attributes: [
    { key: 'id', label: 'ID', description: '', type: 'text' },
    { key: 'code', label: 'Code', description: '', type: 'text' },
    { key: 'site_photos', label: 'Site photos', description: '', type: 'photo', type_config: { multi: true, max_count: 3, max_size_mb: 10 } },
    { key: 'permit', label: 'Permit', description: '', type: 'file', type_config: { accept: ['.pdf'], max_size_mb: 15 } },
    { key: 'notes', label: 'Notes', description: '', type: 'text' },
  ],
  recordTypes: [
    { id: 'rt_widgets', name: 'Widgets', description: '', workflow_ref: 'wf_widgets', custom_fields: [
      { key: 'code', type: 'text' },
    ] },
  ],
  workflows: [
    { id: 'wf_widgets', name: 'Widgets', description: '', activities: [
      { id: 'act_create_widgets', name: 'Create widget', description: '', sort_order: 1, record_map: 'CREATE', attributes: [{ attribute_ref: 'code' }], before_hook: null, after_hook: null },
      { id: 'act_log_photos', name: 'Log photos', description: '', sort_order: 2, attributes: [{ attribute_ref: 'site_photos' }], before_hook: null, after_hook: null },
    ] },
  ],
};

const photo = (storageKey: string, hash: string) => ({
  storage_key: storageKey, name: 'a.jpg', mime: 'image/jpeg', size: 1234, hash,
  width: 800, height: 600, thumb_key: `${storageKey}-thumb`,
});

let db: Db;
const caller = (withBlob = true) => appRouter.createCaller({ db, ...(withBlob ? { blob } : {}) });

beforeAll(async () => {
  db = await createDb();
  await putConfig(db, SCOPE, config);
});

describe('files.presignUpload — cost safeguards (§7)', () => {
  const good = { scope: SCOPE, attributeKey: 'site_photos', name: 'a.jpg', mime: 'image/jpeg', size: 1234 };

  it('refuses when the blob store is unconfigured', async () => {
    await expect(caller(false).files.presignUpload(good)).rejects.toThrow(/not configured/);
  });
  it('rejects an unknown attribute', async () => {
    await expect(caller().files.presignUpload({ ...good, attributeKey: 'nope' })).rejects.toThrow(/Unknown attribute/);
  });
  it('rejects a non-file/photo attribute', async () => {
    await expect(caller().files.presignUpload({ ...good, attributeKey: 'notes' })).rejects.toThrow(/not a file\/photo/);
  });
  it('rejects over the platform ceiling (20 MB)', async () => {
    await expect(caller().files.presignUpload({ ...good, size: 21 * 1024 * 1024 })).rejects.toThrow(/platform limit/);
  });
  it('rejects over the per-attribute max_size_mb', async () => {
    await expect(caller().files.presignUpload({ ...good, size: 11 * 1024 * 1024 })).rejects.toThrow(/10 MB limit/);
  });
  it('rejects a non-image for a photo attribute', async () => {
    await expect(caller().files.presignUpload({ ...good, mime: 'application/pdf', name: 'a.pdf' })).rejects.toThrow(/images only/);
  });
  it('rejects a file outside its accept filter', async () => {
    await expect(caller().files.presignUpload({ scope: SCOPE, attributeKey: 'permit', name: 'a.png', mime: 'image/png', size: 10 })).rejects.toThrow(/not an accepted type/);
  });

  it('signs a photo (full + thumb) and ledgers a pending row', async () => {
    const res = await caller().files.presignUpload(good);
    expect(res.storageKey).toMatch(/\/a\.jpg$/);
    expect(res.uploadUrl).toContain(res.storageKey);
    expect('thumbKey' in res && res.thumbKey).toBeTruthy();
    const rows = await db.select().from(attachments).where(eq(attachments.storageKey, res.storageKey));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].size).toBe(1234);
  });
});

describe('descriptor pipeline — projection (§9) + ledger commit (§8)', () => {
  it('captures a multi photo: positional rpt rows, attachments committed', async () => {
    // Two pending blobs, as if presigned earlier.
    await insertPendingAttachment(db, { storageKey: 'K1', size: 1234, mime: 'image/jpeg', hash: 'h1' });
    await insertPendingAttachment(db, { storageKey: 'K2', size: 5678, mime: 'image/jpeg', hash: 'h2' });

    const created = await caller().activities.run({ scope: SCOPE, activityId: 'act_create_widgets', attributes: { code: 'W-1' } });
    expect(created.recordId).toBeTruthy();

    await caller().activities.run({
      scope: SCOPE,
      activityId: 'act_log_photos',
      recordId: created.recordId!,
      attributes: { site_photos: [photo('K1', 'h1'), photo('K2', 'h2')] },
    });

    // Projection: one row per descriptor leaf, positional segment for the array.
    const [act] = await db.select().from(rptActivities).where(eq(rptActivities.activityId, 'act_log_photos'));
    const attrRows = await db.select().from(rptAttributes).where(eq(rptAttributes.activityRowId, act.id));
    const byKey = new Map(attrRows.map((r) => [r.key, r.value]));
    expect(byKey.get('site_photos.0.hash')).toBe('h1');
    expect(byKey.get('site_photos.0.storage_key')).toBe('K1');
    expect(byKey.get('site_photos.1.hash')).toBe('h2');
    expect(byKey.get('site_photos.1.storage_key')).toBe('K2');

    // Ledger: both referenced blobs flipped to committed.
    for (const key of ['K1', 'K2']) {
      const [row] = await db.select().from(attachments).where(eq(attachments.storageKey, key));
      expect(row.status).toBe('committed');
    }
  });
});
