// The two data layers on one Neon Postgres (v1 deployment per root
// ARCHITECTURE.md "Data architecture — two layers"):
//
//   TRANSACTIONAL — records: SDM-partitioned JSONB rows in the exact
//   RecordInstance shape (activity history embedded). Lean by doctrine;
//   runtime queries are partition-fetch + filter.
//
//   REPORTING — rpt_activities / rpt_attributes: the fully normalized
//   projection of the activity stream (agreed 2026-07-12). One activities row
//   per run; one attributes row per attribute with a single text `value`
//   column; a waived attribute is the SAME row with value null and waive_desc
//   carrying the reason. Derived and rebuildable by re-projection — hooks stay
//   out of this layer.
//
// `scope` is the partition key: an opaque path string (today 'demo/sdm';
// org-defined repo/folder levels slot in later as data, not as schema).

import { pgTable, text, jsonb, timestamp, bigserial, bigint, index, primaryKey } from 'drizzle-orm/pg-core';
import type { ActivityHistoryEntry, ConfigRaw } from '@fluxus/engine';

export const sdmConfigs = pgTable('sdm_configs', {
  scope: text('scope').primaryKey(),
  config: jsonb('config').$type<ConfigRaw>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Page definitions ride the config pipeline (ruled 2026-07-16): server is
// runtime truth, repo page files are the deploy input (seed upserts them —
// deploying pages = deploying files). One row per page so the page builder
// saves a single page without touching the SDM config blob. `def` is opaque
// jsonb here: PageDef and validatePage live in the page builder (a host);
// the server never depends on a peer host.
export const pages = pgTable('pages', {
  scope: text('scope').notNull(),
  path: text('path').notNull(),
  def: jsonb('def').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.scope, t.path] }),
]);

export const records = pgTable('records', {
  scope: text('scope').notNull(),
  id: text('id').notNull(),
  typeRef: text('type_ref').notNull(),
  customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull(),
  activityHistory: jsonb('activity_history').$type<ActivityHistoryEntry[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.scope, t.id] }),
  index('records_scope_type').on(t.scope, t.typeRef),
]);

export const rptActivities = pgTable('rpt_activities', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  scope: text('scope').notNull(),
  recordId: text('record_id').notNull(),
  recordType: text('record_type').notNull(),
  activityId: text('activity_id').notNull(),
  activityName: text('activity_name').notNull(),
  // context.user is the demo stub until auth exists — projected as-is.
  author: text('author').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
}, (t) => [
  index('rpt_activities_scope_record').on(t.scope, t.recordId),
  index('rpt_activities_scope_activity').on(t.scope, t.activityId),
]);

export const rptAttributes = pgTable('rpt_attributes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  activityRowId: bigint('activity_row_id', { mode: 'number' }).notNull().references(() => rptActivities.id),
  key: text('key').notNull(),
  // Single text column — queries stay uniform; typed queries cast on query.
  value: text('value'),
  waiveDesc: text('waive_desc'),
}, (t) => [
  index('rpt_attributes_activity').on(t.activityRowId),
  index('rpt_attributes_key_value').on(t.key, t.value),
]);
