// The client projection (docs/CLIENT_TRUST_BOUNDARY.md §2): what the runtime
// plane is given, and — the part that matters — what it is not. `projectConfig`
// is pure, so these run without a database; the wiring into
// `config.getForOperation` is covered in rbac.test.ts.

import { describe, expect, it } from 'vitest';
import type { AttributeUsageDef, ClientAttributeDef, ClientAttributeTypeConfig, SolutionConfig } from '@fluxus/engine';
import { projectConfig } from '../src/projection';

const activity = (id: string, refs: string[]): SolutionConfig['workflows'][number]['activities'][number] => ({
  id,
  name: id,
  description: '',
  sort_order: 1,
  show_condition: 'available()',
  attributes: refs.map((attribute_ref) => ({ attribute_ref })),
  before_hook: 'fail("the crew is not yours")',
  after_hook: 'notify("done")',
});

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_a', name: 'As' }, { id: 'role_b', name: 'Bs' }] },
  attributes: [
    { key: 'note', label: 'Note', description: '', type: 'text', validation: 'value != ""', validation_message: 'required' },
    {
      key: 'site_photos',
      label: 'Photos',
      description: '',
      type: 'photo',
      type_config: { multi: true, max_count: 3, max_size_mb: 10 },
    },
    { key: 'crew', label: 'Crew', description: '', type: 'list', type_config: { datasource: 'crewnames()' } },
    { key: 'bundle', label: 'Bundle', description: '', type: 'composite', type_config: { attributes: [{ attribute_ref: 'part_a' }] } },
    { key: 'part_a', label: 'Part A', description: '', type: 'text' },
    { key: 'beta_only', label: 'Beta only', description: '', type: 'text' },
    { key: 'orphan', label: 'Orphan', description: '', type: 'text' },
  ],
  recordTypes: [
    {
      id: 'rt_alpha', name: 'Alpha', description: '', workflow_ref: 'wf_alpha',
      custom_fields: [{ key: 'note', label: 'Note', type: 'text', required: true, unique: true, immutable: true, default: 'x', indexed: true }],
      access: { read: ['role_a'] },
    },
    {
      id: 'rt_beta', name: 'Beta', description: '', workflow_ref: 'wf_beta',
      custom_fields: [{ key: 'ref', type: 'fk_ref', fk_record_type: 'rt_alpha', fk_display_field: 'note' }],
      access: { read: ['role_b'] },
    },
  ],
  workflows: [
    { id: 'wf_alpha', name: 'Alpha', description: '', activities: [activity('act_touch_alphas', ['note', 'site_photos', 'crew', 'bundle'])] },
    { id: 'wf_beta', name: 'Beta', description: '', activities: [activity('act_touch_betas', ['beta_only'])] },
  ],
  functions: [
    { id: 'fn_crewnames', name: 'crewnames', description: 'crew list', body: 'function crewnames() { return ["A"] }' },
    { id: 'fn_pricing', name: 'pricing', description: 'margin', body: 'function pricing() { return rate() * 2 }' },
    { id: 'fn_rate', name: 'rate', description: 'the rate', body: 'function rate() { return 42 }' },
  ],
};

const asRoleA = () => projectConfig(config, { roles: ['role_a'], enforced: true });

