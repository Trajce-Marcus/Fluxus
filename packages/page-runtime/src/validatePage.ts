// Save-time page validation (ROADMAP item 5, PAGE_WIRING_DESIGN decision 7):
// the page file is a declarative definition validated against the model —
// component names against the registry, bindings against component schemas,
// expressions and callback scripts against the SDM schema + declared roots,
// activity references against real activity ids. Same posture as the engine's
// config-save validation: diagnostics land on the console.

import { parseExpression, parseScript, type Call, type Diagnostic, type Stmt } from '@fluxus/dsl';
import type { PageDef } from './pageDef';
import { componentManifests } from './componentManifests';

export interface PageFinding {
  where: string;
  diagnostic: Diagnostic;
}

/** The slice of the PageRuntime handle validation needs — kept narrow so this
 *  module doesn't import the runtime factory (no cycle). */
export interface PageValidationHost {
  validateExpression(source: string): Diagnostic[];
  validateCallback(source: string): Diagnostic[];
  findActivity(activityId: string): { activity: { record_map?: string } } | null;
  /** The record type a page declares itself about, with the workflow that
   *  says how one is created. Null when the model has no such type. */
  findRecordType(typeId: string): {
    workflow: { activities: { record_map?: string; attributes: { key: string; required?: boolean }[] }[] };
  } | null;
}

const note = (findings: PageFinding[], where: string, message: string, severity: Diagnostic['severity'] = 'error') => {
  findings.push({ where, diagnostic: { severity, message, line: 1, col: 1 } });
};

export function validatePage(host: PageValidationHost, def: PageDef): PageFinding[] {
  const findings: PageFinding[] = [];

  checkPageRecord(host, def, findings);

  for (const [slotId, config] of Object.entries(def.slotConfigs ?? {})) {
    if (!config) continue;
    const where = (part: string) => `slot '${slotId}' (${config.componentName}) ${part}`;

    const manifest = componentManifests[config.componentName];
    if (!manifest) {
      note(findings, `slot '${slotId}'`, `Unknown component '${config.componentName}' — not in the registry`);
      continue;
    }
    const schemaByName = new Map(manifest.schema.map((p) => [p.name, p]));

    // Static config keys must be declared static-config props.
    for (const key of Object.keys(config.staticConfig)) {
      const prop = schemaByName.get(key);
      if (!prop) note(findings, where(`prop '${key}'`), `'${manifest.name}' has no prop '${key}'`);
      else if (prop.kind !== 'static-config') note(findings, where(`prop '${key}'`), `'${key}' is ${prop.kind}, not static-config`);
    }

    // Dynamic props: declared, and the expression validates (datasource posture).
    for (const [propName, source] of Object.entries(config.dynamicProps)) {
      const w = where(`prop '${propName}'`);
      const prop = schemaByName.get(propName);
      if (!prop) note(findings, w, `'${manifest.name}' has no prop '${propName}'`);
      else if (prop.kind !== 'dynamic-data') note(findings, w, `'${propName}' is ${prop.kind}, not dynamic-data`);
      for (const diagnostic of host.validateExpression(source)) {
        findings.push({ where: w, diagnostic });
      }
      for (const diagnostic of checkRefs(host, source, 'expression')) {
        findings.push({ where: w, diagnostic });
      }
    }

    // Required dynamic-data props left unbound render empty — worth a warning.
    for (const prop of manifest.schema) {
      if (prop.kind === 'dynamic-data' && prop.required && !(prop.name in config.dynamicProps)) {
        note(findings, where(`prop '${prop.name}'`), `required prop '${prop.name}' has no expression`, 'warning');
      }
    }

    // Callbacks: declared, script validates ('callback' mode), activity ids real.
    for (const [callbackName, source] of Object.entries(config.callbacks)) {
      const w = where(`callback '${callbackName}'`);
      const prop = schemaByName.get(callbackName);
      if (!prop) note(findings, w, `'${manifest.name}' has no callback '${callbackName}'`);
      else if (prop.kind !== 'callback') note(findings, w, `'${callbackName}' is ${prop.kind}, not a callback`);
      for (const diagnostic of host.validateCallback(source)) {
        findings.push({ where: w, diagnostic });
      }
      for (const diagnostic of checkRefs(host, source, 'callback')) {
        findings.push({ where: w, diagnostic });
      }
    }
  }

  return findings;
}

/**
 * The page's record declaration (DATA_THROUGH_ACTIVITIES step 3), checked
 * where it can still be fixed. A one-instance page creates its record on first
 * open, so the two things that would strand it — no such type, no create
 * activity — are errors here rather than a page that opens to a message.
 *
 * A page that reads but declares nothing is a warning, not an error: it is
 * legal (a pure view), it just means those reads leave no trace, and that is
 * worth saying to the person who wired the GET.
 */
