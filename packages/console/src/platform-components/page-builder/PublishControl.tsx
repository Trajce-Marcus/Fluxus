// Per-page publish + versions control (CONSOLE_RUNTIME_SPEC §3), mounted in the
// page-editor toolbar. Publish snapshots the current draft as a new immutable
// version with required release notes; the versions dialog lists history and
// rolls back (republishes an older version). Solution comes from the draft
// client; the calls go through the Console client. RBAC stage-2 gates publish
// on implementer write — a FORBIDDEN surfaces as the status line.

import { useState } from 'react';
import { consoleClient, sdmClient } from '../../sdm-runtime/engine';

type Version = { version: number; readme: string; publishedBy: string; publishedAt: string };

export function PublishControl({ pagePath }: { pagePath: string }) {
  const solutionId = sdmClient.solutionId;
  const [dialog, setDialog] = useState<null | 'publish' | 'versions'>(null);
  const [readme, setReadme] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function openVersions() {
    setStatus(null);
    setDialog('versions');
    try {
      setVersions(await consoleClient.listPageVersions(solutionId, pagePath));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function doPublish() {
    if (!readme.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const { version } = await consoleClient.publishPage(solutionId, pagePath, readme.trim());
      setStatus(`Published v${version}.`);
      setReadme('');
      setDialog(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRollback(version: number) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await consoleClient.rollbackPage(solutionId, pagePath, version);
      setStatus(`Rolled back to v${version} (published as v${res.version}).`);
      setVersions(await consoleClient.listPageVersions(solutionId, pagePath));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pub-control">
      <button className="pub-btn" onClick={() => { setStatus(null); setDialog('publish'); }}>Publish</button>
      <button className="pub-btn pub-btn-ghost" onClick={openVersions}>Versions</button>
      {status && <span className="pub-status">{status}</span>}

      {dialog === 'publish' && (
        <div className="pub-overlay" onClick={() => setDialog(null)}>
          <div className="pub-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="pub-modal-title">Publish {pagePath}</h3>
            <p className="pub-modal-sub">Snapshots the current draft as a new version. Release notes are required.</p>
            <textarea className="pub-readme" value={readme} onChange={(e) => setReadme(e.target.value)} placeholder="What changed in this version?" rows={4} />
            <div className="pub-actions">
              <button className="pub-btn pub-btn-ghost" onClick={() => setDialog(null)}>Cancel</button>
              <button className="pub-btn" disabled={busy || !readme.trim()} onClick={doPublish}>{busy ? 'Publishing…' : 'Publish'}</button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'versions' && (
        <div className="pub-overlay" onClick={() => setDialog(null)}>
          <div className="pub-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="pub-modal-title">Versions of {pagePath}</h3>
            {versions.length === 0 ? (
              <p className="pub-modal-sub">Not published yet.</p>
            ) : (
              <ul className="pub-versions">
                {versions.map((v) => (
                  <li key={v.version} className="pub-version">
                    <div className="pub-version-head">
                      <span className="pub-version-num">v{v.version}</span>
                      <span className="pub-version-meta">{new Date(v.publishedAt).toLocaleString()} · {v.publishedBy}</span>
                      {v.version !== versions[0].version && (
                        <button className="pub-btn pub-btn-ghost pub-btn-sm" disabled={busy} onClick={() => doRollback(v.version)}>Roll back</button>
                      )}
                    </div>
                    <div className="pub-version-readme">{v.readme}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="pub-actions">
              <button className="pub-btn pub-btn-ghost" onClick={() => setDialog(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const css = `
  .pub-control { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .pub-status { font-size: 0.72rem; color: var(--color-text-muted); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pub-btn { background: var(--color-accent); color: #fff; border: none; border-radius: 3px; padding: 3px 10px; font-size: 0.75rem; cursor: pointer; }
  .pub-btn:disabled { opacity: 0.5; cursor: default; }
  .pub-btn-ghost { background: none; color: var(--color-text-muted); border: 1px solid var(--color-border); }
  .pub-btn-ghost:hover { color: var(--color-text); }
  .pub-btn-sm { padding: 1px 7px; font-size: 0.7rem; margin-left: auto; }
  .pub-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .pub-modal { background: var(--color-sidebar); border: 1px solid var(--color-border); border-radius: 6px; padding: 18px 20px; width: 460px; max-width: 90vw; max-height: 80vh; overflow-y: auto; color: var(--color-text); }
  .pub-modal-title { margin: 0 0 4px; font-size: 0.95rem; }
  .pub-modal-sub { margin: 0 0 12px; font-size: 0.78rem; color: var(--color-text-muted); }
  .pub-readme { width: 100%; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); padding: 8px; font-size: 0.85rem; font-family: inherit; resize: vertical; }
  .pub-readme:focus { outline: 1px solid var(--color-accent); border-color: var(--color-accent); }
  .pub-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .pub-versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .pub-version { border: 1px solid var(--color-border); border-radius: 4px; padding: 8px 10px; }
  .pub-version-head { display: flex; align-items: center; gap: 8px; }
  .pub-version-num { font-weight: 700; font-size: 0.8rem; }
  .pub-version-meta { font-size: 0.72rem; color: var(--color-text-muted); }
  .pub-version-readme { margin-top: 4px; font-size: 0.8rem; white-space: pre-wrap; }
`;
