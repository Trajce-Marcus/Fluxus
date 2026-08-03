// Solution-model publish + versions (ruled 2026-07-26) — the SDM counterpart of
// the page PublishControl, closing the gap that made git the only history the
// model had. Publish snapshots the solution's current config as a new immutable
// version with required release notes; rollback republishes an older version
// AND restores it as the draft (the config draft is what hosts evaluate), so
// the solution reloads afterwards. Reuses the `.pub-*` styles.

import { useState } from 'react';
import { reloadSolution, sdmClient } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';

type Version = { version: number; readme: string; publishedBy: string; publishedAt: string };

export function ConfigPublishControl() {
  const [dialog, setDialog] = useState<null | 'publish' | 'versions'>(null);
  const [readme, setReadme] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function openVersions() {
    setStatus(null);
    setDialog('versions');
    try {
      setVersions(await sdmClient.configVersions());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function doPublish() {
    if (!readme.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const { version } = await sdmClient.publishConfig(readme.trim());
      setStatus(`Published model v${version}.`);
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
      const res = await sdmClient.rollbackConfig(version);
      // The draft changed under every open editor — rebuild and remount.
      await reloadSolution();
      shellStore.set((prev) => ({ ...prev, scopeVersion: prev.scopeVersion + 1 }));
      setStatus(`Rolled back to v${version} (published as v${res.version}).`);
      setVersions(await sdmClient.configVersions());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pub-control">
      <button className="pub-btn" onClick={() => { setStatus(null); setDialog('publish'); }}>Publish model</button>
      <button className="pub-btn pub-btn-ghost" onClick={openVersions}>Versions</button>
      {status && <span className="pub-status">{status}</span>}

      {dialog === 'publish' && (
        <div className="pub-overlay" onClick={() => setDialog(null)}>
          <div className="pub-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="pub-modal-title">Publish model</h3>
            <p className="pub-modal-sub">Snapshots this solution's SDM as a new version. Release notes are required.</p>
            <textarea className="pub-readme" value={readme} onChange={(e) => setReadme(e.target.value)} placeholder="What changed in the model?" rows={4} />
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
            <h3 className="pub-modal-title">Model versions</h3>
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
