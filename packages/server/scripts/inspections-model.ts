// One-off, 2026-10-10. The inspections solution, Part 1 — record types,
// attributes, activities and workflows per `solutions/inspections/docs/SPEC.md`
// (Part 1: up to Inspected). Pages and the menu are `inspections-pages.ts`;
// sample data is `inspections-sample-data.ts`.
//
// **First write only.** The model goes in through `putConfig`, the import path,
// which replaces the whole model and deletes anything absent from it. That is
// right for a solution that has no model yet and wrong once anyone has edited
// it in the Console, so the script refuses a solution that already has record
// types unless `--replace` is passed. Pass `--dry` to validate without a
// database.
//
// Creates the solution (`inspections`, its first sol admin the Console login)
// and one operation (`inspections-dev`) when they do not exist.
//
// Roles are ignored for now (spec, *Roles*): the model declares none, so no
// activity checks one and every record type reads open.
//
// Guards learned on the projects solution, kept here:
//   - a blank is null (BLUEPRINT, *A blank is null*) — every emptiness test is
//     `is null`, never `= ''`;
//   - status is written inside the after hooks, never captured, so a failing
//     hook leaves the status where it was;
//   - an expired record is one whose `expires_on` has passed: every picker's
//     GET says `(expires_on is null or expires_on > now())`.

import { fileURLToPath } from 'node:url';
import type { SolutionConfig } from '@fluxus/engine';
import { createEngine, MemoryAdapter, buildGeoModule, buildTimeModule, buildMathModule } from '@fluxus/engine';
import { createDb, closeDb } from '../src/db/client';
import { createOperation, createSolution, getSolutionConfig, listOperations, listSolutions, putConfig } from '../src/host';
import { buildNotifyModule, consoleNotifySink } from '../src/services/notify';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const SOLUTION_NAME = 'Building Inspections';
const OPERATION = 'inspections-dev';
const OPERATION_NAME = 'Inspections (dev)';
const FIRST_ADMIN = 't_tosevski@yahoo.com.au';
const dry = process.argv.includes('--dry');
const replace = process.argv.includes('--replace');

// ── builders ────────────────────────────────────────────────────────────────

type Usage = { attribute_ref: string; source?: string; show_condition?: string; required?: boolean; validation?: string; validation_message?: string };
const use = (attribute_ref: string, extra: Omit<Usage, 'attribute_ref'> = {}): Usage => ({ attribute_ref, ...extra });
const req = (attribute_ref: string, extra: Omit<Usage, 'attribute_ref'> = {}): Usage => use(attribute_ref, { required: true, ...extra });

const UNEXPIRED = '(expires_on is null or expires_on > now())';
const TERM = (...fields: string[]) =>
  `(attributes.term is null or ${fields.map((f) => `${f} like '%' + attributes.term + '%'`).join(' or ')})`;

const act = (a: {
  id: string; name: string; description: string; record_map: 'CREATE' | 'UPDATE' | 'DELETE' | 'GET';
  show_condition?: string; attributes?: Usage[]; before_hook?: string; after_hook?: string; returns?: string;
}) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  record_map: a.record_map,
  ...(a.show_condition ? { show_condition: a.show_condition } : {}),
  attributes: a.attributes ?? [],
  before_hook: a.before_hook ?? null,
  after_hook: a.after_hook ?? null,
  ...(a.returns ? { returns: a.returns } : {}),
});

const field = (key: string, label: string, type = 'text', fk?: { rt: string; display: string }) => ({
  key, label, type,
  ...(fk ? { fk_record_type: fk.rt, fk_display_field: fk.display } : {}),
});

// ── attributes (the pool) ───────────────────────────────────────────────────

const text = (key: string, label: string, description = '', multiline = false) =>
  ({ key, label, description, type: 'text', ...(multiline ? { type_config: { multiline: true } } : {}) });
const TRUE_FALSE = { datasource: "['true', 'false']" };

