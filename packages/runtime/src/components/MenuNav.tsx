// Runtime navigation (APPS_AND_INSTANCES §2.5): the operation's app menu, built
// on the server for this caller (`apps.user`) — only leaves whose app they may
// run, and groups that keep one. A leaf shows its app's name and opens it;
// groups nest one level. Renders nothing when the caller has no menu.

import { client } from '../host';
import { useRuntime } from '../context/RuntimeContext';
import { isMenuGroup, type MenuLeaf } from '@fluxus/client';

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
  const { selectedAppId, selectApp } = useRuntime();
  const menu = client.menu;
  if (menu.length === 0) return null;

  const leaf = (it: MenuLeaf, indent: boolean) => (
    <li style={itemStyle(selectedAppId === it.appId, indent)} onClick={() => selectApp(it.appId)}>
      {client.findApp(it.appId)?.label ?? it.appId}
    </li>
  );

  return (
    <nav>
      <div style={headerStyle}>Menu</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {menu.map((it) =>
          isMenuGroup(it) ? (
            <li key={it.id}>
              <div style={{ ...itemStyle(false), cursor: 'default', color: '#475569', fontWeight: 600 }}>{it.label}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {it.items.map((c) => <span key={c.id}>{leaf(c, true)}</span>)}
              </ul>
            </li>
          ) : (
            <span key={it.id}>{leaf(it, false)}</span>
          ),
        )}
      </ul>
    </nav>
  );
}
