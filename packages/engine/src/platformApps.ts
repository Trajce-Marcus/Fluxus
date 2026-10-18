// The platform's apps (APPS_AND_INSTANCES Part 2 §2.4). An operation's apps
// list is records of `rt_sys_apps`, a record type no solution defines. The
// server reads and writes the rows directly, and keeps them out of every
// general read. Since step 5 the record type and its empty workflow are
// defined here, once: `validateConfig` adds them to the model it checks, so an
// app's own activities are typed against them, and the engine runs those
// activities on an app's record and keeps scripts from changing it. Never
// stored, never sent to a browser.

import type { ClientRecordTypeDef, ClientWorkflowRawDef } from './types';

/** The record type of an app in an operation's apps list. */
export const APPS_RECORD_TYPE = 'rt_sys_apps';
/** Its workflow, empty: what runs on an app comes from its page's list. */
export const APPS_WORKFLOW = 'wf_sys_apps';
/** The history entry every Console change to an app leaves on it. */
export const CONSOLE_EDIT = { id: 'sys_console_edit', name: 'Changed in the Console' } as const;
/** The history entry the step 2 migration leaves on each app it creates. */
export const MIGRATION_EDIT = { id: 'sys_migration', name: 'Created by the migration' } as const;

/** Ids no solution may give a record type, workflow or activity. */
export const RESERVED_IDS: ReadonlySet<string> = new Set([APPS_RECORD_TYPE, APPS_WORKFLOW, CONSOLE_EDIT.id, MIGRATION_EDIT.id]);

/**
 * The platform's definition of `rt_sys_apps`, as scripts see it: the fields an
 * app's own activities read through `context.record` — its page, its name and
 * its definition (JSON text). Not its roles: who may run an app is not a
 * script's business (the 2026-10-18 ruling), though the stored record holds
 * `role_ids` too.
 */
export const APPS_RECORD_TYPE_DEF: ClientRecordTypeDef = {
  id: APPS_RECORD_TYPE,
  name: 'Apps',
  description: "An app in an operation's apps list",
  workflow_ref: APPS_WORKFLOW,
  custom_fields: [
    { key: 'page_id', type: 'text' },
    { key: 'label', type: 'text' },
    { key: 'definition', type: 'text' },
  ],
};

/** Its workflow, empty: what runs on an app comes from its page's list. */
export const APPS_WORKFLOW_DEF: ClientWorkflowRawDef = {
  id: APPS_WORKFLOW,
  name: 'Apps',
  description: "Empty — what runs on an app comes from its page's list",
  activities: [],
};

/**
 * What a script knows about the app a call came through (§2.2):
 * `context.app`. Its page, its name, and its definition parsed from its JSON
 * text — never its roles.
 */
export interface AppScope {
  pageId: string;
  label: string;
  definition: unknown;
}
