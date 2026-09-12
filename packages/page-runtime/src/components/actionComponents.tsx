// The platform's two verbs, as buttons.
//
// A page can already run an activity or open a page — but only from a script
// the author wired to a callback. These are the same two calls with a button
// in front, so they can be placed rather than scripted: on their own in a page
// slot, or drawn once per row by an action column in RecordList.
//
// They add no capability. `services.runActivity` and `services.openPage` are
// the identical handlers ComponentContainer already hands to callback scripts,
// and the server authorises every run regardless of what the browser asked
// for. What they add is placement — the same button, wherever it is wanted.
//
// `record` is whichever record the button is about, and that depends on where
// it sits: RecordList fills it from the row, and a button standing alone on a
// page has it bound to the page's record. Same prop, different filler.

import type { FunctionComponent } from 'react';
import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';

export interface ActionProps {
  /** What the button says. */
  label?: string;
  /** The activity id, or the page path — whichever this component runs. */
  target?: string;
  /** The record the act is about. Null for a CREATE, which has no anchor. */
  record?: string | null;
  /**
   * `RunActivity` only: an attribute of the activity that the record fills, so
   * an act can be *about* a record without being anchored on it — which is how
   * a CREATE ("add a child here") carries its parent. Blank leaves the record
   * as the anchor alone, exactly as before.
   */
  attribute?: string;
  /** Supplied by the host, not by the author (see ComponentContainer). */
  services?: PageServiceHandlers;
}

const anchor = (record: string | null | undefined): string | null =>
  record === null || record === undefined || record === '' ? null : String(record);

// Exported because a component's css reaches the page only when that component
// is the one mounted (ComponentContainer injects `manifest.css`). A button
// drawn *inside* another component — a RecordList row, its toolbar — is
// therefore unstyled unless the host component carries these rules too.
export const actionCss = `
  .fx-action-btn { padding: 2px 10px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #334155; cursor: pointer; font-size: 0.7rem; font-family: inherit; white-space: nowrap; }
  .fx-action-btn:hover { background: #f1f5f9; }
`;

// Shown whether or not it has a target (ruled 2026-08-26): a control that
// disappears because nobody finished configuring it is indistinguishable from
// one hidden by access control, and only that is an answer to "may I do this?".
const css = actionCss;

const schema = (what: string): PropSchema[] => [
  { name: 'label',  kind: 'static-config', type: 'string', required: false, description: 'What the button says' },
  { name: 'target', kind: 'static-config', type: 'string', required: true,  description: what },
  { name: 'record', kind: 'dynamic-data',  type: 'string', required: false, description: 'The record this is about — a row supplies its own' },
];

const runSchema: PropSchema[] = [
  ...schema('Activity id to run — the record anchors it, or fills the attribute below'),
  { name: 'attribute', kind: 'static-config', type: 'string', required: false, description: 'Activity attribute the record fills — needed when the activity is a CREATE, which takes no anchor' },
];

function RunActivityComponent({ label = 'Run', target, record, attribute, services }: ActionProps) {
  const run = () => {
    if (!target) return;
    const id = anchor(record);
    // The seed is always a list — one record here, forty from a bulk action —
    // and the attribute's own cardinality decides what it becomes.
    const seed = attribute && id ? { attribute, records: [id] } : undefined;
    services?.runActivity(target, id, seed);
  };
  return (
    <button className="fx-action-btn" title={target} onClick={run}>{label}</button>
  );
}

function OpenPageComponent({ label = 'Open', target, record, services }: ActionProps) {
  return (
    <button className="fx-action-btn" title={target}
      onClick={() => { if (target) services?.openPage(target, anchor(record)); }}>
      {label}
    </button>
  );
}

export const RunActivity = Object.assign(RunActivityComponent, { css, schema: runSchema });

export const OpenPage = Object.assign(OpenPageComponent, {
  css,
  schema: schema('Page path to open — the record goes with it'),
});

/** The action components a RecordList column may name. */
export const actionComponents: Record<string, FunctionComponent<ActionProps>> = {
  RunActivity: RunActivityComponent,
  OpenPage: OpenPageComponent,
};
