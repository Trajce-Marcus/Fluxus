import { Fragment } from 'react';
import { FkDisplay } from './FkDisplay';
import { ComponentLabel } from '../context/UatLabels';
import { FileChips, PhotoThumbs, isDescriptorValue } from './attributeWidgets';
import { useAppContext } from '../context/AppContext';
import type { RecordInstance, RecordTypeDef, WorkflowDef } from '@fluxus/engine';

interface Props {
  record: RecordInstance;
  typeDef: RecordTypeDef & { workflow: WorkflowDef };
  navigateTo: (typeId: string, recordId: string) => void;
}

/** A descriptor bag stored in a custom field: photos → thumbs, files → chips. */
function isImageDescriptor(value: unknown): boolean {
  const first = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | undefined;
  return !!first && (typeof first.thumb_key === 'string' || String(first.mime ?? '').startsWith('image/'));
}

export function RecordDetails({ record, typeDef, navigateTo }: Props) {
  const { uploads } = useAppContext();
  const fields = typeDef.custom_fields;

  return (
    <div style={{ marginBottom: 20, position: 'relative' }}>
      <ComponentLabel name="RecordDetails" />
      <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Record Details
      </h3>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
        {fields.map(cf => {
          const raw = record.customFields[cf.key];
          const rawValue = String(raw ?? '');
          const isLink = cf.type === 'fk_ref' && rawValue !== '';
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
                ) : isDescriptorValue(raw) ? (
                  isImageDescriptor(raw) ? <PhotoThumbs value={raw} uploads={uploads} /> : <FileChips value={raw} uploads={uploads} />
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
