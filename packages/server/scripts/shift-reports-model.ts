// One-off, 2026-09-23. The shift-reports model — eight record types, their
// attributes and activities — per `solutions/projects/docs/SHIFT_REPORTS.md`
// §4, §5, §6, §10, §10a. Pages are a separate script; demonstration data is a
// separate session (per the spec's own instruction).
//
// **A deliberate departure from §10's literal wording, flagged rather than
// silently taken.** §10 says "both status sets" (`sr_status`, `def_status`)
// "are enforced at capture by a list attribute". This build gives neither one
// a pool attribute at all — `status` is written straight inside each
// transition's after hook (`context.record.update({ status: 'Approved' })`),
// exactly the way `rt_projects.status` / `wbs_status` already work, and for
// the same reason §5 spells out at length for Approve: a captured attribute
// whose key matches the field auto-applies as part of the activity's own
// write, *outside* the after hook's transactional boundary, so it survives a
// hook failure that leaves the rest of the transition half-done. Writing the
// literal inside the hook keeps success and failure atomic. The alternative —
// a differently-keyed `sr_status`/`def_status` attribute the hook reads and
// bridges onto `status` — was considered and dropped: it adds a mapping this
// codebase has never used anywhere else, for no behavioural difference, since
// no field named `status`/`def_status` is ever captured by these activities
// either way. `wg_type`, `res_type`, `shift` and `severity` DO get real `list`
// attributes — four, not six, proving the mechanism on real interactive
// capture (`severity`) as well as literal small sets.
//
// **This build (2026-09-23, second pass) follows a design thread that reopened
// after a cold-test found three real gaps — see SHIFT_REPORTS.md §1.1.**
// Work groups may now split into children (§4.1a); Submit and Approve warn
// rather than silently drift when the WBS hours no longer total work_hours
// (§5.2); Reject and Cancel give a submitted report a way back (§5.3); and a
// correction to an approved report is an amendment — the same record type,
// its own activity set (§5.4). The largest-remainder split that Approve does
// by hand is now `services.math.distribute` (packages/engine/docs/SPEC.md,
// beside `services.time`) — a capability, not a recipe repeated in every hook
// that divides.
//
// **The four defects §10a measured, and where each is guarded here:**
//   1. blank fk_ref is not null → every emptiness test on a reference is
//      `<> ''`, never `is not null` (standardResourceSet's own-set lookup,
//      the work-group leaf/parent checks, and — back again, for a different
//      reason — the per-line `wbs_id <> ''` branch in Approve that tells an
//      amendment's whole-line posting from an ordinary report's divided one).
//   2. float equality on hours → the Calculate/Submit/Approve gates compare
//      `round(x, 6)`.
//   3. a blank number turns a running total to text → every accumulation
//      guards its own term with `iif(x = '' or x = null, 0, x)`, not just the
//      final comparison.
//   4. divided shares do not add up → Approve calls `services.math.distribute`,
//      which floors every share and hands the leftover units to the largest
//      remainders, so the parts always sum to the whole.
//
// Written through the config writers, dependency-ordered so a field's
// `fk_record_type` and a GET's `returns` never name a type that is not yet in
// the store: work_groups, resources, wg_resources, shift_reports, shift_wbs,
// shift_report_resource_usage, wbs_resource_usage, defects. Idempotent —
// every write is an upsert of the whole entity. Pass --dry to print and write
// nothing.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');
const ROLES = ['role_project_admin', 'role_project_user'];

// ── small builders, matching the style of wbs-lifecycle.ts ─────────────────

const attrs = (...specs: (string | { key: string; source?: string; required?: boolean })[]) =>
  specs.map((s) => (typeof s === 'string' ? { attribute_ref: s } : { attribute_ref: s.key, ...(s.source ? { source: s.source } : {}), ...(s.required !== undefined ? { required: s.required } : {}) }));

const sourced = (key: string, source: string) => ({ key, source });

// ── 1. new pool attributes ──────────────────────────────────────────────────
// Reused as-is from the existing pool (verified against the live config):
// `project_id`, `code`, `name`, `description`, `expired`, `unit`, `location`.

const ATTRIBUTES = [
  // work groups
  { key: 'wg_code', type: 'text', label: 'Work group code', description: 'WG-WELD.' },
  {
    key: 'wg_parent', type: 'reference', label: 'Parent work group',
    description: "The group this one sits under. Names the work group's own parent field, so it is checked against work groups.",
    type_config: { field: 'rt_work_groups.parent_id' },
  },
  { key: 'manager', type: 'text', label: 'Manager', description: 'The person who owes the shift report.' },
  {
    key: 'wg_type', type: 'list', label: 'Type', description: 'Crew, shared plant, or subcontractor.',
    type_config: { datasource: "['Crew', 'Shared plant', 'Subcontractor']" },
  },
  { key: 'active', type: 'text', label: 'Active', description: "'true' or 'false'. Closing a group ends the expectation without deleting history." },

  // resources
  {
    key: 'res_type', type: 'list', label: 'Resource type', description: 'Labour, plant, materials, or subcontract.',
    type_config: { datasource: "['LAB', 'PLT', 'MAT', 'SUB']" },
  },
  { key: 'rate', type: 'decimal', label: 'Rate', description: 'The standard rate for this resource, or a work group’s override of it.' },
  {
    key: 'cbs_id', type: 'reference', label: 'Cost code', description: 'What kind of cost this is.',
    type_config: { fk_record_type: 'rt_cbs_nodes', datasource: "invoke('act_list_cbs_nodes', { project_id: attributes.project_id })", display_field: 'name' },
  },

  // work group resources / shift usage. `wg_id` is never shown — every use
  // sources it (§4.9: "wg_id on two of the new record types") — so it names
  // no datasource, unlike the pickers below.
  {
    key: 'wg_id', type: 'reference', label: 'Work group', description: 'The work group this belongs to.',
    type_config: { fk_record_type: 'rt_work_groups' },
  },
  {
    key: 'report_id', type: 'reference', label: 'Shift report', description: 'The shift report this belongs to.',
    type_config: { fk_record_type: 'rt_shift_reports' },
  },
  {
    key: 'resource_id', type: 'reference', label: 'Resource', description: 'A resource from the project catalogue.',
    type_config: { fk_record_type: 'rt_resources', datasource: "invoke('act_list_resources', { project_id: attributes.project_id })", display_field: 'description' },
  },
  { key: 'quantity', type: 'decimal', label: 'Quantity', description: 'A count, or a resource-hours figure once priced.' },

  // shift reports
  { key: 'report_date', type: 'datetime', label: 'Report date', description: '' },
  {
    key: 'shift', type: 'list', label: 'Shift', description: 'A label for grouping; the times carry the real information.',
    type_config: { datasource: "['Day', 'Night']" },
  },
  { key: 'start_time', type: 'time', label: 'Start time', description: '' },
  { key: 'end_time', type: 'time', label: 'End time', description: '' },
  { key: 'break_hours', type: 'decimal', label: 'Break hours', description: 'Non-work time within the shift — meals, crib.' },
  { key: 'hours_lost', type: 'decimal', label: 'Hours lost', description: 'Lost to weather or delay. The measurement only.' },
  { key: 'weather', type: 'text', label: 'Weather', description: '' },
  { key: 'work_summary', type: 'text', label: 'Work summary', description: '', type_config: { multiline: true } },
  { key: 'site_notes', type: 'text', label: 'Site notes', description: '', type_config: { multiline: true } },
  {
    key: 'report_photos', type: 'photo', label: 'Photos', description: 'Photos of the shift.',
    type_config: { multi: true, max_count: 6 },
  },
  {
    key: 'amended_report_id', type: 'reference', label: 'Amends report',
    description: "The approved report this amendment corrects. Names the report's own field, so it is checked against shift reports — blank means an ordinary report, set means an amendment (§5.4). Not the pooled report_id, which makes a different claim.",
    type_config: { field: 'rt_shift_reports.amended_report_id' },
  },

  // WBS / usage picking, shared across several of the new types (§4.9)
  {
    key: 'wbs_id', type: 'reference', label: 'WBS node', description: 'A leaf node on the work breakdown structure.',
    type_config: { fk_record_type: 'rt_wbs_nodes', datasource: "invoke('act_search_wbs_leaves', { project_id: attributes.project_id, term: term })", display_field: 'code' },
  },
  { key: 'term', type: 'text', label: 'Search term', description: "A record picker's search box." },
  { key: 'hours', type: 'decimal', label: 'Hours', description: 'Hours on this WBS node this shift.' },
  { key: 'qty_completed', type: 'decimal', label: 'Quantity completed', description: 'Quantity done today.' },
  { key: 'qty_unit', type: 'text', label: 'Unit', description: '' },
  { key: 'notes', type: 'text', label: 'Notes', description: '' },

  // defects
  { key: 'def_description', type: 'text', label: 'Description', description: '', type_config: { multiline: true } },
  { key: 'raised_by', type: 'text', label: 'Raised by', description: '' },
  {
    key: 'severity', type: 'list', label: 'Severity', description: '',
    type_config: { datasource: "['Minor', 'Major', 'Critical']" },
  },
  {
    key: 'defect_photos', type: 'photo', label: 'Photos', description: 'Photos of the defect.',
    type_config: { multi: true },
  },
  { key: 'assigned_to', type: 'text', label: 'Assigned to', description: '' },
  { key: 'rectified_date', type: 'datetime', label: 'Rectified date', description: '' },
  { key: 'rectification_notes', type: 'text', label: 'Rectification notes', description: '', type_config: { multiline: true } },
  { key: 'verified_date', type: 'datetime', label: 'Verified date', description: '' },
  { key: 'verified_by', type: 'text', label: 'Verified by', description: '' },
];

