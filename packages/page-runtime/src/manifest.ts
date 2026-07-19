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
}

export interface ComponentManifest {
  name: string;
  version: string;
  component: ComponentType<Record<string, unknown>>;
  schema: PropSchema[];
  css?: string;
}
