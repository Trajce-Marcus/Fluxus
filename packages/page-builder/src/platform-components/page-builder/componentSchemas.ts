// Imports individual component files (not the registry) to avoid the circular
// dependency: registry → Shell → ContentArea → PageEditor → registry.
import { AppHeader } from '../../components/AppHeader';
import { InventorList } from '../../components/InventorList';
import { InventorProfile } from '../../components/InventorProfile';
import { Map } from '../../components/Map';
import { WorkOrderList } from '../../components/WorkOrderList';
import type { PropSchema } from '../../components/schema';

export const componentSchemas: Record<string, PropSchema[]> = {
  AppHeader: AppHeader.schema ?? [],
  InventorList: InventorList.schema ?? [],
  InventorProfile: InventorProfile.schema ?? [],
  Map: Map.schema ?? [],
  WorkOrderList: WorkOrderList.schema ?? [],
};
