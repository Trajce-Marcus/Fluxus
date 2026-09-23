// One-off, 2026-09-23. The photos shift-reports-data.ts loaded carry no
// `thumb_key`, as SHIFT_REPORTS.md §12 told it to — but `thumb_key` is a
// required part of a photo descriptor (engine attributeTypes.ts). Display never
// checks, so they drew; Modify re-submits a report's photos and the server
// refused them ("Photos #1 is missing 'thumb_key'"). Each gets `thumb_key` =
// its `storage_key` — the full image, which is what display fell back to anyway.
//
// Patches the loaded records the way the loader wrote them. Activity history is
// left as it is. `--dry` reports and writes nothing.

import { and, eq, inArray } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { records } from '../src/db/schema';

const OPERATION = 'projects-dev';
const PHOTO_FIELDS: Record<string, string> = { rt_shift_reports: 'report_photos', rt_defects: 'defect_photos' };
const dry = process.argv.includes('--dry');
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

type Photo = { storage_key?: string; thumb_key?: string | null };

const rows = await db.select().from(records)
  .where(and(eq(records.operationId, OPERATION), inArray(records.typeRef, Object.keys(PHOTO_FIELDS))));

let patchedRecords = 0;
let patchedPhotos = 0;
for (const row of rows) {
  const field = PHOTO_FIELDS[row.typeRef];
  const value = row.customFields[field];
  const list = Array.isArray(value) ? value as Photo[] : value && typeof value === 'object' ? [value as Photo] : [];
  const missing = list.filter((p) => p.storage_key && (p.thumb_key === undefined || p.thumb_key === null));
  if (missing.length === 0) continue;

  const fix = (p: Photo): Photo => (missing.includes(p) ? { ...p, thumb_key: p.storage_key } : p);
  const next = Array.isArray(value) ? list.map(fix) : fix(value as Photo);
  patchedRecords++;
  patchedPhotos += missing.length;
  if (!dry) {
    await db.update(records).set({ customFields: { ...row.customFields, [field]: next }, updatedAt: new Date() })
      .where(and(eq(records.operationId, OPERATION), eq(records.id, row.id)));
  }
}

console.log(`${patchedPhotos} photo(s) on ${patchedRecords} record(s) ${dry ? 'would be' : ''} given a thumb_key`);
await closeDb(db);
