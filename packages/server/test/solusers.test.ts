// M5 design plane: `sol_users` gates the Console write surfaces (config.put,
// pages.*, publish).
//
// **Strict, not dormant** (ruled 2026-08-02): you get access to a solution only
// if you are in its user list, exactly as with an operation. One rule covers
// both — "you belong to a thing, or you do not" — replacing the adoption
// posture where an unconfigured solution stayed open to everyone. The bootstrap
// that follows from it is the same shape too: `solutions.create` enrols its
// creator, and `bootstrapOrgAdmin` covers solutions that already have nobody.
// Env stub (auth unconfigured) stays open.
//
// Two grades only, `read` and `write` (migration 0013): 'admin' collapsed into
// 'write' once the admin tiers took over everything it guarded. What used to be
// the admin-only surfaces — solutions.update/delete, appointing sol users,
// operations, assignments — are org-admin or op-admin work now, covered in
// admintiers.test.ts.
//
// Keyed on EMAIL (migration 0012): a sol user is appointed from the org pool,
// whose users typically have not signed in yet, so there is no auth id to key
// on. Callers here carry emails, and a caller with none can never match a row.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putConfig, putSolUser } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ConfigRaw, ContextUser } from '@fluxus/engine';

const SOL = 'test/impl';
const OP = 'test/impl';
const config: ConfigRaw = { attributes: [{ key: 'id', label: 'ID', description: '', type: 'text' }], recordTypes: [], workflows: [] };

let db: Db;
const writer: ContextUser = { id: 'writer', name: 'W', email: 'writer@example.com', roles: [] };
const outsider: ContextUser = { id: 'outsider', name: 'O', email: 'outsider@example.com', roles: [] };
const reader: ContextUser = { id: 'reader', name: 'R', email: 'reader@example.com', roles: [] };
const anonymous: ContextUser = { id: 'anon', name: 'A', email: null, roles: [] };
const boss: ContextUser = { id: 'boss', name: 'B', email: 'boss@example.com', roles: [] };

const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const stub = () => appRouter.createCaller({ db }); // no authConfigured ⇒ open

beforeAll(async () => {
  db = await createDb();
  const { inviteOrgUser } = await import('../src/host');
  await inviteOrgUser(db, { email: 'boss@example.com', level: 'admin' });
  await ensureSolution(db, SOL, 'Impl');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Impl');
});

describe('sol-user enforcement', () => {
  it('strict: a solution with no users admits nobody to the design plane', async () => {
    // The old posture let an unconfigured solution stay open to everyone. That
    // is gone — this asks "do you belong to this", and an empty list answers it.
    await expect(as(writer).config.put({ solutionId: SOL, config })).rejects.toThrow(/solution 'write'/);
    await expect(as(outsider).config.put({ solutionId: SOL, config })).rejects.toThrow(/solution 'write'/);
  });

  it('once rows are declared, they enforce', async () => {
    await putSolUser(db, { solutionId: SOL, email: 'writer@example.com', level: 'write' });
    await putSolUser(db, { solutionId: SOL, email: 'reader@example.com', level: 'read' });

    // write may edit config/pages and publish…
    await expect(as(writer).pages.put({ solutionId: SOL, path: 'pages/x', def: {} })).resolves.toEqual({ ok: true });
    await expect(as(writer).pages.publish({ solutionId: SOL, path: 'pages/x', readme: 'v1' })).resolves.toMatchObject({ version: 1 });

    // read may look but not build.
    await expect(as(reader).config.get({ solutionId: SOL })).resolves.toBeDefined();
    await expect(as(reader).config.put({ solutionId: SOL, config })).rejects.toThrow(/solution 'write'/);

    // an unlisted user is denied entirely.
    await expect(as(outsider).config.put({ solutionId: SOL, config })).rejects.toThrow(/solution 'write'/);
  });

  it('a caller with no email can never match a row', async () => {
    // The key is the email; an auth id alone has nothing to match against. This
    // is why the rekey had to come with the pool — identity now arrives by
    // invitation, and an invitation is an email.
    await expect(as(anonymous).config.put({ solutionId: SOL, config })).rejects.toThrow(/solution 'write'/);
  });

  it('rows are matched case-insensitively, like every other email key', async () => {
    await expect(
      as({ ...writer, email: 'WRITER@Example.com' }).config.put({ solutionId: SOL, config }),
    ).resolves.toEqual({ ok: true });
  });

  it('creating a solution enrols its creator, or nobody could build it', async () => {
    // The bootstrap that strictness forces. Creating a solution and creating
    // its first user are one act — the same rule the org tier already follows.
    await as(boss).solutions.create({ id: 'test/fresh', name: 'Fresh' });
    await expect(as(boss).config.put({ solutionId: 'test/fresh', config })).resolves.toEqual({ ok: true });
    await expect(as(outsider).config.put({ solutionId: 'test/fresh', config })).rejects.toThrow(/solution 'write'/);
  });

  it('bootstrapOrgAdmin opens solutions that already have nobody', async () => {
    // The recovery path for solutions that predate the rule.
    const { bootstrapOrgAdmin, ensureSolution: ensureSol } = await import('../src/host');
    await ensureSol(db, 'test/orphan', 'Orphan');
    const result = await bootstrapOrgAdmin(db, { email: 'boss@example.com' });
    expect(result.solutionsOpened).toContain('test/orphan');
  });

  it('the env stub (no auth) keeps the design plane open', async () => {
    await expect(stub().config.put({ solutionId: SOL, config })).resolves.toEqual({ ok: true });
  });
});