/** Every key anywhere in the projected object — the growth-proof assertion:
 *  a field added to the model later cannot appear here unless someone named
 *  it in `projectConfig`. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe('projectConfig — what never leaves the server', () => {
  it('carries no hook, anywhere, under any grade of access', () => {
    for (const roles of [['role_a'], ['role_a', 'role_b'], []]) {
      const keys = allKeys(projectConfig(config, { roles, enforced: true }));
      expect(keys.has('before_hook')).toBe(false);
      expect(keys.has('after_hook')).toBe(false);
    }
    // …including the open posture, where every row survives the row cut.
    expect(allKeys(projectConfig(config, { roles: [], enforced: false })).has('after_hook')).toBe(false);
  });

  it('carries no access rules — neither the role defs nor who may read what', () => {
    const projected = asRoleA();
    expect('access' in projected).toBe(false);
    expect(allKeys(projected).has('access')).toBe(false);
  });

  it('carries no presign gate, but keeps the count the widget validates against', () => {
    // `max_size_mb` gates the presign, before any bytes move, so the browser is
    // not told it. `max_count` ships so the add tile can stop the user early —
    // validation, never enforcement (validateSubmission holds the ceiling).
    expect(allKeys(asRoleA()).has('max_size_mb')).toBe(false);
    expect(asRoleA().attributes.find((a) => a.key === 'site_photos')?.type_config)
      .toEqual({ multi: true, max_count: 3 });
  });

  it('carries no storage constraints on custom fields', () => {
    const keys = allKeys(asRoleA());
    for (const stripped of ['required', 'unique', 'immutable', 'indexed', 'default']) {
      expect(keys.has(stripped)).toBe(false);
    }
  });
});

describe('projectConfig — the role cut', () => {
  it('drops unreadable record types and the workflows that serve them', () => {
    const projected = asRoleA();
    expect(projected.recordTypes.map((rt) => rt.id)).toEqual(['rt_alpha']);
    expect(projected.workflows.map((wf) => wf.id)).toEqual(['wf_alpha']);
    expect(allKeys(projected).has('act_touch_betas')).toBe(false);
  });

  it('drops the attributes only an unreachable form used, and the pool orphans', () => {
    const keys = asRoleA().attributes.map((a) => a.key);
    expect(keys.sort()).toEqual(['bundle', 'crew', 'note', 'part_a', 'site_photos']);
  });

  it('reaches composite sub-attributes through the pool', () => {
    expect(asRoleA().attributes.map((a) => a.key)).toContain('part_a');
  });

  it('ships nothing at all to a caller with no roles', () => {
    const projected = projectConfig(config, { roles: [], enforced: true });
    expect(projected.recordTypes).toEqual([]);
    expect(projected.workflows).toEqual([]);
    expect(projected.attributes).toEqual([]);
    expect(projected.functions).toBeUndefined();
  });

  it('ships everything readable when RBAC is dormant (env stub / no roles declared)', () => {
    expect(projectConfig(config, { roles: [], enforced: false }).recordTypes.map((rt) => rt.id))
      .toEqual(['rt_alpha', 'rt_beta']);
    const { access: _dropped, ...noRoles } = config;
    expect(projectConfig(noRoles, { roles: [], enforced: true }).recordTypes).toHaveLength(2);
  });
});

describe('projectConfig — what the client does need', () => {
  it('keeps validation expressions: the client validates inline, the server revalidates', () => {
    const note = asRoleA().attributes.find((a) => a.key === 'note');
    expect(note?.validation).toBe('value != ""');
    expect(note?.validation_message).toBe('required');
  });

  it('keeps the form definition and the availability condition', () => {
    const act = asRoleA().workflows[0].activities[0];
    expect(act.show_condition).toBe('available()');
    expect(act.attributes.map((a) => ('attribute_ref' in a ? a.attribute_ref : a.section)))
      .toEqual(['note', 'site_photos', 'crew', 'bundle']);
  });

  it('keeps the field label, and falls back to the key where there is none', () => {
    const alpha = asRoleA().recordTypes[0];
    expect(alpha.custom_fields[0].label).toBe('Note');
    // The beta type's field was authored before labels existed.
    const beta = projectConfig(config, { roles: ['role_b'], enforced: true }).recordTypes[0];
    expect(beta.custom_fields[0].label).toBeUndefined();
  });

  it('keeps FK wiring, which is how a browser displays and traverses a reference', () => {
    const beta = projectConfig(config, { roles: ['role_b'], enforced: true }).recordTypes[0];
    expect(beta.custom_fields[0]).toEqual({ key: 'ref', type: 'fk_ref', fk_record_type: 'rt_alpha', fk_display_field: 'note' });
  });

  it('ships a function a shipped expression calls, and nothing else', () => {
    // `crewnames` is the crew datasource; `pricing`/`rate` are reachable only
    // from a hook, so they stay where the hook stayed.
    expect(asRoleA().functions?.map((f) => f.name)).toEqual(['crewnames']);
  });

  it('follows a call from one shipped function into another', () => {
    const calling = {
      ...config,
      attributes: config.attributes.map((a) => (a.key === 'crew' ? { ...a, type_config: { datasource: 'pricing()' } } : a)),
    };
    expect(projectConfig(calling, { roles: ['role_a'], enforced: true }).functions?.map((f) => f.name).sort())
      .toEqual(['pricing', 'rate']);
  });
});

// Both projections are whitelists — a fresh object naming each field to keep —
// so a field added to the model and not added there is dropped in silence and
// the feature behind it works on the server and not in the browser. That is
// what happened to `source` (2026-09-15 → 2026-09-17): the WBS create form
// asked for the project the page it was launched from was already showing.
//
// These two lock the whitelists to the types. `Required<…>` is the mechanism:
// add a field to `AttributeUsageDef` or `ClientAttributeDef` and the literal
// below stops compiling until it is listed here, at which point the assertion
// makes it a decision — ships, or named as deliberately withheld.
describe('projectConfig — every field is decided, none dropped by omission', () => {
  /** Fields deliberately withheld from the browser. Adding to these is a
   *  trust-boundary call (docs/CLIENT_TRUST_BOUNDARY.md §2), not a formality. */
  const WITHHELD_FROM_USAGE: string[] = [];
  // `max_size_mb` is on the server grade (`AttributeTypeConfig`), not the
  // client one, so the type keeps it out of this literal on its own.
  const WITHHELD_FROM_TYPE_CONFIG: string[] = [];
  const WITHHELD_FROM_ATTRIBUTE = [
    // Resolution output, not authored state: the adapter rebuilds it from the
    // composite's `type_config.attributes`, which do ship.
    'sub_attributes',
  ];

  it('carries every field of an attribute usage', () => {
    const full: Required<AttributeUsageDef> = {
      attribute_ref: 'note',
      source: 'context.page.record.id',
      show_condition: 'true',
      required: true,
      validation: 'value != ""',
      validation_message: 'required',
      can_waive: true,
    };
    const projected = projectConfig(
      { ...config, workflows: [{ ...config.workflows[0], activities: [{ ...activity('act_touch_alphas', []), attributes: [full] }] }] },
      { roles: ['role_a'], enforced: true },
    ).workflows[0].activities[0].attributes[0];

    for (const key of Object.keys(full)) {
      if (WITHHELD_FROM_USAGE.includes(key)) expect(projected).not.toHaveProperty(key);
      else expect(projected, `usage field '${key}' is dropped by projection`).toHaveProperty(key);
    }
  });

  it('carries every knob of a type config', () => {
    const full: Required<ClientAttributeTypeConfig> = {
      fk_record_type: 'rt_alpha',
      field: 'rt_alpha.ref',
      values: ['a'],
      expression: 'x',
      multi: true,
      datasource: 'crewnames()',
      key_field: 'id',
      display_field: 'name',
      columns: ['a'],
      multiline: true,
      decimal_places: 2,
      accept: ['.pdf'],
      max_count: 3,
      attributes: [{ attribute_ref: 'part_a' }],
    };
    const projected = projectConfig(
      { ...config, attributes: config.attributes.map((a) => (a.key === 'note' ? { ...a, type_config: full } : a)) },
      { roles: ['role_a'], enforced: true },
    ).attributes.find((a) => a.key === 'note')?.type_config;

    for (const key of Object.keys(full)) {
      if (WITHHELD_FROM_TYPE_CONFIG.includes(key)) expect(projected).not.toHaveProperty(key);
      else expect(projected, `type_config knob '${key}' is dropped by projection`).toHaveProperty(key);
    }
  });

  it('carries every field of a pool attribute, bar the resolved ones', () => {
    const full: Required<ClientAttributeDef> = {
      key: 'note',
      label: 'Note',
      description: 'a note',
      type: 'text',
      type_config: { multiline: true },
      sub_attributes: [],
      source: 'context.page.record.id',
      show_condition: 'true',
      required: true,
      validation: 'value != ""',
      validation_message: 'required',
      can_waive: true,
    };
    const projected = projectConfig(
      { ...config, attributes: [full, ...config.attributes.filter((a) => a.key !== 'note')] },
      { roles: ['role_a'], enforced: true },
    ).attributes.find((a) => a.key === 'note');

    for (const key of Object.keys(full)) {
      if (WITHHELD_FROM_ATTRIBUTE.includes(key)) expect(projected).not.toHaveProperty(key);
      else expect(projected, `attribute field '${key}' is dropped by projection`).toHaveProperty(key);
    }
  });
});
