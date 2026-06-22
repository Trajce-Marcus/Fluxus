export type PropKind = 'static-config' | 'dynamic-data' | 'callback';

export type PropType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function';

export interface PropSchema {
  name: string;
  kind: PropKind;
  type: PropType;
  required: boolean;
  description?: string;
}
