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
// Partition keys (CONSOLE_RUNTIME_SPEC §1–2, endorsed rename of the opaque
// `scope`): design artifacts (SDM config, pages) key on **solutionId**;
// records + the reporting projection key on **operationId**. An operation
// links to exactly one solution, so a runtime call resolves operation →
// solution to read the config while its data stays operation-partitioned.

import { pgTable, text, jsonb, timestamp, bigserial, bigint, integer, doublePrecision, index, primaryKey } from 'drizzle-orm/pg-core';
import type { ActivityHistoryEntry, ConfigRaw } from '@fluxus/engine';

// A solution is the design artifact — the container for one SDM config, its
// pages and role defs (CONSOLE_RUNTIME_SPEC §1). No data, users or menus.
export const solutions = pgTable('solutions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// An operation is the runtime unit — it links to exactly one solution and owns
// the record partition, users/assignments and its own runtime config (the menu
// today, §5). `config` is jsonb, not a table, until a second consumer demands
// one (spec §2). Single implicit org for MVP: the column is present, no org UI.
export const operations = pgTable('operations', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  solutionId: text('solution_id').notNull().references(() => solutions.id),
  name: text('name').notNull(),
  config: jsonb('config').$type<OperationConfig>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('operations_solution').on(t.solutionId),
]);

/** operations.config shape (spec §5): the role-gated runtime menu, and future
 *  runtime settings. Menu items address published page paths of the linked
 *  solution; role ids reference that solution's access.roles. */
export interface OperationConfig {
  menu?: MenuItem[];
}
export interface MenuItem {
  label: string;
  /** Page path (leaf items) — resolves to a published version of the solution. */
  page?: string;
  /** Role ids that may see this item; absent/empty ⇒ hidden (deny by default). */
  roles?: string[];
  /** One level of nesting max (MVP) — groups carry children instead of a page. */
  items?: MenuItem[];
}

// Governance store (CONSOLE_RUNTIME_SPEC §2a — Option B, bespoke auth-tier
// tables; RBAC_COMPACT "Roles"): assignments live here, never in the solution.
// Plain reads — no SDM, no activities.

// Runtime-plane assignments: which role ids a user holds in an operation. One
// row per (org, operation, user); the resolver's lookup 1.
export const roleAssignments = pgTable('role_assignments', {
  orgId: text('org_id').notNull().default('default'),
  operationId: text('operation_id').notNull(),
  userId: text('user_id').notNull(),
  roleIds: jsonb('role_ids').$type<string[]>().notNull().default([]),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.operationId, t.userId] }),
  index('role_assignments_operation').on(t.operationId),
]);

// Implementer-plane levels: a user's design-time level on a solution. One row
// per (user, solution); the resolver's lookup 2 (consumed at RBAC stage 2/M5).
export const implementerLevels = pgTable('implementer_levels', {
  userId: text('user_id').notNull(),
  solutionId: text('solution_id').notNull(),
  level: text('level').$type<'read' | 'write' | 'admin'>().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.solutionId] }),
  index('implementer_levels_solution').on(t.solutionId),
]);

export const sdmConfigs = pgTable('sdm_configs', {
  solutionId: text('solution_id').primaryKey(),
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
  solutionId: text('solution_id').notNull(),
  path: text('path').notNull(),
  def: jsonb('def').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.solutionId, t.path] }),
]);

// Published page versions (CONSOLE_RUNTIME_SPEC §2/§3): an append-only,
// immutable history — publishing snapshots the current draft `pages.def` at
// `max(version)+1`; rollback is republishing an older def as a NEW version,
// never a delete/edit (activity-history posture). Runtime renders the latest
// version per path; Console edits the drafts in `pages`.
export const pageVersions = pgTable('page_versions', {
  solutionId: text('solution_id').notNull(),
  path: text('path').notNull(),
  version: integer('version').notNull(),
  def: jsonb('def').notNull(),
  readme: text('readme').notNull(),
  publishedBy: text('published_by').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.solutionId, t.path, t.version] }),
]);

export const records = pgTable('records', {
  operationId: text('operation_id').notNull(),
  id: text('id').notNull(),
  typeRef: text('type_ref').notNull(),
  customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull(),
  activityHistory: jsonb('activity_history').$type<ActivityHistoryEntry[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.operationId, t.id] }),
  index('records_operation_type').on(t.operationId, t.typeRef),
]);

export const rptActivities = pgTable('rpt_activities', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  operationId: text('operation_id').notNull(),
  recordId: text('record_id').notNull(),
  recordType: text('record_type').notNull(),
  activityId: text('activity_id').notNull(),
  activityName: text('activity_name').notNull(),
  // context.user is the demo stub until auth exists — projected as-is.
  author: text('author').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
}, (t) => [
  index('rpt_activities_operation_record').on(t.operationId, t.recordId),
  index('rpt_activities_operation_activity').on(t.operationId, t.activityId),
]);

// The attachments ledger (ATTRIBUTE_TYPES_FILES_SCALARS §8): one row per
// uploaded blob object, inserted `pending` at presign and flipped `committed`
// when a submission referencing its storage_key lands. It is NOT the source of
// truth and nothing references its rows — pipeline values stay by-value, so a
// GC bug can never corrupt history. It answers the bucket-side / cross-system
// questions the pipeline is bad at: the quota fuse (local SUM(size), no
// Cloudflare usage API), duplicate/integrity queries (same hash re-uploaded;
// EXIF geo/time miles or years off), and trivial deferred GC (stale `pending`
// rows). Rebuildable from a bucket listing + history if ever lost.
export const attachments = pgTable('attachments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  storageKey: text('storage_key').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  mime: text('mime').notNull(),
  hash: text('hash'),
  // Photo metadata — nullable (files carry none; a photo may lack EXIF geo/time).
  width: integer('width'),
  height: integer('height'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  takenAt: timestamp('taken_at', { withTimezone: true }),
  // pending → committed.
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('attachments_status').on(t.status),
  index('attachments_hash').on(t.hash),
  index('attachments_storage_key').on(t.storageKey),
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