const ATTRIBUTES = [
  // jobs
  text('customer_name', 'Customer name'),
  text('customer_email', 'Customer email', 'The report and payment emails go here.'),
  text('address', 'Address', 'The property inspected.'),
  text('details', 'Details', '', true),
  text('notes', 'Notes', '', true),
  { key: 'quoted_amount', label: 'Quoted amount', description: '', type: 'decimal', type_config: { decimal_places: 2 } },
  text('quote_notes', 'Quote notes', '', true),
  text('cancel_reason', 'Reason', 'Why the job is cancelled.', true),
  { key: 'scheduled_at', label: 'Date and time', description: 'When the inspection is booked.', type: 'datetime' },
  text('inspector', 'Inspector', "The inspector's name."),
  text('instructions', 'Instructions', '', true),
  text('access', 'Access', 'Access to the property on the day.', true),
  text('weather', 'Weather'),
  text('checklist', 'Pre-start checklist', '', true),
  { key: 'declaration_confirmed', label: 'I confirm the inspection was carried out as recorded', description: '', type: 'list', type_config: TRUE_FALSE },

  // findings
  { key: 'job', label: 'Job', description: 'The job the finding belongs to. Taken from the Job page, never asked for.', type: 'reference', type_config: { fk_record_type: 'rt_jobs' } },
  { key: 'area', label: 'Inspection area', description: '', type: 'reference',
    type_config: { fk_record_type: 'rt_inspection_areas', datasource: "invoke('act_search_inspection_areas', { term: term })" } },
  text('location', 'Location', 'e.g. Bedroom 1'),
  { key: 'has_defect', label: 'Any defects?', description: '', type: 'list', type_config: TRUE_FALSE },
  { key: 'defect', label: 'Defect', description: 'Only the defects mapped to the chosen area.', type: 'reference',
    type_config: { fk_record_type: 'rt_defects', datasource: "invoke('act_search_area_defects', { area: attributes.area, term: term })" } },
  { key: 'category', label: 'Category', description: '', type: 'reference',
    type_config: { fk_record_type: 'rt_defect_categories', datasource: "invoke('act_search_defect_categories', { term: term })" } },
  { key: 'photos', label: 'Photos', description: '', type: 'photo', type_config: { multi: true } },
  text('comments', 'Comments', '', true),

  // master data
  text('code', 'Code'),
  text('name', 'Name'),
  { key: 'sequence', label: 'Order', description: 'Report order.', type: 'int' },
  text('description', 'Description', '', true),
  { key: 'default_category', label: 'Default category', description: '', type: 'reference',
    type_config: { fk_record_type: 'rt_defect_categories', datasource: "invoke('act_search_defect_categories', { term: term })" } },
  text('meaning', 'Meaning', '', true),
  text('source', 'Source', 'e.g. NCC 2025 Housing Provisions'),
  text('clause', 'Clause', 'e.g. 11.3.4'),
  text('title', 'Title'),
  text('extract', 'Extract', 'The clause text.', true),
  text('attribution', 'Attribution', 'Required wording for CC BY material.', true),
  text('link', 'Link'),
  { key: 'expires_on', label: 'Expires on', description: 'From this date it is no longer offered. Blank never expires.', type: 'date' },

  // mappings — a mapping's defect lands in its own type's `defect` field; the
  // findings' `defect` cannot serve, because its picker is filtered by area.
  { key: 'area_map_defect', label: 'Defect', description: '', type: 'reference',
    type_config: { field: 'rt_area_defects.defect', datasource: "invoke('act_search_defects', { term: term })" } },
  { key: 'code_map_defect', label: 'Defect', description: '', type: 'reference',
    type_config: { field: 'rt_defect_code_references.defect', datasource: "invoke('act_search_defects', { term: term })" } },
  { key: 'code_reference', label: 'Code reference', description: '', type: 'reference',
    type_config: { fk_record_type: 'rt_code_references', datasource: "invoke('act_search_code_references', { term: term })" } },

  // picker search box
  text('term', 'Search term', "A record picker's search box."),
];

// ── record types ────────────────────────────────────────────────────────────

const EXPIRES = field('expires_on', 'Expires on', 'date');

