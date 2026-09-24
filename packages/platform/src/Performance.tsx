// The performance dashboard (docs/PERFORMANCE_LOGGING.md §8): switches, then
// what the numbers say. Plain tables, no charts, for this MVP.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OperationRow, PerfRange, PerfReport, PerfSpan, PerfSwitchRow, PerfSwitches, PlatformClient, SwitchValue } from '@fluxus/client';

const card: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #f1f5f9' };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const mono: React.CSSProperties = { ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };
const muted: React.CSSProperties = { color: '#64748b', margin: '0 0 16px', fontSize: 14 };
const h2: React.CSSProperties = { margin: '0 0 4px', fontSize: 18 };

const RANGES: { value: PerfRange; label: string }[] = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

const PARTS: { key: 'enabled' | 'server' | 'browser' | 'dbCounts'; label: string }[] = [
  { key: 'enabled', label: 'Logging' },
  { key: 'server', label: 'Server spans' },
  { key: 'browser', label: 'Browser spans' },
  { key: 'dbCounts', label: 'Database counts' },
];

export function Performance({ client }: { client: PlatformClient }) {
  const [range, setRange] = useState<PerfRange>('24h');
  const [report, setReport] = useState<PerfReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await client.perfReport(range));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, range]);

  useEffect(() => {
    setReport(null);
    void load();
  }, [load]);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {error && <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}>{error}</div>}
      <Switches client={client} />
      <section style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ fontSize: 14, color: '#475569' }}>
          Time range{' '}
          <select value={range} onChange={(e) => setRange(e.target.value as PerfRange)} style={{ marginLeft: 6, font: 'inherit' }}>
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button onClick={() => void load()} style={{ font: 'inherit', cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '4px 12px' }}>
          Refresh
        </button>
      </section>
      {report === null ? (
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      ) : (
        <>
          <Slowest rows={report.slowest} />
          <PageOpens rows={report.pageOpens} />
          <DbWakeups summary={report.dbWakeups} />
          <SlowActions client={client} traces={report.recentSlowTraces} />
        </>
      )}
    </div>
  );
}

// ── Switches ─────────────────────────────────────────────────────────────────

