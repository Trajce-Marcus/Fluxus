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
// pages, role defs and default menu (CONSOLE_RUNTIME_SPEC §1). No data, users
// or role assignments. Provenance (M12): `origin` says where it came from —
// 'authored' (this org) or 'installed' (the Catalogue; unreachable until that
// exists) — and `origin_ref` is the installed lineage, an opaque catalogue ref
// (e.g. catalogue:<id>@<version>), null for authored work. The seam that stops
// anything assuming every solution is locally authored.
export const solutions = pgTable('solutions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  origin: text('origin').notNull().default('authored'),
  originRef: text('origin_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The tenant an operation runs for. `operations.org_id` and
// `role_assignments.org_id` have carried an org key since the operations tier
// (M1) with nowhere to read a display name from; this table is that row.
// Added M13 (name only, for the Runtime header); M14 gives it the profile an
// onboarded org actually has — GitHub's model, where the org is a real thing
// with settings and a plan, and solutions/operations hang under it.
//
// `created_at` is the registration date; `plan` is what they are subscribed to
// (billing itself is later — this column just records the tier). One implicit
// 'default' org still: signing *up* a new org needs the auth tier to know
// which org a user belongs to, which doesn't exist yet.
export const orgs = pgTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contactEmail: text('contact_email'),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// An operation is the runtime unit — it links to exactly one solution and owns
// the record partition, users/assignments and its own runtime config (the menu
// today, §5). `config` is jsonb, not a table, until a second consumer demands
// one (spec §2). Single implicit org for MVP: `org_id` names a row in `orgs`
// (M13) but there is still no org-management UI.
export const operations = pgTable('operations', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  // BINDING AND PERMANENT (ruled 2026-07-27). An operation is created against
  // exactly one solution and can never be re-pointed at another: its record
  // partition, role assignments and menu override are all written against that
  // solution's model, so re-linking would orphan every one of them. Enforced by
  // absence — there is no update path, and none may be added.
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
  /** Stable identity for the item, independent of its label (2026-08-01).
   *  The editor uses it for selection and drag; §5a's subtractive overrides
   *  need it to name an inherited item that a relabel would otherwise lose.
   *  Optional: menus authored before it exists still load. */
  id?: string;
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

// Published SDM config versions — the model's change history, closing the gap
// pages have had since M3 (ruled 2026-07-26). Same posture as page_versions:
// append-only and immutable, publish snapshots the current draft `sdm_configs`
// row at `max(version)+1` with release notes, rollback republishes an older
// config as a NEW version. This is what replaces git as the model's history
// now that the repo config files are demoted to a bootstrap fixture.
export const sdmConfigVersions = pgTable('sdm_config_versions', {
  solutionId: text('solution_id').notNull(),
  version: integer('version').notNull(),
  config: jsonb('config').$type<ConfigRaw>().notNull(),
  readme: text('readme').notNull(),
  publishedBy: text('published_by').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.solutionId, t.version] }),
]);

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
