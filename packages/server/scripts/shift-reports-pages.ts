// One-off, 2026-09-23. `pages/shift-report`, `pages/shift-report-amendment`,
// `pages/work-group`, `pages/defect`, `pages/resources`, `pages/shift-reports`
// (the dashboard) — per SHIFT_REPORTS.md §8 — plus the three sections §8 adds
// to the existing `pages/project` (Work Groups, Shift Reports, Defects; its
// WBS/CBS lists already carry `parentKey` from the 2026-09-14 build, so that
// half of §8's sentence is already done).
//
// Built the same way `project-page.ts` was: out of `RecordList`, `Text`,
// `RunActivity`, `OpenPage`, plus the two components this solution's build
// added, `Contributions` and `Photos`. Nothing new to the component library.
//
// **Ids, not labels.** RecordList has no way to turn a stored reference id
// into a readable label — that lives only in the capture form's resolver
// (`CaptureHost.resolveDisplayLabel`), which a page's read side does not have.
// Every existing GET this build reuses (`act_list_shift_reports`,
// `act_list_defects`, `act_list_shift_wbs`, `act_list_shift_report_resources`)
// returns raw ids for its reference fields, and touching four existing GETs to
// add label projections was weighed against the brief's "add nothing else to
// the model" and set aside — a work group, WBS node or defect's report shows
// as its id, with an Open column/button to the record's own page where the
// real fields are. Flagged plainly rather than silently smoothed over.
//
// **A page written by a script is not validated** by the Console's save path,
// so before writing anything every dynamic prop and `{{ }}` hole is evaluated
// through the real engine, against a real anchor where one already exists
// (P26-011, for the three pages anchored on `rt_projects`) and a **fabricated,
// unpersisted** `RecordInstance` where it does not (no shift report, work
// group or defect has been filed yet — §9's demonstration data is a separate
// session). A fabricated anchor is a plain object, never written through
// `writeBack`; it proves the expressions parse and every named activity and
// attribute is real, the same class of check `runQuery`/`evaluate` already do
// against P26-011 elsewhere, short of exercising real rows.
//
// Drafts only — `pages.def`. Publishing is a person's act, in the Console.
// Pass --dry to print the evaluation and write nothing.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { findActivity, loadOperationHost } from '../src/host';
import { pages } from '../src/db/schema';
import type { RecordInstance } from '@fluxus/engine';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';
const ROLES = ['role_project_admin', 'role_project_user'];
const dry = process.argv.includes('--dry');

// ── the pieces, matching project-page.ts's style ────────────────────────────

const panel = (id: string, size: number, fixed = false, children: unknown[] = [], direction = 'vertical') => ({
  id,
  size: { type: fixed ? 'fixed' : 'flex', value: size },
  children,
  direction,
  background: '#ffffff',
  padding: { top: 4, right: 8, bottom: 4, left: 8 },
});

const auto = (id: string, pad: number, children: unknown[] = []) => ({
  id,
  size: { type: 'auto' },
  children,
  direction: 'vertical',
  background: '#ffffff',
  padding: { top: pad, right: 16, bottom: pad, left: 16 },
});

const row = (id: string, pad: number, children: unknown[]) => ({
  id,
  size: { type: 'auto' },
  children,
  direction: 'horizontal',
  background: '#ffffff',
  padding: { top: pad, right: 16, bottom: pad, left: 16 },
});

const text = (body: string, style: string) => ({
  componentName: 'Text',
  staticConfig: { text: body, style, align: 'left', verticalAlign: 'middle' },
  dynamicProps: {},
  callbacks: {},
});

/** A button standing on its own, about the page's own record. */
const button = (label: string, target: string, attribute?: string) => ({
  componentName: 'RunActivity',
  staticConfig: { label, target, ...(attribute ? { attribute } : {}) },
  dynamicProps: { record: 'context.record.id' },
  callbacks: {},
});

/** A standalone navigation button — `recordExpr` defaults to the page's own record. */
const openButton = (label: string, target: string, recordExpr = 'context.record.id') => ({
  componentName: 'OpenPage',
  staticConfig: { label, target },
  dynamicProps: { record: recordExpr },
  callbacks: {},
});

const runAction = (label: string, target: string, attribute?: string) =>
  ({ label, component: 'RunActivity', target, ...(attribute ? { attribute } : {}) });
const openAction = (label: string, target: string) =>
  ({ label, component: 'OpenPage', target });

const money = (key: string, label: string) =>
  ({ key, label, type: 'decimal', format: 'C0', currency: 'AUD', width: 110 });
const day = (key: string, label: string) =>
  ({ key, label, type: 'datetime', format: 'dd/MM/yyyy', width: 100 });
const num = (key: string, label: string, width = 90) =>
  ({ key, label, type: 'decimal', width });

const recordActivities = (emptyMessage: string) => ({
  componentName: 'RecordActivities',
  staticConfig: { title: 'Actions', emptyMessage },
  dynamicProps: { record: 'context.record.id' },
  callbacks: {},
});

const detailsTable = (rowsExpr: string, title = 'Details') => ({
  componentName: 'RecordList',
  staticConfig: {
    title, selection: 'none', newLabel: '', emptyMessage: 'No details.',
    columns: [{ key: 'property', label: 'Property', width: 180 }, { key: 'value', label: 'Value' }],
  },
  dynamicProps: { rows: rowsExpr },
  callbacks: {},
});

