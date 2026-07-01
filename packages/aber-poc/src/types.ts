// ── SDM config types (shape of the hand-edited JSON) ─────────────────────────

export interface CustomFieldDef {
  key: string;
  type: string;
  default: string;
  required?: boolean;
  unique?: boolean;
  immutable?: boolean;
  indexed?: boolean;
  fk_record_type?: string;
  fk_display_field?: string;
}

export interface AttributeDef {
  key: string;
  label: string;
  description: string;
  type: string;
  fk_record_type?: string;
  fk_display_field?: string;
}

export interface ActivityDef {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  record_map?: 'CREATE' | 'UPDATE' | 'DELETE';
  attributes: AttributeDef[];
  before_hook: object | null;
  after_hook: object | null;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  activities: ActivityDef[];
}

export interface RecordTypeDef {
  id: string;
  name: string;
  description: string;
  workflow_ref: string;
  id_field?: string;
  custom_fields: CustomFieldDef[];
}

export interface Config {
  recordTypes: RecordTypeDef[];
  workflows: WorkflowDef[];
}

// ── Runtime types (store reads/writes these) ──────────────────────────────────

export interface ActivityHistoryEntry {
  activityId: string;
  activityName: string;
  capturedAttributes: Record<string, unknown>;
  timestamp: string;
}

export interface RecordInstance {
  id: string;
  typeRef: string;
  customFields: Record<string, unknown>;
  activityHistory: ActivityHistoryEntry[];
}
