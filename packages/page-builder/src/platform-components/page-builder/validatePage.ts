// Save-time page validation (ROADMAP item 5, PAGE_WIRING_DESIGN decision 7):
// the page file is a declarative definition validated against the model —
// component names against the registry, bindings against component schemas,
// expressions and callback scripts against the SDM schema + declared roots,
// activity references against real activity ids. Same posture as the engine's
// config-save validation: diagnostics land on the console.

import { parseScript, type Call, type Diagnostic, type Stmt } from '@fluxus/dsl';
import type { PageDef } from './persistence';
import { componentManifests } from './componentManifests';
import { validatePageExpression, validatePageCallback } from './pageHost';
import { findActivity } from '../../sdm-runtime/engine';

export interface PageFinding {
  where: string;
  diagnostic: Diagnostic;
}

const note = (findings: PageFinding[], where: string, message: string, severity: Diagnostic['severity'] = 'error') => {
  findings.push({ where, diagnostic: { severity, message, line: 1, col: 1 } });
};

export function validatePage(def: PageDef): PageFinding[] {
  const findings: PageFinding[] = [];

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
      for (const diagnostic of validatePageExpression(source)) {
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
      for (const diagnostic of validatePageCallback(source)) {
        findings.push({ where: w, diagnostic });
      }
      for (const finding of checkActivityRefs(source)) {
        findings.push({ where: w, diagnostic: finding });
      }
    }
  }

  return findings;
}

/**
 * Resolve literal activity ids passed to services.page.runActivity against
 * the SDM. Non-literal first arguments are left to runtime — the reference
 * check is for the common, statically-knowable case.
 */
function checkActivityRefs(source: string): Diagnostic[] {
  let body: Stmt[];
  try {
    body = parseScript(source).body;
  } catch {
    return []; // syntax errors already reported by validatePageCallback
  }
  const out: Diagnostic[] = [];
  walk(body, (call) => {
    const callee = call.callee;
    if (
      callee.kind === 'member' && callee.name === 'runActivity' &&
      callee.object.kind === 'member' && callee.object.name === 'page' &&
      callee.object.object.kind === 'ident' && callee.object.object.name === 'services'
    ) {
      const first = call.args[0]?.value;
      if (first?.kind === 'string' && !findActivity(first.value)) {
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
export function reportPageFindings(pagePath: string, def: PageDef): PageFinding[] {
  const findings = validatePage(def);
  for (const { where, diagnostic } of findings) {
    const label = `[page ${pagePath}] ${where} [${diagnostic.line}:${diagnostic.col}] ${diagnostic.message}`;
    if (diagnostic.severity === 'error') console.error(label);
    else console.warn(label);
  }
  return findings;
}
