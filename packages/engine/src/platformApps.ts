// The platform's apps (APPS_AND_INSTANCES Part 2 §2.4). An operation's apps
// list is records of `rt_sys_apps`, a record type no solution defines. Until
// step 5 these are ids only: the server reads and writes the rows directly,
// and keeps them out of every general read. Step 5 puts the record type and
// its empty workflow here, for the engine and `validateConfig` to add.

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
