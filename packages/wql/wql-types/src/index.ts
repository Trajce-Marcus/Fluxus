// ─── Attribute value wrapper ─────────────────────────────────────────────────

export interface AttributeValue {
  _raw: string | number | boolean;
  toInt(): number;
  toDate(): Date;
  toBool(): boolean;
  toString(): string;
}

export interface Attribute {
  code: string;
  value: AttributeValue;
}

export interface AttributeList {
  [index: number]: Attribute;
  length: number;
  find(fn: (a: Attribute) => boolean): Attribute[];
  filter(fn: (a: Attribute) => boolean): Attribute[];
}

// ─── Domain objects ───────────────────────────────────────────────────────────

export interface WQLUser {
  userId: string;
  name: string;
  role: string;
}

export interface WQLAsset {
  assetId: string;
  assetNo: string;
  assetType: string;
  status: string;
  attributes: AttributeList;
}

export interface WQLProject {
  projectId: string;
  name: string;
  users: WQLUser[];
}

export interface WQLJob {
  jobId: string;
  jobNo: string;
  status: string;
  attributes: Record<string, unknown> & {
    find(fn: (a: Attribute) => boolean): Attribute[];
  };
  workOrders: WQLWorkOrder[];
  project: WQLProject;
}

export interface WQLWorkOrder {
  woId: string;
  status: string;
  activityType: string;
  dueDate: Date;
  completedDate?: Date;
  assignedTo: WQLUser | null;
  asset: WQLAsset | null;
  attributes: AttributeList;
  job: WQLJob;
}

// ─── WF context object ────────────────────────────────────────────────────────

export interface WQLContext {
  now: Date;
  trigger: string;
  owner: WQLUser;
  log(msg: string): void;
  error(msg: string): void;
  notify(user: WQLUser): void;
}

// ─── Workflow definition ──────────────────────────────────────────────────────

export type WFStatus = 'active' | 'inactive' | 'draft';
export type TriggerEvent =
  | 'wo.created'
  | 'wo.updated'
  | 'wo.completed'
  | 'wo.cancelled'
  | 'job.created'
  | 'job.updated'
  | 'asset.updated';

export interface WorkflowTrigger {
  event: TriggerEvent;
  activityType?: string;
  tenantId?: string;
  projectId?: string;
}

export interface Workflow {
  id: string;
  name: string;
  file: string;
  status: WFStatus;
  trigger: WorkflowTrigger;
  code: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Execution log ────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'action' | 'success' | 'warn' | 'error';

export interface LogLine {
  time: string;
  level: LogLevel;
  msg: string;
}

// ─── Mock context config ──────────────────────────────────────────────────────

export interface MockContextConfig {
  woId: string;
  status: string;
  activityType: string;
  dueDate: string;
  assetStatus: string;
  riskScore: number;
  priority: string;
}
