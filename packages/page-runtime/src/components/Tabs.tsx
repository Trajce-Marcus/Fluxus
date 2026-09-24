// A strip of tabs, one per named panel on the page (2026-09-24). SAP's object
// page anchor bar: the whole page stays there, and a tab scrolls to where its
// section starts. The author marks those places with a panel's `tabName`; this
// draws the names the page hands it and, on a click, asks the page to scroll.
//
// **More than one or nothing** — one tab has nowhere else to go, so a page with
// a single named panel draws no strip (ruled 2026-09-23). The tab clicked is
// the one highlighted; following the reader's scrolling to highlight the
// section in view is left for later.

import { useState } from 'react';
import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';

interface TabsProps {
  /** Supplied by the host: the page's tab names and the scroll to one. */
  services?: PageServiceHandlers;
}

function TabsComponent({ services }: TabsProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const names = services?.tabs ?? [];
  if (names.length < 2) return null;

  const current = selected !== null && names.includes(selected) ? selected : names[0];
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

// No properties: the tabs come from the page's panels, not from here.
const schema: PropSchema[] = [];

export const Tabs = Object.assign(TabsComponent, { css, schema });
