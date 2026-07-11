import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { ComponentLabel } from '../context/UatLabels';
import { RecordDetails } from './RecordDetails';
import { RelatedRecords } from './RelatedRecords';
import { ActivityHistoryList } from './ActivityHistoryList';
import { AvailableActivities } from './AvailableActivities';
import { SchemaNavigator } from './SchemaNavigator';
import type { RecordInstance, RecordTypeDef, WorkflowDef } from '@fluxus/engine';

type NavEntry = { typeId: string; recordId: string };

const schemaBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  padding: '3px 10px',
  fontSize: 11,
  cursor: 'pointer',
  color: '#3b82f6',
  fontWeight: 500,
  letterSpacing: '0.02em',
};

const navBtnStyle = (enabled: boolean): React.CSSProperties => ({
  background: 'none',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  padding: '3px 10px',
  fontSize: 14,
  cursor: enabled ? 'pointer' : 'default',
  color: enabled ? '#374151' : '#cbd5e1',
  lineHeight: 1,
});

export function RecordView() {
  const { selectedRecord, selectedRecordType, getRecordAndType } = useAppContext();

  const [viewedTypeId, setViewedTypeId] = useState<string | null>(null);
  const [viewedRecordId, setViewedRecordId] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<NavEntry[]>([]);
  const [forwardStack, setForwardStack] = useState<NavEntry[]>([]);
  const [showSchemaNav, setShowSchemaNav] = useState(false);

  const viewedTypeIdRef = useRef(viewedTypeId);
  const viewedRecordIdRef = useRef(viewedRecordId);
  viewedTypeIdRef.current = viewedTypeId;
  viewedRecordIdRef.current = viewedRecordId;

  // When the selected record changes, sync viewed state from the record's own typeRef
  useEffect(() => {
    setViewedTypeId(selectedRecord?.typeRef ?? null);
    setViewedRecordId(selectedRecord?.id ?? null);
    setBackStack([]);
    setForwardStack([]);
  }, [selectedRecord?.id]);

  const navigateTo = useCallback((typeId: string, recordId: string) => {
    const curType = viewedTypeIdRef.current;
    const curRecord = viewedRecordIdRef.current;
    if (curType && curRecord) {
      setBackStack(prev => [...prev, { typeId: curType, recordId: curRecord }]);
    }
    setForwardStack([]);
    setViewedTypeId(typeId);
    setViewedRecordId(recordId);
  }, []);

  const navigateBack = useCallback(() => {
    setBackStack(prev => {
      if (prev.length === 0) return prev;
      const entry = prev[prev.length - 1];
      const curType = viewedTypeIdRef.current;
      const curRecord = viewedRecordIdRef.current;
      if (curType && curRecord) {
        setForwardStack(f => [...f, { typeId: curType, recordId: curRecord }]);
      }
      setViewedTypeId(entry.typeId);
      setViewedRecordId(entry.recordId);
      return prev.slice(0, -1);
    });
  }, []);

  const navigateForward = useCallback(() => {
    setForwardStack(prev => {
      if (prev.length === 0) return prev;
      const entry = prev[prev.length - 1];
      const curType = viewedTypeIdRef.current;
      const curRecord = viewedRecordIdRef.current;
      if (curType && curRecord) {
        setBackStack(b => [...b, { typeId: curType, recordId: curRecord }]);
      }
      setViewedTypeId(entry.typeId);
      setViewedRecordId(entry.recordId);
      return prev.slice(0, -1);
    });
  }, []);

  if (!selectedRecord) {
    return (
      <div className="panel-body" style={{ position: 'relative' }}>
        <ComponentLabel name="RecordView" />
        {selectedRecordType && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={() => setShowSchemaNav(true)} style={schemaBtnStyle} title="Schema Navigator">
              Schema
            </button>
          </div>
        )}
        <div style={{ color: '#94a3b8', padding: 8, fontSize: 13 }}>
          {selectedRecordType
            ? 'Select a record from the grid to view details.'
            : 'Select a record type, then a record.'}
        </div>
        {showSchemaNav && selectedRecordType && (
          <SchemaNavigator
            initialTypeId={selectedRecordType.id}
            onClose={() => setShowSchemaNav(false)}
          />
        )}
      </div>
    );
  }

  const viewedData = viewedTypeId && viewedRecordId
    ? getRecordAndType(viewedTypeId, viewedRecordId)
    : null;

  // Fall back to selected record if FK target not found
  const viewedRecord: RecordInstance = viewedData?.record ?? selectedRecord;
  const viewedTypeDef: RecordTypeDef & { workflow: WorkflowDef } =
    viewedData?.typeDef ?? selectedRecordType!;

  const canGoBack = backStack.length > 0;
  const canGoForward = forwardStack.length > 0;

  return (
    <>
      <div className="panel-header">
        <ComponentLabel name="RecordView" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <button onClick={navigateBack} disabled={!canGoBack} style={navBtnStyle(canGoBack)} title="Back">←</button>
          <button onClick={navigateForward} disabled={!canGoForward} style={navBtnStyle(canGoForward)} title="Forward">→</button>
          <button onClick={() => setShowSchemaNav(true)} style={{ ...schemaBtnStyle, marginLeft: 'auto' }} title="Schema Navigator">
            Schema
          </button>
        </div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
          {viewedTypeDef.name.endsWith('s') ? viewedTypeDef.name.slice(0, -1) : viewedTypeDef.name}
        </h2>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          id: {viewedRecord.id}
        </div>
      </div>

      <div className="panel-body">
        <AvailableActivities record={viewedRecord} workflow={viewedTypeDef.workflow} />
        <div style={{ borderTop: '1px solid #f1f5f9', margin: '16px 0' }} />
        <RecordDetails record={viewedRecord} typeDef={viewedTypeDef} navigateTo={navigateTo} />
        <RelatedRecords typeId={viewedTypeDef.id} recordId={viewedRecord.id} navigateTo={navigateTo} />
        <div style={{ borderTop: '1px solid #f1f5f9', margin: '16px 0' }} />
        <ActivityHistoryList record={viewedRecord} />

        {showSchemaNav && (
          <SchemaNavigator
            initialTypeId={viewedTypeDef.id}
            onClose={() => setShowSchemaNav(false)}
          />
        )}
      </div>
    </>
  );
}
