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
  /** Service modules (Phase 3): plain objects whose function members are callable. */
  services?: Record<string, unknown>;
  /** Injectable clock, so hooks are testable (GRAMMAR §6). Defaults to real time. */
  now?: () => Date;
  quotas?: Partial<Quotas>;
  /**
   * Additional roots injected per embedding point (DSL_SPEC §3) — e.g. `value`
   * in attribute validation rules, `event` in page-builder callback wiring.
   */
  extras?: Record<string, unknown>;
}
