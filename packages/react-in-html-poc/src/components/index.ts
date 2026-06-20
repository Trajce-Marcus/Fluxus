import type { ComponentType } from 'react';
import { Map } from './Map';
import { InventorList } from './InventorList';
import { AppHeader } from './AppHeader';
import { Shell } from '../platform-components/shell/Shell';

export { Map, InventorList, AppHeader, Shell };

export type FluxusComponent<P = Record<string, unknown>> = ComponentType<P> & { css?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<string, FluxusComponent<any>> = {
  Map,
  InventorList,
  AppHeader,
  Shell,
};