const RECORD_TYPES = [
  { id: 'rt_jobs', name: 'Jobs', description: 'One inspection engagement, whatever its type.', workflow_ref: 'wf_jobs', custom_fields: [
    field('job_type', 'Job type'),
    field('status', 'Status'),
    field('customer_name', 'Customer name'),
    field('customer_email', 'Customer email'),
    field('address', 'Address'),
    field('details', 'Details'),
    field('notes', 'Notes'),
    field('quoted_amount', 'Quoted amount', 'decimal'),
    field('quote_notes', 'Quote notes'),
    field('cancel_reason', 'Cancel reason'),
    field('scheduled_at', 'Scheduled', 'datetime'),
    field('inspector', 'Inspector'),
    field('instructions', 'Instructions'),
    field('access', 'Access'),
    field('weather', 'Weather'),
    field('checklist', 'Pre-start checklist'),
    field('declaration_confirmed', 'Declaration confirmed'),
  ] },
  { id: 'rt_findings', name: 'Findings', description: 'In this area, at this location, this defect (or none), with photos and comments.', workflow_ref: 'wf_findings', custom_fields: [
    field('job', 'Job', 'fk_ref', { rt: 'rt_jobs', display: 'address' }),
    field('area', 'Inspection area', 'fk_ref', { rt: 'rt_inspection_areas', display: 'name' }),
    field('location', 'Location'),
    field('has_defect', 'Any defects?'),
    field('defect', 'Defect', 'fk_ref', { rt: 'rt_defects', display: 'name' }),
    field('category', 'Category', 'fk_ref', { rt: 'rt_defect_categories', display: 'name' }),
    field('photos', 'Photos', 'photo'),
    field('comments', 'Comments'),
  ] },
  { id: 'rt_inspection_areas', name: 'Inspection Areas', description: 'The walk-through areas, in report order.', workflow_ref: 'wf_inspection_areas', custom_fields: [
    field('code', 'Code'), field('name', 'Name'), field('sequence', 'Order', 'int'), EXPIRES,
  ] },
  { id: 'rt_defect_categories', name: 'Defect Categories', description: 'AS 4349.1 — major defect, minor defect, safety hazard.', workflow_ref: 'wf_defect_categories', custom_fields: [
    field('name', 'Name'), field('meaning', 'Meaning'), EXPIRES,
  ] },
  { id: 'rt_defects', name: 'Defects', description: 'Anything observable on a walk-through.', workflow_ref: 'wf_defects', custom_fields: [
    field('code', 'Code'), field('name', 'Name'), field('description', 'Description'),
    field('default_category', 'Default category', 'fk_ref', { rt: 'rt_defect_categories', display: 'name' }), EXPIRES,
  ] },
  { id: 'rt_code_references', name: 'Code References', description: 'Code clauses with an extract of their text.', workflow_ref: 'wf_code_references', custom_fields: [
    field('code', 'Code'), field('source', 'Source'), field('clause', 'Clause'), field('title', 'Title'),
    field('extract', 'Extract'), field('attribution', 'Attribution'), field('link', 'Link'), EXPIRES,
  ] },
  { id: 'rt_area_defects', name: 'Area Defect Mappings', description: 'Which defects can be recorded in which area.', workflow_ref: 'wf_area_defects', custom_fields: [
    field('area', 'Inspection area', 'fk_ref', { rt: 'rt_inspection_areas', display: 'name' }),
    field('defect', 'Defect', 'fk_ref', { rt: 'rt_defects', display: 'name' }), EXPIRES,
  ] },
  { id: 'rt_defect_code_references', name: 'Defect Code Reference Mappings', description: 'Which code clauses relate to which defect.', workflow_ref: 'wf_defect_code_references', custom_fields: [
    field('defect', 'Defect', 'fk_ref', { rt: 'rt_defects', display: 'name' }),
    field('code_reference', 'Code reference', 'fk_ref', { rt: 'rt_code_references', display: 'code' }), EXPIRES,
  ] },
];

// ── jobs ────────────────────────────────────────────────────────────────────

const status = (s: string) => `context.record.update({ status: '${s}' })`;

