import type { ComponentType } from 'react';
import type { PropSchema } from './schema';
export type { PropSchema } from './schema';
import { Map } from './Map';
import { InventorList } from './InventorList';
import { InventorProfile } from './InventorProfile';
import { AppHeader } from './AppHeader';
import { WorkOrderList } from './WorkOrderList';
import { Shell } from '../platform-components/shell/Shell';

export { Map, InventorList, InventorProfile, AppHeader, WorkOrderList, Shell };

export type FluxusComponent<P = Record<string, unknown>> = ComponentType<P> & { css?: string; schema?: PropSchema[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<string, FluxusComponent<any>> = {
  Map,
  InventorList,
  InventorProfile,
  AppHeader,
  WorkOrderList,
  Shell,
};
