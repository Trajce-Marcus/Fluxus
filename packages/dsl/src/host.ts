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

/** A value a host may hand back now or later (SERVER_DATA_LOADING §4.1). */
export type MaybePromise<T> = T | Promise<T>;

/** A staged record mutation (DSL_SPEC §7): held by the evaluator, applied atomically on commit. */
export type MutationOp =
  | { op: 'create'; type: string; record: DslRecord }
  | { op: 'update'; type: string; id: string; fields: Record<string, unknown> }
  | { op: 'delete'; type: string; id: string };

/**
 * Mutation surface of a records host (Phase 2). `prepare*` validate and shape a
 * mutation *without persisting* — constraint violations surface while the script
 * runs, so a failing script stages nothing. `apply` commits the staged ops.
 *
 * Any of them may answer with a promise; only the waiting evaluator accepts one.
 */
export interface RecordsMutationHost {
  /** Validate a create, merge type defaults, assign the committed id. Does not persist. */
  prepareCreate(type: string, fields: Record<string, unknown>): MaybePromise<DslRecord>;
  /** Validate an update (immutable/unique constraints). Does not persist. Throws on violation. */
  prepareUpdate(type: string, id: string, fields: Record<string, unknown>): MaybePromise<void>;
  /**
   * Validate a delete — the record exists and is of the type named. Does not
   * persist. The record's history goes with it (2026-09-21, the user's ruling):
   * a delete is for what should never have existed, and anything worth keeping
   * is marked rather than deleted.
   */
  prepareDelete(type: string, id: string): MaybePromise<void>;
  /** Commit staged mutations, in order. */
  apply(ops: MutationOp[]): MaybePromise<void>;
}

/**
 * A host that writes each mutation at once and undoes a failed script itself
 * (SERVER_DATA_LOADING ruling 10) — the server's database store. The evaluator
 * keeps no staging for it: the script's later reads see its writes because the
 * database does.
 */
export interface WriteThroughMutationHost {
  writesThrough: true;
  /** Called before the script's first write — where the host opens its undo point. */
  begin(): MaybePromise<void>;
  /** Validate and write a create; answers the record as written. */
  create(type: string, fields: Record<string, unknown>): MaybePromise<DslRecord>;
  /** Validate and write an update. */
  update(type: string, id: string, fields: Record<string, unknown>): MaybePromise<void>;
  /** Check the record is of the type named, and delete it. */
  delete(type: string, id: string): MaybePromise<void>;
  /**
   * The script succeeded: throw if anything still points at a record it
   * deleted (checked once, at the end, so deleting a subtree is allowed),
   * otherwise keep its writes. Only called when the script wrote something.
   */
  finish(deleted: { type: string; id: string }[]): MaybePromise<void>;
  /** The script failed: undo everything it wrote since `begin`. */
  undo(): MaybePromise<void>;
  /**
   * Hold `queue`d calls until the host's writes commit; the host drops them
   * if the writes are rolled back instead.
   */
  afterCommit(dispatch: () => void): void;
}

/** Adapter over the SDM record store + schema, injected as the `records` root. */
export interface RecordsHost {
  hasType(type: string): boolean;
  /** All records of a type. The evaluator snapshots (copies) what it receives. */
  getAll(type: string): MaybePromise<DslRecord[]>;
  getById(type: string, id: unknown): MaybePromise<DslRecord | null>;
  /** Target record type if `field` on `type` is an fk_ref, else null (FK auto-deref). */
  fkTarget(type: string, field: string): string | null;
  /** Reverse-FK navigation (D12): resolve `record.<name>` to the incoming FK it names. */
  reverseRef(type: string, name: string): { sourceType: string; field: string } | null;
  /**
   * A type's declared fields and their types (`{ due_date: 'date', … }`), or
   * null for a type the host does not know. Read from the model, so it answers
   * immediately. What a record query compares by (SERVER_DATA_LOADING rulings
   * 12 and 13).
   */
  declaredFields?(type: string): Record<string, string> | null;
  /** Mutation support. Read-only hosts (expression embedding points) omit it. */
  mutate?: RecordsMutationHost | WriteThroughMutationHost;
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
   * May return a Promise. The waiting evaluator (the server's) awaits it; the
   * immediate one (the browser's) accepts one only on `queue` dispatch
   * (fire-and-forget), and a waiting call that returns a Promise is a runtime
   * error there.
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
  /**
   * Budget per evaluation, ms — evaluation time only: time spent waiting on the
   * host (the database, a service) does not count (SERVER_DATA_LOADING ruling 20).
   */
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
  /**
   * `invoke(activityId, params?)` — run a GET activity and return its answer
   * (DSL_SPEC §5a). The DSL knows nothing about activities, so the host that
   * owns the model supplies this; absent ⇒ `invoke` fails loudly rather than
   * returning null, because a guard that silently answers nothing is worse
   * than one that breaks.
   */
  invoke?: (activityId: string, params: Record<string, unknown>) => unknown | Promise<unknown>;
  /** Injectable clock, so hooks are testable (GRAMMAR §6). Defaults to real time. */
  now?: () => Date;
  quotas?: Partial<Quotas>;
  /**
   * Additional roots injected per embedding point (DSL_SPEC §3) — e.g. `value`
   * in attribute validation rules, `event` in page-builder callback wiring.
   */
  extras?: Record<string, unknown>;
}
