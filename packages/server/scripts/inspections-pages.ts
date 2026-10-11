// One-off, 2026-10-10. The inspections solution's pages and default menu, per
// `solutions/inspections/docs/SPEC.md` *Pages* (Part 1). Run after
// `inspections-model.ts`.
//
// Every page is checked with the page builder's own `validatePage` against the
// stored model before anything is written, then saved, then published (the
// Runtime renders published pages and the menu may name only those), and
// finally the menu is written. Idempotent: each page is an upsert, each run
// publishes a new version. Pass --dry to check without writing.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryAdapter } from '@fluxus/engine';
import { createDb, closeDb } from '../src/db/client';
import { getSolutionConfig, publishPage, putDefaultMenu, putPage } from '../src/host';
import { validatePage } from '../../page-runtime/src/validatePage';
import { validatePageCallback, validatePageExpression, validatePageExpressionWithoutRecords } from '../../page-runtime/src/pageHost';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const PUBLISHED_BY = 't_tosevski@yahoo.com.au';
const dry = process.argv.includes('--dry');

// ── builders ────────────────────────────────────────────────────────────────

type Slot = { id: string; componentName: string; tabName?: string; staticConfig?: Record<string, unknown>; dynamicProps?: Record<string, string>; callbacks?: Record<string, string> };

const pad = (top: number, bottom: number) => ({ top, left: 16, right: 16, bottom });
const panel = (id: string, top = 10, bottom = 4) => ({ id, size: { type: 'auto' }, padding: pad(top, bottom), children: [], direction: 'vertical', background: '#ffffff' });

/** A page: a fixed header (title and, on a record page, its activities) over a scrolling body. */
function page(o: { record?: string; header: Slot[]; body: Slot[] }) {
  const slots = [...o.header, ...o.body];
  return {
    ...(o.record ? { record: { type: o.record, instances: 'many' } } : {}),
    layout: {
      root: {
        id: 'root', size: { type: 'flex', value: 1 }, direction: 'vertical',
        children: [
          { id: 'panel-header', size: { type: 'auto' }, padding: { top: 0, left: 0, right: 0, bottom: 0 }, direction: 'vertical', background: '#ffffff',
            children: o.header.map((s, i) => panel(s.id, i === 0 ? 14 : 10, i === 0 ? 0 : 4)) },
          { id: 'panel-body', size: { type: 'flex', value: 1 }, padding: { top: 0, left: 0, right: 0, bottom: 16 }, overflow: 'scroll', direction: 'vertical', background: '#ffffff',
            children: o.body.map((s) => panel(s.id, 10, 10)) },
        ],
      },
    },
    slotConfigs: Object.fromEntries(slots.map((s) => [s.id, {
      componentName: s.componentName,
      ...(s.tabName ? { tabName: s.tabName } : {}),
      staticConfig: s.staticConfig ?? {},
      dynamicProps: s.dynamicProps ?? {},
      callbacks: s.callbacks ?? {},
    }])),
    contextSchema: [],
    componentDependencies: [...new Set(slots.map((s) => s.componentName).concat(['RunActivity', 'OpenPage']))].map((name) => ({ name, version: '1.0.0' })),
  };
}

const header = (title: string, subtitle?: string): Slot =>
  ({ id: 'slot-title', componentName: 'PageHeader', staticConfig: { title, ...(subtitle ? { subtitle } : {}) } });

const activities = (empty: string): Slot =>
  ({ id: 'slot-activities', componentName: 'RecordActivities', staticConfig: { title: 'Actions', emptyMessage: empty }, dynamicProps: { record: 'context.record.id' } });

/** A property/value table over the page's record. */
const details = (rows: [string, string][], o: { id?: string; title?: string; tabName?: string } = {}): Slot => ({
  id: o.id ?? 'slot-details', componentName: 'RecordList', ...(o.tabName ? { tabName: o.tabName } : {}),
  staticConfig: { title: o.title ?? 'Details', columns: [{ key: 'property', label: 'Property', width: 200 }, { key: 'value', label: 'Value' }], newLabel: '', selection: 'none', emptyMessage: 'No details.' },
  dynamicProps: { rows: '[ ' + rows.map(([label, expr], i) => `{ id: 'r${i}', property: '${label}', value: ${expr} }`).join(',\n  ') + ' ]' },
});

