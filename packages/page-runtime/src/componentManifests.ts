// The component registry the renderer and validator resolve against. Moved
// here with the component library at the page-runtime extraction — the old
// circular-dependency reason for importing individual files is gone, but the
// direct imports stay (the registry is the only aggregation point).
//
// Known duplication: the page builder keeps its palette registries
// (SESSION_COMPONENTS, componentSchemas) as separate lists — deriving them
// from this manifest is a floated cleanup, not agreed.

import { OpenPage, RunActivity } from './components/actionComponents';
import { AppHeader } from './components/AppHeader';
import { Contributions } from './components/Contributions';
import { InventorList } from './components/InventorList';
import { InventorProfile } from './components/InventorProfile';
import { Map } from './components/Map';
import { PageHeader } from './components/PageHeader';
import { Photos } from './components/Photos';
import { RecordActivities } from './components/RecordActivities';
import { RecordList } from './components/RecordList';
import { Tabs } from './components/Tabs';
import { Text } from './components/Text';
import { WorkOrderList } from './components/WorkOrderList';
import type { ComponentManifest } from './manifest';

type AnyComponent = ComponentManifest['component'];

export const componentManifests: Record<string, ComponentManifest> = {
  AppHeader:       { name: 'AppHeader',       version: '1.0.0', component: AppHeader       as unknown as AnyComponent, schema: AppHeader.schema,       css: AppHeader.css },
  Contributions:   { name: 'Contributions',   version: '1.0.0', component: Contributions   as unknown as AnyComponent, schema: Contributions.schema, css: Contributions.css },
  InventorList:    { name: 'InventorList',    version: '1.0.0', component: InventorList    as unknown as AnyComponent, schema: InventorList.schema,    css: InventorList.css },
  InventorProfile: { name: 'InventorProfile', version: '1.0.0', component: InventorProfile as unknown as AnyComponent, schema: InventorProfile.schema, css: InventorProfile.css },
  Map:             { name: 'Map',             version: '1.0.0', component: Map             as unknown as AnyComponent, schema: Map.schema ?? [],        css: Map.css },
  PageHeader:      { name: 'PageHeader',      version: '1.0.0', component: PageHeader      as unknown as AnyComponent, schema: PageHeader.schema,    css: PageHeader.css },
  Photos:          { name: 'Photos',          version: '1.0.0', component: Photos          as unknown as AnyComponent, schema: Photos.schema,        css: Photos.css },
  OpenPage:        { name: 'OpenPage',        version: '1.0.0', component: OpenPage        as unknown as AnyComponent, schema: OpenPage.schema,        css: OpenPage.css },
  RecordActivities: { name: 'RecordActivities', version: '1.0.0', component: RecordActivities as unknown as AnyComponent, schema: RecordActivities.schema, css: RecordActivities.css },
  RecordList:      { name: 'RecordList',      version: '1.0.0', component: RecordList      as unknown as AnyComponent, schema: RecordList.schema,     css: RecordList.css },
  RunActivity:     { name: 'RunActivity',     version: '1.0.0', component: RunActivity     as unknown as AnyComponent, schema: RunActivity.schema,     css: RunActivity.css },
  Tabs:            { name: 'Tabs',            version: '1.0.0', component: Tabs            as unknown as AnyComponent, schema: Tabs.schema,           css: Tabs.css },
  Text:            { name: 'Text',            version: '1.0.0', component: Text            as unknown as AnyComponent, schema: Text.schema,           css: Text.css },
  WorkOrderList:   { name: 'WorkOrderList',   version: '1.0.0', component: WorkOrderList   as unknown as AnyComponent, schema: WorkOrderList.schema,   css: WorkOrderList.css },
};
