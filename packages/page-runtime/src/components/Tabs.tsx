// A strip of tabs, one per named panel on the page (2026-09-24). SAP's object
// page anchor bar: the whole page stays there, and a tab scrolls to where its
// section starts. The author marks those places with a panel's `tabName`; this
// draws the names the page hands it and, on a click, asks the page to scroll.
//
// **More than one or nothing** — one tab has nowhere else to go, so a page with
// a single named panel draws no strip (ruled 2026-09-23). The tab lit is the
// one clicked, or the one whose section last came into view as the reader
// scrolled (2026-09-24) — see `watchTabs`.
//
// **`tabMode`** (2026-09-24, the user's name): `scroll`, the default, is all of the above.
// `switch` is the traditional kind — only the chosen tab's section shows, and
// the page hides the rest (`hiddenBySwitch`), so there is nothing to scroll to
// and nothing to watch.

import { useEffect, useState } from 'react';
import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';

const MODES: readonly string[] = ['scroll', 'switch'];

interface TabsProps {
  /** scroll (the default): a click scrolls to the section. switch: only the
   *  chosen section shows. */
  tabMode?: string;
  /** Supplied by the host: the page's tab names and the scroll to one. */
  services?: PageServiceHandlers;
}

function TabsComponent({ tabMode, services }: TabsProps) {
  const switching = tabMode === 'switch';
  const [selected, setSelected] = useState<string | null>(null);
  const names = services?.tabs ?? [];
  const watch = switching ? undefined : services?.watchTabs;
  useEffect(() => watch?.(setSelected), [watch]);
  if (names.length < 2) return null;

  const lit = switching ? services?.activeTab ?? null : selected;
  const current = lit !== null && names.includes(lit) ? lit : names[0];
  return (
    <div className="tb-root" role="tablist">
      {names.map((name) => (
        <button key={name} type="button" role="tab" aria-selected={name === current}
          className={`tb-tab${name === current ? ' tb-tab--on' : ''}`}
          onClick={() => { setSelected(name); services?.selectTab(name); }}>
          {name}
        </button>
      ))}
    </div>
  );
}

const css = `
  .tb-root { font-family: system-ui, sans-serif; display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid #e2e8f0; }
  .tb-tab { padding: 8px 12px; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; color: #475569; font-size: 0.85rem; font-weight: 600; font-family: inherit; cursor: pointer; white-space: nowrap; }
  .tb-tab:hover { color: #1e293b; }
  .tb-tab--on { color: #2563eb; border-bottom-color: #2563eb; }
`;

// The tabs themselves come from the page's slots, not from here.
const schema: PropSchema[] = [
  { name: 'tabMode', kind: 'static-config', type: 'string', required: false, description: 'scroll (default): a tab scrolls to its section; switch: only the chosen section shows', choices: MODES },
];

export const Tabs = Object.assign(TabsComponent, { css, schema });
