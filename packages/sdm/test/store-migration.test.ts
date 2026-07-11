// One-time migration of records from the pre-rename localStorage key
// ('aber-poc-v1-records') into 'fluxus:sdm:records'.

import { describe, it, expect, beforeAll } from 'vitest';

const NEW_KEY = 'fluxus:sdm:records';
const LEGACY_KEY = 'aber-poc-v1-records';

beforeAll(() => {
  const bag = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
    clear: () => bag.clear(),
    key: (i: number) => [...bag.keys()][i] ?? null,
    get length() { return bag.size; },
  } as Storage;
});

describe('legacy localStorage migration', () => {
  it('merges aber-poc era records into the new key and removes the old one', async () => {
    const legacyRecord = {
      id: 'WG1',
      typeRef: 'rt_workgroups',
      customFields: { id: 'WG1', name: 'North Crew' },
      activityHistory: [],
    };
    localStorage.setItem(LEGACY_KEY, JSON.stringify([[legacyRecord.id, legacyRecord]]));

    const { config } = await import('../src/config');
    const { LocalStorageAdapter } = await import('@fluxus/engine');
    const adapter = new LocalStorageAdapter(config, { storageKey: NEW_KEY, legacyStorageKey: LEGACY_KEY });

    const workgroups = adapter.getRecordTypeData('rt_workgroups');
    expect(workgroups.map(r => r.id)).toContain('WG1');
    expect(localStorage.getItem(LEGACY_KEY)).toBe(null);
    expect(localStorage.getItem(NEW_KEY)).toContain('North Crew');
    // seeds still load alongside migrated data
    expect(adapter.getRecordTypeData('rt_cities').length).toBe(3);
  });
});
