// Palette-side prop-schema lookup. The components live in @fluxus/page-runtime
// since the extraction; this stays a separate list from componentManifests by
// standing decision (deriving the three registries from the manifest is a
// floated cleanup, not agreed).
import {
  AppHeader,
  InventorList,
  InventorProfile,
  Map,
  WorkOrderList,
  type PropSchema,
} from '@fluxus/page-runtime';

export const componentSchemas: Record<string, PropSchema[]> = {
  AppHeader: AppHeader.schema ?? [],
  InventorList: InventorList.schema ?? [],
  InventorProfile: InventorProfile.schema ?? [],
  Map: Map.schema ?? [],
  WorkOrderList: WorkOrderList.schema ?? [],
};
