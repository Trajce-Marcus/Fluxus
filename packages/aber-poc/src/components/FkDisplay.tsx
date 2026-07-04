import { useAppContext } from '../context/AppContext';

interface Props {
  value: string;
  fkRecordType: string;
  fkDisplayField?: string;
  asLink?: boolean;
  onNavigate?: (typeId: string, recordId: string) => void;
}

export function FkDisplay({ value, fkRecordType, fkDisplayField, asLink = false, onNavigate }: Props) {
  const { resolveDisplayLabel } = useAppContext();

  const displayValue = resolveDisplayLabel(fkRecordType, fkDisplayField, value);

  if (asLink) {
    return (
      <button
        onClick={() => onNavigate?.(fkRecordType, value)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: 13,
          color: '#2563eb',
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
      >
        {displayValue}
      </button>
    );
  }

  return <span>{displayValue}</span>;
}
