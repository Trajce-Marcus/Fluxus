// The validation posture the Console's DSL Editor uses (DSL_EDITOR_SPEC §7).
//
// It is NOT `pageRuntime.validateExpression`. That one declares the PAGE
// service registry, and a declared registry makes every module outside it an
// unknown-module error — so `services.notify.*` and `services.geo.*`, which the
// server does register, would block the Run button on scripts that run fine.
//
// The editor leaves `services` undeclared instead, which the validator treats
// as "this host has no registry, pass service calls through untyped". The
// browser cannot know what the server registered; a wrong registry is worse
// than none.

import { describe, it, expect } from 'vitest';
import { validateExpression } from '@fluxus/dsl';
import { buildDslSchema, functionSignatures } from '../src/index';
import type { ClientSolutionConfig } from '../src/types';

const config = {
  recordTypes: [
    {
      id: 'rt_assets',
      name: 'Assets',
      custom_fields: [
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
      ],
    },
  ],
  workflows: [],
  attributes: [],
  roles: [],
  functions: [],
} as unknown as ClientSolutionConfig;

/** Exactly what DslEditorView builds. */
function editorValidate(source: string) {
  const schema = { types: buildDslSchema(config).types };
  return validateExpression(source, schema, {
    bannedRoots: ['attributes'],
    functions: functionSignatures(config),
  });
}

const errors = (src: string) => editorValidate(src).filter((d) => d.severity === 'error');

describe('DSL editor validation', () => {
  it('accepts a plain query', () => {
    expect(errors("records.assets.where(status = 'open')")).toEqual([]);
  });

  it('accepts the services the server registers, rather than blocking them', () => {
    // The regression this file exists for: these used to be unknown-module
    // errors, and the Run button refused a script the server would have run.
    expect(errors("services.geo.suburbs('3000')")).toEqual([]);
    expect(errors("services.notify.user('hi')")).toEqual([]);
  });

  it('still catches a field the model does not have', () => {
    expect(errors('records.assets.where(no_such_field = 1)').length).toBeGreaterThan(0);
  });

  it('still catches an unknown record type', () => {
    expect(errors('records.nope.where(a = 1)').length).toBeGreaterThan(0);
  });

  it('bans `attributes` — no activity is in flight', () => {
    expect(errors('attributes.anything').length).toBeGreaterThan(0);
  });

  it('allows context.user', () => {
    expect(errors('context.user')).toEqual([]);
  });
});
