import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { RecordPickerDialog } from './RecordPickerDialog';
import { ComponentLabel } from '../context/UatLabels';
import { coerceCaptured, coerceCapturedValue, compositeSubs, isBlank } from '@fluxus/engine';
import type { ActivityDef, AttributeDef, RecordInstance, RunActivityResult } from '@fluxus/engine';
import type { UploadService } from '@fluxus/client';
import { DateTimeInput, FileInput, NumberInput, PhotoInput, TextAreaInput, TimeInput } from './attributeWidgets';

/** The capture widget for a non-reference/non-list attribute or composite cell. */
function ScalarInput({ attr, value, onChange, uploads }: {
  attr: AttributeDef;
  value: unknown;
  onChange: (value: unknown) => void;
  uploads: UploadService;
}) {
  const str = typeof value === 'string' ? value : '';
  switch (attr.type) {
    case 'photo':
      return <PhotoInput value={value} attributeKey={attr.key} config={attr.type_config} uploads={uploads}
        onChange={(v) => onChange(v)} />;
    case 'file':
      return <FileInput value={value} attributeKey={attr.key} config={attr.type_config} uploads={uploads}
        onChange={(v) => onChange(v)} />;
    case 'datetime':
      return <DateTimeInput value={str} onChange={onChange} />;
    case 'time':
      return <TimeInput value={str} onChange={onChange} />;
    case 'int':
      return <NumberInput value={str} step={1} placeholder={attr.description} onChange={onChange} />;
    case 'decimal':
      return <NumberInput value={str} step={attr.type_config?.decimal_places ? 1 / 10 ** attr.type_config.decimal_places : undefined} placeholder={attr.description} onChange={onChange} />;
    case 'text':
      if (attr.type_config?.multiline) return <TextAreaInput value={str} onChange={onChange} placeholder={attr.description} />;
      return <TextInput value={str} onChange={onChange} placeholder={attr.description} />;
    case 'date':
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} style={plainInputStyle} />;
    default:
      return <TextInput value={str} onChange={onChange} placeholder={attr.description} />;
  }
}

const plainInputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4,
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
};

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={plainInputStyle} />;
}

interface Props {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  recordTypeId: string;
  /**
   * Runs the activity. 'needs-confirmation' means the before hook warn()ed and
   * nothing persisted — the form shows Continue/Cancel and re-submits with
   * acknowledgedWarnings on Continue. `waived` carries the attributes the user
   * declared unavailable (key → reason).
   */
  onSubmit: (
    captured: Record<string, unknown>,
    options?: { acknowledgedWarnings?: boolean; waived?: Record<string, string> }
  ) => Promise<RunActivityResult>;
  onClose: () => void;
}

/** Initial capture value for an attribute: multi → array, file/photo → its
 *  natural empty, everything else the scalar string. */
function emptyValue(attr: AttributeDef): unknown {
  if (attr.type_config?.multi) return [];
  return '';
}

