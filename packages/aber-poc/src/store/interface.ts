import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityHistoryEntry } from '../types';

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
}
