// M5 implementer plane: implementer_levels gate the Console write/admin
// surfaces (config.put, pages.*, publish, operations.*, governance). Dormant
// until declared — no level rows ⇒ everyone admin (adoption); once any row
// exists, levels enforce and an unlisted user is denied. Env stub stays open.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putConfig, putImplementerLevel } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ConfigRaw, ContextUser } from '@fluxus/engine';

const SOL = 'test/impl';
const OP = 'test/impl';
const config: ConfigRaw = { attributes: [{ key: 'id', label: 'ID', description: '', type: 'text' }], recordTypes: [], workflows: [] };

let db: Db;
const writer: ContextUser = { id: 'writer', name: 'W', email: null, roles: [] };
const outsider: ContextUser = { id: 'outsider', name: 'O', email: null, roles: [] };
const boss: ContextUser = { id: 'boss', name: 'B', email: null, roles: [] };

const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const stub = () => appRouter.createCaller({ db }); // no authConfigured ⇒ open

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Impl');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Impl');
});

describe('implementer enforcement', () => {
  it('dormant: with no levels declared everyone is admin', async () => {
    await expect(as(writer).config.put({ solutionId: SOL, config })).resolves.toEqual({ ok: true });
    await expect(as(outsider).implementers.list({ solutionId: SOL })).resolves.toEqual([]); // admin-gated, but dormant
  });

  it('once levels are declared, they enforce', async () => {
    await putImplementerLevel(db, { solutionId: SOL, userId: 'writer', level: 'write' });
    await putImplementerLevel(db, { solutionId: SOL, userId: 'boss', level: 'admin' });

    // write may edit config/pages and publish…
    await expect(as(writer).pages.put({ solutionId: SOL, path: 'pages/x', def: {} })).resolves.toEqual({ ok: true });
    await expect(as(writer).pages.publish({ solutionId: SOL, path: 'pages/x', readme: 'v1' })).resolves.toMatchObject({ version: 1 });
    // …but not the admin surfaces.
    await expect(as(writer).implementers.list({ solutionId: SOL })).rejects.toThrow(/implementer 'admin'/);

    // an unlisted user is denied entirely.
    await expect(as(outsider).config.put({ solutionId: SOL, config })).rejects.toThrow(/implementer 'write'/);

    // admin may do admin work.
    await expect(as(boss).implementers.list({ solutionId: SOL })).resolves.toHaveLength(2);
  });

  it('the env stub (no auth) keeps the implementer plane open', async () => {
    await expect(stub().config.put({ solutionId: SOL, config })).resolves.toEqual({ ok: true });
  });
});
