import { Fragment } from 'react';
import type { ActivityHistoryEntry } from '@fluxus/engine';

interface Props {
  entry: ActivityHistoryEntry;
}

export function ActivityCard({ entry }: Props) {
  const ts = new Date(entry.timestamp).toLocaleString();
  const waived = entry.waived ?? {};
  // Waived attributes show in their own block with the reason, not as empty values
  const attrs = Object.entries(entry.capturedAttributes).filter(([k]) => !(k in waived));

  return (
    <div style={{
      padding: '12px 14px',
      border: '1px solid #e2e8f0',
      borderRadius: 6,
      background: '#fff',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
          {entry.activityName}
        </span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{ts}</span>
      </div>
      {attrs.length > 0 ? (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px' }}>
          {attrs.map(([k, v]) => (
            <Fragment key={k}>
              <dt style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{k}</dt>
              <dd style={{ margin: 0, fontSize: 12, color: '#0f172a' }}>{String(v)}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>No attributes captured.</span>
      )}
      {Object.keys(waived).length > 0 && (
        // Values declared unavailable at capture time, with the user's reason
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e2e8f0' }}>
          {Object.entries(waived).map(([k, reason]) => (
            <div key={k} style={{ fontSize: 12, color: '#64748b' }}>
              ⊘ <span style={{ fontWeight: 500 }}>{k}</span> — can't provide: {reason}
            </div>
          ))}
        </div>
      )}
      {entry.warnings && entry.warnings.length > 0 && (
        // Gate warnings the user acknowledged — part of this submission's audit
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fde68a' }}>
          {entry.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#92400e' }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