type Column = { key?: string; label: string; type?: string; format?: string; width?: number; component?: string; target?: string };
const col = (key: string, label: string, extra: Partial<Column> = {}): Column => ({ key, label, ...extra });
const run = (label: string, target: string): Column => ({ label, target, component: 'RunActivity' });
const open = (target: string): Column => ({ label: 'Open', target, component: 'OpenPage' });
const DATE = { type: 'datetime', format: 'dd/MM/yyyy', width: 110 };
const EXPIRES = col('expires_on', 'Expires on', DATE);

/** A list page over one master-data type: create button, update per row. */
function dataPage(o: { title: string; list: string; create: string; newLabel: string; update: string; columns: Column[]; extra?: Column[]; empty: string }) {
  return page({
    header: [header(o.title)],
    body: [{
      id: 'slot-main', componentName: 'RecordList',
      staticConfig: {
        title: o.title, search: true, sortable: true, columnFilters: true,
        columns: [...o.columns, EXPIRES, run('Update', o.update), ...(o.extra ?? [])],
        newLabel: o.newLabel, emptyMessage: o.empty,
      },
      dynamicProps: { rows: `invoke('${o.list}', {})` },
      callbacks: { onNew: `services.activities.run('${o.create}', null)` },
    }],
  });
}

// ── pages ───────────────────────────────────────────────────────────────────

