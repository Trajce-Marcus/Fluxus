// M3 publish pipeline: draft (pages) → immutable versions (page_versions).
// Publishing snapshots the current draft at max(version)+1 with a readme;
// Runtime reads the latest version per path; drafts and published diverge.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { appRouter } from '../src/router';

const SOL = 'test/publish';
let db: Db;
const caller = () => appRouter.createCaller({ db });

beforeAll(async () => {
  db = await createDb();
});

describe('page publishing', () => {
  it('publishes a draft as version 1 with release notes', async () => {
    await caller().pages.put({ solutionId: SOL, path: 'pages/home', def: { title: 'v1' } });
    const res = await caller().pages.publish({ solutionId: SOL, path: 'pages/home', readme: 'first cut' });
    expect(res.version).toBe(1);
    const versions = await caller().pages.versions({ solutionId: SOL, path: 'pages/home' });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, readme: 'first cut' });
  });

  it('bumps the version on the next publish and keeps history newest-first', async () => {
    await caller().pages.put({ solutionId: SOL, path: 'pages/home', def: { title: 'v2' } });
    const res = await caller().pages.publish({ solutionId: SOL, path: 'pages/home', readme: 'second cut' });
    expect(res.version).toBe(2);
    const versions = await caller().pages.versions({ solutionId: SOL, path: 'pages/home' });
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('refuses to publish a path with no draft', async () => {
    await expect(caller().pages.publish({ solutionId: SOL, path: 'pages/ghost', readme: 'x' })).rejects.toThrow(/no draft page/i);
  });

  it('published list returns the latest version per path; draft list returns the draft', async () => {
    // Draft is currently v2; publish then edit the draft ahead without publishing.
    await caller().pages.put({ solutionId: SOL, path: 'pages/home', def: { title: 'v3-unpublished' } });
    const published = await caller().pages.list({ solutionId: SOL, published: true });
    expect(published.find((p) => p.path === 'pages/home')?.def).toEqual({ title: 'v2' }); // latest PUBLISHED
    const draft = await caller().pages.list({ solutionId: SOL });
    expect(draft.find((p) => p.path === 'pages/home')?.def).toEqual({ title: 'v3-unpublished' });
  });

  it('getVersion returns an older version def (the rollback source)', async () => {
    const { def } = await caller().pages.getVersion({ solutionId: SOL, path: 'pages/home', version: 1 });
    expect(def).toEqual({ title: 'v1' });
  });
});
