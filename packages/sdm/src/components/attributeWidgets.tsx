// Capture + display widgets for the file/photo/scalar attribute types
// (ATTRIBUTE_TYPES_FILES_SCALARS §10). Every widget here is a PURE controlled
// component: value in, onChange out, config as props, the upload service
// injected — ZERO imports from the workbench's stores/context. That is the
// whole point: when the page builder becomes the second consumer these lift to
// a shared package unchanged. Keep it that way (no useAppContext here).

import { useEffect, useRef, useState } from 'react';
import type { Descriptor, FileDescriptor, PhotoDescriptor, UploadService } from '@fluxus/client';
import type { AttributeTypeConfig } from '@fluxus/engine';

// ── shared helpers ───────────────────────────────────────────────────────────

/** A file/photo value is a single descriptor or an array (multi). Normalise. */
function asList(value: unknown): Descriptor[] {
  if (Array.isArray(value)) return value as Descriptor[];
  if (value && typeof value === 'object') return [value as Descriptor];
  return [];
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

/** Resolve a stored object key to a presigned URL (lazy, once). */
function useResolvedUrl(uploads: UploadService, key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) { setUrl(null); return; }
    let live = true;
    uploads.resolveUrl(key).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [uploads, key]);
  return url;
}

// ── scalar capture widgets ───────────────────────────────────────────────────

export function TextAreaInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={4}
      style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
    />
  );
}

export function NumberInput({ value, onChange, step, placeholder }: { value: string; onChange: (v: string) => void; step?: number; placeholder?: string }) {
  return (
    <input type="number" value={value} step={step ?? 'any'} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} style={inputStyle} />
  );
}

export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="time" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
}

/** datetime with local offset (§1): the input is zone-less; we stamp the offset. */
export function DateTimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input type="datetime-local" value={toLocalInput(value)}
      onChange={(e) => onChange(toOffsetIso(e.target.value))} style={inputStyle} />
  );
}

export function toOffsetIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

export function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── file / photo capture ─────────────────────────────────────────────────────

interface UploadState {
  /** Stable identity — progress updates replace the object, so we can't use it. */
  id: string;
  name: string;
  progress: number;
  error?: string;
}

interface CaptureProps {
  value: unknown;
  onChange: (value: Descriptor | Descriptor[] | null) => void;
  attributeKey: string;
  config?: AttributeTypeConfig;
  uploads: UploadService;
  disabled?: boolean;
}

/** Run the picked files through the upload service, appending descriptors. */
function usePicker({ value, onChange, attributeKey, config, uploads }: CaptureProps) {
  const multi = config?.multi === true;
  const current = asList(value);
  const [uploading, setUploading] = useState<UploadState[]>([]);

  // A batch of uploads resolves asynchronously; `latest` lets each completion
  // append to the running list instead of clobbering with a stale `current`.
  const latest = useRef(current);
  latest.current = current;

  const emit = (list: Descriptor[]) => {
    latest.current = list;
    onChange(multi ? list : (list[0] ?? null));
  };

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = multi ? Array.from(files) : [files[0]];
    for (const file of chosen) {
      if (multi && typeof config?.max_count === 'number' && latest.current.length >= config.max_count) break;
      const id = globalThis.crypto.randomUUID();
      setUploading((u) => [...u, { id, name: file.name, progress: 0 }]);
      try {
        const descriptor = await uploads.upload(attributeKey, file, (fraction) => {
          setUploading((u) => u.map((s) => (s.id === id ? { ...s, progress: fraction } : s)));
        });
        emit(multi ? [...latest.current, descriptor] : [descriptor]);
      } catch (err) {
        setUploading((u) => u.map((s) => (s.id === id ? { ...s, error: err instanceof Error ? err.message : String(err) } : s)));
        continue;
      }
      setUploading((u) => u.filter((s) => s.id !== id));
    }
  };

  const remove = (index: number) => emit(current.filter((_, i) => i !== index));

  const canAdd = !config?.max_count || current.length < config.max_count || (!multi && current.length === 0);
  return { multi, current, uploading, pick, remove, canAdd };
}

