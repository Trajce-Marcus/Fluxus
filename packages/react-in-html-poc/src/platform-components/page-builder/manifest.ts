import type { ComponentType } from 'react';
import type { PropSchema } from '../../components/schema';

export interface ComponentManifest {
  name: string;
  version: string;
  component: ComponentType<Record<string, unknown>>;
  schema: PropSchema[];
  css?: string;
}
