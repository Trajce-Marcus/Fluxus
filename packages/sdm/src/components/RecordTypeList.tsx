import { useAppContext } from '../context/AppContext';
import { ComponentLabel } from '../context/UatLabels';

export function RecordTypeList() {
  const { recordTypes, selectedRecordType, selectRecordType } = useAppContext();

  return (
    <div style={{ position: 'relative' }}>
      <ComponentLabel name="RecordTypeList" />
      <div style={{
        padding: '12px 16px',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: '#64748b',
        borderBottom: '1px solid #e2e8f0',
      }}>
        Record Types
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {recordTypes.map(rt => (
          <li
            key={rt.id}
            onClick={() => selectRecordType(rt)}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              background: selectedRecordType?.id === rt.id ? '#eff6ff' : 'transparent',
              color: selectedRecordType?.id === rt.id ? '#1d4ed8' : '#0f172a',
              fontWeight: selectedRecordType?.id === rt.id ? 600 : 400,
              borderLeft: selectedRecordType?.id === rt.id ? '3px solid #2563eb' : '3px solid transparent',
            }}
          >
            {rt.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
