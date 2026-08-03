import type { ComponentType } from 'react';

export type FluxusComponent<P = Record<string, unknown>> = ComponentType<P> & { css?: string };

export const registry: Record<string, FluxusComponent> = {};