export const PAGES: Record<string, ReturnType<typeof page>> = {
  'pages/jobs': page({
    header: [header('Jobs')],
    body: [{
      id: 'slot-main', componentName: 'RecordList',
      staticConfig: {
        title: 'Jobs', search: true, sortable: true, columnFilters: true,
        columns: [
          col('job_no', 'Job', { width: 90 }), col('address', 'Address'), col('customer_name', 'Customer'), col('status', 'Status', { width: 120 }),
          col('scheduled_at', 'Scheduled', { type: 'datetime', format: 'dd/MM/yyyy HH:mm', width: 140 }), col('inspector', 'Inspector'),
          open('pages/job'),
        ],
        newLabel: 'Add job', emptyMessage: 'No jobs yet.',
      },
      dynamicProps: { rows: "invoke('act_list_jobs', {})" },
      callbacks: { onNew: "services.activities.run('act_create_jobs', null)" },
    }],
  }),

  'pages/job': page({
    record: 'rt_jobs',
    header: [
      header('{{ context.record.job_no }} · {{ context.record.address }}', '{{ context.record.customer_name }} · {{ context.record.status }}'),
      { id: 'slot-summary', componentName: 'Text', staticConfig: { text: "{{ invoke('act_summarise_findings', { job: context.record.id }) }}", style: 'caption' } },
      activities('Nothing can be done to this job right now.'),
      // One section at a time (spec, *Pages*): Job, Quote, Inspection, Findings.
      { id: 'slot-tabs', componentName: 'Tabs', staticConfig: { tabMode: 'scroll' } },
    ],
    body: [
      details([
        ['Job number', 'context.record.job_no'],
        ['Status', 'context.record.status'],
        ['Job type', 'context.record.job_type'],
        ['Customer', 'context.record.customer_name'],
        ['Customer email', 'context.record.customer_email'],
        ['Address', 'context.record.address'],
        ['Details', 'context.record.details'],
        ['Notes', 'context.record.notes'],
        ['Scheduled', 'context.record.scheduled_at'],
        ['Inspector', 'context.record.inspector.name'],
        ['Instructions', 'context.record.instructions'],
        ['Cancel reason', 'context.record.cancel_reason'],
      ], { id: 'slot-job', title: 'Job', tabName: 'Job' }),
      // The quote is its own record, read by Admins only (2026-10-12): an
      // inspector's browser is never sent it, so this tab says "Record access
      // denied" for them, and the server offers them no Quote action.
      details([
        ['Quoted amount', 'context.record.quote.quoted_amount'],
        ['Quote notes', 'context.record.quote.quote_notes'],
      ], { id: 'slot-quote', title: 'Quote', tabName: 'Quote' }),
      { id: 'slot-quote-actions', componentName: 'RecordActivities', staticConfig: { title: '', emptyMessage: '' }, dynamicProps: { record: 'context.record.quote' } },
      details([
        ['Access', 'context.record.access'],
        ['Weather', 'context.record.weather'],
        ['Pre-start checklist', 'context.record.checklist'],
        ['Building type', 'context.record.building_type'],
        ['Construction', 'context.record.construction'],
        ['Roof cladding', 'context.record.roof_cladding'],
        ['Footings', 'context.record.footings'],
        ['Storeys', 'context.record.storeys'],
        ['Approximate year built', 'context.record.year_built'],
        ['Occupied', 'context.record.occupied'],
        ['Furnished', 'context.record.furnished'],
        ['People present', 'context.record.people_present'],
        ['Water connected', 'context.record.water_connected'],
        ['Electricity connected', 'context.record.electricity_connected'],
        ['Gas connected', 'context.record.gas_connected'],
        ['Signs of concealed defects', 'context.record.concealment'],
        ['Concealment note', 'context.record.concealment_note'],
      ], { id: 'slot-inspection', title: 'Inspection', tabName: 'Inspection' }),
      details([
        ['Major defects, compared with similar homes', 'context.record.major_incidence'],
        ['Minor defects, compared with similar homes', 'context.record.minor_incidence'],
        ['Overall condition', 'context.record.overall_condition'],
        ['Overall assessment', 'context.record.overall_assessment'],
        ['Declaration confirmed', 'context.record.declaration_confirmed'],
      ], { id: 'slot-assessment', title: 'Assessment' }),
      // The Findings tab lists the job's area inspections (2026-10-12): each
      // area at a location and its outcome, with its findings a click away.
      { id: 'slot-findings-new', componentName: 'RunActivity', tabName: 'Findings', staticConfig: { label: 'Add area inspection', target: 'act_add_area_inspections' }, dynamicProps: { record: 'context.record.id' } },
      {
        id: 'slot-findings', componentName: 'RecordList',
        staticConfig: {
          title: 'Area inspections', sortable: true,
          columns: [
            col('sequence', 'No.', { type: 'int', width: 20 }), col('area', 'Area'), col('location', 'Location'),
            col('outcome', 'Outcome', { width: 160 }), col('restriction', 'Restriction', { width: 140 }),
            col('finding_count', 'Findings', { type: 'int', width: 80 }),
            col('photos', 'Photos', { type: 'photo', width: 90 }),
            run('Update', 'act_update_area_inspections'), run('Remove', 'act_remove_area_inspections'), open('pages/area-inspection'),
          ],
          newLabel: '', selection: 'one', emptyMessage: 'No area inspections yet.',
        },
        dynamicProps: { rows: "invoke('act_list_area_inspections', { job: context.record.id })" },
      },
    ],
  }),

  'pages/area-inspection': page({
    record: 'rt_area_inspections',
    header: [
      header('{{ context.record.area.name }} — {{ context.record.location }}', '{{ context.record.job.job_no }} · {{ context.record.job.address }}'),
      activities('This area inspection can no longer be changed.'),
    ],
    body: [
      details([
        ['Inspection area', 'context.record.area.name'],
        ['Location', 'context.record.location'],
        ['Outcome', 'context.record.outcome'],
        ['Restriction', 'context.record.restriction'],
        ['Comments', 'context.record.comments'],
      ]),
      { id: 'slot-photos', componentName: 'Photos', staticConfig: { title: 'Photos' }, dynamicProps: { value: 'context.record.photos' } },
      { id: 'slot-findings-new', componentName: 'RunActivity', staticConfig: { label: 'Add finding', target: 'act_add_findings' }, dynamicProps: { record: 'context.record.id' } },
      {
        id: 'slot-findings', componentName: 'RecordList',
        staticConfig: {
          title: 'Findings',
          columns: [
            col('defect', 'Defect'), col('category', 'Category', { width: 120 }), col('safety_hazard', 'Safety hazard', { width: 110 }),
            col('photos', 'Photos', { type: 'photo', width: 90 }),
            run('Update', 'act_update_findings'), run('Remove', 'act_remove_findings'), open('pages/finding'),
          ],
          newLabel: '', selection: 'one', emptyMessage: 'No findings yet.',
        },
        dynamicProps: { rows: "invoke('act_list_findings', { area_inspection: context.record.id })" },
      },
    ],
  }),

  'pages/finding': page({
    record: 'rt_findings',
    header: [
      header('{{ context.record.defect.name }}', '{{ context.record.area_inspection.area.name }} — {{ context.record.area_inspection.location }} · {{ context.record.area_inspection.job.job_no }}'),
      activities('This finding can no longer be changed.'),
    ],
    body: [
      details([
        ['Defect', 'context.record.defect.name'],
        ['Category', 'context.record.category.name'],
        ['Safety hazard', 'context.record.safety_hazard'],
        ['Comments', 'context.record.comments'],
      ]),
      { id: 'slot-photos', componentName: 'Photos', staticConfig: { title: 'Photos' }, dynamicProps: { value: 'context.record.photos' } },
    ],
  }),

  'pages/inspection-areas': dataPage({
    title: 'Inspection Areas', list: 'act_list_inspection_areas', create: 'act_create_inspection_areas', newLabel: 'Create area',
    update: 'act_update_inspection_areas', empty: 'No areas yet.',
    columns: [col('sequence', 'Order', { type: 'int', width: 70 }), col('code', 'Code', { width: 80 }), col('name', 'Name')],
  }),

  'pages/defects': dataPage({
    title: 'Defects', list: 'act_list_defects', create: 'act_create_defects', newLabel: 'Create defect',
    update: 'act_update_defects', empty: 'No defects yet.',
    columns: [col('code', 'Code', { width: 80 }), col('name', 'Name'), col('default_category', 'Default category', { width: 150 })],
  }),

  'pages/defect-categories': dataPage({
    title: 'Defect Categories', list: 'act_list_defect_categories', create: 'act_create_defect_categories', newLabel: 'Create category',
    update: 'act_update_defect_categories', empty: 'No categories yet.',
    columns: [col('name', 'Name', { width: 160 }), col('meaning', 'Meaning')],
  }),

  // Not a master-data page: inspectors have start and finish dates, no expiry.
  'pages/inspectors': page({
    header: [header('Inspectors')],
    body: [{
      id: 'slot-main', componentName: 'RecordList',
      staticConfig: {
        title: 'Inspectors', search: true, sortable: true, columnFilters: true,
        columns: [
          col('name', 'Name'), col('email', 'Email'),
          col('start_date', 'Start date', DATE), col('finish_date', 'Finish date', DATE),
          run('Update', 'act_update_inspectors'),
        ],
        newLabel: 'Create inspector', emptyMessage: 'No inspectors yet.',
      },
      dynamicProps: { rows: "invoke('act_list_inspectors', {})" },
      callbacks: { onNew: "services.activities.run('act_create_inspectors', null)" },
    }],
  }),

  'pages/code-references': dataPage({
    title: 'Code References', list: 'act_list_code_references', create: 'act_create_code_references', newLabel: 'Create code reference',
    update: 'act_update_code_references', empty: 'No code references yet.',
    columns: [col('code', 'Code', { width: 80 }), col('source', 'Source'), col('clause', 'Clause', { width: 90 }), col('title', 'Title')],
    extra: [open('pages/code-reference')],
  }),

  'pages/code-reference': page({
    record: 'rt_code_references',
    header: [
      header('{{ context.record.code }} — {{ context.record.title }}', '{{ context.record.source }} · {{ context.record.clause }}'),
      activities('Nothing can be done to this code reference right now.'),
    ],
    body: [
      { id: 'slot-extract', componentName: 'Text', staticConfig: { text: '{{ context.record.extract }}' } },
      details([
        ['Source', 'context.record.source'],
        ['Clause', 'context.record.clause'],
        ['Attribution', 'context.record.attribution'],
        ['Link', 'context.record.link'],
        ['Expires on', 'context.record.expires_on'],
      ]),
    ],
  }),

  'pages/area-defect-mappings': dataPage({
    title: 'Area Defect Mappings', list: 'act_list_area_defects', create: 'act_create_area_defects', newLabel: 'Add mapping',
    update: 'act_update_area_defects', empty: 'No mappings yet.',
    columns: [col('area_code', 'Area code', { width: 90 }), col('area', 'Area'), col('defect_code', 'Defect code', { width: 100 }), col('defect', 'Defect')],
  }),

  'pages/defect-code-reference-mappings': dataPage({
    title: 'Defect Code Reference Mappings', list: 'act_list_defect_code_references', create: 'act_create_defect_code_references', newLabel: 'Add mapping',
    update: 'act_update_defect_code_references', empty: 'No mappings yet.',
    columns: [col('defect_code', 'Defect code', { width: 100 }), col('defect', 'Defect'), col('code_reference', 'Code', { width: 80 }), col('title', 'Title')],
  }),
};