const JOB_ACTIVITIES = [
  act({
    id: 'act_create_jobs', name: 'Create Pre-Purchase Job', record_map: 'CREATE',
    description: 'Takes a new pre-purchase inspection request.',
    // Only where there is no record — the Jobs page — so it is not offered
    // among a job's own activities.
    show_condition: 'context.record is null',
    attributes: [req('customer_name'), req('customer_email'), req('address'), use('details'), use('notes')],
    after_hook: "context.record.update({ status: 'Requested', job_type: 'Pre-Purchase Inspection' })",
  }),
  act({
    id: 'act_quote_jobs', name: 'Quote', record_map: 'UPDATE',
    description: 'Records the price. Rerun to change it; a re-quote does not undo an acceptance.',
    show_condition: "context.record.status <> 'Cancelled' and context.record.status <> 'Inspected'",
    attributes: [req('quoted_amount'), use('quote_notes')],
    after_hook: `if context.record.status = 'Requested' {\n  ${status('Quoted')}\n}`,
  }),
  act({
    id: 'act_accept_jobs', name: 'Accept Quote', record_map: 'UPDATE',
    description: 'The customer accepted the quote.',
    show_condition: "context.record.status = 'Quoted'",
    after_hook: status('Accepted'),
  }),
  act({
    id: 'act_cancel_jobs', name: 'Cancel Job', record_map: 'UPDATE',
    description: 'Cancels the job, with a reason.',
    show_condition: "context.record.status <> 'Cancelled' and context.record.status <> 'Inspected'",
    attributes: [req('cancel_reason')],
    after_hook: status('Cancelled'),
  }),
  act({
    id: 'act_schedule_jobs', name: 'Schedule', record_map: 'UPDATE',
    description: 'Books the inspection. Rerun to reschedule.',
    show_condition: "context.record.status = 'Accepted' or context.record.status = 'Scheduled'",
    attributes: [req('scheduled_at'), req('inspector'), use('instructions')],
    after_hook: status('Scheduled'),
  }),
  act({
    id: 'act_start_jobs', name: 'Start Inspection', record_map: 'UPDATE',
    description: 'On site: access, weather and the pre-start checklist.',
    show_condition: "context.record.status = 'Scheduled'",
    attributes: [use('access'), use('weather'), use('checklist')],
    after_hook: status('In Progress'),
  }),
  act({
    id: 'act_finish_jobs', name: 'Finish Inspection', record_map: 'UPDATE',
    description: 'Ends the walk-through. Every area needs at least one finding.',
    show_condition: "context.record.status = 'In Progress'",
    attributes: [req('declaration_confirmed', { validation: "value = 'true'", validation_message: 'Confirm the declaration to finish the inspection.' })],
    before_hook: [
      "let missing = ''",
      `for each a in records.inspection_areas.where(${UNEXPIRED} and not (id in records.findings.where(job = context.record.id).values(area))).orderBy(sequence) {`,
      "  missing = iif(missing = '', a.name, missing + ', ' + a.name)",
      '}',
      "if missing <> '' {",
      "  fail('Every area needs at least one finding, even if it has no defects. Still missing: ' + missing + '.')",
      '}',
    ].join('\n'),
    after_hook: status('Inspected'),
  }),
  act({
    id: 'act_list_jobs', name: 'List Jobs', record_map: 'GET',
    description: 'Every job, for the Jobs page.',
    returns: 'records.jobs.orderBy(scheduled_at desc).select(id, address, customer_name, status, scheduled_at, inspector)',
  }),
];

// ── findings ────────────────────────────────────────────────────────────────

const DEFECT_SHOWN = "attributes.has_defect = 'true'";
const MAPPED = `records.area_defects.where(area = attributes.area and defect = attributes.defect and ${UNEXPIRED}).count = 0`;
const NOT_MAPPED_MESSAGE = "fail('That defect is not listed for this area. Pick one from the defects for the chosen area.')";
const CLEAR_DEFECT = `if attributes.has_defect = 'false' {\n  context.record.update({ defect: null, category: null })\n}`;
const FINDING_QUESTIONS = (): Usage[] => [
  req('area'),
  req('location'),
  req('has_defect'),
  req('defect', { show_condition: DEFECT_SHOWN }),
  req('category', { show_condition: DEFECT_SHOWN }),
  use('photos'),
  use('comments'),
];

