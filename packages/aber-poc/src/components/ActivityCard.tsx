import { Fragment } from 'react';
import type { ActivityHistoryEntry } from '../types';

interface Props {
  entry: ActivityHistoryEntry;
}

export function ActivityCard({ entry }: Props) {
  const ts = new Date(entry.timestamp).toLocaleString();
  const attrs = Object.entries(entry.capturedAttributes);

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
    </div>
  );
}
