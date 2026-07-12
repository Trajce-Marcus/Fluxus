import type { RecordInstance, ConfigRaw } from './types';
import { MemoryAdapter } from './memoryAdapter';

// Each host names its own storage key (fork 2: hosts configure the shared
// adapter, they don't reimplement it). legacyStorageKey covers one-time
// renames: data found there is merged in once, then the key is removed.
export interface LocalStorageAdapterOptions {
  storageKey: string;
  legacyStorageKey?: string;
}

function loadRecords(options: LocalStorageAdapterOptions): Map<string, RecordInstance> {
  let records = new Map<string, RecordInstance>();
  try {
    const raw = localStorage.getItem(options.storageKey);
    if (raw) records = new Map(JSON.parse(raw) as [string, RecordInstance][]);
  } catch {
    records = new Map();
  }

  if (!options.legacyStorageKey) return records;
  try {
    const legacyRaw = localStorage.getItem(options.legacyStorageKey);
    if (legacyRaw) {
      const entries: [string, RecordInstance][] = JSON.parse(legacyRaw);
      for (const [id, record] of entries) {
        if (!records.has(id)) records.set(id, record);
      }
      saveRecords(options.storageKey, records);
      localStorage.removeItem(options.legacyStorageKey);
    }
  } catch {
    // unreadable legacy data — leave it in place, don't block loading
  }

  return records;
}

function saveRecords(storageKey: string, records: Map<string, RecordInstance>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...records.entries()]));
  } catch {
    // quota exceeded or private browsing — silent
  }
}

// The browser Store: MemoryAdapter persisted to localStorage. All store
// behaviour lives in the base class; this subclass only loads, saves, and
// upgrades stored data (natural-id migration).
export class LocalStorageAdapter extends MemoryAdapter {
  private storageKey: string;

  constructor(config: ConfigRaw, options: LocalStorageAdapterOptions) {
    super(config, { initialRecords: loadRecords(options) });
    this.storageKey = options.storageKey;
    this.migrateNaturalIds();
    this.seedRecords(config);
  }

  protected persist(): void {
    saveRecords(this.storageKey, this.records);
  }
}
