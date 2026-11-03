import type { ActivityRawDef, SolutionModel, RecordTypeDef, WorkflowRawDef, AttributeDef } from '@fluxus/engine';

// The model the tests run against, and nothing else. The running app never
// reads it — it fetches its model from the server.
//
// It used to be bigger, and it used to be installed: until 2026-08-05 the seed
// script pushed these files into a database, so a real solution could descend
// from them and then drift away as the files and the database were edited
// separately. The seed script is gone (nothing prepopulates a database), and on
// 2026-08-11 everything the tests do not exercise was deleted with it, so the
// files no longer resemble a solution anyone could mistake for a second copy of
// one. What remains is what two test files reach: `test/dsl-wiring.test.ts`
// uses assets, cities, suburbs and work orders directly and asset types, jobs,
// workgroups and contracts through their foreign keys; the server's
// `test/headless.test.ts` (which imports this file too) adds inspection
// checklists, the only end-to-end exercise of composite attributes.
//
// Split one file per entity — a record type, its workflow and the pool
// activities that workflow lists, always edited together — plus the shared
// attribute and function pools. Everything merges back
// into one SolutionModel here; nothing downstream knows about files.

import attributes from '../model/attributes.json';
import functions from '../model/functions.json';

import assetTypes from '../model/entities/asset_types.json';
import assets from '../model/entities/assets.json';
import jobs from '../model/entities/jobs.json';
import workgroups from '../model/entities/workgroups.json';
import contracts from '../model/entities/contracts.json';
import workOrders from '../model/entities/work_orders.json';
import cities from '../model/entities/cities.json';
import suburbs from '../model/entities/suburbs.json';
import inspectionChecklists from '../model/entities/inspection_checklists.json';

interface EntityFile {
  recordType: RecordTypeDef;
  workflow: WorkflowRawDef;
  activities: ActivityRawDef[];
}

// Order here is display order in the workbench sidebar.
const entities = [
  assetTypes,
  assets,
  jobs,
  workgroups,
  contracts,
  workOrders,
  cities,
  suburbs,
  inspectionChecklists,
] as unknown as EntityFile[];

export const model: SolutionModel = {
  attributes: attributes as unknown as AttributeDef[],
  activities: entities.flatMap((e) => e.activities),
  recordTypes: entities.map((e) => e.recordType),
  workflows: entities.map((e) => e.workflow),
  functions: functions as SolutionModel['functions'],
};
