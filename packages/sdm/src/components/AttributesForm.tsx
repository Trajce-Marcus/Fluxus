import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { RecordPickerDialog } from './RecordPickerDialog';
import type { ActivityDef, RecordInstance } from '../types';

interface Props {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  recordTypeId: string;
  onSubmit: (captured: Record<string, string>) => void;
  onClose: () => void;
}

export function AttributesForm({ activity, anchorRecord, recordTypeId, onSubmit, onClose }: Props) {
  const { resolveDisplayLabel, resolveAttributeDisplayField } = useAppContext();

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      activity.attributes.map(a => {
        const seed = activity.record_map === 'UPDATE' && anchorRecord
          ? String(anchorRecord.customFields[a.key] ?? '')
          : '';
        return [a.key, seed];
      })
    )
  );

  // Display labels for reference fields — separate from the stored IDs
  const [displayLabels, setDisplayLabels] = useState<Record<string, string>>(() => {
    if (activity.record_map !== 'UPDATE' || !anchorRecord) return {};
    return Object.fromEntries(
      activity.attributes
        .filter(a => a.type === 'reference')
        .map(a => {
          const rawId = String(anchorRecord.customFields[a.key] ?? '');
          if (!rawId) return [a.key, ''];
          const fkRecordType = a.type_config?.fk_record_type;
          if (!fkRecordType) return [a.key, rawId];
          const fkDisplayField = resolveAttributeDisplayField(recordTypeId, a.key);
          return [a.key, resolveDisplayLabel(fkRecordType, fkDisplayField, rawId)];
        })
    );
  });

  const [openPickerFor, setOpenPickerFor] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        {activity.attributes.map(attr => (
          <div key={attr.key} style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#374151' }}>
              {attr.label}
            </label>

            {attr.type === 'reference' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1,
                  padding: '6px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  color: values[attr.key] ? '#0f172a' : '#94a3b8',
                  background: '#f9fafb',
                  minHeight: 32,
                }}>
                  {displayLabels[attr.key] || values[attr.key] || 'None selected'}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenPickerFor(attr.key)}
                  style={{
                    padding: '6px 12px',
                    background: '#f1f5f9',
                    color: '#374151',
                    border: '1px solid #e2e8f0',
                    borderRadius: 4,
                    fontSize: 13,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {values[attr.key] ? 'Change…' : 'Select…'}
                </button>
                {values[attr.key] && (
                  <button
                    type="button"
                    onClick={() => {
                      setValues(v => ({ ...v, [attr.key]: '' }));
                      setDisplayLabels(d => ({ ...d, [attr.key]: '' }));
                    }}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                    title="Clear"
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              <input
                type="text"
                value={values[attr.key]}
                onChange={e => setValues(v => ({ ...v, [attr.key]: e.target.value }))}
                placeholder={attr.description}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            type="submit"
            style={{ padding: '7px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Submit
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '7px 16px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </form>

      {openPickerFor && (() => {
        const attr = activity.attributes.find(a => a.key === openPickerFor)!;
        const fkRecordType = attr.type_config?.fk_record_type;
        if (!fkRecordType) return null;
        return (
          <RecordPickerDialog
            targetTypeId={fkRecordType}
            onSelect={(record) => {
              setValues(v => ({ ...v, [openPickerFor]: record.id }));
              const fkDisplayField = resolveAttributeDisplayField(recordTypeId, attr.key);
              const label = resolveDisplayLabel(fkRecordType, fkDisplayField, record.id);
              setDisplayLabels(d => ({ ...d, [openPickerFor]: label }));
              setOpenPickerFor(null);
            }}
            onClose={() => setOpenPickerFor(null)}
          />
        );
      })()}
    </>
  );
}
