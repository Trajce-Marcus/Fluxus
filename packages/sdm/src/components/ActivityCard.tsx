import { Fragment } from 'react';
import { compositeSubs } from '@fluxus/engine';
import type { ActivityDef, ActivityHistoryEntry } from '@fluxus/engine';
import { useAppContext } from '../context/AppContext';
import { FileChips, PhotoThumbs, isDescriptorValue } from './attributeWidgets';
import type { UploadService } from '@fluxus/client';

interface Props {
  entry: ActivityHistoryEntry;
}

/** Render one entry value: descriptor bags as thumbs/chips, else plain text. */
function ValueCell({ value, uploads }: { value: unknown; uploads: UploadService }) {
  if (isDescriptorValue(value)) {
    const first = (Array.isArray(value) ? value[0] : value) as Record<string, unknown>;
    return typeof first.thumb_key === 'string' || String(first.mime ?? '').startsWith('image/')
      ? <PhotoThumbs value={value} uploads={uploads} />
      : <FileChips value={value} uploads={uploads} />;
  }
  return <>{String(value)}</>;
}

/**
 * Display rows for an entry's captured attributes, in the activity
 * DEFINITION order (= the order the form captured them): the stored entry is
 * jsonb, which does not preserve key order, so the definition is the ordering
 * truth. Composite values flatten to one row per cell under the dotted
 * `attr.sub` key, cells in sub-attribute order. Keys the definition doesn't
 * know (system_log, hook-written extras, older-config entries) follow in
 * entry order.
 */
function displayRows(entry: ActivityHistoryEntry, activity: ActivityDef | undefined): [string, unknown][] {
  const attrs = entry.capturedAttributes;
  const waived = entry.waived ?? {};
  const rows: [string, unknown][] = [];
  const pushFlat = (key: string, value: unknown) => {
    if (key in waived) return; // shown in the waived block with the reason
    // File/photo descriptors (and arrays of them) stay whole — one row the
    // display renders as thumbs/chips, not flattened to per-field text.
    if (!isDescriptorValue(value) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        pushFlat(`${key}.${subKey}`, subValue);
      }
      return;
    }
    rows.push([key, value]);
  };

  const seen = new Set<string>();
  for (const attr of activity?.attributes ?? []) {
    if (attr.type === 'section') continue;
    seen.add(attr.key);
    if (!(attr.key in attrs)) continue;
    const subs = compositeSubs(attr);
    const value = attrs[attr.key];
    if (subs && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const cells = value as Record<string, unknown>;
      const cellSeen = new Set<string>();
      for (const sub of subs) {
        if (sub.key in cells) {
          pushFlat(`${attr.key}.${sub.key}`, cells[sub.key]);
          cellSeen.add(sub.key);
        }
      }
      for (const [cellKey, cellValue] of Object.entries(cells)) {
        if (!cellSeen.has(cellKey)) pushFlat(`${attr.key}.${cellKey}`, cellValue);
      }
    } else {
      pushFlat(attr.key, value);
    }
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (!seen.has(key)) pushFlat(key, value);
  }
  return rows;
}

export function ActivityCard({ entry }: Props) {
  const { selectedRecordType, uploads } = useAppContext();
  const activity = selectedRecordType?.workflow.activities.find(a => a.id === entry.activityId);
  const ts = new Date(entry.timestamp).toLocaleString();
  const waived = entry.waived ?? {};
  const attrs = displayRows(entry, activity);

  return (
    <div style={{
      padding: '12px 14px',
      border: '1px solid #e2e8f0',
      borderRadius: 6,
      background: '#fff',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
          {entry.activityName}
        </span>
        <span style={{ fontSize: 11, color: '#94a3b8' }} title={entry.author}>
          {/* author = user id (RBAC_COMPACT); display-name resolution arrives
              with a user directory — until then the id, shortened. */}
          {entry.author ? `${entry.author.slice(0, 8)} · ` : ''}{ts}
        </span>
      </div>
      {attrs.length > 0 ? (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px' }}>
          {attrs.map(([k, v]) => (
            <Fragment key={k}>
              <dt style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{k}</dt>
              <dd style={{ margin: 0, fontSize: 12, color: '#0f172a' }}><ValueCell value={v} uploads={uploads} /></dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>No attributes captured.</span>
      )}
      {Object.keys(waived).length > 0 && (
        // Values declared unavailable at capture time, with the user's reason
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e2e8f0' }}>
          {Object.entries(waived).map(([k, reason]) => (
            <div key={k} style={{ fontSize: 12, color: '#64748b' }}>
              ⊘ <span style={{ fontWeight: 500 }}>{k}</span> — can't provide: {reason}
            </div>
          ))}
        </div>
      )}
      {entry.warnings && entry.warnings.length > 0 && (
        // Gate warnings the user acknowledged — part of this submission's audit
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fde68a' }}>
          {entry.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#92400e' }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
