/**
 * **A component's root carries no outer padding** (ruled 2026-09-14, the
 * user's call). The container owns layout; the component owns content. A
 * component that pads itself is deciding spacing for a page it cannot see —
 * which is how three stacked `Text` blocks came to sit 32px apart with no
 * page definition able to take it back. Internal spacing is still the
 * component's business: gaps between rows, a toolbar, the inside of a popup.
 *
 * Padding belongs on the `Panel`, where the layout editor already offers it.
 */
import type { ComponentType } from 'react';

// A component's prop schema: the declarative contract the page wiring layer
// binds against — static config, dynamic-data expressions, named callbacks.

export type PropKind = 'static-config' | 'dynamic-data' | 'callback';

export type PropType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function';

export interface PropSchema {
  name: string;
  kind: PropKind;
  type: PropType;
  required: boolean;
  description?: string;
  /**
   * For `type: 'array'` — the fields of one item, described the same way any
   * property is. A component that declares this gets an editor for the array
   * in the page builder; one that doesn't leaves the value read-only there,
   * because nothing may guess what an undeclared item holds.
   */
  items?: PropSchema[];
  /**
   * For `type: 'string'` — the values this property accepts. A property that
   * declares them is **chosen** in the page builder rather than typed
   * (2026-09-13): a fixed set typed into a free text box is a spelling test the
   * author can fail silently, and the component then falls back to its default
   * without saying why. The component still treats an unknown value as its
   * default, because a page may have been written before the list existed.
   */
  choices?: readonly string[];
}

export interface ComponentManifest {
  name: string;
  version: string;
  component: ComponentType<Record<string, unknown>>;
  schema: PropSchema[];
  css?: string;
}
