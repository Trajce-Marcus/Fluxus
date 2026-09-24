// Palette-side prop-schema lookup. The components live in @fluxus/page-runtime
// since the extraction; this stays a separate list from componentManifests by
// standing decision (deriving the three registries from the manifest is a
// floated cleanup, not agreed).
import {
  AppHeader,
  Contributions,
  InventorList,
  InventorProfile,
  Map,
  OpenPage,
  PageHeader,
  Photos,
  RecordActivities,
  RecordList,
  Text,
  RunActivity,
  Tabs,
  WorkOrderList,
  type PropSchema,
} from '@fluxus/page-runtime';

export const componentSchemas: Record<string, PropSchema[]> = {
  AppHeader: AppHeader.schema ?? [],
  Contributions: Contributions.schema ?? [],
  InventorList: InventorList.schema ?? [],
  InventorProfile: InventorProfile.schema ?? [],
  Map: Map.schema ?? [],
  OpenPage: OpenPage.schema ?? [],
  PageHeader: PageHeader.schema ?? [],
  Photos: Photos.schema ?? [],
  RecordActivities: RecordActivities.schema ?? [],
  RecordList: RecordList.schema ?? [],
  Text: Text.schema ?? [],
  RunActivity: RunActivity.schema ?? [],
  Tabs: Tabs.schema ?? [],
  WorkOrderList: WorkOrderList.schema ?? [],
};