const photos = (title: string, valueExpr: string) => ({
  componentName: 'Photos',
  staticConfig: { title },
  dynamicProps: { value: valueExpr },
  callbacks: {},
});

// ── pages/project — three new sections ──────────────────────────────────────
// The WBS/CBS lists already carry `parentKey: 'parent_id'` (2026-09-14) — the
// other half of §8's sentence is already built and untouched here.

function buildProjectPageAdditions(existingDef: {
  layout: { root: { children: unknown[] } };
  slotConfigs: Record<string, unknown>;
  componentDependencies: { name: string; version: string }[];
}) {
  const slotConfigs = { ...existingDef.slotConfigs };

  // `slot-project-links` is a layout row only — it holds no component of its
  // own, just the two button slots beneath it, each with its own entry below.
  slotConfigs['slot-resources-link'] = openButton('Resources', 'pages/resources');
  slotConfigs['slot-dashboard-link'] = openButton('Shift reports dashboard', 'pages/shift-reports');
  const projectLinksPanel = row('slot-project-links', 6, [
    auto('slot-resources-link', 0),
    auto('slot-dashboard-link', 0),
  ]);

  slotConfigs['slot-work-groups-new'] = button('New work group', 'act_create_work_groups');
  slotConfigs['slot-work-groups'] = {
    componentName: 'RecordList',
    staticConfig: {
      title: 'Work Groups', parentKey: 'parent_id', search: true, sortable: true,
      selection: 'one', newLabel: '', emptyMessage: 'No work groups yet.',
      columns: [
        { key: 'wg_code', label: 'Code', width: 110 },
        { key: 'name', label: 'Name' },
        { key: 'manager', label: 'Manager' },
        { key: 'wg_type', label: 'Type', width: 110 },
        { key: 'active', label: 'Active', type: 'boolean', width: 80, format: 'Active/Inactive' },
        runAction('Edit', 'act_modify_work_groups'),
        runAction('Add child', 'act_create_work_groups', 'wg_parent'),
        runAction('Delete', 'act_delete_work_groups'),
        openAction('Open', 'pages/work-group'),
      ],
    },
    dynamicProps: { rows: "invoke('act_list_work_groups', { project_id: context.record.id })" },
    callbacks: {},
  };

  slotConfigs['slot-shift-reports'] = {
    componentName: 'RecordList',
    staticConfig: {
      title: 'Shift Reports', search: true, sortable: true, columnFilters: true,
      selection: 'one', newLabel: '', emptyMessage: 'No shift reports yet.',
      columns: [
        { key: 'report_no', label: 'Report no.', width: 100 },
        day('report_date', 'Date'),
        { key: 'shift', label: 'Shift', width: 80 },
        { key: 'wg_id', label: 'Work group' },
        num('work_hours', 'Hours'),
        { key: 'status', label: 'Status', width: 100 },
        openAction('Open', 'pages/shift-report'),
      ],
    },
    dynamicProps: { rows: "invoke('act_list_shift_reports', { project_id: context.record.id })" },
    callbacks: {},
  };

  slotConfigs['slot-defects'] = {
    componentName: 'RecordList',
    staticConfig: {
      title: 'Defects', search: true, sortable: true, columnFilters: true,
      selection: 'one', newLabel: '', emptyMessage: 'No defects yet.',
      columns: [
        { key: 'defect_no', label: 'Defect no.', width: 100 },
        day('raised_date', 'Raised'),
        { key: 'wbs_id', label: 'WBS' },
        { key: 'severity', label: 'Severity', width: 90 },
        { key: 'status', label: 'Status', width: 100 },
        openAction('Open', 'pages/defect'),
      ],
    },
    dynamicProps: { rows: "invoke('act_list_defects', { project_id: context.record.id })" },
    callbacks: {},
  };

  // The links row rides in the header, right under the activities strip —
  // pushed directly (not through `auto()`, which would nest it as its own
  // vertical stack when it is already the horizontal `row()` panel it needs
  // to be).
  //
  // Adding is idempotent (2026-09-23): the first build ran this twice and the
  // published project page carried every new section, and the links row, twice.
  // Anything already placed is left where it is rather than added again.
  const placed = (children: unknown[]) => new Set(children.map((c) => (c as { id: string }).id));
  const addMissing = (children: unknown[], additions: unknown[]) => {
    const have = placed(children);
    return [...children, ...additions.filter((a) => !have.has((a as { id: string }).id))];
  };

  const header = existingDef.layout.root.children[0] as { children: unknown[] };
  header.children = addMissing(header.children, [projectLinksPanel]);

  const bodyPanel = existingDef.layout.root.children[1] as { children: unknown[] };
  bodyPanel.children = addMissing(bodyPanel.children, [
    auto('slot-work-groups-new', 6),
    auto('slot-work-groups', 4),
    auto('slot-shift-reports', 10),
    auto('slot-defects', 10),
  ]);

  const componentDependencies = [...existingDef.componentDependencies];
  for (const name of ['OpenPage']) {
    if (!componentDependencies.some((c) => c.name === name)) componentDependencies.push({ name, version: '1.0.0' });
  }

  return { slotConfigs, componentDependencies, layout: existingDef.layout };
}

