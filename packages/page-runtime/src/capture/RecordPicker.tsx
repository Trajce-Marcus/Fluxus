// Picking one record out of many, over a GET (RECORD_PICKER, 2026-09-23).
//
// The workbench picks by browsing the record snapshot; a page holds none, so
// every candidate has to arrive over the wire. The attribute names the GET that
// supplies them — the same `datasource` a `list` attribute has named since
// 2026-08-16, read here by a second kind of attribute — and the search term
// reaches that expression as the `term` root.
//
// **The searching is the GET's, not this component's.** It sends a term and
// draws what comes back: the model author writes what "matches" means, in the
// GET's own script, with `like` and `%`. That is also what lets one component
// serve both the short case and the long one — six work groups come back whole
// and nothing is ever typed, five hundred come back empty with "type to search".
//
// **This does not evaluate the datasource** (§10). The form does, and hands the
// rows down, so this and the workbench's dialog stay two fills of one slot
// rather than structurally different components.
//
// Not built: tree rendering, multi-select, create-from-picker, paging, recently
// picked. The GET caps a long answer; this does not scroll for more.

import { useEffect, useRef, useState } from 'react';
import type { RecordPickerCandidate, RecordPickerProps } from './host';

/** 300 ms after the last keystroke, not on every one (§4). */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Nothing is sent until this many characters are typed. Below it the
 * **empty-term result stands** — not an error, and not a cleared list: what the
 * picker opened with is still the GET's own answer about what to show.
 */
export const SEARCH_MIN_CHARS = 2;

/**
 * What a picker with no display field says, instead of guessing.
 *
 * A `list` attribute falls back to a literal `name` because it has no field
 * declaration anywhere to consult and never will. A reference does — the target
 * field's `fk_display_field` — so guessing here would draw plausible-looking
 * rows over a modelling gap and hide it from the one person who can fix it
 * (the user's call, 2026-09-23). `validateConfig` refuses such a field at save;
 * this is the net under a model that drifted after it.
 */
const NO_DISPLAY_FIELD =
  'No display field for this reference. Set `display_field` on the attribute, '
  + 'or `fk_display_field` on the field it points at.';

/** One candidate resolved to what the list draws. */
interface Candidate {
  value: string;
  label: string;
  secondary: string;
}

/**
 * A row is either a DslRecord (`{id, type, fields}`) or a projected row. The
 * bag is whichever holds the fields, and `id` is read off the record itself
 * when that is what the key field names.
 */
function bagOf(row: RecordPickerCandidate): { bag: Record<string, unknown>; id: unknown } {
  if (row === null || typeof row !== 'object') return { bag: {}, id: undefined };
  const record = row as { id?: unknown; fields?: Record<string, unknown> };
  return { bag: record.fields ?? (row as Record<string, unknown>), id: record.id };
}

/**
 * Resolve the rows, and count the ones that cannot be used.
 *
 * **A row missing the key field is skipped and counted** (§5) — the dropdown
 * turns such a row into a blank entry instead, which is a quieter version of
 * the same bug. Saying how many were skipped is what lets it be fixed.
 */
export function resolveCandidates(
  rows: RecordPickerCandidate[],
  keyField: string,
  displayField: string,
  columns: string[],
): { candidates: Candidate[]; skipped: number } {
  const candidates: Candidate[] = [];
  let skipped = 0;
  for (const row of rows) {
    const { bag, id } = bagOf(row);
    const raw = keyField === 'id' && id !== undefined ? id : bag[keyField];
    const value = raw === null || raw === undefined ? '' : String(raw);
    if (!value) {
      skipped += 1;
      continue;
    }
    const label = bag[displayField];
    candidates.push({
      value,
      label: label === null || label === undefined || label === '' ? value : String(label),
      secondary: columns
        .map((c) => bag[c])
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map(String)
        .join(' · '),
    });
  }
  return { candidates, skipped };
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
};

const panelStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 8, padding: 16, width: 420, maxWidth: '90vw',
  maxHeight: '70vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
};

export function SearchRecordPicker({
  displayField,
  keyField,
  columns,
  rows,
  loading,
  error,
  onSearch,
  onSelect,
  onClose,
}: RecordPickerProps) {
  // The term is this component's own state, debounced, and that state is what
  // triggers the fetch (§4). It deliberately does not ride in the form's
  // values: those are unknown-shaped, so a datasource naming it there would
  // raise no error at save and simply read as blank at runtime — and every
  // other datasource on the form would re-evaluate on every keystroke.
  const [typed, setTyped] = useState('');
  // The empty term is already asked for: the picker **opens** by calling the
  // GET with it (§4), and the form does that on open rather than 300 ms later.
  // What that returns is the GET's decision — all six work groups, the top
  // level of a tree, or nothing with "type to search" under it.
  const sent = useRef<string | null>('');

  // Ask for what has been typed, unless that is already what was asked for —
  // Enter after the debounce has landed must not fire a second identical run.
  const search = (term: string) => {
    const asked = term.length >= SEARCH_MIN_CHARS ? term : '';
    if (sent.current === asked) return;
    sent.current = asked;
    onSearch?.(asked);
  };

  useEffect(() => {
    const id = setTimeout(() => search(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  // Escape closes, as it does on the form's own dialog: abandoning a choice
  // costs nothing, so the cheap way out is the obvious one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const { candidates, skipped } = Array.isArray(rows) && displayField
    ? resolveCandidates(rows, keyField ?? 'id', displayField, columns ?? [])
    : { candidates: [], skipped: 0 };

  // Said in place of the list, the same posture a GET error and a non-list
  // answer already take — there is nothing readable to draw, so nothing is.
  const fault = !displayField ? NO_DISPLAY_FIELD : error;

  const short = typed.trim().length > 0 && typed.trim().length < SEARCH_MIN_CHARS;

  return (
    <div role="dialog" aria-modal="true" aria-label="Select a record" style={overlayStyle}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <input
            type="text"
            autoFocus
            value={typed}
            placeholder="Search…"
            aria-label="Search"
            onChange={(e) => setTyped(e.target.value)}
            // Enter searches immediately rather than waiting out the debounce.
            // An explicit "go" button was considered and rejected: it costs an
            // extra action on every pick, and a manager filing a shift report
            // picks three or four times a shift.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              search(typed.trim());
            }}
            style={{
              flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4,
              fontSize: 14, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* A GET error replaces the list, with the message — the same posture
            the dropdown takes, since the same round trip is underneath. */}
        {fault ? (
          <div style={{ fontSize: 12, color: '#b91c1c', padding: '8px 0' }}>
            {displayField ? `Search failed: ${fault}` : fault}
          </div>
        ) : loading ? (
          <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>Searching…</div>
        ) : candidates.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>
            {short ? 'Type to search' : typed.trim() ? 'Nothing matches' : 'Type to search'}
          </div>
        ) : (
          <div style={{ overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 4 }}>
            {candidates.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => onSelect(c.value, c.label)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none',
                  border: 'none', borderBottom: '1px solid #f1f5f9', padding: '7px 10px',
                  cursor: 'pointer', font: 'inherit', fontSize: 13, color: '#0f172a',
                }}
              >
                {c.label}
                {c.secondary && (
                  <span style={{ display: 'block', fontSize: 11, color: '#64748b', marginTop: 1 }}>{c.secondary}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Skipped rows are said out loud rather than shown as blanks. */}
        {skipped > 0 && (
          <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>
            {skipped} row{skipped === 1 ? '' : 's'} skipped — no value in the key field
          </div>
        )}
      </div>
    </div>
  );
}
