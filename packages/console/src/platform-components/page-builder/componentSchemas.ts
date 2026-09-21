// Palette-side prop-schema lookup. The components live in @fluxus/page-runtime
// since the extraction; this stays a separate list from componentManifests by
// standing decision (deriving the three registries from the manifest is a
// floated cleanup, not agreed).
import {
  AppHeader,
  InventorList,
  InventorProfile,
  Map,
  OpenPage,
  RecordActivities,
  RecordList,
  Text,
  RunActivity,
  WorkOrderList,
  type PropSchema,
} from '@fluxus/page-runtime';

export const componentSchemas: Record<string, PropSchema[]> = {
  AppHeader: AppHeader.schema ?? [],
  InventorList: InventorList.schema ?? [],
  InventorProfile: InventorProfile.schema ?? [],
  Map: Map.schema ?? [],
  OpenPage: OpenPage.schema ?? [],
  RecordActivities: RecordActivities.schema ?? [],
  RecordList: RecordList.schema ?? [],
  Text: Text.schema ?? [],
  RunActivity: RunActivity.schema ?? [],
  WorkOrderList: WorkOrderList.schema ?? [],
};
