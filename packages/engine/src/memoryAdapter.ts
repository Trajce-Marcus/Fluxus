import type { Store } from './store';
import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityHistoryEntry, ConfigRaw, ReverseRefEntry } from './types';
import { joinScript } from './bridge';

// The in-memory Store: all reference-Store behaviour (workflow resolution,
// constraint checks, staged mutation halves, seeding) with no storage attached.
// Storage-backed adapters subclass it and override persist() — the browser's
// LocalStorageAdapter saves to localStorage; the server host loads a scope's
// partition into one of these per request, runs the sync engine against it,
// and writes the diff back to Postgres (partition-fetch + filter made literal).
export interface MemoryAdapterOptions {
  initialRecords?: Iterable<readonly [string, RecordInstance]>;
  /** Load config seed records for types that have none yet (as LocalStorageAdapter always did). */
  seed?: boolean;
}

export class MemoryAdapter implements Store {
  protected recordTypes: RecordTypeDef[];
  protected workflows: Map<string, WorkflowDef>;
  protected records: Map<string, RecordInstance>;
  private listeners: Set<() => void> = new Set();
  private reverseIndex: Map<string, ReverseRefEntry[]>;

  constructor(config: ConfigRaw, options: MemoryAdapterOptions = {}) {
    this.recordTypes = config.recordTypes;

    // Build an attribute lookup keyed by attribute.key, then resolve each
    // activity's attribute_ref wrappers into full AttributeDef objects.
    const attrMap = new Map(config.attributes.map(a => [a.key, a]));
    this.workflows = new Map(config.workflows.map(wf => [
      wf.id,
      {
        ...wf,
        activities: wf.activities.map(act => ({
          ...act,
          // Hooks may be written as arrays of lines in the JSON — joined here
          before_hook: joinScript(act.before_hook),
          after_hook: joinScript(act.after_hook),
          attributes: act.attributes.map(usage => {
            const def = attrMap.get(usage.attribute_ref);
            if (!def) throw new Error(`Attribute not found: ${usage.attribute_ref}`);
            // Carry usage-level settings onto the resolved attribute
            return usage.show_condition || usage.required || usage.validation || usage.can_waive
              ? {
                  ...def,
                  show_condition: usage.show_condition ?? def.show_condition,
                  required: usage.required,
                  validation: usage.validation ?? def.validation,
                  validation_message: usage.validation_message ?? def.validation_message,
                  can_waive: usage.can_waive ?? def.can_waive,
                }
              : def;
          }),
        })),
      },
    ]));

    this.reverseIndex = new Map();
    for (const rt of this.recordTypes) {
      for (const cf of rt.custom_fields) {
        if (cf.type === 'fk_ref' && cf.fk_record_type) {
          const bucket = this.reverseIndex.get(cf.fk_record_type) ?? [];
          bucket.push({ sourceTypeId: rt.id, fieldKey: cf.key });
          this.reverseIndex.set(cf.fk_record_type, bucket);
        }
      }
    }

    this.records = new Map(options.initialRecords ?? []);
    if (options.seed) this.seedRecords(config);
  }

  /** Persistence hook, called after every mutation — no-op in memory. */
  protected persist(): void {}

  // Load an entity file's sample records, but only for types that have no
  // records yet — user data is never touched or duplicated.
  protected seedRecords(config: ConfigRaw): void {
    let seeded = false;
    for (const group of config.seeds ?? []) {
      const hasAny = [...this.records.values()].some(r => r.typeRef === group.typeId);
      if (hasAny) continue;
      for (const seed of group.records) {
        this.records.set(seed.id, {
          id: seed.id,
          typeRef: group.typeId,
          customFields: seed.fields,
          activityHistory: [],
        });
        seeded = true;
      }
    }
    if (seeded) this.persist();
  }

  // For record types with id_field set, rename any record whose stored id doesn't
  // match the natural key value, then patch FK references pointing at the old ids.
  // Storage-format upgrade for pre-natural-id data — subclasses with durable
  // storage call it after construction; a fresh in-memory store never needs it.
  protected migrateNaturalIds(): void {
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
        if (cf.type === 'fk_ref') {
          const fkVal = String(newFields[cf.key] ?? '');
          const remapped = idRemap.get(fkVal);
          if (remapped) { newFields[cf.key] = remapped; changed = true; }
        }
      }
      if (changed) record.customFields = newFields;
    }

    this.persist();
  }

  /** Every record in the store — snapshot/diff support for write-back hosts. */
  allRecords(): RecordInstance[] {
    return [...this.records.values()];
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

  // Validate + shape a create without persisting — the staging half of createRecord.
  // Hooks build records while their script runs and insert only on commit.
  buildRecord(typeId: string, customFields: Record<string, unknown>): RecordInstance {
    const rt = this.recordTypes.find(r => r.id === typeId);
    if (!rt) throw new Error(`RecordType not found: ${typeId}`);

    const defaults = Object.fromEntries(rt.custom_fields.map(cf => [cf.key, cf.default ?? '']));
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

    return {
      id,
      typeRef: typeId,
      customFields: merged,
      activityHistory: [],
    };
  }

  insertRecord(record: RecordInstance): void {
    this.records.set(record.id, record);
    this.persist();
    this.notify();
  }

  createRecord(typeId: string, customFields: Record<string, unknown>): RecordInstance {
    const record = this.buildRecord(typeId, customFields);
    this.insertRecord(record);
    return record;
  }

  // Constraint check for an update without applying it — the staging half of updateRecord.
  validateUpdate(recordId: string, fields: Record<string, unknown>): void {
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
  }

  updateRecord(recordId: string, fields: Record<string, unknown>): void {
    this.validateUpdate(recordId, fields);
    const r = this.records.get(recordId)!;
    r.customFields = { ...r.customFields, ...fields };
    this.persist();
    this.notify();
  }

  deleteRecord(recordId: string): void {
    if (!this.records.has(recordId)) throw new Error(`Record not found: ${recordId}`);
    this.records.delete(recordId);
    this.persist();
    this.notify();
  }

  appendActivity(recordId: string, entry: ActivityHistoryEntry): void {
    const r = this.records.get(recordId);
    if (!r) throw new Error(`Record not found: ${recordId}`);
    r.activityHistory = [...r.activityHistory, entry];
    this.persist();
    this.notify();
  }

  resolveDisplayLabel(fkRecordType: string, fkDisplayField: string | undefined, rawId: string): string {
    if (!rawId) return '';
    const record = this.records.get(rawId);
    if (!record || record.typeRef !== fkRecordType) return rawId;
    if (!fkDisplayField) return rawId;
    return String(record.customFields[fkDisplayField] ?? rawId);
  }

  getReverseRefs(targetTypeId: string): ReverseRefEntry[] {
    return this.reverseIndex.get(targetTypeId) ?? [];
  }

  getRecordsByField(typeId: string, fieldKey: string, value: string): RecordInstance[] {
    return [...this.records.values()].filter(
      r => r.typeRef === typeId && String(r.customFields[fieldKey] ?? '') === value
    );
  }

  resolveAttributeDisplayField(typeId: string, attrKey: string): string | undefined {
    const rt = this.recordTypes.find(r => r.id === typeId);
    if (!rt) return undefined;
    const cf = rt.custom_fields.find(c => c.key === attrKey);
    if (!cf || cf.type !== 'fk_ref') return undefined;
    return cf.fk_display_field;
  }
}
