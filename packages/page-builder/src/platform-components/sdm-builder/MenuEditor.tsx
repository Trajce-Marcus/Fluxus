// Solution-level default-menu editor (CONSOLE_RUNTIME_SPEC §5, M10): edits the
// `default_menu` carried in the config artifact — what every operation inherits
// unless it overrides. Saved through commitConfig like every SDM section, so it
// versions/publishes with the model; validated server-side at config.put
// (published pages + declared roles + one nesting level).

import { useEffect, useState } from 'react';
import type { ConfigRaw } from '@fluxus/engine';
import type { MenuItem } from '@fluxus/client';
import { readConfig, commitConfig, useDirty } from './useSolutionConfig';
import { consoleClient, sdmClient } from '../../sdm-runtime/engine';
import { MenuItemsEditor } from '../admin/MenuItemsEditor';

type ConfigWithMenu = ConfigRaw & { default_menu?: MenuItem[] };

export function MenuEditor() {
  const [draft, setDraft] = useState<ConfigWithMenu>(() => readConfig());
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();

  useEffect(() => {
    consoleClient.listPublishedPaths(sdmClient.solutionId).then(setPaths).catch((e) => setError(String(e)));
  }, []);

  const menu = draft.default_menu ?? [];
  const roles = (draft.access?.roles ?? []).map((r) => ({ id: r.id, name: r.name }));

  function setMenu(next: MenuItem[]) {
    setDraft((d) => ({ ...d, default_menu: next }));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Prune: empty items[] would read as a group; an empty menu drops the key
      // (no default is `undefined`, not `[]`).
      const clean = menu.map((it) => (it.items && it.items.length === 0 ? { ...it, items: undefined } : it));
      await commitConfig({ ...draft, default_menu: clean.length > 0 ? clean : undefined } as ConfigRaw);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Menu</h2>
        <p className="admin-sub">
          The solution's default runtime navigation — every operation inherits it unless it
          sets an override. Leaf items open published pages; items show only to users holding
          a listed role.
        </p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {menu.length === 0 && <p className="admin-muted">No default menu yet — operations fall back to the plain workbench nav.</p>}
      <MenuItemsEditor menu={menu} onChange={setMenu} roles={roles} paths={paths} />

      <div className="admin-actions">
        <button className="admin-btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save menu'}</button>
      </div>
    </div>
  );
}
