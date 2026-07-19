// The component registry the renderer and validator resolve against. Moved
// here with the component library at the page-runtime extraction — the old
// circular-dependency reason for importing individual files is gone, but the
// direct imports stay (the registry is the only aggregation point).
//
// Known duplication: the page builder keeps its palette registries
// (SESSION_COMPONENTS, componentSchemas) as separate lists — deriving them
// from this manifest is a floated cleanup, not agreed.

import { AppHeader } from './components/AppHeader';
import { InventorList } from './components/InventorList';
import { InventorProfile } from './components/InventorProfile';
import { Map } from './components/Map';
import { WorkOrderList } from './components/WorkOrderList';
import type { ComponentManifest } from './manifest';

type AnyComponent = ComponentManifest['component'];

export const componentManifests: Record<string, ComponentManifest> = {
  AppHeader:       { name: 'AppHeader',       version: '1.0.0', component: AppHeader       as unknown as AnyComponent, schema: AppHeader.schema,       css: AppHeader.css },
  InventorList:    { name: 'InventorList',    version: '1.0.0', component: InventorList    as unknown as AnyComponent, schema: InventorList.schema,    css: InventorList.css },
  InventorProfile: { name: 'InventorProfile', version: '1.0.0', component: InventorProfile as unknown as AnyComponent, schema: InventorProfile.schema, css: InventorProfile.css },
  Map:             { name: 'Map',             version: '1.0.0', component: Map             as unknown as AnyComponent, schema: Map.schema ?? [],        css: Map.css },
  WorkOrderList:   { name: 'WorkOrderList',   version: '1.0.0', component: WorkOrderList   as unknown as AnyComponent, schema: WorkOrderList.schema,   css: WorkOrderList.css },
};
