import type { Store } from './interface';
import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityHistoryEntry, Config } from '../types';

const STORAGE_KEY = 'aber-poc-v1-records';

function loadRecords(): Map<string, RecordInstance> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const entries: [string, RecordInstance][] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveRecords(records: Map<string, RecordInstance>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...records.entries()]));
  } catch {
    // quota exceeded or private browsing — silent
  }
}

export class LocalStorageAdapter implements Store {
  private recordTypes: RecordTypeDef[];
  private workflows: Map<string, WorkflowDef>;
  private records: Map<string, RecordInstance>;
  private listeners: Set<() => void> = new Set();

  constructor(config: Config) {
    this.recordTypes = config.recordTypes;
    this.workflows = new Map(config.workflows.map(wf => [wf.id, wf]));
    this.records = loadRecords();
    this.migrateNaturalIds();
  }

  // For record types with id_field set, rename any record whose stored id doesn't
  // match the natural key value, then patch FK references pointing at the old ids.
  private migrateNaturalIds(): void {
    const idRemap = new Map<string, string>();

    for (const [oldId, record] of this.records) {
      const rt = this.recordTypes.find(r => r.id === record.typeRef);
      if (!rt?.id_field) continue;
      const naturalId = String(record.customFields[rt.id_field] ?? '').trim();
      if (naturalId && naturalId !== oldId) {
        idRemap.set(oldId, naturalId);
      }
    }

    if (idRemap.size === 0) return;

    // Rename the records themselves
    for (const [oldId, newId] of idRemap) {
      const record = this.records.get(oldId)!;
      this.records.delete(oldId);
      this.records.set(newId, { ...record, id: newId });
    }

    // Patch FK values in all records that pointed at the old ids
    for (const record of this.records.values()) {
      const rt = this.recordTypes.find(r => r.id === record.typeRef);
      if (!rt) continue;
      let changed = false;
      const newFields = { ...record.customFields };
      for (const cf of rt.custom_fields) {
        if (cf.fk_record_type) {
          const fkVal = String(newFields[cf.key] ?? '');
          const remapped = idRemap.get(fkVal);
          if (remapped) { newFields[cf.key] = remapped; changed = true; }
        }
      }
      if (changed) record.customFields = newFields;
    }

    saveRecords(this.records);
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    this.listeners.forEach(cb => cb());
  }

  listRecordTypes(): RecordTypeDef[] {
    return this.recordTypes;
  }

  getRecordTypeDef(typeId: string): RecordTypeDef & { workflow: WorkflowDef } {
    const rt = this.recordTypes.find(r => r.id === typeId);
    if (!rt) throw new Error(`RecordType not found: ${typeId}`);
    const workflow = this.workflows.get(rt.workflow_ref);
    if (!workflow) throw new Error(`Workflow not found: ${rt.workflow_ref}`);
    return { ...rt, workflow };
  }

  getRecordTypeData(typeId: string): RecordInstance[] {
    return [...this.records.values()].filter(r => r.typeRef === typeId);
  }

  getRecord(recordId: string): RecordInstance {
    const r = this.records.get(recordId);
    if (!r) throw new Error(`Record not found: ${recordId}`);
    return r;
  }

  createRecord(typeId: string, customFields: Record<string, unknown>): RecordInstance {
    const rt = this.recordTypes.find(r => r.id === typeId);
    if (!rt) throw new Error(`RecordType not found: ${typeId}`);

    const defaults = Object.fromEntries(rt.custom_fields.map(cf => [cf.key, cf.default]));
    const merged = { ...defaults, ...customFields };

    // Enforce field constraints
    for (const cf of rt.custom_fields) {
      const val = String(merged[cf.key] ?? '').trim();
      if (cf.required && !val) throw new Error(`"${cf.key}" is required`);
      if (cf.unique && val) {
        const clash = [...this.records.values()].find(
          r => r.typeRef === typeId && String(r.customFields[cf.key] ?? '') === val
        );
        if (clash) throw new Error(`"${cf.key}" must be unique — "${val}" already exists`);
      }
    }

    let id: string;
    if (rt.id_field) {
      id = String(merged[rt.id_field] ?? '').trim();
    } else {
      id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const record: RecordInstance = {
      id,
      typeRef: typeId,
      customFields: merged,
      activityHistory: [],
    };

    this.records.set(id, record);
    saveRecords(this.records);
    this.notify();
    return record;
  }

  updateRecord(recordId: string, fields: Record<string, unknown>): void {
    const r = this.records.get(recordId);
    if (!r) throw new Error(`Record not found: ${recordId}`);
    const rt = this.recordTypes.find(t => t.id === r.typeRef);
    for (const cf of rt?.custom_fields ?? []) {
      if (!(cf.key in fields)) continue;
      const newVal = String(fields[cf.key] ?? '').trim();
      if (cf.immutable && newVal !== String(r.customFields[cf.key] ?? ''))
        throw new Error(`"${cf.key}" is immutable and cannot be changed`);
      if (cf.unique && newVal) {
        const clash = [...this.records.values()].find(
          rec => rec.typeRef === r.typeRef && rec.id !== recordId && String(rec.customFields[cf.key] ?? '') === newVal
        );
        if (clash) throw new Error(`"${cf.key}" must be unique — "${newVal}" already exists`);
      }
    }
    r.customFields = { ...r.customFields, ...fields };
    saveRecords(this.records);
    this.notify();
  }

  deleteRecord(recordId: string): void {
    if (!this.records.has(recordId)) throw new Error(`Record not found: ${recordId}`);
    this.records.delete(recordId);
    saveRecords(this.records);
    this.notify();
  }

  appendActivity(recordId: string, entry: ActivityHistoryEntry): void {
    const r = this.records.get(recordId);
    if (!r) throw new Error(`Record not found: ${recordId}`);
    r.activityHistory = [...r.activityHistory, entry];
    saveRecords(this.records);
    this.notify();
  }
}
