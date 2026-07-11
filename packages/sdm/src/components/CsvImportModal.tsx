import { useState, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import type { CustomFieldDef } from '@fluxus/engine';

interface Props {
  typeName: string;
  customFields: CustomFieldDef[];
  defaultTab?: 'file' | 'paste';
  onImport: (rows: Record<string, string>[]) => void;
  onClose: () => void;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// Normalize a string for fuzzy key matching: lowercase, strip separators.
// "assetNo" → "assetno", "asset_no" → "assetno", "Asset No" → "assetno"
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_\-]/g, '');
}

export function CsvImportModal({ typeName, customFields, defaultTab = 'file', onImport, onClose }: Props) {
  const [tab, setTab] = useState<'file' | 'paste'>(defaultTab);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [parsedFrom, setParsedFrom] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Map from normalized field key → actual field key
  const normalizedFieldMap = new Map(customFields.map(cf => [normalize(cf.key), cf.key]));

  // For a CSV header, return the matched field key or null
  const resolveFieldKey = (header: string): string | null =>
    normalizedFieldMap.get(normalize(header)) ?? null;

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a .csv file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length < 2) {
        setError('CSV must have a header row and at least one data row.');
        return;
      }
      setError(null);
      setParsed({ headers: rows[0], rows: rows.slice(1) });
      setParsedFrom('file');
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePastePreview = () => {
    const text = pasteText.trim();
    if (!text) { setError('Paste some CSV text first.'); return; }
    const rows = parseCSV(text);
    if (rows.length < 2) { setError('CSV must have a header row and at least one data row.'); return; }
    setError(null);
    setParsed({ headers: rows[0], rows: rows.slice(1) });
    setParsedFrom('paste');
  };

  const matchedHeaders = parsed ? parsed.headers.filter(h => resolveFieldKey(h) !== null) : [];
  const unmatchedHeaders = parsed ? parsed.headers.filter(h => resolveFieldKey(h) === null) : [];

  const handleImport = () => {
    if (!parsed) return;
    const rows = parsed.rows.map(row => {
      const obj: Record<string, string> = {};
      parsed.headers.forEach((h, i) => {
        const fieldKey = resolveFieldKey(h);
        if (fieldKey) obj[fieldKey] = row[i] ?? '';
      });
      return obj;
    });
    onImport(rows);
  };

  return (
    <Modal title={`Import CSV — ${typeName}`} onClose={onClose}>
      {!parsed ? (
        <div>
          {/* Tab switcher */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
            {(['file', 'paste'] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); }}
                style={{
                  padding: '7px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
                  color: tab === t ? '#2563eb' : '#64748b',
                  fontSize: 13,
                  fontWeight: tab === t ? 600 : 400,
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                {t === 'file' ? 'Upload file' : 'Paste text'}
              </button>
            ))}
          </div>

          {tab === 'file' ? (
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? '#2563eb' : '#cbd5e1'}`,
                borderRadius: 8,
                padding: '40px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: isDragging ? '#eff6ff' : '#f8fafc',
                transition: 'border-color 0.15s, background 0.15s',
                userSelect: 'none',
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="12" x2="12" y2="18"/>
                <polyline points="9 15 12 18 15 15"/>
              </svg>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4, fontSize: 14 }}>
                Drop a CSV file here, or click to browse
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                First row must contain field names as column headers
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          ) : (
            <div>
              <textarea
                value={pasteText}
                onChange={e => { setPasteText(e.target.value); setError(null); }}
                placeholder={`Paste CSV content here…\n\nasset_no,description\nSIGN-001,Example sign`}
                spellCheck={false}
                style={{
                  width: '100%',
                  height: 200,
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'ui-monospace, monospace',
                  color: '#0f172a',
                  background: '#f8fafc',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  onClick={handlePastePreview}
                  style={{
                    padding: '6px 16px',
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Preview
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          {unmatchedHeaders.length > 0 && (
            <div style={{
              background: '#fef9c3',
              border: '1px solid #fde047',
              borderRadius: 4,
              padding: '7px 12px',
              fontSize: 12,
              color: '#713f12',
              marginBottom: 10,
            }}>
              Columns skipped — no matching field:{' '}
              {unmatchedHeaders.map(h => (
                <code key={h} style={{ marginLeft: 4, background: '#fef08a', padding: '1px 4px', borderRadius: 2 }}>{h}</code>
              ))}
            </div>
          )}
          {matchedHeaders.length === 0 && (
            <div style={{
              background: '#fee2e2',
              border: '1px solid #fca5a5',
              borderRadius: 4,
              padding: '7px 12px',
              fontSize: 12,
              color: '#991b1b',
              marginBottom: 10,
            }}>
              No CSV columns match any field keys. Expected:{' '}
              {customFields.map(cf => (
                <code key={cf.key} style={{ marginLeft: 4, background: '#fecaca', padding: '1px 4px', borderRadius: 2 }}>{cf.key}</code>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
            <strong>{parsed.rows.length}</strong> row{parsed.rows.length !== 1 ? 's' : ''} detected
            {parsed.rows.length > 5 && ' — previewing first 5'}
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 16, border: '1px solid #e2e8f0', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  {parsed.headers.map((h, i) => {
                    const fieldKey = resolveFieldKey(h);
                    const renamed = fieldKey && fieldKey !== h;
                    return (
                      <th key={i} style={{
                        padding: '6px 10px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: fieldKey ? '#374151' : '#94a3b8',
                        borderBottom: '1px solid #e2e8f0',
                        whiteSpace: 'nowrap',
                      }}>
                        {h}
                        {renamed && (
                          <span style={{ marginLeft: 4, fontSize: 10, color: '#2563eb', fontWeight: 400 }}>→ {fieldKey}</span>
                        )}
                        {!fieldKey && (
                          <span style={{ marginLeft: 4, fontSize: 10, color: '#cbd5e1', fontWeight: 400 }}>skipped</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                    {parsed.headers.map((h, ci) => (
                      <td key={ci} style={{
                        padding: '6px 10px',
                        borderBottom: '1px solid #f1f5f9',
                        color: resolveFieldKey(h) ? '#0f172a' : '#94a3b8',
                      }}>
                        {row[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => { setParsed(null); setError(null); }}
              style={{
                padding: '6px 14px',
                background: '#f1f5f9',
                color: '#374151',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {parsedFrom === 'paste' ? 'Edit text' : 'Choose another file'}
            </button>
            <button
              onClick={handleImport}
              disabled={matchedHeaders.length === 0}
              style={{
                padding: '6px 16px',
                background: matchedHeaders.length === 0 ? '#cbd5e1' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 600,
                cursor: matchedHeaders.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Import {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, color: '#dc2626', fontSize: 12 }}>{error}</div>
      )}
    </Modal>
  );
}