const FINDING_ACTIVITIES = [
  act({
    id: 'act_add_findings', name: 'Add Finding', record_map: 'CREATE',
    description: 'Records one finding on the job whose page it is added from.',
    // A CREATE has no anchor, so the job's status is checked here against the
    // job named, not by a show condition.
    attributes: [use('job', { source: 'context.page.record.id' }), ...FINDING_QUESTIONS()],
    before_hook: [
      'let job = records.jobs.where(id = attributes.job).first',
      'if job is null {',
      "  fail('Add a finding from its job.')",
      '}',
      "if job.status <> 'In Progress' {",
      "  fail('Findings can be added only while the inspection is in progress.')",
      '}',
      "if attributes.has_defect = 'true' and " + MAPPED + ' {',
      '  ' + NOT_MAPPED_MESSAGE,
      '}',
    ].join('\n'),
    after_hook: CLEAR_DEFECT,
  }),
  act({
    id: 'act_update_findings', name: 'Update Finding', record_map: 'UPDATE',
    description: 'Changes a finding while the inspection is in progress.',
    show_condition: "context.record.job.status = 'In Progress'",
    attributes: FINDING_QUESTIONS(),
    // The mapping check applies only when the area or defect is being changed,
    // so an old finding whose defect has since expired can still be updated.
    before_hook: [
      "if attributes.has_defect = 'true' and (attributes.area <> context.record.area or attributes.defect <> context.record.defect) {",
      '  if ' + MAPPED + ' {',
      '    ' + NOT_MAPPED_MESSAGE,
      '  }',
      '}',
    ].join('\n'),
    after_hook: CLEAR_DEFECT,
  }),
  act({
    id: 'act_remove_findings', name: 'Remove Finding', record_map: 'DELETE',
    description: 'Deletes the finding. The report is still being compiled, so it leaves no trace.',
    show_condition: "context.record.job.status = 'In Progress'",
  }),
  act({
    id: 'act_list_findings', name: 'List Findings', record_map: 'GET',
    description: "One job's findings, in area order.",
    attributes: [use('job')],
    returns: 'records.findings.where(job = attributes.job).select(id, area: area.name, sequence: area.sequence, location, defect: defect.name, category: category.name, photos, comments)',
  }),
];

// ── master data ─────────────────────────────────────────────────────────────

/** Create / update / list / search for one master-data type. */
function masterData(o: {
  plural: string; singular: string; collection: string;
  fields: string[]; required: string[]; listSelect: string; orderBy: string;
  searchFields: string[]; searchSelect: string; uniqueCode: boolean;
}) {
  const usages = (withExpiry: boolean) => [
    ...o.fields.map((f) => (o.required.includes(f) ? req(f) : use(f))),
    ...(withExpiry ? [use('expires_on')] : []),
  ];
  const unique = (update: boolean) => o.uniqueCode
    ? [
        `if records.${o.collection}.where(code = attributes.code${update ? ' and id <> context.record.id' : ''}).count > 0 {`,
        `  fail('Code ' + attributes.code + ' is already used by another ${o.singular.toLowerCase()}.')`,
        '}',
      ].join('\n')
    : undefined;
  return [
    act({
      id: `act_create_${o.plural}`, name: `Create ${o.singular}`, record_map: 'CREATE',
      description: `Adds a ${o.singular.toLowerCase()}.`,
      show_condition: 'context.record is null',
      attributes: usages(false),
      before_hook: unique(false),
    }),
    act({
      id: `act_update_${o.plural}`, name: `Update ${o.singular}`, record_map: 'UPDATE',
      description: `Changes a ${o.singular.toLowerCase()}, or sets the date it expires.`,
      attributes: usages(true),
      before_hook: unique(true),
    }),
    act({
      id: `act_list_${o.plural}`, name: `List ${o.singular}s`, record_map: 'GET',
      description: 'Every record, expired included, for its page.',
      returns: `records.${o.collection}.orderBy(${o.orderBy}).select(${o.listSelect})`,
    }),
    act({
      id: `act_search_${o.plural}`, name: `Search ${o.singular}s`, record_map: 'GET',
      description: 'Unexpired records matching a search term — for pickers.',
      attributes: [use('term')],
      returns: `records.${o.collection}.where(${UNEXPIRED} and ${TERM(...o.searchFields)}).orderBy(${o.orderBy}).select(${o.searchSelect})`,
    }),
  ];
}

