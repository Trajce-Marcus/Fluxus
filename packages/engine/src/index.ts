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
  coerceValue,
  compositeSubs,
  flattenCaptured,
  functionSignatures,
  joinScript,
  nestComposite,
  resolveFunctions,
  shortName,
  fullId,
  toDslRecord,
} from './bridge';
export type { ScriptContext } from './bridge';

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
  CustomFieldDef,
  FunctionDef,
  RecordInstance,
  RecordTypeDef,
  ReverseRefEntry,
  RunActivityResult,
  SeedGroup,
  WorkflowDef,
  WorkflowRawDef,
} from './types';
