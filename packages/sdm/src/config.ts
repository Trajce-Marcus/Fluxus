import type { ConfigRaw, RecordTypeDef, WorkflowRawDef, AttributeDef } from './types';

// The SDM is split for hand-editing: shared pools (attributes, functions) plus
// one file per entity (record type + its workflow, always edited as a pair).
// This layout is a POC-era convenience — the endgame is the SDM in a database,
// edited through UI. Everything merges back into one ConfigRaw here; nothing
// downstream knows about files.

import attributes from '../config/attributes.json';
import functions from '../config/functions.json';

import assetTypes from '../config/entities/asset_types.json';
import assets from '../config/entities/assets.json';
import jobs from '../config/entities/jobs.json';
import workgroups from '../config/entities/workgroups.json';
import resources from '../config/entities/resources.json';
import contracts from '../config/entities/contracts.json';
import wgPlans from '../config/entities/wg_plans.json';
import wgResources from '../config/entities/wg_resources.json';
import workOrders from '../config/entities/work_orders.json';
import woResources from '../config/entities/wo_resources.json';
import woAssets from '../config/entities/wo_assets.json';

interface EntityFile {
  recordType: RecordTypeDef;
  workflow: WorkflowRawDef;
}

// Order here is display order in the workbench sidebar.
const entities = [
  assetTypes,
  assets,
  jobs,
  workgroups,
  resources,
  contracts,
  wgPlans,
  wgResources,
  workOrders,
  woResources,
  woAssets,
] as unknown as EntityFile[];

export const config: ConfigRaw = {
  attributes: attributes as unknown as AttributeDef[],
  recordTypes: entities.map((e) => e.recordType),
  workflows: entities.map((e) => e.workflow),
  functions: functions as ConfigRaw['functions'],
};