// ── pages/shift-report ───────────────────────────────────────────────────────

const SHIFT_REPORT_DETAILS_ROWS = [
  "[ { id: 'wg',       property: 'Work group',    value: context.record.wg_id },",
  "  { id: 'date',     property: 'Date',          value: context.record.report_date },",
  "  { id: 'shift',    property: 'Shift',         value: context.record.shift },",
  "  { id: 'status',   property: 'Status',        value: context.record.status },",
  "  { id: 'start',    property: 'Start time',    value: context.record.start_time },",
  "  { id: 'end',      property: 'End time',      value: context.record.end_time },",
  "  { id: 'breaks',   property: 'Break hours',   value: context.record.break_hours },",
  "  { id: 'worked',   property: 'Work hours',    value: context.record.work_hours },",
  "  { id: 'lost',     property: 'Hours lost',    value: context.record.hours_lost },",
  "  { id: 'weather',  property: 'Weather',       value: context.record.weather },",
  "  { id: 'summary',  property: 'Work summary',  value: context.record.work_summary },",
  "  { id: 'notes',    property: 'Site notes',    value: context.record.site_notes },",
  "  { id: 'apprvby',  property: 'Approved by',   value: context.record.approved_by },",
  "  { id: 'apprvdt',  property: 'Approved date', value: context.record.approved_date } ]",
].join('\n');

