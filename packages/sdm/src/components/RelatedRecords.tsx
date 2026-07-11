import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import type { RecordInstance, RecordTypeDef, WorkflowDef } from '@fluxus/engine';

interface Props {
  typeId: string;
  recordId: string;
  navigateTo: (typeId: string, recordId: string) => void;
}

export function RelatedRecords({ typeId, recordId, navigateTo }: Props) {
  const { getReverseRefs, getRecordsByField, getRecordTypeDef } = useAppContext();
  const [activeTab, setActiveTab] = useState(0);

  const groups = getReverseRefs(typeId)
    .map(({ sourceTypeId, fieldKey }) => {
      const sourceDef = getRecordTypeDef(sourceTypeId);
      if (!sourceDef) return null;
      const records = getRecordsByField(sourceTypeId, fieldKey, recordId);
      return { sourceTypeId, fieldKey, sourceDef, records };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null && g.records.length > 0);

  if (groups.length === 0) return null;

  const safeTab = Math.min(activeTab, groups.length - 1);
  const group = groups[safeTab];

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Related Records
      </h3>

      {groups.length > 1 ? (
        <div style={{ display: 'flex', gap: 2, marginBottom: 12, borderBottom: '1px solid #e2e8f0' }}>
          {groups.map((g, i) => (
            <button
              key={`${g.sourceTypeId}:${g.fieldKey}`}
              onClick={() => setActiveTab(i)}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: safeTab === i ? 600 : 400,
                color: safeTab === i ? '#2563eb' : '#64748b',
                background: 'none',
                border: 'none',
                borderBottom: safeTab === i ? '2px solid #2563eb' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: -1,
              }}
            >
              {g.sourceDef.name}
              <span style={{ marginLeft: 6, fontSize: 11, color: safeTab === i ? '#2563eb' : '#94a3b8' }}>
                {g.records.length}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          {group.sourceDef.name}
          <span style={{ marginLeft: 6, color: '#94a3b8' }}>{group.records.length}</span>
        </div>
      )}

      <RelatedRecordsTable
        records={group.records}
        typeDef={group.sourceDef}
        sourceTypeId={group.sourceTypeId}
        navigateTo={navigateTo}
      />
    </div>
  );
}

interface TableProps {
  records: RecordInstance[];
  typeDef: RecordTypeDef & { workflow: WorkflowDef };
  sourceTypeId: string;
  navigateTo: (typeId: string, recordId: string) => void;
}

function RelatedRecordsTable({ records, typeDef, sourceTypeId, navigateTo }: TableProps) {
  const { resolveDisplayLabel } = useAppContext();
  const customFields = typeDef.custom_fields;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 320 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            {customFields.map(cf => (
              <th
                key={cf.key}
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: '#374151',
                  borderBottom: '1px solid #e2e8f0',
                  whiteSpace: 'nowrap',
                }}
              >
                {cf.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record, i) => (
            <tr
              key={record.id}
              onClick={() => navigateTo(sourceTypeId, record.id)}
              style={{ background: i % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa'; }}
            >
              {customFields.map(cf => {
                const raw = String(record.customFields[cf.key] ?? '');
                const display = cf.type === 'fk_ref' && raw
                  ? resolveDisplayLabel(cf.fk_record_type!, cf.fk_display_field, raw)
                  : raw;
                return (
                  <td
                    key={cf.key}
                    style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' }}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
