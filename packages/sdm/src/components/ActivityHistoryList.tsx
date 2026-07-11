import { ActivityCard } from './ActivityCard';
import type { RecordInstance } from '@fluxus/engine';

interface Props {
  record: RecordInstance;
}

export function ActivityHistoryList({ record }: Props) {
  const history = record.activityHistory;

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Activity History
      </h3>
      {history.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>No activities run yet.</p>
      ) : (
        <div>
          {history.map((entry, i) => (
            <ActivityCard key={`${entry.activityId}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
