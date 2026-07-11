import { useState, useCallback } from 'react';
import { Modal } from './Modal';
import { SchemaNavGraph } from './SchemaNavGraph';
import { useAppContext } from '../context/AppContext';
import { ComponentLabel } from '../context/UatLabels';

interface Props {
  initialTypeId: string;
  onClose: () => void;
}

export function SchemaNavigator({ initialTypeId, onClose }: Props) {
  const { getRecordTypeDef, selectRecordType, recordTypes } = useAppContext();
  const [focalTypeId, setFocalTypeId] = useState(initialTypeId);
  const [history, setHistory] = useState<string[]>([]);

  const focalDef = getRecordTypeDef(focalTypeId);

  const navigateTo = useCallback((typeId: string) => {
    setHistory(prev => [...prev, focalTypeId]);
    setFocalTypeId(typeId);
  }, [focalTypeId]);

  const navigateBack = useCallback(() => {
    if (history.length === 0) return;
    setFocalTypeId(history[history.length - 1]);
    setHistory(prev => prev.slice(0, -1));
  }, [history]);

  const handleJumpToType = useCallback(() => {
    const rt = recordTypes.find(r => r.id === focalTypeId);
    if (rt) { selectRecordType(rt); onClose(); }
  }, [focalTypeId, recordTypes, selectRecordType, onClose]);

  return (
    <Modal title="Schema Navigator" onClose={onClose} width={860} bodyStyle={{ padding: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc',
        position: 'relative',
      }}>
        <ComponentLabel name="SchemaNavigator" />
        <button
          onClick={navigateBack}
          disabled={history.length === 0}
          style={{
            background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
            padding: '2px 9px', fontSize: 13, lineHeight: 1,
            cursor: history.length > 0 ? 'pointer' : 'default',
            color: history.length > 0 ? '#374151' : '#cbd5e1',
          }}
          title="Back"
        >←</button>
        <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
          {focalDef?.name ?? focalTypeId}
        </span>
        <button
          onClick={handleJumpToType}
          style={{
            marginLeft: 'auto', background: 'none', border: '1px solid #e2e8f0',
            borderRadius: 4, padding: '2px 10px', fontSize: 11,
            cursor: 'pointer', color: '#3b82f6', fontWeight: 500,
          }}
        >Go to type →</button>
      </div>

      <SchemaNavGraph focalTypeId={focalTypeId} onSelectType={navigateTo} />
    </Modal>
  );
}
