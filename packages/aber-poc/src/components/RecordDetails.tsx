import { Fragment } from 'react';
import { FkDisplay } from './FkDisplay';
import type { RecordInstance, RecordTypeDef, WorkflowDef } from '../types';

interface Props {
  record: RecordInstance;
  typeDef: RecordTypeDef & { workflow: WorkflowDef };
  navigateTo: (typeId: string, recordId: string) => void;
}

export function RecordDetails({ record, typeDef, navigateTo }: Props) {
  const fields = typeDef.custom_fields;

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Record Details
      </h3>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
        {fields.map(cf => {
          const rawValue = String(record.customFields[cf.key] ?? '');
          const isLink = !!cf.fk_record_type && rawValue !== '';
          return (
            <Fragment key={cf.key}>
              <dt style={{ fontSize: 13, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>
                {cf.key}
              </dt>
              <dd style={{ margin: 0, fontSize: 13, color: '#0f172a' }}>
                {isLink ? (
                  <FkDisplay
                    value={rawValue}
                    fkRecordType={cf.fk_record_type!}
                    fkDisplayField={cf.fk_display_field}
                    asLink
                    onNavigate={navigateTo}
                  />
                ) : (
                  rawValue
                )}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </div>
  );
}