export const MENU = [
  { id: 'menu-jobs', label: 'Jobs', page: 'pages/jobs' },
  { id: 'menu-inspectors', label: 'Inspectors', page: 'pages/inspectors' },
  { id: 'menu-inspection-areas', label: 'Inspection Areas', page: 'pages/inspection-areas' },
  { id: 'menu-defects', label: 'Defects', page: 'pages/defects' },
  { id: 'menu-defect-categories', label: 'Defect Categories', page: 'pages/defect-categories' },
  { id: 'menu-code-references', label: 'Code References', page: 'pages/code-references' },
  { id: 'menu-area-defect-mappings', label: 'Area Defect Mappings', page: 'pages/area-defect-mappings' },
  { id: 'menu-defect-code-reference-mappings', label: 'Defect Code Reference Mappings', page: 'pages/defect-code-reference-mappings' },
];

// ── check, then write ───────────────────────────────────────────────────────

// Run only when invoked directly: the one-off scripts import the definitions
// above and write them per entity, so the user's Console edits survive.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = await createDb();
  const config = await getSolutionConfig(db, SOLUTION);
  const adapter = new MemoryAdapter(config);

  const host = {
    validateExpression: (s: string) => validatePageExpression(config, s),
    validateExpressionWithoutRecords: (s: string) => validatePageExpressionWithoutRecords(config, s),
    validateCallback: (s: string) => validatePageCallback(config, s),
    findActivity: (id: string) => {
      const a = config.activities.find((x) => x.id === id);
      return a ? { activity: a } : null;
    },
    findRecordType: (id: string) => {
      try { return adapter.getRecordTypeDef(id) as never; } catch { return null; }
    },
  };

  let errors = 0;
  for (const [path, def] of Object.entries(PAGES)) {
    const findings = validatePage(host as never, def as never);
    for (const f of findings) {
      console.log(`${path}: ${f.diagnostic.severity} ${f.where}: ${f.diagnostic.message}`);
      if (f.diagnostic.severity === 'error') errors++;
    }
  }
  console.log(`${Object.keys(PAGES).length} pages checked — ${errors} error(s)`);
  if (errors > 0 || dry) { await closeDb(db); process.exit(errors > 0 ? 1 : 0); }

  for (const [path, def] of Object.entries(PAGES)) {
    await putPage(db, SOLUTION, path, def);
    const { version } = await publishPage(db, SOLUTION, path, 'Inspections Part 1 — built by script (inspections-pages.ts); 2026-10-11 revision.', PUBLISHED_BY);
    console.log(`  + ${path} (v${version})`);
  }
  await putDefaultMenu(db, SOLUTION, MENU);
  console.log('menu written');
  await closeDb(db);
}