function Switches({ client }: { client: PlatformClient }) {
  const [switches, setSwitches] = useState<PerfSwitches | null>(null);
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, ops] = await Promise.all([client.perfSwitches(), client.listOperations()]);
      setSwitches(s);
      setOperations(ops);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);
  useEffect(() => void load(), [load]);

  const change = async (scope: string, key: (typeof PARTS)[number]['key'], value: SwitchValue) => {
    try {
      await client.setPerfSwitches({ scope, [key]: value });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // An operation with no row follows the platform on every part.
  const rowFor = (id: string): PerfSwitchRow =>
    switches?.operations.find((o) => o.scope === id) ?? { scope: id, enabled: 'follow', server: 'follow', browser: 'follow', dbCounts: 'follow' };

  return (
    <section style={card}>
      <h2 style={h2}>Switches</h2>
      <p style={muted}>
        Platform-wide, then each operation. An operation can turn logging on or off for itself, or follow the platform.
        A change reaches the server within half a minute, and a browser the next time it connects.
      </p>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {switches === null ? (
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Scope</th>
                {PARTS.map((p) => <th key={p.key} style={th}>{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <SwitchRow label="Platform" row={switches.platform} follow={false} onChange={(k, v) => void change('platform', k, v)} />
              {operations.map((o) => (
                <SwitchRow key={o.id} label={`${o.name} `} sub={o.id} row={rowFor(o.id)} follow onChange={(k, v) => void change(o.id, k, v)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SwitchRow({ label, sub, row, follow, onChange }: {
  label: string;
  sub?: string;
  row: PerfSwitchRow;
  /** The platform row has nothing above it to follow. */
  follow: boolean;
  onChange: (key: (typeof PARTS)[number]['key'], value: SwitchValue) => void;
}) {
  return (
    <tr>
      <td style={td}>
        <strong>{label}</strong>
        {sub && <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{sub}</span>}
      </td>
      {PARTS.map((p) => (
        <td key={p.key} style={td}>
          <select value={row[p.key]} onChange={(e) => onChange(p.key, e.target.value as SwitchValue)} style={{ font: 'inherit' }}>
            <option value="on">on</option>
            <option value="off">off</option>
            {follow && <option value="follow">follow platform</option>}
          </select>
        </td>
      ))}
    </tr>
  );
}

// ── Slowest things ───────────────────────────────────────────────────────────

type SlowKey = 'kind' | 'name' | 'count' | 'medianMs' | 'p95Ms' | 'maxMs';

function Slowest({ rows }: { rows: PerfReport['slowest'] }) {
  const [sort, setSort] = useState<{ key: SlowKey; dir: 1 | -1 }>({ key: 'p95Ms', dir: -1 });
  const sorted = useMemo(() => {
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
    });
  }, [rows, sort]);
  const head = (key: SlowKey, label: string, right = false) => (
    <th style={{ ...th, textAlign: right ? 'right' : 'left', cursor: 'pointer' }} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'kind' || key === 'name' ? 1 : -1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  return (
    <section style={card}>
      <h2 style={h2}>Slowest things</h2>
      <p style={muted}>Per kind and name: how many, typical (median), the slow end (95th percentile) and the worst. This is where "which activity is slow" is answered.</p>
      {rows.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>Nothing recorded in this range.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>{head('kind', 'Kind')}{head('name', 'Name')}{head('count', 'Count', true)}{head('medianMs', 'Typical', true)}{head('p95Ms', 'Slow end', true)}{head('maxMs', 'Worst', true)}</tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={`${r.kind}\u0000${r.name}`}>
                  <td style={mono}>{r.kind}</td>
                  <td style={mono}>{r.name}</td>
                  <td style={num}>{r.count}</td>
                  <td style={num}>{ms(r.medianMs)}</td>
                  <td style={num}>{ms(r.p95Ms)}</td>
                  <td style={num}>{ms(r.maxMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Page opens ───────────────────────────────────────────────────────────────

function PageOpens({ rows }: { rows: PerfReport['pageOpens'] }) {
  return (
    <section style={card}>
      <h2 style={h2}>Page opens</h2>
      <p style={muted}>From a page being asked for until every component on it has loaded.</p>
      {rows.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>No page opens in this range.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr><th style={th}>Page</th><th style={{ ...th, textAlign: 'right' }}>Opens</th><th style={{ ...th, textAlign: 'right' }}>Typical</th><th style={{ ...th, textAlign: 'right' }}>Slow end</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}><td style={mono}>{r.name}</td><td style={num}>{r.count}</td><td style={num}>{ms(r.medianMs)}</td><td style={num}>{ms(r.p95Ms)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Database wake-ups ────────────────────────────────────────────────────────

function DbWakeups({ summary }: { summary: PerfReport['dbWakeups'] }) {
  return (
    <section style={card}>
      <h2 style={h2}>Database wake-ups</h2>
      <p style={muted}>A new database connection being opened — what a cold database looks like. This is where "the first page is slow" is answered.</p>
      {summary === null ? (
        <p style={{ color: '#94a3b8' }}>No new connections in this range.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Connections opened</th><th style={{ ...th, textAlign: 'right' }}>Typical</th><th style={{ ...th, textAlign: 'right' }}>Longest</th></tr></thead>
          <tbody><tr><td style={num}>{summary.count}</td><td style={num}>{ms(summary.medianMs)}</td><td style={num}>{ms(summary.maxMs)}</td></tr></tbody>
        </table>
      )}
    </section>
  );
}

// ── Recent slow actions ──────────────────────────────────────────────────────

function SlowActions({ client, traces }: { client: PlatformClient; traces: PerfReport['recentSlowTraces'] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [spans, setSpans] = useState<PerfSpan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = async (traceId: string) => {
    if (open === traceId) {
      setOpen(null);
      return;
    }
    setOpen(traceId);
    setSpans(null);
    try {
      setSpans(await client.perfTrace(traceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section style={card}>
      <h2 style={h2}>Recent slow actions</h2>
      <p style={muted}>Actions over 2 seconds, newest first. Click one to see what it did, step by step.</p>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {traces.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>Nothing over 2 seconds in this range.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={th}>When</th><th style={th}>Trace</th><th style={{ ...th, textAlign: 'right' }}>Took</th></tr></thead>
          <tbody>
            {traces.map((t) => (
              <FragmentRows key={t.traceId}>
                <tr onClick={() => void show(t.traceId)} style={{ cursor: 'pointer', background: open === t.traceId ? '#f8fafc' : undefined }}>
                  <td style={td}>{new Date(t.startedAt).toLocaleString()}</td>
                  <td style={mono}>{t.traceId.slice(0, 12)}…</td>
                  <td style={num}>{ms(t.durationMs)}</td>
                </tr>
                {open === t.traceId && (
                  <tr>
                    <td colSpan={3} style={{ padding: '4px 12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                      {spans === null ? <span style={{ color: '#94a3b8' }}>Loading…</span> : <SpanTree spans={spans} />}
                    </td>
                  </tr>
                )}
              </FragmentRows>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** One trace as an indented tree. A span whose parent is not in the trace (a
 *  browser batch that never arrived) is shown at the top rather than lost. */
function SpanTree({ spans }: { spans: PerfSpan[] }) {
  const rows = useMemo(() => flatten(spans), [spans]);
  return (
    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>
      {rows.map(({ span, depth }) => (
        <div key={span.spanId} style={{ display: 'flex', gap: 12, padding: '2px 0', paddingLeft: depth * 20, color: span.outcome === 'ok' ? undefined : span.outcome === 'refused' ? '#b45309' : '#b91c1c' }}>
          <span style={{ color: '#94a3b8', width: 56 }}>{span.side}</span>
          <span style={{ width: 84 }}>{span.kind}</span>
          <span style={{ flex: 1 }}>
            {span.name}
            {span.counts && <span style={{ color: '#64748b' }}> · {Object.entries(span.counts).map(([k, v]) => `${k} ${v}`).join(', ')}</span>}
            {span.message && <span> · {span.message}</span>}
          </span>
          <span style={{ textAlign: 'right', width: 72 }}>{ms(span.durationMs)}</span>
        </div>
      ))}
    </div>
  );
}

function flatten(spans: PerfSpan[]): { span: PerfSpan; depth: number }[] {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string | null, PerfSpan[]>();
  for (const s of spans) {
    const parent = s.parentId !== null && ids.has(s.parentId) ? s.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  const out: { span: PerfSpan; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of (children.get(parent) ?? []).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      out.push({ span: s, depth });
      walk(s.spanId, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} s` : `${Math.round(n)} ms`;
}