export function PhotoInput(props: CaptureProps) {
  const { multi, current, uploading, pick, remove, canAdd } = usePicker(props);
  const inputRef = useRef<HTMLInputElement>(null);
  const showAdd = canAdd && !props.disabled && (multi || current.length === 0);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {current.map((d, i) => (
          <Thumb key={`${d.storage_key}-${i}`} descriptor={d as PhotoDescriptor} uploads={props.uploads}
            onRemove={props.disabled ? undefined : () => remove(i)} />
        ))}
        {uploading.map((u) => (
          <div key={u.id} style={tileStyle}>
            <div style={{ fontSize: 10, color: u.error ? '#b91c1c' : '#64748b', textAlign: 'center', padding: 4 }}>
              {u.error ? '⚠' : `${Math.round(u.progress * 100)}%`}
            </div>
          </div>
        ))}
        {showAdd && (
          <button type="button" onClick={() => inputRef.current?.click()}
            style={{ ...tileStyle, cursor: 'pointer', color: '#94a3b8', fontSize: 28, background: '#f8fafc' }}>
            +
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple={multi}
        style={{ display: 'none' }} onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

export function FileInput(props: CaptureProps) {
  const { multi, current, uploading, pick, remove, canAdd } = usePicker(props);
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = props.config?.accept?.join(',');
  const showAdd = canAdd && !props.disabled && (multi || current.length === 0);

  return (
    <div>
      {current.map((d, i) => (
        <FileRow key={`${d.storage_key}-${i}`} descriptor={d} uploads={props.uploads}
          onRemove={props.disabled ? undefined : () => remove(i)} />
      ))}
      {uploading.map((u) => (
        <div key={u.id} style={{ fontSize: 12, color: u.error ? '#b91c1c' : '#64748b', padding: '4px 0' }}>
          {u.error ? `⚠ ${u.name}: ${u.error}` : `↑ ${u.name} — ${Math.round(u.progress * 100)}%`}
        </div>
      ))}
      {showAdd && (
        <button type="button" onClick={() => inputRef.current?.click()}
          style={{ ...inputStyle, cursor: 'pointer', textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
          📎 Add file{multi ? 's' : ''}…
        </button>
      )}
      <input ref={inputRef} type="file" accept={accept} multiple={multi}
        style={{ display: 'none' }} onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

// ── display widgets ──────────────────────────────────────────────────────────

const tileStyle: React.CSSProperties = {
  width: 72, height: 72, border: '1px solid #e2e8f0', borderRadius: 6,
  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 0,
};

function Thumb({ descriptor, uploads, onRemove }: { descriptor: PhotoDescriptor; uploads: UploadService; onRemove?: () => void }) {
  const url = useResolvedUrl(uploads, descriptor.thumb_key ?? descriptor.storage_key);
  const open = async () => {
    const full = await uploads.resolveUrl(descriptor.storage_key);
    window.open(full, '_blank', 'noopener');
  };
  return (
    <div style={{ ...tileStyle, position: 'relative', cursor: url ? 'pointer' : 'default' }}>
      {url ? (
        <img src={url} alt={descriptor.name} onClick={open} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: 10, color: '#94a3b8' }}>…</span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove"
          style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.7)', color: '#fff', fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0 }}>
          ×
        </button>
      )}
    </div>
  );
}

function FileRow({ descriptor, uploads, onRemove }: { descriptor: FileDescriptor; uploads: UploadService; onRemove?: () => void }) {
  const download = async () => {
    const url = await uploads.resolveUrl(descriptor.storage_key);
    window.open(url, '_blank', 'noopener');
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 4, marginBottom: 4, fontSize: 13 }}>
      <span aria-hidden>📎</span>
      <button type="button" onClick={download} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontSize: 13, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {descriptor.name}
      </button>
      <span style={{ color: '#94a3b8', fontSize: 12 }}>{humanSize(descriptor.size)}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
      )}
    </div>
  );
}

/** Read-only thumb grid for a photo value (history / record details). */
export function PhotoThumbs({ value, uploads }: { value: unknown; uploads: UploadService }) {
  const list = asList(value);
  if (list.length === 0) return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {list.map((d, i) => <Thumb key={`${d.storage_key}-${i}`} descriptor={d as PhotoDescriptor} uploads={uploads} />)}
    </div>
  );
}

/** Read-only file chip rows for a file value (history / record details). */
export function FileChips({ value, uploads }: { value: unknown; uploads: UploadService }) {
  const list = asList(value);
  if (list.length === 0) return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
  return <div>{list.map((d, i) => <FileRow key={`${d.storage_key}-${i}`} descriptor={d} uploads={uploads} />)}</div>;
}

/** Compact grid-cell view: first thumbnail with a count badge (§10). */
export function PhotoCountCell({ value, uploads }: { value: unknown; uploads: UploadService }) {
  const list = asList(value);
  const url = useResolvedUrl(uploads, list[0] ? ((list[0] as PhotoDescriptor).thumb_key ?? list[0].storage_key) : undefined);
  if (list.length === 0) return <span style={{ color: '#cbd5e1' }}>—</span>;
  return (
    <div style={{ position: 'relative', width: 28, height: 28 }}>
      {url && <img src={url} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} />}
      {list.length > 1 && (
        <span style={{ position: 'absolute', bottom: -4, right: -4, background: '#0f172a', color: '#fff', borderRadius: 8, fontSize: 10, padding: '0 4px', lineHeight: '14px' }}>
          {list.length}
        </span>
      )}
    </div>
  );
}

/** A value is a descriptor bag (or list of them) — used to choose the display. */
export function isDescriptorValue(value: unknown): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return !!first && typeof first === 'object' && typeof (first as Record<string, unknown>).storage_key === 'string';
}
