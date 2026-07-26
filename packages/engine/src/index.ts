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
  buildDslSchema,
  buildEvalHost,
  buildRecordsHost,
  coerceCaptured,
  coerceCapturedValue,
  coerceValue,
  compositeSubs,
  flattenCaptured,
  functionSignatures,
  isBlank,
  joinScript,
  nestComposite,
  resolveFunctions,
  shortName,
  fullId,
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
  ConfigRaw,
  ContextUser,
  CustomFieldDef,
  FunctionDef,
  RecordInstance,
  RecordTypeDef,
  RoleDef,
  ReverseRefEntry,
  RunActivityResult,
  SeedGroup,
  WorkflowDef,
  WorkflowRawDef,
} from './types';