export function AttributesForm({ activity, anchorRecord, recordTypeId, onSubmit, onClose }: Props) {
  const { resolveDisplayLabel, resolveAttributeDisplayField, dslEvaluate, uploads } = useAppContext();

  // Form state is FLAT: composite attributes contribute one entry per cell
  // under the dotted path `attr.sub` — the engine nests them again. Section
  // markers carry no value. Scalars are strings; file/photo attributes hold
  // descriptor objects (or arrays when multi).
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const a of activity.attributes) {
      if (a.type === 'section') continue;
      const subs = compositeSubs(a);
      if (subs) {
        for (const sub of subs) out[`${a.key}.${sub.key}`] = emptyValue(sub);
        continue;
      }
      out[a.key] = activity.record_map === 'UPDATE' && anchorRecord && a.key in anchorRecord.customFields
        ? anchorRecord.customFields[a.key]
        : emptyValue(a);
    }
    return out;
  });

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
  // Attributes declared unavailable ("can't provide"): key → the user's reason.
  // Presence of a key means the toggle is on; the value input is replaced by
  // the reason box and the captured value is cleared.
  const [waived, setWaived] = useState<Record<string, string>>({});
  // Before-hook warnings awaiting the user's Continue/Cancel decision, together
  // with a frozen snapshot of the values/waivers that were validated and warned
  // about. Continue submits the snapshot — editing the form cannot sneak past
  // the validations that already ran (the fields are locked while pending anyway).
  const [pending, setPending] = useState<{
    warnings: string[];
    captured: Record<string, unknown>;
    waived: Record<string, string>;
  } | null>(null);

  const toggleWaive = (key: string, on: boolean) => {
    setWaived(w => {
      const next = { ...w };
      if (on) next[key] = next[key] ?? '';
      else delete next[key];
      return next;
    });
    if (on) {
      setValues(v => ({ ...v, [key]: '' }));
      setDisplayLabels(d => ({ ...d, [key]: '' }));
    }
  };

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

  // One "capture unit" per input the user can fill: a scalar attribute, or one
  // cell of a composite (dotted key, per-cell required/waive/validation from
  // the column definition). The submit checks below run over units so both
  // shapes share the same semantics.
  interface CaptureUnit {
    key: string;
    label: string;
    required?: boolean;
    can_waive?: boolean;
    validation?: string;
    validation_message?: string;
    typed: () => unknown;
  }
  const captureUnits: CaptureUnit[] = visibleAttributes.flatMap((attr): CaptureUnit[] => {
    if (attr.type === 'section') return [];
    const subs = compositeSubs(attr);
    if (!subs) {
      return [{
        key: attr.key,
        label: attr.label,
        required: attr.required,
        can_waive: attr.can_waive,
        validation: attr.validation,
        validation_message: attr.validation_message,
        typed: () => typedValues[attr.key],
      }];
    }
    // Sub-attribute show_conditions apply within the row (fail open, like
    // attribute-level ones) — hidden cells are exempt from checks and payload.
    return subs.filter(isVisible).map(sub => {
      const key = `${attr.key}.${sub.key}`;
      return {
        key,
        label: `${attr.label} — ${sub.label}`,
        required: sub.required,
        can_waive: sub.can_waive,
        validation: sub.validation,
        validation_message: sub.validation_message,
        typed: () => coerceCapturedValue(sub.type, values[key]),
      };
    });
  });

  // The submission payload: hidden attributes are not part of it
  const capturedForSubmit = () => {
    const visibleKeys = new Set(captureUnits.map(u => u.key));
    return Object.fromEntries(Object.entries(values).filter(([k]) => visibleKeys.has(k)));
  };

  const submit = async (
    captured: Record<string, unknown>,
    capturedWaived: Record<string, string>,
    options?: { acknowledgedWarnings?: boolean }
  ) => {
    try {
      const result = await onSubmit(captured, { ...options, waived: capturedWaived });
      if (result.status === 'needs-confirmation') {
        setPending({ warnings: result.warnings, captured, waived: capturedWaived });
      } else {
        setPending(null);
      }
    } catch (err) {
      // fail() in a hook and constraint violations (required/unique/immutable)
      // surface here; the modal stays open so the user can correct and resubmit.
      setPending(null);
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isWaived = (key: string) => key in waived;
    // Required units must be captured (hidden ones are exempt by
    // construction; waived ones trade the value for a mandatory reason)
    const missing = captureUnits.filter(
      u => u.required && !isWaived(u.key) && isBlank(values[u.key])
    );
    if (missing.length > 0) {
      setSubmitError(`Required: ${missing.map(u => u.label).join(', ')}`);
      return;
    }
    const reasonless = captureUnits.filter(u => isWaived(u.key) && !waived[u.key].trim());
    if (reasonless.length > 0) {
      setSubmitError(`A reason is needed for: ${reasonless.map(u => u.label).join(', ')}`);
      return;
    }
    // Validation rules (FluxScript; the captured value is `value`)
    const failures: string[] = [];
    for (const unit of captureUnits) {
      if (!unit.validation || isBlank(values[unit.key])) continue; // empties are required's job
      try {
        const ok = dslEvaluate(unit.validation, {
          attributes: typedValues,
          anchorRecord,
          activity: { id: activity.id, name: activity.name },
          extras: { value: unit.typed() },
        });
        if (ok !== true) failures.push(unit.validation_message ?? `${unit.label} is invalid`);
      } catch (err) {
        failures.push(`${unit.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures.length > 0) {
      setSubmitError(failures.join(' · '));
      return;
    }
    setSubmitError(null);
    // Only visible units can be waived in this submission
    const visibleKeys = new Set(captureUnits.map(u => u.key));
    const capturedWaived = Object.fromEntries(
      Object.entries(waived).filter(([k]) => visibleKeys.has(k)).map(([k, r]) => [k, r.trim()])
    );
    submit(capturedForSubmit(), capturedWaived);
  };

  return (
    <div style={{ position: 'relative' }}>
      <ComponentLabel name="AttributesForm" />
      <form onSubmit={handleSubmit}>
        {/* Fields lock while a warning decision is pending — the snapshot that
            was validated is what Continue submits, so editing must wait. */}
        <fieldset disabled={pending !== null} style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 'auto', opacity: pending ? 0.6 : 1 }}>
        {visibleAttributes.map(attr => attr.type === 'section' ? (
          <div key={attr.key} style={{ margin: '16px 0 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: 4 }}>
              {attr.label}
            </div>
            {attr.description && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{attr.description}</div>
            )}
          </div>
        ) : attr.type === 'composite' ? (
          <CompositeField
            key={attr.key}
            attr={attr}
            values={values}
            waived={waived}
            anchorRecord={anchorRecord}
            activity={activity}
            uploads={uploads}
            isSubVisible={isVisible}
            onValue={(key, val) => setValues(v => ({ ...v, [key]: val }))}
            onToggleWaive={toggleWaive}
            onWaiveReason={(key, reason) => setWaived(w => ({ ...w, [key]: reason }))}
          />
        ) : (
          <div key={attr.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <label style={{ fontSize: 13, color: '#374151' }}>
                {attr.label}
                {attr.required && <span style={{ color: '#b91c1c' }}> *</span>}
              </label>
              {attr.can_waive && (
                <label style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={attr.key in waived}
                    onChange={e => toggleWaive(attr.key, e.target.checked)}
                    style={{ verticalAlign: 'middle', marginRight: 4 }}
                  />
                  Can't provide
                </label>
              )}
            </div>

            {attr.key in waived ? (
              // Value traded for a mandatory reason — nothing is written to the field
              <input
                type="text"
                value={waived[attr.key]}
                onChange={e => setWaived(w => ({ ...w, [attr.key]: e.target.value }))}
                placeholder="Why can't this be provided?"
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #fde68a',
                  background: '#fffbeb',
                  borderRadius: 4,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            ) : attr.type === 'reference' ? (
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
                  {displayLabels[attr.key] || String(values[attr.key] ?? '') || 'None selected'}
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
                {!!values[attr.key] && (
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
                value={String(values[attr.key] ?? '')}
                allValues={values}
                anchorRecord={anchorRecord}
                activity={activity}
                onChange={val => setValues(v => ({ ...v, [attr.key]: val }))}
              />
            ) : (
              <ScalarInput
                attr={attr}
                value={values[attr.key]}
                uploads={uploads}
                onChange={val => setValues(v => ({ ...v, [attr.key]: val }))}
              />
            )}
          </div>
        ))}
        </fieldset>

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

        {pending && (
          // The before hook warn()ed: nothing has been saved yet. Same layout
          // as the fail banner — messages above, buttons below.
          <div style={{
            marginBottom: 10,
            padding: '8px 12px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 4,
            color: '#92400e',
            fontSize: 13,
          }}>
            {pending.warnings.map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {pending ? (
            <>
              <button
                type="button"
                onClick={() => submit(pending.captured, pending.waived, { acknowledgedWarnings: true })}
                style={{ padding: '7px 16px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Continue anyway
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                style={{ padding: '7px 16px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
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
    </div>
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
  allValues: Record<string, unknown>;
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

// ── Composite attribute (one question's row of sub-fields, rendered stacked) ──
// Deliberately NOT the paper form's sideways layout: the attribute label reads
// as the question and its sub-attribute inputs stack beneath — the layout that
// works on small screens (design ruled 2026-07-18). Sub-attributes are real
// pool attributes resolved through usage wrappers; cell state lives in the
// parent's flat `values` bag under dotted `attr.sub` keys.

interface CompositeFieldProps {
  attr: AttributeDef;
  values: Record<string, unknown>;
  waived: Record<string, string>;
  anchorRecord: RecordInstance | null;
  activity: ActivityDef;
  uploads: UploadService;
  isSubVisible: (sub: AttributeDef) => boolean;
  onValue: (key: string, value: unknown) => void;
  onToggleWaive: (key: string, on: boolean) => void;
  onWaiveReason: (key: string, reason: string) => void;
}

function CompositeField({ attr, values, waived, anchorRecord, activity, uploads, isSubVisible, onValue, onToggleWaive, onWaiveReason }: CompositeFieldProps) {
  const subs = compositeSubs(attr);
  if (!subs) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ margin: '10px 0 14px', paddingLeft: 10, borderLeft: '2px solid #e2e8f0' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', marginBottom: 6 }}>{attr.label}</div>
      {attr.description && (
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{attr.description}</div>
      )}
      {subs.filter(isSubVisible).map(sub => {
        const key = `${attr.key}.${sub.key}`;
        return (
          <div key={sub.key} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
              <label style={{ fontSize: 12, color: '#374151' }}>
                {sub.label}
                {sub.required && <span style={{ color: '#b91c1c' }}> *</span>}
              </label>
              {sub.can_waive && (
                <label style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={key in waived}
                    onChange={e => onToggleWaive(key, e.target.checked)}
                    style={{ verticalAlign: 'middle', marginRight: 4 }}
                  />
                  Can't provide
                </label>
              )}
            </div>
            {key in waived ? (
              <input
                type="text"
                value={waived[key]}
                onChange={e => onWaiveReason(key, e.target.value)}
                placeholder="Why can't this be provided?"
                style={{ ...inputStyle, border: '1px solid #fde68a', background: '#fffbeb' }}
              />
            ) : sub.type === 'list' ? (
              <ListField
                attr={{ ...sub, key }}
                value={String(values[key] ?? '')}
                allValues={values}
                anchorRecord={anchorRecord}
                activity={activity}
                onChange={val => onValue(key, val)}
              />
            ) : (
              <ScalarInput
                attr={sub}
                value={values[key]}
                uploads={uploads}
                onChange={val => onValue(key, val)}
              />
            )}
          </div>
        );
      })}
    </div>
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