function shiftReportPage() {
  const slotConfigs: Record<string, unknown> = {
    'slot-title': text('Shift Report {{ context.record.report_no }}', 'title'),
    'slot-subtitle': text('{{ context.record.report_date }} · {{ context.record.shift }} · {{ context.record.status }}', 'subheading'),
    'slot-activities': recordActivities('Nothing can be done to this report right now.'),
    // Always shown; the model refuses it against a report that is not
    // Approved (§5.4) — the same "placed, model-gated" pattern every other
    // CREATE button in this solution follows, since RecordActivities cannot
    // list a CREATE (page-runtime SPEC: "CREATE and GET are excluded").
    'slot-amendment-btn': button('Raise amendment', 'act_create_shift_report_amendments'),

    'slot-details': detailsTable(SHIFT_REPORT_DETAILS_ROWS),
    'slot-photos': photos('Photos', 'context.record.report_photos'),

    'slot-wbs-new': button('Add WBS row', 'act_create_shift_wbs'),
    'slot-wbs': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'WBS Rows', selection: 'one', newLabel: '', emptyMessage: 'No WBS rows yet.',
        columns: [
          { key: 'wbs_id', label: 'WBS node' },
          num('hours', 'Hours'),
          num('qty_completed', 'Qty completed'),
          { key: 'qty_unit', label: 'Unit', width: 80 },
          { key: 'notes', label: 'Notes' },
          runAction('Edit', 'act_modify_shift_wbs'),
          runAction('Delete', 'act_delete_shift_wbs'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_shift_wbs', { report_id: context.record.id })" },
      callbacks: {},
    },

    'slot-resources-new': button('Add resource line', 'act_add_shift_report_resource'),
    'slot-resources': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Resources Used', selection: 'one', newLabel: '', emptyMessage: 'No resource lines yet.',
        columns: [
          { key: 'description', label: 'Resource' },
          num('quantity', 'Quantity'),
          { key: 'unit', label: 'Unit', width: 70 },
          money('rate', 'Rate'),
          money('tracked_cost', 'Tracked cost'),
          { key: 'calculated', label: 'Calculated', type: 'boolean', width: 90, format: 'Yes/No' },
          { key: 'notes', label: 'Notes' },
          runAction('Adjust', 'act_modify_shift_report_resource'),
          runAction('Remove', 'act_remove_shift_report_resource'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_shift_report_resources', { report_id: context.record.id })" },
      callbacks: {},
    },

    'slot-defects-new': button('Raise defect', 'act_create_defects'),
    'slot-defects': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Defects', selection: 'one', newLabel: '', emptyMessage: 'No defects raised.',
        columns: [
          { key: 'defect_no', label: 'Defect no.', width: 100 },
          { key: 'wbs_id', label: 'WBS' },
          { key: 'severity', label: 'Severity', width: 90 },
          { key: 'status', label: 'Status', width: 100 },
          openAction('Open', 'pages/defect'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_defects', { project_id: context.record.project_id, report_id: context.record.id })" },
      callbacks: {},
    },

    'slot-amendments': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Amendments', selection: 'one', newLabel: '', emptyMessage: 'No amendments raised.',
        columns: [
          { key: 'report_no', label: 'Report no.', width: 100 },
          { key: 'status', label: 'Status', width: 100 },
          { key: 'site_notes', label: 'Notes' },
          openAction('Open', 'pages/shift-report-amendment'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_shift_report_amendments', { report_id: context.record.id })" },
      callbacks: {},
    },
  };

  const layout = {
    root: {
      id: 'root', size: { type: 'flex', value: 1 }, direction: 'vertical',
      children: [
        auto('panel-header', 0, [
          { ...auto('slot-title', 0), padding: { top: 14, right: 16, bottom: 0, left: 16 } },
          auto('slot-subtitle', 1),
          { ...auto('slot-activities', 0), padding: { top: 10, right: 16, bottom: 4, left: 16 } },
          auto('slot-amendment-btn', 0),
        ]),
        {
          ...panel('panel-body', 1, false, [
            auto('slot-details', 10),
            auto('slot-photos', 6),
            auto('slot-wbs-new', 10),
            auto('slot-wbs', 4),
            auto('slot-resources-new', 10),
            auto('slot-resources', 4),
            auto('slot-defects-new', 10),
            auto('slot-defects', 4),
            auto('slot-amendments', 10),
          ]),
          padding: { top: 0, right: 0, bottom: 16, left: 0 },
          overflow: 'scroll',
        },
      ],
    },
  };

  return {
    access: { open: ROLES },
    record: { type: 'rt_shift_reports', instances: 'many' },
    layout, slotConfigs, contextSchema: [],
    componentDependencies: [
      { name: 'RecordActivities', version: '1.0.0' },
      { name: 'RecordList', version: '1.0.0' },
      { name: 'RunActivity', version: '1.0.0' },
      { name: 'OpenPage', version: '1.0.0' },
      { name: 'Text', version: '1.0.0' },
      { name: 'Photos', version: '1.0.0' },
    ],
  };
}

// ── pages/shift-report-amendment — its own activity set, per §5.4/§8 ───────

const AMENDMENT_DETAILS_ROWS = [
  "[ { id: 'corrects', property: 'Corrects report', value: context.record.amended_report_id },",
  "  { id: 'status',   property: 'Status',          value: context.record.status },",
  "  { id: 'notes',    property: 'Notes',           value: context.record.site_notes } ]",
].join('\n');

function shiftReportAmendmentPage() {
  const slotConfigs: Record<string, unknown> = {
    'slot-title': text('Amendment {{ context.record.report_no }}', 'title'),
    'slot-subtitle': text('{{ context.record.status }}', 'subheading'),
    // RecordActivities lists this record's own wf_shift_reports activities:
    // Edit Notes, Submit, Reject, Cancel, Approve. Raise Amendment (CREATE)
    // and the line activities (anchored on the line, a different record type)
    // never appear here regardless.
    'slot-activities': recordActivities('Nothing can be done to this amendment right now.'),
    'slot-open-original': openButton('View original report', 'pages/shift-report', 'context.record.amended_report_id'),

    'slot-details': detailsTable(AMENDMENT_DETAILS_ROWS),

    'slot-lines-new': button('Add correction line', 'act_add_shift_report_amendment_line'),
    'slot-lines': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Correction Lines', selection: 'one', newLabel: '', emptyMessage: 'No correction lines yet.',
        columns: [
          { key: 'description', label: 'Resource' },
          num('quantity', 'Quantity (signed)'),
          { key: 'wbs_id', label: 'WBS node' },
          money('rate', 'Rate'),
          money('tracked_cost', 'Tracked cost'),
          { key: 'notes', label: 'Notes' },
          runAction('Adjust', 'act_adjust_shift_report_amendment_line'),
          runAction('Remove', 'act_remove_shift_report_resource'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_shift_report_resources', { report_id: context.record.id })" },
      callbacks: {},
    },
  };

  const layout = {
    root: {
      id: 'root', size: { type: 'flex', value: 1 }, direction: 'vertical',
      children: [
        auto('panel-header', 0, [
          { ...auto('slot-title', 0), padding: { top: 14, right: 16, bottom: 0, left: 16 } },
          auto('slot-subtitle', 1),
          { ...auto('slot-activities', 0), padding: { top: 10, right: 16, bottom: 4, left: 16 } },
          auto('slot-open-original', 0),
        ]),
        {
          ...panel('panel-body', 1, false, [
            auto('slot-details', 10),
            auto('slot-lines-new', 10),
            auto('slot-lines', 4),
          ]),
          padding: { top: 0, right: 0, bottom: 16, left: 0 },
          overflow: 'scroll',
        },
      ],
    },
  };

  return {
    access: { open: ROLES },
    record: { type: 'rt_shift_reports', instances: 'many' },
    layout, slotConfigs, contextSchema: [],
    componentDependencies: [
      { name: 'RecordActivities', version: '1.0.0' },
      { name: 'RecordList', version: '1.0.0' },
      { name: 'RunActivity', version: '1.0.0' },
      { name: 'OpenPage', version: '1.0.0' },
      { name: 'Text', version: '1.0.0' },
    ],
  };
}

// ── pages/work-group ─────────────────────────────────────────────────────────

function workGroupPage() {
  const slotConfigs: Record<string, unknown> = {
    'slot-title': text('{{ context.record.wg_code }}', 'title'),
    'slot-subtitle': text('{{ context.record.name }} · {{ context.record.manager }} · {{ context.record.wg_type }}', 'subheading'),
    'slot-activities': recordActivities('Nothing can be done to this work group right now.'),
    'slot-new-report-btn': button('New shift report', 'act_create_shift_reports'),

    'slot-resources-new': button('Add standard resource', 'act_create_wg_resources'),
    'slot-resources': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Standard Resources', selection: 'one', newLabel: '', emptyMessage: 'No standard resources yet.',
        columns: [
          { key: 'resource_id', label: 'Resource' },
          num('quantity', 'Quantity'),
          money('rate', 'Rate override'),
          { key: 'cbs_id', label: 'Cost code override' },
          runAction('Edit', 'act_modify_wg_resources'),
          runAction('Remove', 'act_delete_wg_resources'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_wg_resources', { wg_id: context.record.id })" },
      callbacks: {},
    },

    'slot-reports': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Recent Shift Reports', selection: 'one', newLabel: '', emptyMessage: 'No shift reports yet.',
        columns: [
          { key: 'report_no', label: 'Report no.', width: 100 },
          day('report_date', 'Date'),
          { key: 'shift', label: 'Shift', width: 80 },
          num('work_hours', 'Hours'),
          { key: 'status', label: 'Status', width: 100 },
          openAction('Open', 'pages/shift-report'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_work_group_reports', { wg_id: context.record.id })" },
      callbacks: {},
    },
  };

  const layout = {
    root: {
      id: 'root', size: { type: 'flex', value: 1 }, direction: 'vertical',
      children: [
        auto('panel-header', 0, [
          { ...auto('slot-title', 0), padding: { top: 14, right: 16, bottom: 0, left: 16 } },
          auto('slot-subtitle', 1),
          { ...auto('slot-activities', 0), padding: { top: 10, right: 16, bottom: 4, left: 16 } },
          auto('slot-new-report-btn', 0),
        ]),
        {
          ...panel('panel-body', 1, false, [
            auto('slot-resources-new', 10),
            auto('slot-resources', 4),
            auto('slot-reports', 10),
          ]),
          padding: { top: 0, right: 0, bottom: 16, left: 0 },
          overflow: 'scroll',
        },
      ],
    },
  };

  return {
    access: { open: ROLES },
    record: { type: 'rt_work_groups', instances: 'many' },
    layout, slotConfigs, contextSchema: [],
    componentDependencies: [
      { name: 'RecordActivities', version: '1.0.0' },
      { name: 'RecordList', version: '1.0.0' },
      { name: 'RunActivity', version: '1.0.0' },
      { name: 'OpenPage', version: '1.0.0' },
      { name: 'Text', version: '1.0.0' },
    ],
  };
}

// ── pages/defect ──────────────────────────────────────────────────────────────

const DEFECT_DETAILS_ROWS = [
  "[ { id: 'location', property: 'Location',              value: context.record.location },",
  "  { id: 'desc',     property: 'Description',           value: context.record.def_description },",
  "  { id: 'wbs',      property: 'WBS node',               value: context.record.wbs_id },",
  "  { id: 'raised',   property: 'Raised',                 value: context.record.raised_date },",
  "  { id: 'raisedby', property: 'Raised by',              value: context.record.raised_by },",
  "  { id: 'assigned', property: 'Assigned to',            value: context.record.assigned_to },",
  "  { id: 'rectdt',   property: 'Rectified date',         value: context.record.rectified_date },",
  "  { id: 'rectnt',   property: 'Rectification notes',    value: context.record.rectification_notes },",
  "  { id: 'verdt',    property: 'Verified date',          value: context.record.verified_date },",
  "  { id: 'verby',    property: 'Verified by',            value: context.record.verified_by } ]",
].join('\n');

function defectPage() {
  const slotConfigs: Record<string, unknown> = {
    'slot-title': text('{{ context.record.defect_no }}', 'title'),
    'slot-subtitle': text('{{ context.record.severity }} · {{ context.record.status }}', 'subheading'),
    'slot-activities': recordActivities('Nothing can be done to this defect right now.'),
    'slot-open-report': openButton('View report', 'pages/shift-report', 'context.record.report_id'),

    'slot-details': detailsTable(DEFECT_DETAILS_ROWS),
    'slot-photos': photos('Photos', 'context.record.defect_photos'),
  };

  const layout = {
    root: {
      id: 'root', size: { type: 'flex', value: 1 }, direction: 'vertical',
      children: [
        auto('panel-header', 0, [
          { ...auto('slot-title', 0), padding: { top: 14, right: 16, bottom: 0, left: 16 } },
          auto('slot-subtitle', 1),
          { ...auto('slot-activities', 0), padding: { top: 10, right: 16, bottom: 4, left: 16 } },
          auto('slot-open-report', 0),
        ]),
        {
          ...panel('panel-body', 1, false, [
            auto('slot-details', 10),
            auto('slot-photos', 6),
          ]),
          padding: { top: 0, right: 0, bottom: 16, left: 0 },
          overflow: 'scroll',
        },
      ],
    },
  };

  return {
    access: { open: ROLES },
    record: { type: 'rt_defects', instances: 'many' },
    layout, slotConfigs, contextSchema: [],
    componentDependencies: [
      { name: 'RecordActivities', version: '1.0.0' },
      { name: 'RecordList', version: '1.0.0' },
      { name: 'RunActivity', version: '1.0.0' },
      { name: 'OpenPage', version: '1.0.0' },
      { name: 'Text', version: '1.0.0' },
      { name: 'Photos', version: '1.0.0' },
    ],
  };
}

// ── pages/resources — a plain list, nothing more ────────────────────────────

function resourcesPage() {
  const slotConfigs: Record<string, unknown> = {
    'slot-title': text('Resources', 'title'),
    'slot-subtitle': text('{{ context.record.project_no }} · {{ context.record.name }}', 'subheading'),
    'slot-new': button('New resource', 'act_create_resources'),
    'slot-list': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Catalogue', search: true, sortable: true, columnFilters: true,
        selection: 'one', newLabel: '', emptyMessage: 'No resources yet.',
        columns: [
          { key: 'code', label: 'Code', width: 110 },
          { key: 'description', label: 'Description' },
          { key: 'res_type', label: 'Type', width: 90 },
          { key: 'unit', label: 'Unit', width: 70 },
          money('rate', 'Rate'),
          { key: 'cbs_id', label: 'Cost code' },
          runAction('Edit', 'act_modify_resources'),
          runAction('Delete', 'act_delete_resources'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_resources', { project_id: context.record.id })" },
      callbacks: {},
    },
  };

  const layout = {
    root: {
      id: 'root', size: { type: 'flex', value: 1 }, direction: 'vertical',
      children: [
        auto('panel-header', 0, [
          { ...auto('slot-title', 0), padding: { top: 14, right: 16, bottom: 0, left: 16 } },
          auto('slot-subtitle', 1),
        ]),
        {
          ...panel('panel-body', 1, false, [
            auto('slot-new', 10),
            auto('slot-list', 4),
          ]),
          padding: { top: 0, right: 0, bottom: 16, left: 0 },
          overflow: 'scroll',
        },
      ],
    },
  };

  return {
    access: { open: ROLES },
    record: { type: 'rt_projects', instances: 'many' },
    layout, slotConfigs, contextSchema: [],
    componentDependencies: [
      { name: 'RecordList', version: '1.0.0' },
      { name: 'RunActivity', version: '1.0.0' },
      { name: 'Text', version: '1.0.0' },
    ],
  };
}

// ── pages/shift-reports — the dashboard ─────────────────────────────────────

function shiftReportsDashboardPage() {
  const slotConfigs: Record<string, unknown> = {
    'slot-title': text('Shift Reports', 'title'),
    'slot-subtitle': text('{{ context.record.project_no }} · {{ context.record.name }}', 'subheading'),

    'slot-contributions': {
      componentName: 'Contributions',
      staticConfig: {
        title: 'Contributions',
        // §8's colour rule: green only when the report AND every amendment
        // against it are approved; amber while anything is in flight; red for
        // nothing filed at all. The GET never emits 'missing' itself — a hole
        // with no cell is exactly what draws it (Contributions §3).
        states: [
          { state: 'approved', colour: 'green', label: 'Approved' },
          { state: 'inflight', colour: 'amber', label: 'Filed, not all approved' },
          { state: 'missing', colour: 'red', label: 'Not filed' },
        ],
        missingState: 'missing',
        emptyMessage: 'No work groups expected to file yet.',
      },
      dynamicProps: {
        cells: "invoke('act_list_shift_report_contributions', { project_id: context.record.id })",
        rows: "invoke('act_list_contribution_rows', { project_id: context.record.id })",
      },
      callbacks: {
        // A click on an empty (red) cell carries no report id — the
        // component's own synthesised `{ key, date, state }` (CONTRIBUTIONS
        // §7) — and there is nothing to open in that case.
        onSelect: "if callbackData.value.id <> '' and callbackData.value.id <> null { services.page.open('pages/shift-report', callbackData.value.id) }",
      },
    },

    'slot-awaiting': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Awaiting Approval', selection: 'one', newLabel: '', emptyMessage: 'Nothing awaiting approval.',
        columns: [
          { key: 'report_no', label: 'Report no.', width: 100 },
          day('report_date', 'Date'),
          { key: 'wg_id', label: 'Work group' },
          { key: 'status', label: 'Status', width: 100 },
          openAction('Open', 'pages/shift-report'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_reports_awaiting_approval', { project_id: context.record.id })" },
      callbacks: {},
    },

    'slot-recent-approved': {
      componentName: 'RecordList',
      staticConfig: {
        title: 'Recently Approved', selection: 'one', newLabel: '', emptyMessage: 'Nothing approved yet.',
        columns: [
          { key: 'report_no', label: 'Report no.', width: 100 },
          day('report_date', 'Date'),
          { key: 'wg_id', label: 'Work group' },
          num('work_hours', 'Hours'),
          openAction('Open', 'pages/shift-report'),
        ],
      },
      dynamicProps: { rows: "invoke('act_list_recently_approved_reports', { project_id: context.record.id })" },
      callbacks: {},
    },
  };

  const layout = {
    root: {
      id: 'root', size: { type: 'flex', value: 1 }, direction: 'vertical',
      children: [
        auto('panel-header', 0, [
          { ...auto('slot-title', 0), padding: { top: 14, right: 16, bottom: 0, left: 16 } },
          auto('slot-subtitle', 1),
        ]),
        {
          ...panel('panel-body', 1, false, [
            auto('slot-contributions', 10),
            auto('slot-awaiting', 10),
            auto('slot-recent-approved', 10),
          ]),
          padding: { top: 0, right: 0, bottom: 16, left: 0 },
          overflow: 'scroll',
        },
      ],
    },
  };

  return {
    access: { open: ROLES },
    record: { type: 'rt_projects', instances: 'many' },
    layout, slotConfigs, contextSchema: [],
    componentDependencies: [
      { name: 'Contributions', version: '1.0.0' },
      { name: 'RecordList', version: '1.0.0' },
      { name: 'OpenPage', version: '1.0.0' },
      { name: 'Text', version: '1.0.0' },
    ],
  };
}

// ── the check: every expression, through the real engine ────────────────────
// project-page.ts's pattern, generalised to accept a fabricated anchor for the
// three record types that have no real rows yet.

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const user = { id: 'script', name: 'page writer', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);
const projectAnchor = host.adapter.getRecord(PROJECT);
if (!projectAnchor) throw new Error(`${PROJECT} not found`);

// Fabricated — never inserted into the adapter, never written back. Enough
// shape for a scalar field read (`context.record.report_no`) and for the raw
// id to travel into an `invoke(...)` parameter; a query against it simply
// returns no rows, which is not an error.
const fabricate = (typeRef: string, customFields: Record<string, unknown>): RecordInstance =>
  ({ id: 'FABRICATED-0000', typeRef, customFields, activityHistory: [] });

const FAKE_SHIFT_REPORT = fabricate('rt_shift_reports', {
  report_no: 'SR-0000', project_id: PROJECT, wg_id: '', report_date: '2026-09-23', shift: 'Day',
  start_time: '06:00', end_time: '16:00', break_hours: '0', work_hours: '10', hours_lost: '0',
  weather: '', work_summary: '', site_notes: '', report_photos: '', status: 'Draft',
  approved_by: '', approved_date: '', amended_report_id: '', expired: 'false',
});
const FAKE_AMENDMENT = fabricate('rt_shift_reports', { ...FAKE_SHIFT_REPORT.customFields, amended_report_id: 'SR-0000' });
const FAKE_WORK_GROUP = fabricate('rt_work_groups', {
  wg_code: 'WG-FAKE', parent_id: '', name: 'Fake crew', project_id: PROJECT, manager: 'x', wg_type: 'Crew', active: 'true', expired: 'false',
});
const FAKE_DEFECT = fabricate('rt_defects', {
  defect_no: 'DEF-000', project_id: PROJECT, wbs_id: '', report_id: '', raised_date: '2026-09-23', raised_by: '',
  location: '', def_description: '', severity: 'Minor', defect_photos: '', assigned_to: '',
  rectified_date: '', rectification_notes: '', verified_date: '', verified_by: '', status: 'Open', expired: 'false',
});

let failed = 0;
const holesIn = (s: string) => [...s.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1].trim());
const named = (source: string) => source.match(/^\s*invoke\('([^']+)'/)?.[1] ?? null;

// Only used for `{{ }}` holes, none of which name a GET in this build — plain
// field reads against the anchor.
function evaluate(where: string, source: string, anchor: RecordInstance) {
  try {
    const value = host.engine.evaluate(source, { anchorRecord: anchor });
    console.log(`ok    ${where.padEnd(34)} ${JSON.stringify(value).slice(0, 70)}`);
  } catch (err) {
    console.log(`FAIL  ${where.padEnd(34)} ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

// A crude but sufficient parameter reader for the simple `invoke('act_x', { a: expr, ... })`
// literal shape every dynamic prop here uses — non-greedy so it stops at the
// invoke's OWN closing brace regardless of what a chained `.where(...)` etc.
// adds afterwards. None of these object literals nest braces of their own.
function resolveInvokeArgs(source: string, anchor: RecordInstance): Record<string, unknown> {
  const body = source.match(/invoke\(\s*'[^']+'\s*,\s*\{([\s\S]*?)\}\s*\)/)?.[1] ?? '';
  const args: Record<string, unknown> = {};
  for (const part of body.split(',')) {
    const m = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/s);
    if (!m) continue;
    // Every param here is `context.record.*` (the page's own anchor) — never
    // `context.page.record.*`, which is a page-host-only root for activity
    // *attribute sourcing*, not something a dynamic prop names.
    args[m[1]] = host.engine.evaluate(m[2], { anchorRecord: anchor });
  }
  return args;
}

// `engine.evaluate` has no `invoke` of its own (that is the page host's, not
// the plain expression door) — so a full chain (`invoke(...).where(...)`) is
// run by hand: call the named GET for its rows, then re-evaluate the rest of
// the chain against those rows via a synthetic `attributes.rows` root.
function evaluateChain(where: string, source: string, anchor: RecordInstance, realAnchor: boolean) {
  const get = named(source);
  if (!get) return evaluate(where, source, anchor);
  try {
    const activity = findActivity(host, get)!;
    const args = resolveInvokeArgs(source, anchor);
    // `runQuery`'s own anchor param is for the light log entry, which needs a
    // record the adapter actually holds — none of these GETs' `returns` reads
    // `context.record` themselves, so a fabricated anchor (no real row yet)
    // is passed as `null` here rather than made to round-trip the adapter.
    const rows = host.engine.runQuery(activity, args, realAnchor ? anchor : null).data;
    const rest = source.slice(source.indexOf(')', source.indexOf('{')) + 1).replace(/^\s*\)/, '');
    const chained = rest.trim().startsWith('.') ? rest.trim() : '';
    const value = chained ? host.engine.evaluate(`attributes.rows${chained}`, { attributes: { rows } }) : rows;
    const shown = Array.isArray(value) ? `${value.length} rows` : JSON.stringify(value);
    console.log(`ok    ${where.padEnd(34)} ${String(shown).slice(0, 70)}`);
  } catch (err) {
    console.log(`FAIL  ${where.padEnd(34)} ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

type SlotConfig = { dynamicProps?: Record<string, string>; staticConfig?: Record<string, unknown>; callbacks?: Record<string, string> };

function checkPage(label: string, slotConfigs: Record<string, unknown>, anchor: RecordInstance, realAnchor = false) {
  console.log(`\n── ${label} ──`);
  for (const [slot, raw] of Object.entries(slotConfigs)) {
    const config = raw as SlotConfig;
    for (const [prop, source] of Object.entries(config.dynamicProps ?? {})) evaluateChain(`${slot}.${prop}`, source, anchor, realAnchor);
    for (const [key, value] of Object.entries(config.staticConfig ?? {})) {
      if (typeof value !== 'string') continue;
      for (const hole of holesIn(value)) evaluate(`${slot}.${key} {{}}`, hole, anchor);
    }
  }

  const targets = new Set<string>();
  const seeds: { where: string; target: string; attribute: string }[] = [];
  for (const [slot, raw] of Object.entries(slotConfigs)) {
    const config = raw as SlotConfig;
    const s = config.staticConfig ?? {};
    if (typeof s.target === 'string') targets.add(s.target);
    if (typeof s.target === 'string' && typeof s.attribute === 'string') seeds.push({ where: slot, target: s.target, attribute: s.attribute });
    for (const column of (s.columns as { target?: string; attribute?: string; label?: string }[] ?? [])) {
      if (column.target) targets.add(column.target);
      if (column.target && column.attribute) seeds.push({ where: `${slot} · ${column.label ?? ''}`, target: column.target, attribute: column.attribute });
    }
    // Page targets (OpenPage) aren't activities — filtered below by findActivity.
  }
  for (const id of [...targets].sort()) {
    if (id.startsWith('pages/')) { console.log(`ok    page target                     ${id}`); continue; }
    if (findActivity(host, id)) console.log(`ok    activity                       ${id}`);
    else { console.log(`FAIL  activity                       ${id} does not exist`); failed += 1; }
  }
  for (const seed of seeds) {
    const found = findActivity(host, seed.target);
    if (found?.attributes.some((a) => a.key === seed.attribute)) console.log(`ok    seeds                          ${seed.where} → ${seed.attribute}`);
    else { console.log(`FAIL  seeds                          ${seed.where} → '${seed.target}' has no attribute '${seed.attribute}'`); failed += 1; }
  }
}

// ── build every page, check, then write ─────────────────────────────────────

const existingProjectRow = (await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, 'pages/project'))))[0];
if (!existingProjectRow) throw new Error('pages/project not found — run project-page.ts first');
const existingProjectDef = existingProjectRow.def as Parameters<typeof buildProjectPageAdditions>[0];
const projectAdditions = buildProjectPageAdditions(existingProjectDef);
const updatedProjectDef = { ...existingProjectDef, slotConfigs: projectAdditions.slotConfigs, componentDependencies: projectAdditions.componentDependencies };

checkPage('pages/project (additions)', {
  'slot-work-groups': projectAdditions.slotConfigs['slot-work-groups'],
  'slot-shift-reports': projectAdditions.slotConfigs['slot-shift-reports'],
  'slot-defects': projectAdditions.slotConfigs['slot-defects'],
}, projectAnchor, true);

const shiftReportDef = shiftReportPage();
checkPage('pages/shift-report', shiftReportDef.slotConfigs, FAKE_SHIFT_REPORT);

const amendmentDef = shiftReportAmendmentPage();
checkPage('pages/shift-report-amendment', amendmentDef.slotConfigs, FAKE_AMENDMENT);

const workGroupDef = workGroupPage();
checkPage('pages/work-group', workGroupDef.slotConfigs, FAKE_WORK_GROUP);

const defectDef = defectPage();
checkPage('pages/defect', defectDef.slotConfigs, FAKE_DEFECT);

const resourcesDef = resourcesPage();
checkPage('pages/resources', resourcesDef.slotConfigs, projectAnchor, true);

const dashboardDef = shiftReportsDashboardPage();
checkPage('pages/shift-reports', dashboardDef.slotConfigs, projectAnchor, true);

if (failed > 0) {
  console.log(`\n${failed} problem${failed === 1 ? '' : 's'} — nothing written`);
  await closeDb(db);
  process.exit(1);
}

if (dry) {
  console.log('\nall checks passed — dry run, nothing written');
  await closeDb(db);
  process.exit(0);
}

const write = async (path: string, def: unknown) => {
  await db.insert(pages).values({ solutionId: SOLUTION, path, def })
    .onConflictDoUpdate({ target: [pages.solutionId, pages.path], set: { def, updatedAt: new Date() } });
  console.log(`page written  ${path}  (draft — publish it in the Console)`);
};

await write('pages/project', updatedProjectDef);
await write('pages/shift-report', shiftReportDef);
await write('pages/shift-report-amendment', amendmentDef);
await write('pages/work-group', workGroupDef);
await write('pages/defect', defectDef);
await write('pages/resources', resourcesDef);
await write('pages/shift-reports', dashboardDef);

await closeDb(db);
