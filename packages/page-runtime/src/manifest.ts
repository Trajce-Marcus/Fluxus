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
}

export interface ComponentManifest {
  name: string;
  version: string;
  component: ComponentType<Record<string, unknown>>;
  schema: PropSchema[];
  css?: string;
}
