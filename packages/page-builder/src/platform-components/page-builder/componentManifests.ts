// Imports individual component files (not the registry) to avoid the circular
// dependency: registry → Shell → ContentArea → PageEditor → registry.
import { AppHeader } from '../../components/AppHeader';
import { InventorList } from '../../components/InventorList';
import { InventorProfile } from '../../components/InventorProfile';
import { Map } from '../../components/Map';
import type { ComponentManifest } from './manifest';

type AnyComponent = ComponentManifest['component'];

export const componentManifests: Record<string, ComponentManifest> = {
  AppHeader:       { name: 'AppHeader',       version: '1.0.0', component: AppHeader       as unknown as AnyComponent, schema: AppHeader.schema,       css: AppHeader.css },
  InventorList:    { name: 'InventorList',    version: '1.0.0', component: InventorList    as unknown as AnyComponent, schema: InventorList.schema,    css: InventorList.css },
  InventorProfile: { name: 'InventorProfile', version: '1.0.0', component: InventorProfile as unknown as AnyComponent, schema: InventorProfile.schema, css: InventorProfile.css },
  Map:             { name: 'Map',             version: '1.0.0', component: Map             as unknown as AnyComponent, schema: Map.schema ?? [],        css: Map.css },
};
