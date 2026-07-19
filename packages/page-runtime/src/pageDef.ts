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
  /** propName → FluxScript expression source. */
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
}
