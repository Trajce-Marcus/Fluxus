import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityHistoryEntry, ReverseRefEntry } from '../types';

export interface Store {
  listRecordTypes(): RecordTypeDef[];
  getRecordTypeDef(typeId: string): RecordTypeDef & { workflow: WorkflowDef };
  getRecordTypeData(typeId: string): RecordInstance[];
  getRecord(recordId: string): RecordInstance;
  createRecord(typeId: string, customFields: Record<string, unknown>): RecordInstance;
  updateRecord(recordId: string, fields: Record<string, unknown>): void;
  deleteRecord(recordId: string): void;
  appendActivity(recordId: string, entry: ActivityHistoryEntry): void;
  subscribe(cb: () => void): () => void;
  // Resolves a stored fk_ref id to a human-readable label (§SDM_Change §6).
  // Falls back to rawId when the record or display field is not found.
  resolveDisplayLabel(fkRecordType: string, fkDisplayField: string | undefined, rawId: string): string;
  // Returns the fk_display_field for an attribute by key-matching against the
  // record type's CustomFields (§SDM_Change §7 resolution rule).
  resolveAttributeDisplayField(typeId: string, attrKey: string): string | undefined;
  // Returns all (sourceTypeId, fieldKey) pairs whose fk_ref points at targetTypeId.
  // Derived from config at construction time — no data scan required.
  getReverseRefs(targetTypeId: string): ReverseRefEntry[];
  // Returns all records of typeId where customFields[fieldKey] === value.
  getRecordsByField(typeId: string, fieldKey: string, value: string): RecordInstance[];
}
