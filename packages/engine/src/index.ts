// @fluxus/engine — the shared activity engine (SDM core). One pipeline for
// every host: runActivity + the Store contract + the DSL bridge. Extracted
// from @fluxus/sdm at the Extraction milestone; see docs/SPEC.md.
//
// Named exports only (no wildcard barrels) — conventions.md tree-shaking rules.

export { createEngine } from './engine';
export type { Engine, EngineOptions, ActivityAvailability, RunActivityOptions } from './engine';

export type { Store } from './store';
export { MemoryAdapter } from './memoryAdapter';
export type { MemoryAdapterOptions } from './memoryAdapter';

export { buildGeoModule } from './services/geo';

export { validateSubmission } from './validateSubmission';
export type { SubmissionIssue } from './validateSubmission';

export {
  activityHooks,
  buildDslSchema,
  buildEvalHost,
  buildRecordsHost,
  coerceCaptured,
  coerceCapturedValue,
  coerceValue,
  compositeSubs,
  fieldLabel,
  flattenCaptured,
  functionSignatures,
  isBlank,
  joinScript,
  nestComposite,
  resolveFunctions,
  shortName,
  fullId,
  toComponentValue,
  toDslRecord,
  DEMO_USER,
} from './bridge';
export type { ScriptContext } from './bridge';

export {
  ATTRIBUTE_TYPES,
  attributeTypeSpec,
  descriptorFields,
  descriptorShapeIssues,
  isDescriptorType,
} from './attributeTypes';
export type { AttributeTypeSpec, DescriptorField, DescriptorFieldType } from './attributeTypes';

export { validateConfig, reportConfigFindings } from './validateConfig';
export type { Finding } from './validateConfig';

export type {
  ActivityDef,
  ActivityHistoryEntry,
  ActivityRawDef,
  AttributeDef,
  AttributeTypeConfig,
  AttributeUsageDef,
  SectionMarkerDef,
  SolutionConfig,
  ContextUser,
  CustomFieldDef,
  FunctionDef,
  RecordInstance,
  RecordTypeDef,
  RoleDef,
  ReverseRefEntry,
  QueryActivityResult,
  RunActivityResult,
  WorkflowDef,
  WorkflowRawDef,
} from './types';

// The client's grade of the model (CLIENT_TRUST_BOUNDARY §2) — what
// `config.getForOperation` returns and what every browser-side host is typed
// against. Each is the base its full-grade namesake above extends.
export type {
  ClientActivityRawDef,
  ClientAttributeDef,
  ClientAttributeTypeConfig,
  ClientCustomFieldDef,
  ClientRecordTypeDef,
  ClientSolutionConfig,
  ClientWorkflowRawDef,
} from './types';
