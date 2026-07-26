// Runtime navigation (CONSOLE_RUNTIME_SPEC §4/§5): the operation's menu,
// role-filtered. Leaf items open a published page; groups nest one level. A
// "Workbench" item returns to the record grid (§4 — reachable, no longer the
// default). Renders nothing when no menu is configured, so the demo op is
// unchanged. Client filtering is cosmetic; the server already filtered the
// page snapshot to what the caller may open.

import { client } from '../host';
import { useAppContext } from '../context/AppContext';
import type { MenuItem } from '@fluxus/client';

const headerStyle: React.CSSProperties = {
  padding: '12px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#64748b', borderBottom: '1px solid #e2e8f0',
};

function itemStyle(active: boolean, indent = false): React.CSSProperties {
  return {
    padding: `7px 16px 7px ${indent ? 30 : 16}px`,
    cursor: 'pointer',
    background: active ? '#eff6ff' : 'transparent',
    color: active ? '#1d4ed8' : '#0f172a',
    fontWeight: active ? 600 : 400,
    borderLeft: active ? '3px solid #2563eb' : '3px solid transparent',
    fontSize: 13,
  };
}

export function MenuNav() {
  const { selectedPage, selectPage, showWorkbench } = useAppContext();
  const menu = client.visibleMenu();
  if (menu.length === 0) return null;

  const leaf = (it: MenuItem, indent: boolean) => (
    <li
      style={itemStyle(!!it.page && selectedPage === it.page, indent)}
      onClick={() => it.page && selectPage(it.page)}
    >
      {it.label}
    </li>
  );

  return (
    <nav>
      <div style={headerStyle}>Menu</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        <li style={itemStyle(selectedPage === null)} onClick={showWorkbench}>Workbench</li>
        {menu.map((it, i) =>
          it.items ? (
            <li key={i}>
              <div style={{ ...itemStyle(false), cursor: 'default', color: '#475569', fontWeight: 600 }}>{it.label}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {it.items.map((c, j) => <span key={j}>{leaf(c, true)}</span>)}
              </ul>
            </li>
          ) : (
            <span key={i}>{leaf(it, false)}</span>
          ),
        )}
      </ul>
    </nav>
  );
}
