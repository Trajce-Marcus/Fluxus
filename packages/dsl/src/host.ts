// Host interfaces — how an embedding environment (sdm workbench, page builder,
// backend) injects the four roots into the evaluator. Scripts are scope-blind;
// everything they can touch enters through EvalHost.

/** A record value as the DSL sees it. Hosts adapt their storage to this shape. */
export interface DslRecord {
  id: string;
  /** Record type name as used after `records.` (e.g. 'resources'). */
  type: string;
  fields: Record<string, unknown>;
}

/**
 * The value of an fk_ref field. Behaves as the raw id in comparisons;
 * member access dereferences to the target record (FK auto-deref, GRAMMAR §3.3).
 */
export class FkPointer {
  constructor(
    readonly targetType: string,
    readonly id: unknown,
  ) {}
}

/** A staged record mutation (DSL_SPEC §7): held by the evaluator, applied atomically on commit. */
export type MutationOp =
  | { op: 'create'; type: string; record: DslRecord }
  | { op: 'update'; type: string; id: string; fields: Record<string, unknown> };

/**
 * Mutation surface of a records host (Phase 2). `prepare*` validate and shape a
 * mutation *without persisting* — constraint violations surface while the script
 * runs, so a failing script stages nothing. `apply` commits the staged ops.
 */
export interface RecordsMutationHost {
  /** Validate a create, merge type defaults, assign the committed id. Does not persist. */
  prepareCreate(type: string, fields: Record<string, unknown>): DslRecord;
  /** Validate an update (immutable/unique constraints). Does not persist. Throws on violation. */
  prepareUpdate(type: string, id: string, fields: Record<string, unknown>): void;
  /** Commit staged mutations, in order. */
  apply(ops: MutationOp[]): void;
}

/** Adapter over the SDM record store + schema, injected as the `records` root. */
export interface RecordsHost {
  hasType(type: string): boolean;
  /** All records of a type. The evaluator snapshots (copies) what it receives. */
  getAll(type: string): DslRecord[];
  getById(type: string, id: unknown): DslRecord | null;
  /** Target record type if `field` on `type` is an fk_ref, else null (FK auto-deref). */
  fkTarget(type: string, field: string): string | null;
  /** Reverse-FK navigation (D12): resolve `record.<name>` to the incoming FK it names. */
  reverseRef(type: string, name: string): { sourceType: string; field: string } | null;
  /** Mutation support. Read-only hosts (expression embedding points) omit it. */
  mutate?: RecordsMutationHost;
}

/**
 * One callable function of a service module (Phase 3). The manifest half
 * (params/description/kind) feeds the validator; `fn` is the implementation.
 */
export interface ServiceFunctionDef {
  /** Parameter names — arity is validator-checked at config-save time. */
  params: string[];
  description: string;
  /**
   * 'read' = pure query, callable from any tier (datasources, before hooks).
   * 'effect' = does something to the world — after hooks only, prefer `queue`.
   */
  kind: 'read' | 'effect';
  /**
   * May return a Promise. The sync evaluator accepts that only on `queue`
   * dispatch (fire-and-forget); a *waiting* call that returns a Promise is a
   * runtime error until the async evaluator lands with the backend phase.
   */
  fn: (...args: unknown[]) => unknown;
}

/** A service module: the unit registered under the `services` root. */
export interface ServiceModuleDef {
  /** Name after `services.` (e.g. 'notify', 'geo'). */
  name: string;
  description: string;
  functions: Record<string, ServiceFunctionDef>;
}

export interface Quotas {
  /** Max evaluator steps (AST nodes visited) per evaluation. */
  maxSteps: number;
  /** Max rows a single query may materialize. */
  maxRows: number;
  /** Wall-clock budget per evaluation, ms. */
  timeoutMs: number;
}

export const DEFAULT_QUOTAS: Quotas = {
  maxSteps: 100_000,
  maxRows: 10_000,
  timeoutMs: 1_000,
};

export interface EvalHost {
  records?: RecordsHost;
  context?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  /** Service modules (Phase 3): the registry behind the `services` root. */
  services?: ServiceModuleDef[];
  /**
   * Where async `queue` dispatch failures land (the script already returned,
   * so they can't become warnings). Sync dispatch failures stay warnings.
   */
  onQueuedFailure?: (label: string, message: string) => void;
  /**
   * Named functions (DSL_SPEC §8): full `function name(params) { … }` sources.
   * Callable by declared name from any tier; parsed lazily and cached per evaluation.
   */
  functions?: string[];
  /** Injectable clock, so hooks are testable (GRAMMAR §6). Defaults to real time. */
  now?: () => Date;
  quotas?: Partial<Quotas>;
  /**
   * Additional roots injected per embedding point (DSL_SPEC §3) — e.g. `value`
   * in attribute validation rules, `event` in page-builder callback wiring.
   */
  extras?: Record<string, unknown>;
}
