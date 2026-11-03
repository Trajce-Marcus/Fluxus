// The operation view's Apps tab (APPS_AND_INSTANCES §2.6): the operation's
// apps list. Each app is made from one of the solution's published pages, with
// its own name, who may run it, and its definition — what it needs set for
// this operation, as JSON. One page may be added more than once (a water
// scheduler and a sewer scheduler). Adding and changing happen in a dialog,
// which also shows the app's history; every change leaves an entry there.
// Nothing is removed: an app is expired (§3.2) — final, kept in the list
// marked Expired, its dialog read-only. Requires op admin.

import { useEffect, useState } from 'react';
import type { App, AppInput } from '@fluxus/client';
import type { ActivityHistoryEntry } from '@fluxus/engine';
import { consoleClient } from '../../sdm-runtime/engine';
import { Dialog } from '../users/dialogs/Dialog';
import { StatusPill } from '../users/shared/UserTabs';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function OperationAppsSection({ operationId, solutionId }: { operationId: string; solutionId: string }) {
  const [apps, setApps] = useState<App[] | null>(null);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The app the dialog is open on: null for a new one, absent when closed. */
  const [editing, setEditing] = useState<App | null | undefined>(undefined);

  async function load() {
    setError(null);
    try {
      const [list, r, p] = await Promise.all([
        consoleClient.listApps(operationId),
        consoleClient.operationRoles(operationId),
        consoleClient.listPublishedPaths(solutionId),
      ]);
      setApps(list.apps);
      setRoles(r);
      setPaths(p);
    } catch (e) {
      setError(message(e));
    }
  }

  useEffect(() => { void load(); }, [operationId, solutionId]);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="admin-section">
      <div className="admin-head-row">
        <h3 className="admin-section-title">Apps</h3>
        <button className="admin-btn" disabled={apps === null} onClick={() => setEditing(null)}>Add app</button>
      </div>
      <p className="admin-sub">
        The apps this operation uses. Each is made from one of the solution's published pages, with its own
        name, who may run it, and what it needs set here. A page can be added more than once.
      </p>
      {error && <div className="admin-error">{error}</div>}
      {apps === null ? (
        !error && <p className="admin-muted">Loading…</p>
      ) : apps.length === 0 ? (
        <p className="admin-muted">No apps yet — nothing in this operation can be opened until one is added.</p>
      ) : (
        <table className="admin-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Name</th><th>Page</th><th>Who may run it</th></tr></thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.id} className={`apps-row${app.status === 'expired' ? ' apps-row-expired' : ''}`} onClick={() => setEditing(app)}>
                <td>{app.label}{app.status === 'expired' && <> <StatusPill status="expired" title="No longer runs; kept with its history" /></>}</td>
                <td className="admin-mono">{app.pageId}</td>
                <td>{app.roleIds.length === 0 ? <span className="admin-muted">Nobody</span> : app.roleIds.map(roleName).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== undefined && (
        <AppDialog
          operationId={operationId}
          solutionId={solutionId}
          app={editing}
          roles={roles}
          paths={paths}
          onClose={() => setEditing(undefined)}
          onDone={() => { setEditing(undefined); void load(); }}
        />
      )}
    </div>
  );
}

function AppDialog({ operationId, solutionId, app, roles, paths, onClose, onDone }: {
  operationId: string;
  solutionId: string;
  /** null: a new app. */
  app: App | null;
  roles: { id: string; name: string }[];
  paths: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [pageId, setPageId] = useState(app?.pageId ?? paths[0] ?? '');
  const [label, setLabel] = useState(app?.label ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set(app?.roleIds ?? []));
  const [definition, setDefinition] = useState(app?.definition ?? '{}');
  const [history, setHistory] = useState<ActivityHistoryEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Asking before expiring: it is final. */
  const [confirming, setConfirming] = useState(false);
  const expired = app?.status === 'expired';

  // The history is fetched for this one app when its dialog opens, not with
  // the list (it grows with every change).
  useEffect(() => {
    if (!app) return;
    consoleClient.getApp(operationId, app.id)
      .then((a) => setHistory(a.activityHistory))
      .catch((e) => setFailed(message(e)));
  }, [operationId, app]);

  // A new app starts with its page's example definition and default roles,
  // set again whenever another page is chosen (APPS_AND_INSTANCES §3.1,
  // §3.3). An existing app is never touched.
  useEffect(() => {
    if (app || !pageId) return;
    let current = true;
    consoleClient.pageAppDefaults(solutionId, pageId)
      .then((d) => { if (current) { setDefinition(d.definition ?? '{}'); setPicked(new Set(d.roleIds)); } })
      .catch((e) => { if (current) setFailed(message(e)); });
    return () => { current = false; };
  }, [solutionId, app, pageId]);

  function toggle(roleId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId); else next.add(roleId);
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      const input: AppInput = { ...(app ? { id: app.id } : {}), pageId, label, roleIds: [...picked], definition };
      await consoleClient.putApp(operationId, input);
      onDone();
    } catch (err) {
      setFailed(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function expire() {
    if (!app) return;
    setBusy(true);
    setFailed(null);
    try {
      await consoleClient.expireApp(operationId, app.id);
      onDone();
    } catch (err) {
      setFailed(message(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={app ? app.label : 'Add app'}
      sub={expired
        ? 'This app has expired: it no longer runs and is off the menu. It is kept, with its history, and cannot be changed.'
        : 'An app is made from one published page. Who may run it is set here, on the app.'}
      error={failed}
      onClose={onClose}
    >
      <form className="admin-modal-form" onSubmit={save}>
        <fieldset className="apps-fields" disabled={expired}>
        <label className="admin-field">
          <span>Page</span>
          <select value={pageId} onChange={(e) => setPageId(e.target.value)}>
            {paths.length === 0 && <option value="">No published pages</option>}
            {/* An app made from a page since unpublished still shows its page. */}
            {pageId && !paths.includes(pageId) && <option value={pageId}>{pageId}</option>}
            {paths.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="admin-field">
          <span>Name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Water scheduler" autoFocus />
        </label>
        <div className="admin-field">
          <span>Who may run it</span>
          {roles.length === 0 ? (
            <p className="admin-muted" style={{ margin: 0 }}>The solution declares no roles yet, so nobody can run it.</p>
          ) : (
            <div className="admin-checks">
              {roles.map((r) => (
                <label key={r.id} className="admin-check">
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span>{r.name} <span className="admin-muted admin-mono">{r.id}</span></span>
                </label>
              ))}
            </div>
          )}
        </div>
        <label className="admin-field">
          <span>Definition — what the app needs set for this operation, as JSON</span>
          <textarea className="admin-mono apps-definition" value={definition} onChange={(e) => setDefinition(e.target.value)} rows={5} spellCheck={false} />
        </label>
        </fieldset>
        {confirming ? (
          <div className="apps-confirm">
            <p style={{ margin: 0 }}>
              Expire <strong>{app?.label}</strong>? It stops running for everyone and leaves the menu. It is not
              deleted — it stays here with its history — but it cannot be brought back.
            </p>
            <div className="admin-row admin-modal-actions">
              <button type="button" className="admin-btn is-danger" disabled={busy} onClick={() => void expire()}>
                {busy ? 'Expiring…' : 'Expire app'}
              </button>
              <button type="button" className="admin-link" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        ) : expired ? (
          <div className="admin-row admin-modal-actions">
            <button type="button" className="admin-btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <div className="admin-row admin-modal-actions">
            <button type="submit" className="admin-btn" disabled={busy || !pageId || !label.trim()}>
              {busy ? 'Saving…' : app ? 'Save changes' : 'Add app'}
            </button>
            <button type="button" className="admin-link" onClick={onClose}>Cancel</button>
            {app && <button type="button" className="admin-link is-danger apps-expire" disabled={busy} onClick={() => setConfirming(true)}>Expire</button>}
          </div>
        )}
      </form>
      {app && (
        <div className="apps-history">
          <h4 className="apps-history-title">History</h4>
          {history === null ? (
            <p className="admin-muted">Loading…</p>
          ) : (
            <ul className="apps-history-list">
              {[...history].reverse().map((entry, i) => (
                <li key={i}>
                  <div><strong>{entry.activityName}</strong> <span className="admin-muted">{new Date(entry.timestamp).toLocaleString()} · {entry.author ?? 'unknown'}</span></div>
                  <div className="admin-mono apps-history-fields">
                    {Object.entries(entry.capturedAttributes).map(([k, v]) => `${k}: ${String(v)}`).join('  ·  ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

export const css = `
  .apps-row { cursor: pointer; }
  .apps-row-expired td { opacity: 0.55; }
  .apps-fields { border: none; margin: 0; padding: 0; min-width: 0; display: contents; }
  .apps-expire { margin-left: auto; }
  .apps-confirm { display: flex; flex-direction: column; gap: 10px; }
  .apps-row:hover td { background: var(--color-surface-hover, rgba(255,255,255,0.04)); }
  .apps-definition {
    background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);
    border-radius: 4px; padding: 6px 8px; font-size: 0.78rem; resize: vertical;
  }
  .apps-history { margin-top: 18px; border-top: 1px solid var(--color-border); padding-top: 10px; }
  .apps-history-title { margin: 0 0 6px; font-size: 0.8rem; }
  .apps-history-list { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; font-size: 0.76rem; }
  .apps-history-list li { padding: 6px 0; border-bottom: 1px solid var(--color-border); }
  .apps-history-fields { color: var(--color-text-muted); margin-top: 2px; word-break: break-all; }
`;
