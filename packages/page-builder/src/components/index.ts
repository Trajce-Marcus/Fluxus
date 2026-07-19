import type { ComponentType } from 'react';
import type { PropSchema } from '@fluxus/page-runtime';
export type { PropSchema } from '@fluxus/page-runtime';
// The app component library lives in @fluxus/page-runtime since the
// extraction; the Shell (the page builder IDE itself) stays here.
import { AppHeader, InventorList, InventorProfile, Map, WorkOrderList } from '@fluxus/page-runtime';
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
