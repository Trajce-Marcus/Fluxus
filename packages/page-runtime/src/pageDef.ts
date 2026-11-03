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
  /**
   * Where a tab scrolls to (2026-09-24): this slot's label in the `Tabs`
   * strip. On the slot, not the layout panel, so the layout stays about
   * arrangement (the user's call) — and so only a slot holding a component can
   * be a tab. The slot's element carries it as `data-tab-name`.
   */
  tabName?: string;
}

/**
 * The record a page is about (CLIENT_TRUST_BOUNDARY §7, page-anchor model): a
 * record type, one of whose records the page is opened on — its id arrives in
 * the URL (`?record=`), and nothing is created. Absent ⇒ a pure view: no
 * anchor, and the GETs it fires stay untraced.
 *
 * Its `instances` choice went with apps Part 2 step 2 (APPS_AND_INSTANCES
 * §2.2): `'one'` — a single record per operation, found or created when the
 * page opened — is the operation's app's job now, and no page on dev used it.
 * Old page versions still carry the field; nothing reads it.
 */
export interface PageRecordDef {
  type: string;
}

export interface PageDef {
  template?: string;
  record?: PageRecordDef;
  /**
   * The page's list — the activities and reads its apps use (APPS_AND_INSTANCES
   * §2.2): a workflow no record type points to, authored in the Workflows
   * editor, whose items may carry the app's own condition. An app offers and
   * runs only what is on it; with none, nothing. Checked when the page is
   * published (it exists, and no record type points to it).
   */
  workflowId?: string;
  /**
   * An example of an app's definition, as JSON text (APPS_AND_INSTANCES §3.1):
   * the page editor's preview runs with it as `context.app.definition`, and a
   * new app made from the page starts with a copy. No app reads it at run time,
   * and it never reaches the Runtime. Checked to be JSON when published.
   */
  exampleDefinition?: string;
  /**
   * The page's default roles (APPS_AND_INSTANCES §3.3): the roles a new app
   * made from it starts with, which the operation admin changes freely. A
   * default, never a limit — who may run an app is set only on the app. Never
   * reaches the Runtime.
   */
  roleIds?: string[];
  layout?: LayoutDefinition;
  componentDependencies?: PageComponentEntry[];
  contextSchema?: ContextKeyDef[];
  slotConfigs?: Record<string, SlotConfig | null>;
  // `access` (who may open the page) went with apps Part 2 step 2: who may run
  // an app is set on it in the operation's apps list (APPS_AND_INSTANCES §2.2);
  // `roleIds` above is only a new app's default. Old page versions keep
  // `access`; nothing reads it.
}
