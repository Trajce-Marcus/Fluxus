// The stored page definition — what @fluxus/server persists per page path and
// the client snapshots at connect. Page wiring is FluxScript everywhere
// (PAGE_WIRING_DESIGN, 2026-07-12): a dynamic prop is a single expression
// evaluated with datasource posture; a callback is a script receiving the
// payload as the `callbackData` root. The stored artifact is the source text;
// any picker UI merely writes it.

import type { LayoutDefinition } from './layout';

export interface PageComponentEntry {
  name: string;
  version: string;
}

export type ContextKeyType = 'string' | 'number' | 'boolean' | 'object';

/**
 * A page-declared context key: seeds `context.page.<key>` at page start.
 * Declarations are conveniences, not a schema — the validator treats
 * `context.page.*` as opaque (ruled 2026-07-12: permissive for MVP).
 * Platform built-ins (`context.user`, `context.app`) come from the host,
 * never from here.
 */
export interface ContextKeyDef {
  key: string;
  type: ContextKeyType;
  defaultValue?: unknown;
}

export interface SlotConfig {
  componentName: string;
  staticConfig: Record<string, unknown>;
  /**
   * propName → FluxScript expression source. The expression may carry the
   * query itself, or name a GET activity that does —
   * `invoke('act_get_work_orders', { status: context.page.status })` — which
   * is where a page's data requirements move into the model
   * (DATA_THROUGH_ACTIVITIES step 2). One stored shape either way: the
   * producer is named *in* the expression, not beside it.
   */
  dynamicProps: Record<string, string>;
  /** callbackName → FluxScript script source. */
  callbacks: Record<string, string>;
}

export interface PageDef {
  template?: string;
  layout?: LayoutDefinition;
  componentDependencies?: PageComponentEntry[];
  contextSchema?: ContextKeyDef[];
  slotConfigs?: Record<string, SlotConfig | null>;
  /**
   * Who may open this page (CONSOLE_RUNTIME_SPEC §6): role ids, **default
   * deny** once the solution declares `access.roles` — a published page with
   * none never reaches the browser. Enforced server-side, which reads only
   * this shallow convention off the otherwise opaque def (`pageOpenable`).
   * Declared here since 2026-08-10 so the Console can author it; the rule
   * itself is older, and pages written before it carry nothing.
   *
   * Distinct from a menu item's `roles`, which decide only what is *listed*.
   */
  access?: { open?: string[] };
}
