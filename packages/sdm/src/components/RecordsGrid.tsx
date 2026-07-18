import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { ComponentLabel } from '../context/UatLabels';
import { AttributesForm } from './AttributesForm';
import { Modal } from './Modal';
import { FkDisplay } from './FkDisplay';
import { CsvImportModal } from './CsvImportModal';
import { PhotoCountCell, isDescriptorValue } from './attributeWidgets';
import { exportToCSV, exportToJSON } from '../utils/export';
import type { RecordInstance } from '@fluxus/engine';

interface Props {
  typeId?: string;
  onRecordSelected?: (record: RecordInstance) => void;
}

export function RecordsGrid({ typeId, onRecordSelected }: Props = {}) {
  const {
    selectedRecordType,
    selectedRecord,
    selectRecord,
    selectRecordById,
    getRecordTypeData,
    getRecordTypeDef,
    runActivity,
    isActivityAvailable,
    uploads,
  } = useAppContext();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportCSV, setShowImportCSV] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!showExport) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExport(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExport]);

  // Close new menu on outside click
  useEffect(() => {
    if (!showNewMenu) return;
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNewMenu]);

  // Keep the selected row visible — e.g. right after CREATE selects the new record.
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedRecord?.id]);

  const pickerMode = !!onRecordSelected;
  const typeDef = typeId ? getRecordTypeDef(typeId) : selectedRecordType;

  if (!typeDef) {
    return (
      <div className={pickerMode ? undefined : 'panel-body'} style={{ color: '#94a3b8', padding: 8 }}>
        Select a record type from the panel to view records.
      </div>
    );
  }

  const allRecords = getRecordTypeData(typeDef.id);
  const customFields = typeDef.custom_fields;
  // CREATE has no anchor: its availability condition sees context.record = null
  const foundCreate = !pickerMode
    ? typeDef.workflow?.activities.find(a => a.record_map === 'CREATE')
    : undefined;
  const createActivity = foundCreate && isActivityAvailable(foundCreate, null) ? foundCreate : undefined;

  // Filter
  const filtered = searchTerm
    ? allRecords.filter(r =>
        customFields.some(cf =>
          String(r.customFields[cf.key] ?? '').toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    : allRecords;

  // Sort
  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = String(a.customFields[sortKey] ?? '');
        const bv = String(b.customFields[sortKey] ?? '');
        const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleRowClick = (record: RecordInstance) => {
    onRecordSelected ? onRecordSelected(record) : selectRecord(record);
  };

  const sortIcon = (key: string) => {
    if (sortKey !== key) return <span style={{ color: '#cbd5e1', marginLeft: 4 }}>↕</span>;
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const countLabel = searchTerm
    ? `${filtered.length} of ${allRecords.length}`
    : `${allRecords.length}`;

  const headerRow = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: pickerMode ? 12 : 0, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
            {typeDef.name}
          </h2>
          {typeDef.description && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{typeDef.description}</div>
          )}
        </div>

        <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {countLabel} record{allRecords.length !== 1 ? 's' : ''}
        </span>

        <input
          type="text"
          placeholder="Search…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{
            padding: '5px 10px',
            border: '1px solid #e2e8f0',
            borderRadius: 4,
            fontSize: 13,
            outline: 'none',
            width: 160,
          }}
        />

        {!pickerMode && (
          <div ref={exportRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowExport(v => !v)}
              title="Export"
              style={{
                padding: '5px 8px',
                background: '#f1f5f9',
                color: '#374151',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7.5 2v8M4.5 7l3 3 3-3"/>
                <path d="M2 12.5h11"/>
              </svg>
            </button>
            {showExport && (
              <div style={{
                position: 'absolute',
                top: '110%',
                right: 0,
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                zIndex: 100,
                minWidth: 120,
              }}>
                {[
                  { label: 'Export CSV', action: () => { exportToCSV(sorted, customFields, typeDef.name); setShowExport(false); } },
                  { label: 'Export JSON', action: () => { exportToJSON(sorted, customFields, typeDef.name); setShowExport(false); } },
                ].map(({ label, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 14px',
                      background: 'none',
                      border: 'none',
                      textAlign: 'left',
                      fontSize: 13,
                      color: '#374151',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {createActivity && (
          <div ref={newMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowNewMenu(v => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              + New
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3.5l3.5 3.5 3.5-3.5"/>
              </svg>
            </button>
            {showNewMenu && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                zIndex: 100,
                minWidth: 160,
              }}>
                {[
                  {
                    label: 'Insert row',
                    action: () => { setShowCreateForm(true); setShowNewMenu(false); },
                  },
                  {
                    label: 'Import from CSV',
                    action: () => { setShowImportCSV(true); setShowNewMenu(false); },
                  },
                ].map(({ label, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 14px',
                      background: 'none',
                      border: 'none',
                      textAlign: 'left',
                      fontSize: 13,
                      color: '#374151',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
  );

  const body = (
    <>
      {showCreateForm && createActivity && (
        <Modal title={createActivity.name} onClose={() => setShowCreateForm(false)}>
          <AttributesForm
            activity={createActivity}
            anchorRecord={null}
            recordTypeId={typeDef.id}
            onSubmit={async (captured, options) => {
              const result = await runActivity(createActivity, captured, null, options);
              if (result.status === 'done') {
                setShowCreateForm(false);
                if (!pickerMode && result.recordId) {
                  // Show the new record: select it (detail view follows) and
                  // drop any search filter that would hide its row.
                  setSearchTerm('');
                  selectRecordById(result.recordId);
                }
              }
              return result;
            }}
            onClose={() => setShowCreateForm(false)}
          />
        </Modal>
      )}

      {showImportCSV && createActivity && (
        <CsvImportModal
          typeName={typeDef.name}
          customFields={customFields}
          onImport={async (rows) => {
            // Bulk import acknowledges gate warnings up front (there's no one to
            // confirm per row); fail() still rejects the row. Sequential on
            // purpose: each run round-trips the server and refreshes the snapshot.
            for (const row of rows) {
              await runActivity(createActivity, row, null, { acknowledgedWarnings: true });
            }
            setShowImportCSV(false);
          }}
          onClose={() => setShowImportCSV(false)}
        />
      )}

      {sorted.length === 0 ? (
        <p style={{ color: '#94a3b8', margin: 0, paddingTop: pickerMode ? 0 : 16, fontSize: 13 }}>
          {searchTerm ? 'No records match your search.' : `No records yet.${createActivity ? ' Use the button above to create one.' : ''}`}
        </p>
      ) : (
        <div style={pickerMode ? { overflowX: 'auto' } : undefined}>
          {/* borderCollapse must stay 'separate': collapsed borders break sticky headers */}
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {customFields.map(cf => (
                  <th
                    key={cf.key}
                    onClick={() => handleSort(cf.key)}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: '#374151',
                      background: '#f1f5f9',
                      borderBottom: '1px solid #e2e8f0',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      userSelect: 'none',
                      // Pin column headers to the top of the scrolling panel body
                      position: pickerMode ? undefined : 'sticky',
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    {cf.key}{sortIcon(cf.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((record, i) => {
                const isSelected = !pickerMode && selectedRecord?.id === record.id;
                return (
                  <tr
                    key={record.id}
                    ref={isSelected ? selectedRowRef : undefined}
                    onClick={() => handleRowClick(record)}
                    style={{
                      background: isSelected ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#fafafa',
                      cursor: 'pointer',
                      outline: isSelected ? '2px solid #bfdbfe' : 'none',
                      outlineOffset: -2,
                      // Keep scrollIntoView from tucking the row under the sticky header
                      scrollMarginTop: 36,
                    }}
                  >
                    {customFields.map(cf => {
                      const raw = record.customFields[cf.key];
                      const cellValue = String(raw ?? '');
                      const isFk = !pickerMode && cf.type === 'fk_ref' && cellValue !== '';
                      return (
                        <td
                          key={cf.key}
                          style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' }}
                        >
                          {isFk ? (
                            <FkDisplay
                              value={cellValue}
                              fkRecordType={cf.fk_record_type!}
                              fkDisplayField={cf.fk_display_field}
                            />
                          ) : isDescriptorValue(raw) ? (
                            <PhotoCountCell value={raw} uploads={uploads} />
                          ) : (
                            cellValue
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  if (pickerMode) {
    return (
      <div>
        {headerRow}
        {body}
      </div>
    );
  }

  return (
    <>
      <div className="panel-header">
        <ComponentLabel name="RecordsGrid" />
        {headerRow}
      </div>
      {/* Flush top so the sticky column headers pin directly under the toolbar */}
      <div className="panel-body" style={{ paddingTop: 0 }}>{body}</div>
    </>
  );
}