function checkPageRecord(host: PageValidationHost, def: PageDef, findings: PageFinding[]): void {
  const declared = def.record;
  const where = 'page record';

  if (!declared) {
    const reads = Object.values(def.slotConfigs ?? {}).some(
      (config) => config && Object.values(config.dynamicProps).some((source) => source.includes('invoke(')),
    );
    if (reads) {
      note(findings, where, 'This page names a GET but is about no record, so its reads are not logged', 'warning');
    }
    return;
  }

  const typeDef = host.findRecordType(declared.type);
  if (!typeDef) {
    note(findings, where, `'${declared.type}' is not a record type in this model`);
    return;
  }
  if (declared.instances !== 'one' && declared.instances !== 'many') {
    note(findings, where, `'${String(declared.instances)}' is not a number of instances — use 'one' or 'many'`);
    return;
  }
  if (declared.instances !== 'one') return;

  const create = typeDef.workflow.activities.find((a) => a.record_map === 'CREATE');
  if (!create) {
    note(findings, where, `'${declared.type}' has no create activity, so this page cannot open its record`);
    return;
  }
  // The page opens the record with no one there to fill a form in.
  const required = create.attributes.filter((attr) => attr.required).map((attr) => attr.key);
  if (required.length > 0) {
    note(
      findings,
      where,
      `the create activity requires ${required.join(', ')}, which nobody can supply when the page opens it`,
      'warning',
    );
  }
}

/**
 * Resolve literal activity ids against the SDM — `services.activities.run` in
 * a callback, and `invoke` in a dynamic-prop expression (the page naming its
 * producer, DATA_THROUGH_ACTIVITIES step 2). Non-literal first arguments are
 * left to runtime; the reference check is for the common, statically-knowable
 * case, and it is the only check that knows which surface the source came from.
 */
function checkRefs(host: PageValidationHost, source: string, kind: 'expression' | 'callback'): Diagnostic[] {
  let root: Stmt[] | unknown;
  try {
    root = kind === 'callback' ? parseScript(source).body : parseExpression(source);
  } catch {
    return []; // syntax errors already reported by the shared validators
  }
  const out: Diagnostic[] = [];
  walk(root, (call) => {
    const callee = call.callee;
    const first = call.args[0]?.value;

    // invoke(activityId, params?) — only a GET can answer, and only a dynamic
    // prop can wait for one: a callback script is synchronous and void, so the
    // page host supplies no `invoke` there and the evaluator would fail at run
    // time. Say so at save time instead.
    if (callee.kind === 'ident' && callee.name === 'invoke') {
      if (kind === 'callback') {
        out.push({
          severity: 'error',
          message: 'invoke() is not available in a callback — name the GET from a dynamic prop instead',
          line: call.pos.line,
          col: call.pos.col,
        });
      } else if (first?.kind === 'string') {
        const found = host.findActivity(first.value);
        if (!found) {
          out.push({ severity: 'error', message: `Unknown activity '${first.value}'`, line: first.pos.line, col: first.pos.col });
        } else if (found.activity.record_map !== 'GET') {
          out.push({
            severity: 'error',
            message: `'${first.value}' is not a GET activity — only a GET can answer invoke()`,
            line: first.pos.line,
            col: first.pos.col,
          });
        }
      }
      return;
    }

    if (
      callee.kind === 'member' && callee.name === 'run' &&
      callee.object.kind === 'member' && callee.object.name === 'activities' &&
      callee.object.object.kind === 'ident' && callee.object.object.name === 'services'
    ) {
      if (first?.kind === 'string' && !host.findActivity(first.value)) {
        out.push({
          severity: 'error',
          message: `Unknown activity '${first.value}'`,
          line: first.pos.line,
          col: first.pos.col,
        });
      }
    }
  });
  return out;
}

/** Visit every Call node reachable from a value (statements, expressions, args). */
function walk(node: unknown, visit: (call: Call) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (rec.kind === 'call') visit(node as Call);
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'pos') continue;
    walk(value, visit);
  }
}

/** Console reporting, same voice as the engine's reportConfigFindings. */
export function reportPageFindings(host: PageValidationHost, pagePath: string, def: PageDef): PageFinding[] {
  const findings = validatePage(host, def);
  for (const { where, diagnostic } of findings) {
    const label = `[page ${pagePath}] ${where} [${diagnostic.line}:${diagnostic.col}] ${diagnostic.message}`;
    if (diagnostic.severity === 'error') console.error(label);
    else console.warn(label);
  }
  return findings;
}
