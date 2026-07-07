import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { RecordPickerDialog } from './RecordPickerDialog';
import { coerceCaptured, coerceValue } from '../dsl/bridge';
import type { ActivityDef, AttributeDef, RecordInstance } from '../types';

interface Props {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  recordTypeId: string;
  onSubmit: (captured: Record<string, string>) => void;
  onClose: () => void;
}

export function AttributesForm({ activity, anchorRecord, recordTypeId, onSubmit, onClose }: Props) {
  const { resolveDisplayLabel, resolveAttributeDisplayField, dslEvaluate } = useAppContext();

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      activity.attributes.map(a => {
        const seed = activity.record_map === 'UPDATE' && anchorRecord
          ? String(anchorRecord.customFields[a.key] ?? '')
          : '';
        return [a.key, seed];
      })
    )
  );

  // Display labels for reference fields — separate from the stored IDs
  const [displayLabels, setDisplayLabels] = useState<Record<string, string>>(() => {
    if (activity.record_map !== 'UPDATE' || !anchorRecord) return {};
    return Object.fromEntries(
      activity.attributes
        .filter(a => a.type === 'reference')
        .map(a => {
          const rawId = String(anchorRecord.customFields[a.key] ?? '');
          if (!rawId) return [a.key, ''];
          const fkRecordType = a.type_config?.fk_record_type;
          if (!fkRecordType) return [a.key, rawId];
          const fkDisplayField = resolveAttributeDisplayField(recordTypeId, a.key);
          return [a.key, resolveDisplayLabel(fkRecordType, fkDisplayField, rawId)];
        })
    );
  });

  const [openPickerFor, setOpenPickerFor] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // show_condition (FluxScript) decides which attributes are presented.
  // Evaluation errors leave the attribute visible — a broken condition should
  // never make an input unreachable.
  // Captured strings coerced to typed script values (dates, numbers) per attribute type
  const typedValues = coerceCaptured(activity.attributes, values);

  const isVisible = (attr: AttributeDef): boolean => {
    if (!attr.show_condition) return true;
    try {
      return dslEvaluate(attr.show_condition, {
        attributes: typedValues,
        anchorRecord,
        activity: { id: activity.id, name: activity.name },
      }) === true;
    } catch (err) {
      console.warn(`show_condition failed for '${attr.key}':`, err);
      return true;
    }
  };

  const visibleAttributes = activity.attributes.filter(isVisible);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Hidden attributes are not part of the submission
    const visibleKeys = new Set(visibleAttributes.map(a => a.key));
    // Required attributes must be captured (hidden ones are exempt by construction)
    const missing = visibleAttributes.filter(a => a.required && !String(values[a.key] ?? '').trim());
    if (missing.length > 0) {
      setSubmitError(`Required: ${missing.map(a => a.label).join(', ')}`);
      return;
    }
    // Attribute-level validation rules (FluxScript; the captured value is `value`)
    const failures: string[] = [];
    for (const attr of visibleAttributes) {
      if (!attr.validation || !String(values[attr.key] ?? '').trim()) continue; // empties are required's job
      try {
        const ok = dslEvaluate(attr.validation, {
          attributes: typedValues,
          anchorRecord,
          activity: { id: activity.id, name: activity.name },
          extras: { value: typedValues[attr.key] },
        });
        if (ok !== true) failures.push(attr.validation_message ?? `${attr.label} is invalid`);
      } catch (err) {
        failures.push(`${attr.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures.length > 0) {
      setSubmitError(failures.join(' · '));
      return;
    }
    try {
      onSubmit(Object.fromEntries(Object.entries(values).filter(([k]) => visibleKeys.has(k))));
    } catch (err) {
      // Constraint violations (required/unique/immutable) surface here; the
      // modal stays open so the user can correct and resubmit.
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        {visibleAttributes.map(attr => (
          <div key={attr.key} style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#374151' }}>
              {attr.label}
              {attr.required && <span style={{ color: '#b91c1c' }}> *</span>}
            </label>

            {attr.type === 'reference' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1,
                  padding: '6px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  color: values[attr.key] ? '#0f172a' : '#94a3b8',
                  background: '#f9fafb',
                  minHeight: 32,
                }}>
                  {displayLabels[attr.key] || values[attr.key] || 'None selected'}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenPickerFor(attr.key)}
                  style={{
                    padding: '6px 12px',
                    background: '#f1f5f9',
                    color: '#374151',
                    border: '1px solid #e2e8f0',
                    borderRadius: 4,
                    fontSize: 13,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {values[attr.key] ? 'Change…' : 'Select…'}
                </button>
                {values[attr.key] && (
                  <button
                    type="button"
                    onClick={() => {
                      setValues(v => ({ ...v, [attr.key]: '' }));
                      setDisplayLabels(d => ({ ...d, [attr.key]: '' }));
                    }}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                    title="Clear"
                  >
                    ×
                  </button>
                )}
              </div>
            ) : attr.type === 'list' ? (
              <ListField
                attr={attr}
                value={values[attr.key]}
                allValues={values}
                anchorRecord={anchorRecord}
                activity={activity}
                onChange={val => setValues(v => ({ ...v, [attr.key]: val }))}
              />
            ) : (
              <input
                type={attr.type === 'date' ? 'date' : 'text'}
                value={values[attr.key]}
                onChange={e => setValues(v => ({ ...v, [attr.key]: e.target.value }))}
                placeholder={attr.description}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>
        ))}

        {submitError && (
          <div style={{
            marginBottom: 10,
            padding: '8px 12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            color: '#b91c1c',
            fontSize: 13,
          }}>
            {submitError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            type="submit"
            style={{ padding: '7px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Submit
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '7px 16px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </form>

      {openPickerFor && (() => {
        const attr = activity.attributes.find(a => a.key === openPickerFor)!;
        const fkRecordType = attr.type_config?.fk_record_type;
        if (!fkRecordType) return null;
        return (
          <RecordPickerDialog
            targetTypeId={fkRecordType}
            onSelect={(record) => {
              setValues(v => ({ ...v, [openPickerFor]: record.id }));
              const fkDisplayField = resolveAttributeDisplayField(recordTypeId, attr.key);
              const label = resolveDisplayLabel(fkRecordType, fkDisplayField, record.id);
              setDisplayLabels(d => ({ ...d, [openPickerFor]: label }));
              setOpenPickerFor(null);
            }}
            onClose={() => setOpenPickerFor(null)}
          />
        );
      })()}
    </>
  );
}

// ── List attribute (DSL-driven) ────────────────────────────────────────────────
// Options come from evaluating the attribute's FluxScript datasource against the
// live store, with current form values injected as `attributes` — which is what makes
// dependent attributes (city → suburb) work: this re-renders on every form value
// change, so the datasource re-evaluates with the latest attribute values.

interface ListOption {
  value: string;
  label: string;
}

interface ListFieldProps {
  attr: AttributeDef;
  value: string;
  allValues: Record<string, string>;
  anchorRecord: RecordInstance | null;
  activity: ActivityDef;
  onChange: (value: string) => void;
}

function ListField({ attr, value, allValues, anchorRecord, activity, onChange }: ListFieldProps) {
  const { dslEvaluate } = useAppContext();
  const datasource = attr.type_config?.datasource ?? '';
  const keyField = attr.type_config?.key_field ?? 'id';
  const displayField = attr.type_config?.display_field ?? 'name';

  const { options, error } = useMemo((): { options: ListOption[]; error: string | null } => {
    if (!datasource) return { options: [], error: `'${attr.key}' has no datasource` };
    try {
      const result = dslEvaluate(datasource, {
        attributes: coerceCaptured(activity.attributes, allValues),
        anchorRecord,
        activity: { id: activity.id, name: activity.name },
      });
      if (!Array.isArray(result)) return { options: [], error: 'datasource did not return a list' };
      return { options: result.map(item => toOption(item, keyField, displayField)), error: null };
    } catch (err) {
      return { options: [], error: err instanceof Error ? err.message : String(err) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasource, keyField, displayField, JSON.stringify(allValues), anchorRecord?.id]);

  // A stale selection (e.g. suburb after the city changed) clears itself
  useEffect(() => {
    if (value && !options.some(o => o.value === value)) onChange('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options]);

  if (error) {
    return <div style={{ fontSize: 12, color: '#b91c1c' }}>Datasource error: {error}</div>;
  }

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '6px 10px',
        border: '1px solid #d1d5db',
        borderRadius: 4,
        fontSize: 14,
        outline: 'none',
        boxSizing: 'border-box',
        background: '#fff',
        color: value ? '#0f172a' : '#94a3b8',
      }}
    >
      <option value="">— select —</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function toOption(item: unknown, keyField: string, displayField: string): ListOption {
  if (item !== null && typeof item === 'object') {
    // DslRecord ({id, type, fields}) or a projected row (plain object)
    const record = item as { id?: unknown; fields?: Record<string, unknown> };
    const bag = record.fields ?? (item as Record<string, unknown>);
    const value = keyField === 'id' && record.id !== undefined ? record.id : bag[keyField];
    const label = bag[displayField] ?? value;
    return { value: String(value ?? ''), label: String(label ?? '') };
  }
  return { value: String(item ?? ''), label: String(item ?? '') };
}
