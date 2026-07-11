// Minimal standard capture form for app-triggered UI activities (Extraction
// stage 2). Deliberately a subset of the workbench's AttributesForm — text and
// date inputs with `required` — because peer hosts can't share React
// components; where the full shared form should live is an open discussion.

import { useState } from 'react';
import type { ActivityDef, RecordInstance } from '@fluxus/engine';

interface Props {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  /** Runs the activity; returns true when done (modal closes), false when cancelled. */
  onSubmit: (captured: Record<string, unknown>) => boolean;
  onClose: () => void;
}

export function ActivityFormModal({ activity, anchorRecord, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    for (const attr of activity.attributes) {
      if (attr.required && !(values[attr.key] ?? '').trim()) {
        setError(`${attr.label} is required`);
        return;
      }
    }
    setError(null);
    try {
      if (onSubmit(values)) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, minWidth: 340, maxWidth: 480, boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{activity.name}</div>
        <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
          {activity.description}
          {anchorRecord ? ` — ${anchorRecord.id}` : ''}
        </div>
        {activity.attributes.map((attr) => (
          <label key={attr.key} style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 3, fontWeight: 600 }}>
              {attr.label}{attr.required ? ' *' : ''}
            </span>
            <input
              type={attr.type === 'date' ? 'date' : 'text'}
              value={values[attr.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [attr.key]: e.target.value }))}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
            />
          </label>
        ))}
        {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onClose} style={{ padding: '6px 14px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleSubmit} style={{ padding: '6px 14px', border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
