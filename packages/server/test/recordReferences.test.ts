// `records.get` sends the records a record points at (2026-10-12): two levels
// of references, readable ones only, with those it may not read named as
// withheld — so a page that holds only its own record can show
// `context.record.area.name`, a form can name what a reference holds, and a
// withheld one says "Record access denied".

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putConfig, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';
import { createDbRolesResolver } from '../src/auth';
import type { ContextUser, SolutionConfig } from '@fluxus/engine';

const SOL = 'test/record-references';
const OP = 'test/record-references';

const fk = (key: string, target: string) => ({ key, type: 'fk_ref', fk_record_type: target, fk_display_field: 'name' });
const type = (id: string, fields: object[], read: string[]) =>
  ({ id, name: id, description: '', workflow_ref: `wf_${id}`, custom_fields: [{ key: 'name', type: 'text' }, ...fields], access: { read } });

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_a', name: 'A' }, { id: 'role_boss', name: 'Boss' }] },
  attributes: [],
  activities: [],
  recordTypes: [
    type('rt_jobs', [fk('owner', 'rt_owners')], ['role_a']),
    type('rt_owners', [fk('region', 'rt_regions')], ['role_a']),
    type('rt_regions', [], ['role_a']),
    type('rt_ledgers', [], ['role_boss']),
    type('rt_findings', [fk('job', 'rt_jobs'), fk('ledger', 'rt_ledgers'), fk('gone', 'rt_owners')], ['role_a']),
  ] as never,
  workflows: ['rt_jobs', 'rt_owners', 'rt_regions', 'rt_ledgers', 'rt_findings']
    .map((id) => ({ id: `wf_${id}`, name: id, description: '', activities: [] })),
};

let db: Db;
const user: ContextUser = { id: 'u1', name: 'U1', email: 'u1@example.com', roles: [] };
const as = () => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const row = (id: string, typeRef: string, customFields: Record<string, unknown>) =>
  ({ operationId: OP, id, typeRef, customFields: { name: id, ...customFields }, activityHistory: [] });

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'References');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'References');
  await db.insert(records).values([
    row('R1', 'rt_regions', {}),
    row('O1', 'rt_owners', { region: 'R1' }),
    row('J1', 'rt_jobs', { owner: 'O1' }),
    row('L1', 'rt_ledgers', {}),
    row('F1', 'rt_findings', { job: 'J1', ledger: 'L1', gone: 'NO_SUCH' }),
  ]);
  await inviteUser(db, { email: user.email! });
  await addOpUser(db, { operationId: OP, email: user.email! });
  await putUserRoles(db, { operationId: OP, email: user.email!, roleIds: ['role_a'] });
});

describe('records.get — the records a record points at', () => {
  it('follows references two levels, and no further', async () => {
    const got = await as().records.get({ operationId: OP, recordId: 'F1' });
    expect(got.id).toBe('F1');
    // F1 → J1 (one level) → O1 (two); O1 → R1 would be a third.
    expect(got.references.map((r) => r.id).sort()).toEqual(['J1', 'O1']);
  });

  it('names a record the caller may not read as withheld, and skips a reference to a missing one', async () => {
    const got = await as().records.get({ operationId: OP, recordId: 'F1' });
    expect(got.references.map((r) => r.id)).not.toContain('L1');
    expect(got.withheld).toEqual(['L1']);
    expect(got.references.map((r) => r.id)).not.toContain('NO_SUCH');
    expect(got.withheld).not.toContain('NO_SUCH');
  });

  it('refuses a record the caller may not read as access denied', async () => {
    await expect(as().records.get({ operationId: OP, recordId: 'L1' })).rejects.toThrow('Record access denied');
  });

  it('sends a referenced record whole, so its fields can be read', async () => {
    const got = await as().records.get({ operationId: OP, recordId: 'J1' });
    const owner = got.references.find((r) => r.id === 'O1');
    expect(owner?.customFields.name).toBe('O1');
    expect(got.references.map((r) => r.id).sort()).toEqual(['O1', 'R1']);
  });

  it('sends nothing for a record that points nowhere', async () => {
    const got = await as().records.get({ operationId: OP, recordId: 'R1' });
    expect(got.references).toEqual([]);
  });
});