const AREA_ACTIVITIES = masterData({
  plural: 'inspection_areas', singular: 'Area', collection: 'inspection_areas',
  fields: ['code', 'name', 'sequence'], required: ['code', 'name', 'sequence'],
  listSelect: 'id, code, name, sequence, expires_on', orderBy: 'sequence',
  searchFields: ['name', 'code'], searchSelect: 'id, code, name', uniqueCode: true,
});
const CATEGORY_ACTIVITIES = masterData({
  plural: 'defect_categories', singular: 'Category', collection: 'defect_categories',
  fields: ['name', 'meaning'], required: ['name'],
  listSelect: 'id, name, meaning, expires_on', orderBy: 'name',
  searchFields: ['name'], searchSelect: 'id, name', uniqueCode: false,
});
const DEFECT_ACTIVITIES = masterData({
  plural: 'defects', singular: 'Defect', collection: 'defects',
  fields: ['code', 'name', 'description', 'default_category'], required: ['code', 'name'],
  listSelect: 'id, code, name, default_category: default_category.name, expires_on', orderBy: 'code',
  searchFields: ['name', 'code'], searchSelect: 'id, code, name', uniqueCode: true,
});
const CODE_REFERENCE_ACTIVITIES = masterData({
  plural: 'code_references', singular: 'Code Reference', collection: 'code_references',
  fields: ['code', 'source', 'clause', 'title', 'extract', 'attribution', 'link'], required: ['code', 'title'],
  listSelect: 'id, code, source, clause, title, expires_on', orderBy: 'code',
  searchFields: ['code', 'title', 'clause'], searchSelect: 'id, code, title', uniqueCode: true,
});

// The defect search for Add Finding: unexpired defects through unexpired
// mappings to the chosen area.
const SEARCH_AREA_DEFECTS = act({
  id: 'act_search_area_defects', name: 'Search Area Defects', record_map: 'GET',
  description: 'Unexpired defects mapped to an area, matching a search term — the Add Finding defect picker.',
  attributes: [use('area'), use('term')],
  returns: `records.defects.where(${UNEXPIRED} and id in records.area_defects.where(area = attributes.area and ${UNEXPIRED}).values(defect) and ${TERM('name', 'code')}).orderBy(code).select(id, code, name)`,
});

// ── mappings ────────────────────────────────────────────────────────────────

const AREA_DEFECT_ACTIVITIES = [
  act({
    id: 'act_create_area_defects', name: 'Add Area Defect Mapping', record_map: 'CREATE',
    description: 'Lets a defect be recorded in an area.',
    show_condition: 'context.record is null',
    attributes: [req('area'), req('area_map_defect')],
    before_hook: [
      `if records.area_defects.where(area = attributes.area and defect = attributes.area_map_defect and ${UNEXPIRED}).count > 0 {`,
      "  fail('This defect is already mapped to this area.')",
      '}',
    ].join('\n'),
  }),
  act({
    id: 'act_update_area_defects', name: 'Update Area Defect Mapping', record_map: 'UPDATE',
    description: 'Sets the date the mapping expires.',
    attributes: [use('expires_on')],
  }),
  act({
    id: 'act_list_area_defects', name: 'List Area Defect Mappings', record_map: 'GET',
    description: 'Every mapping, expired included, for its page.',
    returns: 'records.area_defects.select(id, area: area.name, area_code: area.code, defect: defect.name, defect_code: defect.code, expires_on)',
  }),
];

const DEFECT_CODE_REFERENCE_ACTIVITIES = [
  act({
    id: 'act_create_defect_code_references', name: 'Add Defect Code Reference Mapping', record_map: 'CREATE',
    description: 'Relates a code clause to a defect.',
    show_condition: 'context.record is null',
    attributes: [req('code_map_defect'), req('code_reference')],
    before_hook: [
      `if records.defect_code_references.where(defect = attributes.code_map_defect and code_reference = attributes.code_reference and ${UNEXPIRED}).count > 0 {`,
      "  fail('This code reference is already mapped to this defect.')",
      '}',
    ].join('\n'),
  }),
  act({
    id: 'act_update_defect_code_references', name: 'Update Defect Code Reference Mapping', record_map: 'UPDATE',
    description: 'Sets the date the mapping expires.',
    attributes: [use('expires_on')],
  }),
  act({
    id: 'act_list_defect_code_references', name: 'List Defect Code Reference Mappings', record_map: 'GET',
    description: 'Every mapping, expired included, for its page.',
    returns: 'records.defect_code_references.select(id, defect: defect.name, defect_code: defect.code, code_reference: code_reference.code, title: code_reference.title, expires_on)',
  }),
];

// ── workflows ───────────────────────────────────────────────────────────────

const flow = (id: string, name: string, description: string, acts: { id: string }[]) =>
  ({ id, name, description, activities: acts.map((a) => ({ activity_ref: a.id })) });