// ── 2. functions ─────────────────────────────────────────────────────────────

const STANDARD_RESOURCE_SET = {
  id: 'fn_standard_resource_set',
  name: 'standardResourceSet',
  description: "A work group's own standard resources (§4.1a) — never its parent's. A child with none of its own reads as empty rather than borrowing; the parent shares nothing downward.",
  body: [
    'function standardResourceSet(wgId) {',
    "  return records.wg_resources.where(wg_id = wgId and expired <> 'true')",
    '}',
  ].join('\n'),
};

// ── 3. record types ──────────────────────────────────────────────────────────

const rtWorkGroups = {
  id: 'rt_work_groups',
  name: 'Work Groups',
  access: { read: ROLES },
  description: 'The unit of responsibility for a shift report — a crew, shared plant, or a subcontractor.',
  workflow_ref: 'wf_work_groups',
  custom_fields: [
    { key: 'wg_code', type: 'text', label: 'Code', default: '', indexed: true, required: true },
    { key: 'parent_id', type: 'fk_ref', label: 'Parent', default: '', indexed: true, fk_record_type: 'rt_work_groups', fk_display_field: 'wg_code' },
    { key: 'name', type: 'text', label: 'Name', default: '', required: true },
    { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', indexed: true, required: true, fk_record_type: 'rt_projects', fk_display_field: 'project_no' },
    { key: 'manager', type: 'text', label: 'Manager', default: '' },
    { key: 'wg_type', type: 'text', label: 'Type', default: 'Crew' },
    { key: 'active', type: 'text', label: 'Active', default: 'true', indexed: true },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

const rtResources = {
  id: 'rt_resources',
  name: 'Resources',
  access: { read: ROLES },
  description: "A project's resource catalogue — what costs money by the hour or the day.",
  workflow_ref: 'wf_resources',
  custom_fields: [
    { key: 'code', type: 'text', label: 'Code', default: '', indexed: true, required: true },
    { key: 'description', type: 'text', label: 'Description', default: '', required: true },
    { key: 'res_type', type: 'text', label: 'Type', default: 'LAB' },
    { key: 'unit', type: 'text', label: 'Unit', default: '' },
    { key: 'rate', type: 'decimal', label: 'Rate', default: '' },
    { key: 'cbs_id', type: 'fk_ref', label: 'Cost code', default: '', indexed: true, required: true, fk_record_type: 'rt_cbs_nodes', fk_display_field: 'name' },
    { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', indexed: true, required: true, fk_record_type: 'rt_projects', fk_display_field: 'project_no' },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

const rtWgResources = {
  id: 'rt_wg_resources',
  name: 'Work Group Resources',
  access: { read: ROLES },
  description: "A selection from the catalogue with counts, held on whichever group owns them — a work group's standard set.",
  workflow_ref: 'wf_wg_resources',
  custom_fields: [
    { key: 'wg_id', type: 'fk_ref', label: 'Work group', default: '', indexed: true, required: true, fk_record_type: 'rt_work_groups', fk_display_field: 'wg_code' },
    { key: 'resource_id', type: 'fk_ref', label: 'Resource', default: '', indexed: true, required: true, fk_record_type: 'rt_resources', fk_display_field: 'description' },
    { key: 'quantity', type: 'decimal', label: 'Quantity', default: '', required: true },
    { key: 'rate', type: 'decimal', label: 'Rate override', default: '' },
    { key: 'cbs_id', type: 'fk_ref', label: 'Cost code override', default: '', fk_record_type: 'rt_cbs_nodes', fk_display_field: 'name' },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

const rtShiftReports = {
  id: 'rt_shift_reports',
  name: 'Shift Reports',
  access: { read: ROLES },
  description: 'One work group, one shift: times, WBS hours, resources used, photos and narrative. Filed and approved.',
  workflow_ref: 'wf_shift_reports',
  custom_fields: [
    { key: 'report_no', type: 'text', label: 'Report no.', default: '' },
    { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', indexed: true, required: true, fk_record_type: 'rt_projects', fk_display_field: 'project_no' },
    { key: 'wg_id', type: 'fk_ref', label: 'Work group', default: '', indexed: true, required: true, fk_record_type: 'rt_work_groups', fk_display_field: 'wg_code' },
    // Not required at the field level, deliberately (§4.9/§5.4): an amendment
    // is never asked for date, shift or times, and required-ness lives on the
    // activity — the ordinary Create/Modify usages below mark these required,
    // the amendment's Create does not name them at all.
    { key: 'report_date', type: 'datetime', label: 'Date', default: '' },
    { key: 'shift', type: 'text', label: 'Shift', default: 'Day' },
    { key: 'start_time', type: 'time', label: 'Start time', default: '' },
    { key: 'end_time', type: 'time', label: 'End time', default: '' },
    { key: 'break_hours', type: 'decimal', label: 'Break hours', default: '' },
    { key: 'work_hours', type: 'decimal', label: 'Work hours', default: '' },
    { key: 'hours_lost', type: 'decimal', label: 'Hours lost', default: '' },
    { key: 'weather', type: 'text', label: 'Weather', default: '' },
    { key: 'work_summary', type: 'text', label: 'Work summary', default: '' },
    { key: 'site_notes', type: 'text', label: 'Site notes', default: '' },
    { key: 'report_photos', type: 'photo', label: 'Photos', default: '' },
    { key: 'status', type: 'text', label: 'Status', default: 'Draft', indexed: true },
    { key: 'approved_by', type: 'text', label: 'Approved by', default: '' },
    { key: 'approved_date', type: 'datetime', label: 'Approved date', default: '' },
    // Blank on an ordinary report; set on an amendment — the approved report
    // it corrects (§5.4). One field carries both the pointer and the fact.
    { key: 'amended_report_id', type: 'fk_ref', label: 'Amends report', default: '', indexed: true, fk_record_type: 'rt_shift_reports', fk_display_field: 'report_no' },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

const rtShiftWbs = {
  id: 'rt_shift_wbs',
  name: 'Shift WBS Rows',
  access: { read: ROLES },
  description: 'One row per WBS node a shift report touched — hours and quantity completed.',
  workflow_ref: 'wf_shift_wbs',
  custom_fields: [
    { key: 'report_id', type: 'fk_ref', label: 'Report', default: '', indexed: true, required: true, fk_record_type: 'rt_shift_reports', fk_display_field: 'report_no' },
    { key: 'wbs_id', type: 'fk_ref', label: 'WBS node', default: '', indexed: true, required: true, fk_record_type: 'rt_wbs_nodes', fk_display_field: 'code' },
    { key: 'hours', type: 'decimal', label: 'Hours', default: '', required: true },
    { key: 'qty_completed', type: 'decimal', label: 'Quantity completed', default: '' },
    { key: 'qty_unit', type: 'text', label: 'Unit', default: '' },
    { key: 'notes', type: 'text', label: 'Notes', default: '' },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

const rtShiftReportResourceUsage = {
  id: 'rt_shift_report_resource_usage',
  name: 'Shift Report Resource Usage',
  access: { read: ROLES },
  description: 'What a shift consumed — one line per resource, priced by Calculate.',
  workflow_ref: 'wf_shift_report_resource_usage',
  custom_fields: [
    { key: 'report_id', type: 'fk_ref', label: 'Report', default: '', indexed: true, required: true, fk_record_type: 'rt_shift_reports', fk_display_field: 'report_no' },
    { key: 'resource_id', type: 'fk_ref', label: 'Resource', default: '', fk_record_type: 'rt_resources', fk_display_field: 'description' },
    { key: 'description', type: 'text', label: 'Description', default: '' },
    { key: 'notes', type: 'text', label: 'Notes', default: '' },
    { key: 'quantity', type: 'decimal', label: 'Quantity', default: '' },
    // Blank on an ordinary line, divided across the report's WBS rows by
    // hours; set on an amendment's line, posted whole to that node (§5.1,
    // §5.4). The test at Approve is `wbs_id <> ''` — a blank fk_ref is not
    // null (§10a).
    { key: 'wbs_id', type: 'fk_ref', label: 'WBS node', default: '', fk_record_type: 'rt_wbs_nodes', fk_display_field: 'code' },
    { key: 'calculated', type: 'text', label: 'Calculated', default: 'false' },
    { key: 'unit', type: 'text', label: 'Unit', default: '' },
    { key: 'rate', type: 'decimal', label: 'Rate', default: '' },
    { key: 'cbs_id', type: 'fk_ref', label: 'Cost code', default: '', fk_record_type: 'rt_cbs_nodes', fk_display_field: 'name' },
    { key: 'tracked_cost', type: 'decimal', label: 'Tracked cost', default: '' },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

const rtWbsResourceUsage = {
  id: 'rt_wbs_resource_usage',
  name: 'WBS Resource Usage',
  access: { read: ROLES },
  description: "Where a shift's cost landed on the WBS — written at approval, holds only approved figures.",
  workflow_ref: 'wf_wbs_resource_usage',
  custom_fields: [
    { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', indexed: true, required: true, fk_record_type: 'rt_projects', fk_display_field: 'project_no' },
    { key: 'report_id', type: 'fk_ref', label: 'Report', default: '', indexed: true, required: true, fk_record_type: 'rt_shift_reports', fk_display_field: 'report_no' },
    { key: 'source_line_id', type: 'fk_ref', label: 'Source line', default: '', required: true, fk_record_type: 'rt_shift_report_resource_usage', fk_display_field: 'description' },
    { key: 'wbs_id', type: 'fk_ref', label: 'WBS node', default: '', indexed: true, required: true, fk_record_type: 'rt_wbs_nodes', fk_display_field: 'code' },
    { key: 'cbs_id', type: 'fk_ref', label: 'Cost code', default: '', indexed: true, fk_record_type: 'rt_cbs_nodes', fk_display_field: 'name' },
    { key: 'usage_date', type: 'datetime', label: 'Date', default: '' },
    { key: 'quantity', type: 'decimal', label: 'Quantity', default: '' },
    { key: 'tracked_cost', type: 'decimal', label: 'Tracked cost', default: '' },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

const rtDefects = {
  id: 'rt_defects',
  name: 'Defects',
  access: { read: ROLES },
  description: 'Raised from the shift report that found it, with a life of its own afterwards.',
  workflow_ref: 'wf_defects',
  custom_fields: [
    { key: 'defect_no', type: 'text', label: 'Defect no.', default: '' },
    { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', indexed: true, required: true, fk_record_type: 'rt_projects', fk_display_field: 'project_no' },
    { key: 'wbs_id', type: 'fk_ref', label: 'WBS node', default: '', indexed: true, fk_record_type: 'rt_wbs_nodes', fk_display_field: 'code' },
    { key: 'report_id', type: 'fk_ref', label: 'Report', default: '', indexed: true, fk_record_type: 'rt_shift_reports', fk_display_field: 'report_no' },
    { key: 'raised_date', type: 'datetime', label: 'Raised date', default: '' },
    { key: 'raised_by', type: 'text', label: 'Raised by', default: '' },
    { key: 'location', type: 'text', label: 'Location', default: '' },
    { key: 'def_description', type: 'text', label: 'Description', default: '' },
    { key: 'severity', type: 'text', label: 'Severity', default: 'Minor' },
    { key: 'defect_photos', type: 'photo', label: 'Photos', default: '' },
    { key: 'assigned_to', type: 'text', label: 'Assigned to', default: '' },
    { key: 'rectified_date', type: 'datetime', label: 'Rectified date', default: '' },
    { key: 'rectification_notes', type: 'text', label: 'Rectification notes', default: '' },
    { key: 'verified_date', type: 'datetime', label: 'Verified date', default: '' },
    { key: 'verified_by', type: 'text', label: 'Verified by', default: '' },
    { key: 'status', type: 'text', label: 'Status', default: 'Open', indexed: true },
    { key: 'expired', type: 'text', label: 'Expired', default: 'false', indexed: true },
  ],
};

// ── 4. workflows / activities ───────────────────────────────────────────────
// Numbering (report_no / defect_no): counts the project's records — not
// count-and-add-one, because the record the activity just made is already
// stored by the time the after hook runs (§10, verified). Zero-padded by
// cascading iif, since the language has no format builtin.

const numberingHook = (collection: string, prefix: string, width: 3 | 4) => {
  const cases = width === 4
    ? "iif(len(seq) = 1, '000' + seq, iif(len(seq) = 2, '00' + seq, iif(len(seq) = 3, '0' + seq, seq)))"
    : "iif(len(seq) = 1, '00' + seq, iif(len(seq) = 2, '0' + seq, seq))";
  return [
    `let n = records.${collection}.where(project_id = context.record.project_id).count`,
    "let seq = '' + n",
    `let padded = ${cases}`,
    `context.record.update({ ${collection === 'shift_reports' ? 'report_no' : 'defect_no'}: '${prefix}-' + padded })`,
  ].join('\n');
};

const workHoursCalc = [
  "let breaks = iif(attributes.break_hours = '' or attributes.break_hours = null, 0, attributes.break_hours)",
  'let worked = services.time.hoursBetween(attributes.start_time, attributes.end_time) - breaks',
  'context.record.update({ work_hours: round(worked, 2) })',
].join('\n');

const DRAFT_REPORT_GATE = (reportIdExpr: string) => [
  `for each r in records.shift_reports.where(id = ${reportIdExpr}) {`,
  "  if r.status <> 'Draft' {",
  "    fail('This report is no longer a draft.')",
  '  }',
  '}',
].join('\n');

// §5.4: each activity set refuses the other's records — a page naming an
// activity is not a gate, and an activity reachable through one page is
// reachable through any caller. Without this, an amendment's line (signed,
// naming its own wbs_id, never Calculated) can be added to an ordinary
// report, where Approve posts it whole and undivided — the "pin one resource
// to one node" exception §5.1 removed, reachable again under another name.
// Symmetric, no exemption, and the test is `<> ''`/`= ''`, never a null
// check (§10a). `reportExpr` is whatever names the report from the calling
// activity's own position — `attributes.report_id` on a CREATE, or
// `context.record.report_id` (an fk_ref — `=` unwraps it to its raw id) on
// an UPDATE anchored on the line itself.
const AMENDMENT_ONLY_GATE = (reportExpr: string) => [
  `for each r in records.shift_reports.where(id = ${reportExpr}) {`,
  "  if r.amended_report_id = '' {",
  "    fail('This activity is for an amendment — that report is an ordinary one.')",
  '  }',
  '}',
].join('\n');

const ORDINARY_ONLY_GATE = (reportExpr: string) => [
  `for each r in records.shift_reports.where(id = ${reportExpr}) {`,
  "  if r.amended_report_id <> '' {",
  "    fail('This activity is for an ordinary report — use the amendment activities instead.')",
  '  }',
  '}',
].join('\n');

// §5.2: Submit and Approve re-check the WBS-hours-equals-work_hours invariant
// that Calculate checked, and `warn()` rather than `fail()` — editing a
// report's times or its WBS rows after Calculate does not clear any line's
// `calculated` flag, so the invariant can go stale with no gate noticing.
// Named both figures; acknowledging the warning is a legitimate answer.
//
// Skipped outright on an amendment (§5.4): it has no WBS rows and no
// work_hours, so the comparison means nothing and would warn on every one of
// them. Blank-guarded regardless (§10a): round() throws on '' rather than
// treating it as zero, and an ordinary report's work_hours is never blank
// only because Create/Modify always compute it — nothing here depends on that
// staying true.
const HOURS_WARN_CHECK = [
  "if context.record.amended_report_id = '' {",
  '  let wbsTotal = 0',
  "  for each w in records.shift_wbs.where(report_id = context.record.id and expired <> 'true') {",
  "    wbsTotal = wbsTotal + iif(w.hours = '' or w.hours = null, 0, w.hours)",
  '  }',
  "  let workHours = iif(context.record.work_hours = '' or context.record.work_hours = null, 0, context.record.work_hours)",
  '  if round(wbsTotal, 6) <> round(workHours, 6) {',
  "    warn('The WBS hours total ' + wbsTotal + ', but the hours worked are ' + workHours + '.')",
  '  }',
  '}',
].join('\n');

const wfWorkGroups = {
  id: 'wf_work_groups',
  name: 'Work Groups',
  activities: [
    {
      id: 'act_create_work_groups', name: 'Create Work Group', record_map: 'CREATE', sort_order: 0,
      description: 'Adds a crew, shared-plant group, or subcontractor to the project — optionally under a parent (§4.1a).',
      before_hook: [
        "if records.work_groups.where(project_id = attributes.project_id and expired <> 'true' and wg_code = attributes.wg_code).count > 0 {",
        "  fail('A work group with this code already exists on this project.')",
        '}',
        // One level only (§4.1a, §10): a group whose own parent is set cannot
        // be chosen as a parent. The test is `<> ''`, not a null check — a
        // blank fk_ref is not null (§10a).
        "if attributes.wg_parent <> '' {",
        '  let p = records.work_groups.where(id = attributes.wg_parent).first',
        "  if p <> null and p.parent_id <> '' {",
        "    fail('That group already sits under a parent — work groups nest one level only.')",
        '  }',
        '}',
      ].join('\n'),
      after_hook: null,
      // wg_parent names rt_work_groups.parent_id, so it cannot exist until
      // the type does — safe here because the bare pass (see the write
      // section) strips every activity's `attributes` too, not just hooks.
      attributes: attrs(sourced('project_id', 'context.page.record.id'), 'wg_parent', 'wg_code', 'name', 'manager', 'wg_type'),
    },
    {
      id: 'act_modify_work_groups', name: 'Modify Work Group', record_map: 'UPDATE', sort_order: 1,
      description: "Changes a work group's code, name, manager, type or active state.",
      before_hook: [
        "if records.work_groups.where(project_id = context.record.project_id and expired <> 'true' and wg_code = attributes.wg_code and id <> context.record.id).count > 0 {",
        "  fail('A work group with this code already exists on this project.')",
        '}',
      ].join('\n'),
      after_hook: null,
      attributes: attrs('wg_code', 'name', 'manager', 'wg_type', 'active'),
    },
    {
      id: 'act_delete_work_groups', name: 'Delete Work Group', record_map: 'UPDATE', sort_order: 2,
      description: 'Retires a work group with no unexpired children.',
      // Counts unexpired children only (§4.1a, §10) — an already-expired
      // child is no obstacle. The naive childless check (`not (id in
      // .values(parent_id))`) ignores `expired` and does not do this.
      show_condition: "records.work_groups.where(parent_id = context.record.id and expired <> 'true').count = 0",
      before_hook: null, after_hook: null, attributes: attrs('expired'),
    },
    {
      id: 'act_list_work_groups', name: 'List Work Groups', record_map: 'GET', sort_order: 3,
      description: "A project's whole set of work groups, for the table that nests it.",
      returns: "records.work_groups.where(project_id = attributes.project_id and expired <> 'true').orderBy(wg_code)"
        + '.select(id, wg_code, name, manager, wg_type, active, parent_id)',
      before_hook: null, after_hook: null, attributes: attrs('project_id'),
    },
    {
      id: 'act_list_expected_work_groups', name: 'List Expected Work Groups', record_map: 'GET', sort_order: 4,
      description: 'The groups that owe a report: active, no children, crew or subcontractor (§6).',
      returns: "records.work_groups.where(project_id = attributes.project_id and expired <> 'true' and active = 'true'"
        + " and (wg_type = 'Crew' or wg_type = 'Subcontractor')"
        + ' and not (id in records.work_groups.values(parent_id))).orderBy(wg_code)'
        + '.select(id, wg_code, name, manager)',
      before_hook: null, after_hook: null, attributes: attrs('project_id'),
    },
  ],
};

const wfResources = {
  id: 'wf_resources',
  name: 'Resources',
  activities: [
    {
      id: 'act_create_resources', name: 'Create Resource', record_map: 'CREATE', sort_order: 0,
      description: "Adds an entry to the project's catalogue.",
      before_hook: null, after_hook: null,
      attributes: attrs(sourced('project_id', 'context.page.record.id'), 'code', 'description', 'res_type', 'unit', 'rate', 'cbs_id'),
    },
    {
      id: 'act_modify_resources', name: 'Modify Resource', record_map: 'UPDATE', sort_order: 1,
      description: "Changes a catalogue entry's description, type, unit, rate or cost code.",
      before_hook: null, after_hook: null,
      attributes: attrs(sourced('project_id', 'context.record.project_id'), 'code', 'description', 'res_type', 'unit', 'rate', 'cbs_id'),
    },
    {
      id: 'act_delete_resources', name: 'Delete Resource', record_map: 'UPDATE', sort_order: 2,
      description: 'Retires a catalogue entry.',
      before_hook: null, after_hook: null, attributes: attrs('expired'),
    },
    {
      id: 'act_list_resources', name: 'List Resources', record_map: 'GET', sort_order: 3,
      description: "A project's catalogue.",
      returns: "records.resources.where(project_id = attributes.project_id and expired <> 'true').orderBy(code)"
        + '.select(id, code, description, res_type, unit, rate, cbs_id)',
      before_hook: null, after_hook: null, attributes: attrs('project_id'),
    },
  ],
};

const wfWgResources = {
  id: 'wf_wg_resources',
  name: 'Work Group Resources',
  activities: [
    {
      id: 'act_create_wg_resources', name: 'Add Standard Resource', record_map: 'CREATE', sort_order: 0,
      description: "Adds a resource, with its standard count, to a work group's standard set.",
      before_hook: null, after_hook: null,
      attributes: attrs(
        sourced('project_id', 'context.page.record.project_id'),
        sourced('wg_id', 'context.page.record.id'),
        'resource_id', 'quantity', 'rate', 'cbs_id',
      ),
    },
    {
      id: 'act_modify_wg_resources', name: 'Modify Standard Resource', record_map: 'UPDATE', sort_order: 1,
      description: 'Changes the standard count, rate override or cost-code override.',
      before_hook: null, after_hook: null,
      attributes: attrs(sourced('project_id', 'context.record.wg_id.project_id'), 'quantity', 'rate', 'cbs_id'),
    },
    {
      id: 'act_delete_wg_resources', name: 'Remove Standard Resource', record_map: 'UPDATE', sort_order: 2,
      description: "Removes a resource from a work group's standard set.",
      before_hook: null, after_hook: null, attributes: attrs('expired'),
    },
    {
      id: 'act_list_wg_resources', name: 'List Standard Resources', record_map: 'GET', sort_order: 3,
      description: "A work group's own standard set — never its parent's (§4.1a).",
      returns: "records.wg_resources.where(wg_id = attributes.wg_id and expired <> 'true')"
        + '.select(id, resource_id, quantity, rate, cbs_id)',
      before_hook: null, after_hook: null, attributes: attrs('wg_id'),
    },
  ],
};

const wfShiftReports = {
  id: 'wf_shift_reports',
  name: 'Shift Reports',
  activities: [
    {
      id: 'act_create_shift_reports', name: 'Create Shift Report', record_map: 'CREATE', sort_order: 0,
      description: 'Starts a report for a work group and seeds its resource lines from the standard set.',
      before_hook: null,
      after_hook: [
        workHoursCalc,
        numberingHook('shift_reports', 'SR', 4),
        'for each item in standardResourceSet(context.record.wg_id) {',
        "  let stdQty = iif(item.quantity = '' or item.quantity = null, 0, item.quantity)",
        '  records.shift_report_resource_usage.create({',
        '    report_id: context.record.id,',
        '    resource_id: item.resource_id,',
        '    description: item.resource_id.description,',
        '    quantity: round(context.record.work_hours * stdQty, 2),',
        "    calculated: 'false',",
        '    unit: item.resource_id.unit,',
        "    rate: iif(item.rate = '' or item.rate = null, item.resource_id.rate, item.rate),",
        "    cbs_id: iif(item.cbs_id = '' or item.cbs_id = null, item.resource_id.cbs_id, item.cbs_id),",
        "    tracked_cost: ''",
        '  })',
        '}',
      ].join('\n'),
      attributes: attrs(
        sourced('project_id', 'context.page.record.project_id'),
        sourced('wg_id', 'context.page.record.id'),
        { key: 'report_date', required: true }, 'shift', { key: 'start_time', required: true }, { key: 'end_time', required: true },
        'break_hours', 'hours_lost', 'weather', 'work_summary', 'site_notes', 'report_photos',
      ),
    },
    {
      id: 'act_modify_shift_reports', name: 'Modify Shift Report', record_map: 'UPDATE', sort_order: 1,
      description: 'Changes times, weather, narrative or photos. Draft only.',
      show_condition: "context.record.status = 'Draft'",
      // §5.4: a report activity, refused on an amendment — otherwise it
      // writes date/shift/times/work_hours onto a record §5.4 says nothing
      // asks for and no gate looks at. Anchored on the report itself, so the
      // field is read directly rather than through the ORDINARY_ONLY_GATE
      // indirection the line activities need.
      before_hook: [
        "if context.record.amended_report_id <> '' {",
        "  fail('This activity is for an ordinary report — use the amendment activities instead.')",
        '}',
      ].join('\n'),
      after_hook: workHoursCalc,
      attributes: attrs(
        { key: 'report_date', required: true }, 'shift', { key: 'start_time', required: true }, { key: 'end_time', required: true },
        'break_hours', 'hours_lost', 'weather', 'work_summary', 'site_notes', 'report_photos',
      ),
    },
    {
      id: 'act_cancel_shift_reports', name: 'Cancel', record_map: 'UPDATE', sort_order: 2,
      description: 'Withdraws a draft report that should not stand — expires it, and §6 then reads that group and day as nothing filed (§5.3).',
      show_condition: "context.record.status = 'Draft'",
      before_hook: null, after_hook: null, attributes: attrs('expired'),
    },
    {
      id: 'act_calculate_shift_reports', name: 'Calculate', record_map: 'UPDATE', sort_order: 3,
      description: 'Checks the WBS hours total the shift, then prices every resource line at quantity × rate.',
      show_condition: "context.record.status = 'Draft'",
      before_hook: [
        // Refused outright, not blank-guarded into working (§5.4): an
        // amendment has no WBS rows and no work_hours, so there is nothing to
        // calculate, and guarding the comparison below would paper over that
        // rather than say so.
        "if context.record.amended_report_id <> '' {",
        "  fail('An amendment has no WBS rows or hours to calculate — its lines are entered by hand.')",
        '}',
        'let total = 0',
        "for each w in records.shift_wbs.where(report_id = context.record.id and expired <> 'true') {",
        "  total = total + iif(w.hours = '' or w.hours = null, 0, w.hours)",
        '}',
        'if round(total, 6) <> round(context.record.work_hours, 6) {',
        "  fail('The WBS hours must total the hours worked.')",
        '}',
      ].join('\n'),
      after_hook: [
        "for each line in records.shift_report_resource_usage.where(report_id = context.record.id and expired <> 'true') {",
        "  let qty = iif(line.quantity = '' or line.quantity = null, 0, line.quantity)",
        "  let rate = iif(line.rate = '' or line.rate = null, 0, line.rate)",
        "  line.update({ tracked_cost: round(qty * rate, 2), calculated: 'true' })",
        '}',
      ].join('\n'),
      attributes: [],
    },
    {
      id: 'act_submit_shift_reports', name: 'Submit', record_map: 'UPDATE', sort_order: 4,
      description: 'Locks the report for approval. Refused until every non-amendment line has been priced by Calculate; warns rather than refuses if the WBS hours have since drifted from work_hours (§5.2).',
      show_condition: "context.record.status = 'Draft'",
      before_hook: [
        // Amendment lines always name their own wbs_id and never run Calculate
        // (§5.4), so the gate excludes them — it is asking whether the
        // ORDINARY lines this report divides by hours have been priced.
        "if records.shift_report_resource_usage.where(report_id = context.record.id and expired <> 'true' and wbs_id = '' and calculated <> 'true').count > 0 {",
        "  fail('Calculate this report before submitting it.')",
        '}',
        HOURS_WARN_CHECK,
      ].join('\n'),
      // Captures nothing and writes status inside its own hook, for the same
      // reason Approve must (§5): a captured field-matching attribute
      // auto-applies outside the after hook's transactional boundary.
      after_hook: "context.record.update({ status: 'Submitted' })",
      attributes: [],
    },
    {
      id: 'act_reject_shift_reports', name: 'Reject', record_map: 'UPDATE', sort_order: 5,
      description: 'Sends a submitted report back to Draft. Nothing has posted yet, so this costs nothing (§5.3).',
      show_condition: "context.record.status = 'Submitted'",
      before_hook: null,
      after_hook: "context.record.update({ status: 'Draft' })",
      attributes: [],
    },
    {
      id: 'act_approve_shift_reports', name: 'Approve', record_map: 'UPDATE', sort_order: 6,
      description: "Signs off the report. An ordinary line's cost divides across the WBS rows it touched, in proportion to hours; an amendment's line posts whole to the node it names (§5.1, §5.4).",
      show_condition: "context.record.status = 'Submitted'",
      before_hook: [
        // Zero WBS hours only blocks approval when some line actually needs
        // them to divide by — an amendment has no shift_wbs rows at all, and
        // must not be refused on that account (every one of its lines names
        // its own wbs_id, so none of them reaches the division).
        'let total = 0',
        "for each w in records.shift_wbs.where(report_id = context.record.id and expired <> 'true') {",
        "  total = total + iif(w.hours = '' or w.hours = null, 0, w.hours)",
        '}',
        "let needsDivision = records.shift_report_resource_usage.where(report_id = context.record.id and expired <> 'true' and wbs_id = '').count > 0",
        'if needsDivision and round(total, 6) = 0 {',
        "  fail('This report has no WBS hours to divide cost across.')",
        '}',
        HOURS_WARN_CHECK,
      ].join('\n'),
      after_hook: [
        "context.record.update({ status: 'Approved', approved_by: context.user.name, approved_date: now() })",
        '',
        // `.orderBy(id)` makes the two passes below (this one, and the for-each
        // that spends the shares) walk the same rows in the same order — the
        // one thing distribute()'s positional shares depend on.
        "let weights = records.shift_wbs.where(report_id = context.record.id and expired <> 'true').orderBy(id).values(hours)",
        '',
        "for each line in records.shift_report_resource_usage.where(report_id = context.record.id and expired <> 'true') {",
        "  let lineQty = iif(line.quantity = '' or line.quantity = null, 0, line.quantity)",
        "  let lineCost = iif(line.tracked_cost = '' or line.tracked_cost = null, 0, line.tracked_cost)",
        // The test is the LINE's own wbs_id, and nothing about the report —
        // an amendment's negative quantities never reach the division below,
        // because every one of its lines carries a wbs_id of its own (§5.1,
        // §10a: a blank fk_ref is not null, so this is `<> ''`, never a null
        // check).
        "  if line.wbs_id <> '' {",
        '    records.wbs_resource_usage.create({',
        '      project_id: context.record.project_id, report_id: context.record.id, source_line_id: line.id,',
        '      wbs_id: line.wbs_id, cbs_id: line.cbs_id, usage_date: context.record.report_date,',
        '      quantity: lineQty, tracked_cost: lineCost',
        '    })',
        '  } else {',
        '    let qtyShares = services.math.distribute(weights, lineQty, 2)',
        '    let costShares = services.math.distribute(weights, lineCost, 2)',
        '    let idx = 0',
        "    for each w in records.shift_wbs.where(report_id = context.record.id and expired <> 'true').orderBy(id) {",
        '      records.wbs_resource_usage.create({',
        '        project_id: context.record.project_id, report_id: context.record.id, source_line_id: line.id,',
        '        wbs_id: w.wbs_id, cbs_id: line.cbs_id, usage_date: context.record.report_date,',
        '        quantity: qtyShares[idx], tracked_cost: costShares[idx]',
        '      })',
        '      idx = idx + 1',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      attributes: [],
    },
    {
      id: 'act_create_shift_report_amendments', name: 'Raise Amendment', record_map: 'CREATE', sort_order: 7,
      description: 'Raises a correction against an approved report — the same record type, its own activity set (§5.4). Never asked for date, shift, times or a WBS split.',
      before_hook: [
        // Sourced, not asked (§4.9) — so `required` on the attribute usage
        // would not help even if set: a hidden/sourced attribute is exempt
        // from it (validateSubmission). Enforced here instead, for the same
        // reason every other gate in this file is a hook and not a show
        // condition — a page's own wiring is not something the model can
        // trust a caller to have gone through.
        //
        // `attributes.*` and `context.record.*`/`records.*` disagree about
        // blank: a stored field's blank is `''` (§10a's blank-fk-is-not-null),
        // but a CAPTURED value's blank is coerced to `null` before a hook
        // ever sees it (coerceCapturedValue: `raw === '' → null`). This is
        // the one gate in this file testing a captured reference rather than
        // a stored one, so it is the one gate that tests `= null`.
        'if attributes.amended_report_id = null {',
        "  fail('An amendment must name the report it corrects.')",
        '}',
        'let r = records.shift_reports.where(id = attributes.amended_report_id).first',
        "if r <> null and r.status <> 'Approved' {",
        "  fail('An amendment can only be raised against an approved report.')",
        '}',
      ].join('\n'),
      // Numbering is shared with ordinary reports (§5.4); work_hours is not
      // computed — there are no times to compute it from, and nothing reads
      // it on an amendment.
      after_hook: numberingHook('shift_reports', 'SR', 4),
      attributes: attrs(
        sourced('project_id', 'context.page.record.project_id'),
        sourced('wg_id', 'context.page.record.wg_id'),
        sourced('amended_report_id', 'context.page.record.id'),
      ),
    },
    {
      id: 'act_edit_shift_report_amendment_notes', name: 'Edit Notes', record_map: 'UPDATE', sort_order: 8,
      description: 'Records why the correction is needed, while the amendment is a draft.',
      show_condition: "context.record.status = 'Draft'",
      // §5.4: an amendment-only activity, refused on an ordinary report —
      // symmetric with its siblings (Raise Amendment, Add/Adjust Amendment
      // Line), which already carry this gate.
      before_hook: [
        "if context.record.amended_report_id = '' {",
        "  fail('This activity is for an amendment — that report is an ordinary one.')",
        '}',
      ].join('\n'),
      after_hook: null,
      attributes: attrs('site_notes'),
    },
    {
      id: 'act_list_shift_reports', name: 'List Shift Reports', record_map: 'GET', sort_order: 9,
      description: "A project's shift reports, most recent first. Amendments are not filings (§6) and are excluded.",
      returns: "records.shift_reports.where(project_id = attributes.project_id and expired <> 'true' and amended_report_id = '').orderBy(report_date desc)"
        + '.select(id, report_no, report_date, shift, wg_id, work_hours, status)',
      before_hook: null, after_hook: null, attributes: attrs('project_id'),
    },
    {
      id: 'act_list_work_group_reports', name: 'List Work Group Reports', record_map: 'GET', sort_order: 10,
      description: "A work group's ten most recent shift reports. Amendments are not filings (§6) and are excluded.",
      returns: "records.shift_reports.where(wg_id = attributes.wg_id and expired <> 'true' and amended_report_id = '').orderBy(report_date desc).top(10)"
        + '.select(id, report_no, report_date, shift, work_hours, status)',
      before_hook: null, after_hook: null, attributes: attrs('wg_id'),
    },
  ],
};

const wfShiftWbs = {
  id: 'wf_shift_wbs',
  name: 'Shift WBS Rows',
  activities: [
    {
      id: 'act_create_shift_wbs', name: 'Add WBS Row', record_map: 'CREATE', sort_order: 0,
      description: 'Records hours and quantity completed against one WBS node for this shift.',
      // §5.4: an amendment has no WBS rows.
      before_hook: [DRAFT_REPORT_GATE('attributes.report_id'), ORDINARY_ONLY_GATE('attributes.report_id')].join('\n'),
      after_hook: null,
      attributes: attrs(
        sourced('project_id', 'context.page.record.project_id'),
        sourced('report_id', 'context.page.record.id'),
        'wbs_id', 'hours', 'qty_completed', 'qty_unit', 'notes',
      ),
    },
    {
      id: 'act_modify_shift_wbs', name: 'Modify WBS Row', record_map: 'UPDATE', sort_order: 1,
      description: 'Changes hours, quantity completed, or notes. Draft only.',
      show_condition: "context.record.report_id.status = 'Draft'",
      before_hook: ORDINARY_ONLY_GATE('context.record.report_id'), after_hook: null,
      attributes: attrs('hours', 'qty_completed', 'qty_unit', 'notes'),
    },
    {
      id: 'act_delete_shift_wbs', name: 'Remove WBS Row', record_map: 'UPDATE', sort_order: 2,
      description: 'Removes a WBS row from a draft report.',
      show_condition: "context.record.report_id.status = 'Draft'",
      before_hook: ORDINARY_ONLY_GATE('context.record.report_id'), after_hook: null, attributes: attrs('expired'),
    },
    {
      id: 'act_list_shift_wbs', name: 'List Shift WBS Rows', record_map: 'GET', sort_order: 3,
      description: "A shift report's WBS rows.",
      returns: "records.shift_wbs.where(report_id = attributes.report_id and expired <> 'true')"
        + '.select(id, wbs_id, hours, qty_completed, qty_unit, notes)',
      before_hook: null, after_hook: null, attributes: attrs('report_id'),
    },
    {
      id: 'act_search_wbs_leaves', name: 'Search WBS Leaves', record_map: 'GET', sort_order: 4,
      description: 'WBS nodes with no children, matching a search term — what a shift report may book hours against.',
      returns: "records.wbs_nodes.where(project_id = attributes.project_id and expired <> 'true'"
        + " and (code like attributes.term + '%' or name like '%' + attributes.term + '%')"
        + ' and not (id in records.wbs_nodes.values(parent_id))).orderBy(code).top(50)'
        + '.select(id, code, name)',
      before_hook: null, after_hook: null, attributes: attrs('project_id', 'term'),
    },
  ],
};

const wfShiftReportResourceUsage = {
  id: 'wf_shift_report_resource_usage',
  name: 'Shift Report Resource Usage',
  activities: [
    {
      id: 'act_add_shift_report_resource', name: 'Add Resource Line', record_map: 'CREATE', sort_order: 0,
      description: 'Adds a resource used this shift that was not in the standard set. Picking one from the catalogue fills description, unit, rate and cost code where left blank.',
      before_hook: [DRAFT_REPORT_GATE('attributes.report_id'), ORDINARY_ONLY_GATE('attributes.report_id')].join('\n'),
      after_hook: [
        "if attributes.resource_id <> '' {",
        '  for each res in records.resources.where(id = attributes.resource_id) {',
        '    context.record.update({',
        "      description: iif(context.record.description = '', res.description, context.record.description),",
        "      unit: iif(context.record.unit = '', res.unit, context.record.unit),",
        "      rate: iif(context.record.rate = '' or context.record.rate = null, res.rate, context.record.rate),",
        "      cbs_id: iif(context.record.cbs_id = '', res.cbs_id, context.record.cbs_id)",
        '    })',
        '  }',
        '}',
      ].join('\n'),
      attributes: attrs(
        sourced('project_id', 'context.page.record.project_id'),
        sourced('report_id', 'context.page.record.id'),
        'resource_id', 'description', 'quantity', 'unit', 'rate', 'cbs_id', 'notes',
      ),
    },
    {
      id: 'act_modify_shift_report_resource', name: 'Adjust Resource Line', record_map: 'UPDATE', sort_order: 1,
      description: "Confirms or adjusts a line's quantity, rate or cost code. Marks it uncalculated again.",
      show_condition: "context.record.report_id.status = 'Draft'",
      before_hook: ORDINARY_ONLY_GATE('context.record.report_id'),
      after_hook: "context.record.update({ calculated: 'false' })",
      attributes: attrs('quantity', 'rate', 'cbs_id', 'notes'),
    },
    {
      id: 'act_remove_shift_report_resource', name: 'Remove Resource Line', record_map: 'UPDATE', sort_order: 2,
      description: 'Removes a line the work group did not actually use this shift.',
      show_condition: "context.record.report_id.status = 'Draft'",
      before_hook: null, after_hook: null, attributes: attrs('expired'),
    },
    {
      id: 'act_list_shift_report_resources', name: 'List Resource Lines', record_map: 'GET', sort_order: 3,
      description: "A shift report's resource lines.",
      returns: "records.shift_report_resource_usage.where(report_id = attributes.report_id and expired <> 'true')"
        + '.select(id, resource_id, description, quantity, wbs_id, notes, calculated, unit, rate, cbs_id, tracked_cost)',
      before_hook: null, after_hook: null, attributes: attrs('report_id'),
    },
    {
      id: 'act_add_shift_report_amendment_line', name: 'Add Amendment Line', record_map: 'CREATE', sort_order: 4,
      description: 'Adds a correction line to an amendment — signed quantity, posted whole to the WBS node it names (§5.1, §5.4). No standard set, no Calculate.',
      before_hook: [DRAFT_REPORT_GATE('attributes.report_id'), AMENDMENT_ONLY_GATE('attributes.report_id')].join('\n'),
      after_hook: [
        "if attributes.resource_id <> '' {",
        '  for each res in records.resources.where(id = attributes.resource_id) {',
        '    context.record.update({',
        "      description: iif(context.record.description = '', res.description, context.record.description),",
        "      unit: iif(context.record.unit = '', res.unit, context.record.unit),",
        "      rate: iif(context.record.rate = '' or context.record.rate = null, res.rate, context.record.rate),",
        "      cbs_id: iif(context.record.cbs_id = '', res.cbs_id, context.record.cbs_id)",
        '    })',
        '  }',
        '}',
        // No Calculate for an amendment (§5.4) — the line prices itself.
        "let qty = iif(context.record.quantity = '' or context.record.quantity = null, 0, context.record.quantity)",
        "let rate = iif(context.record.rate = '' or context.record.rate = null, 0, context.record.rate)",
        'context.record.update({ tracked_cost: round(qty * rate, 2) })',
      ].join('\n'),
      attributes: attrs(
        sourced('project_id', 'context.page.record.project_id'),
        sourced('report_id', 'context.page.record.id'),
        'resource_id', 'description', 'quantity', 'unit', 'rate', 'cbs_id',
        { key: 'wbs_id', required: true }, 'notes',
      ),
    },
    {
      id: 'act_adjust_shift_report_amendment_line', name: 'Adjust Amendment Line', record_map: 'UPDATE', sort_order: 5,
      description: "Corrects an amendment line's quantity, rate, cost code, WBS node or notes while it is a draft.",
      show_condition: "context.record.report_id.status = 'Draft'",
      before_hook: AMENDMENT_ONLY_GATE('context.record.report_id'),
      after_hook: [
        "let qty = iif(context.record.quantity = '' or context.record.quantity = null, 0, context.record.quantity)",
        "let rate = iif(context.record.rate = '' or context.record.rate = null, 0, context.record.rate)",
        'context.record.update({ tracked_cost: round(qty * rate, 2) })',
      ].join('\n'),
      attributes: attrs('quantity', 'rate', 'cbs_id', { key: 'wbs_id', required: true }, 'notes'),
    },
  ],
};

const wfWbsResourceUsage = {
  id: 'wf_wbs_resource_usage',
  name: 'WBS Resource Usage',
  // Written only by act_approve_shift_reports's after hook — no capture
  // activities. A read-only GET, for the totals a page will build on later.
  activities: [
    {
      id: 'act_list_wbs_resource_usage', name: 'List WBS Resource Usage', record_map: 'GET', sort_order: 0,
      description: "A project's approved cost against the WBS.",
      returns: "records.wbs_resource_usage.where(project_id = attributes.project_id and expired <> 'true')"
        + '.select(id, report_id, wbs_id, cbs_id, usage_date, quantity, tracked_cost)',
      before_hook: null, after_hook: null, attributes: attrs('project_id'),
    },
  ],
};

const wfDefects = {
  id: 'wf_defects',
  name: 'Defects',
  activities: [
    {
      id: 'act_create_defects', name: 'Raise Defect', record_map: 'CREATE', sort_order: 0,
      description: 'Raises a defect found while filing a shift report.',
      // §8: an amendment gets no defects.
      before_hook: [DRAFT_REPORT_GATE('attributes.report_id'), ORDINARY_ONLY_GATE('attributes.report_id')].join('\n'),
      after_hook: [
        "context.record.update({ raised_date: now() })",
        numberingHook('defects', 'DEF', 3),
      ].join('\n'),
      attributes: attrs(
        sourced('project_id', 'context.page.record.project_id'),
        sourced('report_id', 'context.page.record.id'),
        'wbs_id', 'raised_by', 'location', 'def_description', 'severity', 'defect_photos',
      ),
    },
    {
      id: 'act_modify_defects', name: 'Modify Defect', record_map: 'UPDATE', sort_order: 1,
      description: 'Changes location, description, severity or assignment. Open or rectified only.',
      show_condition: "context.record.status <> 'Closed'",
      before_hook: null, after_hook: null,
      attributes: attrs('location', 'def_description', 'severity', 'assigned_to'),
    },
    {
      id: 'act_rectify_defects', name: 'Rectify Defect', record_map: 'UPDATE', sort_order: 2,
      description: 'Records the fix. Captures nothing that maps to status — the transition is written inside the hook.',
      show_condition: "context.record.status = 'Open'",
      before_hook: null,
      after_hook: "context.record.update({ status: 'Rectified' })",
      attributes: attrs('rectified_date', 'rectification_notes'),
    },
    {
      id: 'act_verify_defects', name: 'Verify Defect', record_map: 'UPDATE', sort_order: 3,
      description: 'Signs off the rectification and closes the defect.',
      show_condition: "context.record.status = 'Rectified'",
      before_hook: null,
      after_hook: "context.record.update({ status: 'Closed' })",
      attributes: attrs('verified_date', 'verified_by'),
    },
    {
      id: 'act_list_defects', name: 'List Defects', record_map: 'GET', sort_order: 4,
      description: "A project's defects, or one report's when report_id is given.",
      returns: "records.defects.where(project_id = attributes.project_id and expired <> 'true'"
        + " and (attributes.report_id = '' or report_id = attributes.report_id)).orderBy(raised_date desc)"
        + '.select(id, defect_no, wbs_id, report_id, raised_date, location, def_description, severity, status)',
      before_hook: null, after_hook: null, attributes: attrs('project_id', sourced('report_id', "''")),
    },
  ],
};

// ── 5. existing totals, guarded against a parent that holds an amount ──────
// §7: none of the three returns a wrong number today (parents already
// read blank), but the fix must land before bad data can arrive. The
// "no children" test goes through `.values()`, not a nested `.where()` —
// the pattern §7 measured as silently wrong (both sides bind to the inner
// row) — and the blank guard on every accumulated term stays exactly as it
// was (§10a: text-poisoning a running total is the same defect either way).

const total = (name: string, field: string, type: string) => ({
  id: `fn_${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
  name,
  description: `Adds up ${field} across a project's ${type} nodes with no children. Blank figures are skipped.`,
  body: [
    `function ${name}(project) {`,
    '  let total = 0',
    `  for each n in records.${type}_nodes.where(project_id = project and expired <> 'true'`,
    `      and not (id in records.${type}_nodes.values(parent_id))) {`,
    `    total = total + iif(n.${field} = '' or n.${field} = null, 0, n.${field})`,
    '  }',
    '  return total',
    '}',
  ].join('\n'),
});

const FIXED_TOTALS = [
  total('cbsBudgetTotal', 'budget_cost', 'cbs'),
  total('wbsBaselineTotal', 'baseline_budget', 'wbs'),
  total('wbsForecastTotal', 'forecast_cost', 'wbs'),
];

// ── write, in dependency order ──────────────────────────────────────────────

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

if (dry) {
  for (const a of ATTRIBUTES) console.log(`attribute  + ${a.key}`);
  console.log(`function   + ${STANDARD_RESOURCE_SET.name}`);
  for (const t of FIXED_TOTALS) console.log(`function   ~ ${t.name} (children-guard)`);
  for (const rt of [rtWorkGroups, rtResources, rtWgResources, rtShiftReports, rtShiftWbs, rtShiftReportResourceUsage, rtWbsResourceUsage, rtDefects]) {
    console.log(`record type + ${rt.id}, workflow + ${rt.workflow_ref}`);
  }
  await closeDb(db);
  process.exit(0);
}

// `wg_parent` names `rt_work_groups.parent_id` and `amended_report_id` names
// `rt_shift_reports.amended_report_id` — neither field exists until its type
// lands, same ordering problem `wbs_parent` had. Every other attribute lands
// now; these two wait for their types (below).
const DEFERRED_ATTRIBUTES = new Set(['wg_parent', 'amended_report_id']);
for (const attribute of ATTRIBUTES) {
  if (DEFERRED_ATTRIBUTES.has(attribute.key)) continue;
  console.log(`attribute  + ${attribute.key}`);
  await putConfigEntity(db, SOLUTION, configCollections.attributes, attribute);
}

console.log('functions  ~ cbsBudgetTotal, wbsBaselineTotal, wbsForecastTotal (children-guard)');
for (const t of FIXED_TOTALS) await putConfigEntity(db, SOLUTION, configCollections.functions, t);

// Every hook/show_condition/returns here names `records.<type>` for one of
// these eight new types, some of them each other's (shift_reports' Calculate
// and Approve name shift_wbs and shift_report_resource_usage; work_groups'
// own gates name work_groups itself). None of that resolves until every type
// in the group exists. So: a **bare** pass first — every activity present
// (satisfying each record type's `workflow_ref`, and letting `attributes`
// usages validate) but with hooks, show_conditions and GET bodies stripped to
// nothing — then the eight record types in fk_record_type dependency order,
// then one **full** pass rewriting every workflow complete, once every type
// it could possibly name is in the store.
type RawActivity = { id: string; record_map?: string; before_hook?: unknown; after_hook?: unknown; show_condition?: unknown; returns?: unknown; attributes?: unknown };
type RawFlow = { id: string; name: string; activities: RawActivity[] };

// Attributes are stripped too, not just hooks: `wg_parent` itself does not
// exist until the type lands (its own `field:` names it), so an activity
// naming it in `attributes` cannot validate in this bare pass either.
const bare = (flow: RawFlow): RawFlow => ({
  ...flow,
  activities: flow.activities.map((a) => ({
    ...a,
    before_hook: null,
    after_hook: null,
    show_condition: undefined,
    returns: a.record_map === 'GET' ? "''" : undefined,
    attributes: [],
  })),
});

const FLOWS: [unknown, RawFlow][] = [
  [rtWorkGroups, wfWorkGroups as RawFlow],
  [rtResources, wfResources as RawFlow],
  [rtWgResources, wfWgResources as RawFlow],
  [rtShiftReports, wfShiftReports as RawFlow],
  [rtShiftWbs, wfShiftWbs as RawFlow],
  [rtShiftReportResourceUsage, wfShiftReportResourceUsage as RawFlow],
  [rtWbsResourceUsage, wfWbsResourceUsage as RawFlow],
  [rtDefects, wfDefects as RawFlow],
];

console.log('bare workflows');
for (const [, flow] of FLOWS) await putConfigEntity(db, SOLUTION, configCollections.workflows, bare(flow) as never);

console.log('record types');
for (const [rt, flow] of FLOWS) {
  await putConfigEntity(db, SOLUTION, configCollections.recordTypes, rt as never);
  console.log(`  + ${(rt as { id: string }).id}`);
}

// Now both types exist: land the two field-naming attributes that wait on them.
for (const key of DEFERRED_ATTRIBUTES) {
  console.log(`attribute  + ${key}`);
  await putConfigEntity(db, SOLUTION, configCollections.attributes, ATTRIBUTES.find((a) => a.key === key)!);
}

// standardResourceSet names records.wg_resources / records.work_groups —
// both now exist, and it is needed by act_create_shift_reports below.
console.log('function   + standardResourceSet');
await putConfigEntity(db, SOLUTION, configCollections.functions, STANDARD_RESOURCE_SET);

console.log('full workflows');
for (const [, flow] of FLOWS) {
  await putConfigEntity(db, SOLUTION, configCollections.workflows, flow as never);
  console.log(`  ~ ${flow.id}`);
}

console.log('\nmodel written');
await closeDb(db);
