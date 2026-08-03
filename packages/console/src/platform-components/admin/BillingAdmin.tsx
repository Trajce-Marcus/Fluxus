// Organisation → Billing (M17). Billing itself is not built; what *is* real is
// the plan the org is on (M14: `plan`/`status` are ours to set, never the
// org's), so this surface shows it read-only and is honest about the rest.

import { useEffect, useState } from 'react';
import type { OrgProfile } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function BillingAdmin() {
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void consoleClient.getOrg()
      .then(setOrg)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Billing</h2>
        <p className="admin-sub">What this organisation is subscribed to. Invoices and self-serve plan changes aren't built.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-section">
        <h3 className="admin-form-title">Plan</h3>
        {org === null ? (
          <p className="admin-muted">Loading…</p>
        ) : (
          <table className="admin-table">
            <tbody>
              <tr><th>Plan</th><td>{org.plan}</td></tr>
              <tr><th>Status</th><td>{org.status}</td></tr>
              <tr><th>Registered</th><td className="admin-muted">{formatDate(org.createdAt)}</td></tr>
            </tbody>
          </table>
        )}
        <p className="admin-sub">Changing plan is a Fluxus-side action.</p>
      </div>

      <div className="placeholder-card">
        <div className="placeholder-badge">Not built yet</div>
        <ul className="placeholder-list">
          <li>Payment method and billing contact</li>
          <li>Invoices and receipts</li>
          <li>Usage against plan limits</li>
          <li>Self-serve upgrade / downgrade</li>
        </ul>
      </div>
    </div>
  );
}