const WORKFLOWS: [ReturnType<typeof flow>, ReturnType<typeof act>[]][] = [
  [flow('wf_jobs', 'Jobs', 'A pre-purchase inspection from request to Inspected.', JOB_ACTIVITIES), JOB_ACTIVITIES],
  [flow('wf_findings', 'Findings', 'Recording what the walk-through found.', FINDING_ACTIVITIES), FINDING_ACTIVITIES],
  [flow('wf_inspection_areas', 'Inspection Areas', 'Maintaining the areas.', AREA_ACTIVITIES), AREA_ACTIVITIES],
  [flow('wf_defect_categories', 'Defect Categories', 'Maintaining the categories.', CATEGORY_ACTIVITIES), CATEGORY_ACTIVITIES],
  [flow('wf_defects', 'Defects', 'Maintaining the defects.', [...DEFECT_ACTIVITIES, SEARCH_AREA_DEFECTS]), [...DEFECT_ACTIVITIES, SEARCH_AREA_DEFECTS]],
  [flow('wf_code_references', 'Code References', 'Maintaining the code references.', CODE_REFERENCE_ACTIVITIES), CODE_REFERENCE_ACTIVITIES],
  [flow('wf_area_defects', 'Area Defect Mappings', 'Which defects can be recorded in which area.', AREA_DEFECT_ACTIVITIES), AREA_DEFECT_ACTIVITIES],
  [flow('wf_defect_code_references', 'Defect Code Reference Mappings', 'Which code clauses relate to which defect.', DEFECT_CODE_REFERENCE_ACTIVITIES), DEFECT_CODE_REFERENCE_ACTIVITIES],
];

const CONFIG = {
  attributes: ATTRIBUTES,
  activities: WORKFLOWS.flatMap(([, acts]) => acts),
  recordTypes: RECORD_TYPES,
  workflows: WORKFLOWS.map(([wf]) => wf),
  functions: [],
} as unknown as SolutionConfig;

// ── validate locally, the same check the server runs at save ────────────────

function validateLocally(config: SolutionConfig): string[] {
  const adapter = new MemoryAdapter(config);
  for (const rt of config.recordTypes) adapter.getRecordTypeDef(rt.id);
  const engine = createEngine({ store: adapter, config, services: [buildNotifyModule(consoleNotifySink), buildGeoModule(adapter), buildTimeModule(), buildMathModule()] });
  return engine.validateConfig().map((f) => `${f.diagnostic.severity.toUpperCase()} ${f.where}: ${f.diagnostic.message}`);
}

const findings = validateLocally(CONFIG);
for (const f of findings) console.log(f);
console.log(`${CONFIG.recordTypes.length} record types, ${CONFIG.workflows.length} workflows, ${CONFIG.activities.length} activities, ${CONFIG.attributes.length} attributes — ${findings.length === 0 ? 'clean' : `${findings.length} finding(s)`}`);
if (findings.some((f) => f.startsWith('ERROR'))) process.exit(1);
if (dry) process.exit(0);

// ── write ───────────────────────────────────────────────────────────────────

const db = await createDb();
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}`);

if (!(await listSolutions(db)).some((s) => s.id === SOLUTION)) {
  await createSolution(db, { id: SOLUTION, name: SOLUTION_NAME, createdBy: FIRST_ADMIN });
  console.log(`solution  + ${SOLUTION}`);
}
if (!(await listOperations(db)).some((o) => o.id === OPERATION)) {
  await createOperation(db, { id: OPERATION, solutionId: SOLUTION, name: OPERATION_NAME });
  console.log(`operation + ${OPERATION}`);
}

const existing = await getSolutionConfig(db, SOLUTION);
if (existing.recordTypes.length > 0 && !replace) {
  console.error(`'${SOLUTION}' already has a model (${existing.recordTypes.length} record types). Not replacing it — pass --replace to overwrite, which deletes anything absent from this script.`);
  await closeDb(db);
  process.exit(1);
}

// Keep a menu already written by inspections-pages.ts across a --replace.
const menu = (existing as { default_menu?: unknown }).default_menu;
await putConfig(db, SOLUTION, { ...CONFIG, ...(menu ? { default_menu: menu } : {}) } as SolutionConfig);
console.log('model written');
await closeDb(db);
