// The DSL Editor (packages/console/docs/DSL_EDITOR_SPEC.md) — ad-hoc
// FluxScript over one operation's records, read-only, plus running an activity.
//
// Why it exists: the workbench lists and inspects records of one type but
// cannot query them. This adds the querying.
//
// Why it is not a tab inside the workbench: the workbench's frame is one record
// type at a time, and a query is not. It also reads `useWorkbench()` throughout,
// so nothing of it is reusable here — this builds its own operation picker and
// sits on @fluxus/page-runtime for the capture form, which is the shared one.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { buildDslSchema, functionSignatures, modelSchemaTypes, type ActivityDef, type RecordInstance, type RunActivityResult } from '@fluxus/engine';
import { validateExpression } from '@fluxus/dsl';
import type { ScriptQueryResult } from '@fluxus/client';
import { ActivityFormModal } from '@fluxus/page-runtime';
import { FLUXSCRIPT, registerFluxscript } from '../page-builder/fluxscriptLanguage';
import { openSolution, pageRuntime, sdmClient } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';
import { useShellState } from '../shell/useShellState';

/**
 * Where the buffer is kept between visits. Per solution, because a script names
 * that solution's record types and is meaningless against another's.
 *
 * This is the smallest useful piece of the persistence story, not the whole of
 * it: saved snippets, named scripts and files are still ahead (SPEC §11). It
 * also covers the rough edge that switching operation remounts the view and
 * used to discard whatever was typed.
 */
const bufferKey = (solutionId: string) => `fluxus:console:dsl-editor:${solutionId}`;

function loadBuffer(solutionId: string | null): { source: string; anchorId: string } {
  if (!solutionId) return { source: '', anchorId: '' };
  try {
    const raw = window.localStorage.getItem(bufferKey(solutionId));
    if (!raw) return { source: '', anchorId: '' };
    const parsed = JSON.parse(raw) as { source?: unknown; anchorId?: unknown };
    return {
      source: typeof parsed.source === 'string' ? parsed.source : '',
      anchorId: typeof parsed.anchorId === 'string' ? parsed.anchorId : '',
    };
  } catch {
    // Unreadable or unparseable storage is an empty editor, never a crash.
    return { source: '', anchorId: '' };
  }
}

/**
 * Validation runs this long after the last keystroke, not on every one — the
 * same 300 ms the record picker's search waits (`SEARCH_DEBOUNCE_MS`).
 *
 * Why it matters here: a script is invalid for most of the time it is being
 * typed, so validating per keystroke paints the editor red while you are still
 * writing the line. Waiting until you stop means the marker appears when it is
 * information rather than noise.
 */
const VALIDATE_DEBOUNCE_MS = 300;

const PLACEHOLDER = `records.<record_type>\n  .where(<field> = 'value')\n  .top(50)\n\n-- the model itself:\n-- model.record_types.select(query_name, name)`;

/** How many rows the grid draws. There is no windowing dependency in the repo
 *  and one is not justified for a v1 — past this the answer is a tighter
 *  `where` or a `.top(n)`, which is what the tool is for. */
const DISPLAY_CAP = 500;

type Row = Record<string, unknown>;

function DslEditorViewComponent() {
  const { solutionId, dataOperationId, dataOperations } = useShellState([
    'solutionId', 'dataOperationId', 'dataOperations',
  ]);

  // Restored once, on mount — which is also what makes the buffer survive the
  // remount an operation switch causes.
  const restored = useMemo(() => loadBuffer(solutionId), [solutionId]);
  const [source, setSource] = useState(restored.source);
  const [anchorId, setAnchorId] = useState(restored.anchorId);
  const [result, setResult] = useState<ScriptQueryResult | null>(null);
  /** The last result that carried a value. A failed run shows its error over
   *  this rather than blanking the pane — you usually want to see what you had
   *  while you fix the query. */
  const [lastGood, setLastGood] = useState<ScriptQueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activityPick, setActivityPick] = useState(false);
  const [runningActivity, setRunningActivity] = useState<{ activity: ActivityDef; typeId: string } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  /** Editor height as a percentage of the pane. Dragged, not stored — where
   *  the split sits is a per-session preference and saving anything is
   *  deferred with the rest of persistence. */
  const [splitPct, setSplitPct] = useState(45);
  /** Inspector width in px. Dragged, not stored, like the horizontal split. */
  const [inspectorPx, setInspectorPx] = useState(340);
  /** The results pane appears when there is a result, and not before: opening
   *  the tool gives the whole area to the editor rather than to an empty panel
   *  explaining itself. Closing it hands the space back; a run reopens it, so
   *  closing is "out of my way", not "discard what I ran". */
  const [resultsOpen, setResultsOpen] = useState(false);

  // Written on every change. The buffer is small and the write is cheap; a
  // debounce would only add a window in which a reload loses the last edit.
  useEffect(() => {
    if (!solutionId) return;
    try {
      window.localStorage.setItem(bufferKey(solutionId), JSON.stringify({ source, anchorId }));
    } catch {
      // Storage full or blocked — the editor still works, it just will not be
      // there next time. Not worth interrupting anyone over.
    }
  }, [solutionId, source, anchorId]);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Not `pageRuntime.validateExpression`: that one declares the PAGE service
  // registry (`page`, `activities`), so `services.notify.*` and
  // `services.geo.*` — which the server does register — would validate as
  // unknown modules and the Run button would refuse a script that runs fine.
  //
  // `services` is left UNDECLARED instead, which the validator treats as "this
  // host has no registry, pass service calls through untyped". The browser
  // cannot know what the server registers, and a wrong registry is worse than
  // none: it blocks valid scripts. Service errors then surface at run time.
  //
  // `attributes` stays banned — no activity is in flight here.
  const schema = useMemo(() => {
    const built = buildDslSchema(sdmClient.config);
    // The model collections, so `model.record_types` validates here exactly as
    // the endpoint answers it. Declared in the editor and nowhere else — the
    // page builder's dialog and every hook leave them out, which is what keeps
    // the model out of stored scripts.
    return { types: { ...built.types, ...modelSchemaTypes() } };
  }, [dataOperationId]);

  const validate = useCallback(
    (text: string) =>
      text.trim() === ''
        ? []
        : validateExpression(text, schema, {
            bannedRoots: ['attributes'],
            functions: functionSignatures(sdmClient.config),
          }),
    [schema],
  );

  // What is *shown*, which lags what is typed by the debounce.
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSettled(source), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [source]);

  const diagnostics = useMemo(() => validate(settled), [settled, validate]);
  const errors = diagnostics.filter((d) => d.severity === 'error');

  // Diagnostics as squiggles, not just a list underneath. `Diagnostic` carries
  // line and col but no end position, so each marker covers the word at that
  // point — enough to place the error, and clicking the list jumps to it.
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed) return;
    const model = ed.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      'fluxscript',
      diagnostics.map((d) => {
        const word = model.getWordAtPosition({ lineNumber: d.line, column: d.col });
        return {
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.line,
          startColumn: d.col,
          endLineNumber: d.line,
          endColumn: word ? word.endColumn : d.col + 1,
        };
      }),
    );
  }, [diagnostics]);

  // Run acts on the SELECTION if there is one, otherwise the whole buffer —
  // the convention every SQL tool teaches. No separator token and no statement
  // splitting: one run, one request, one result.
  const selectedText = useCallback((): string => {
    const ed = editorRef.current;
    if (!ed) return source;
    const sel = ed.getSelection();
    const picked = sel && !sel.isEmpty() ? ed.getModel()?.getValueInRange(sel) ?? '' : '';
    return picked.trim() !== '' ? picked : source;
  }, [source]);

  const run = useCallback(async () => {
    if (!dataOperationId || running) return;
    const text = selectedText().trim();
    if (text === '') return;
    // Validate the text being run, now — not the debounced verdict, which may
    // be up to 300 ms behind, and which was formed over the whole buffer while
    // a run may carry only the selection.
    const live = validate(text).filter((d) => d.severity === 'error');
    if (live.length > 0) {
      setSettled(source);
      return;
    }
    setRunning(true);
    setSelected(null);
    try {
      const r = await sdmClient.runScript({ source: text, recordId: anchorId.trim() || undefined });
      setResult(r);
      setResultsOpen(true);
      if (!r.error) setLastGood(r);
    } catch (e) {
      // Transport and gate failures throw; a failed SCRIPT comes back as a
      // result carrying `error`, so those two stay distinguishable.
      setResult({
        value: null,
        elapsedMs: 0,
        error: { kind: 'runtime', message: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      setRunning(false);
    }
  }, [anchorId, dataOperationId, running, selectedText, source, validate]);

  // Cmd/Ctrl+Enter, bound on the editor rather than the document so it does not
  // fire from elsewhere in the Console.
  const onMount = (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { void runRef.current(); });
    // Monaco's selection changes do not re-render React, so without this the
    // button keeps saying "Run" while Run-on-selection is what will happen.
    ed.onDidChangeCursorSelection((e) => setHasSelection(!e.selection.isEmpty()));
  };
  const runRef = useRef(run);
  runRef.current = run;

  // Picking an operation re-opens the solution against that partition and bumps
  // scopeVersion — the same act the workbench performs, so the two agree on
  // which operation is current. The remount that follows discards the editor
  // contents; persistence is deferred (SPEC §11) and this is the known cost.
  async function selectOperation(operationId: string | null) {
    if (!solutionId) return;
    setScopeError(null);
    try {
      await openSolution(solutionId, operationId);
      shellStore.set((prev) => ({ ...prev, dataOperationId: operationId, scopeVersion: prev.scopeVersion + 1 }));
    } catch (e) {
      setScopeError(e instanceof Error ? e.message : String(e));
    }
  }

  // clipboard is undefined in an insecure context and writeText can reject;
  // neither should surface as an unhandled rejection.
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  function copy(label: string, text: string) {
    try {
      void navigator.clipboard?.writeText(text).catch(() => setCopied('Copy failed —'));
    } catch {
      setCopied('Copy failed —');
    }
    setCopied(label);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1200);
  }

  const activities = useMemo(() => {
    const out: { activity: ActivityDef; typeId: string }[] = [];
    for (const rt of sdmClient.adapter.listRecordTypes()) {
      const def = pageRuntime.findRecordType(rt.id);
      for (const a of def?.workflow.activities ?? []) out.push({ activity: a, typeId: rt.id });
    }
    return out.sort((a, b) => a.activity.name.localeCompare(b.activity.name));
  }, [dataOperationId]);

  const anchorRecord: RecordInstance | null = useMemo(() => {
    if (!anchorId.trim()) return null;
    try { return sdmClient.adapter.getRecord(anchorId.trim()); } catch { return null; }
    // sdmClient.adapter is the live snapshot; `result` is in the deps because a
    // run is the moment the anchor could have started resolving.
  }, [anchorId, result]);

  if (!dataOperationId) {
    return (
      <div className="dsl-empty">
        <p className="dsl-empty-title">No operation chosen</p>
        <p className="dsl-empty-hint">Scripts run against one operation's records. Pick one to start.</p>
        <OperationSelect value={dataOperationId} operations={dataOperations} onChange={selectOperation} />
        {scopeError && <p className="dsl-error-text">{scopeError}</p>}
      </div>
    );
  }

  // The inspected row lives here rather than inside ResultPane: the panel is a
  // column of the whole view, so it keeps full height instead of being confined
  // to whatever the splitter left the results.
  const inspected = useMemo(() => {
    const body = result?.error ? lastGood : result;
    const rows = body ? asRows(body.value) : null;
    return rows && selected !== null ? rows.slice(0, DISPLAY_CAP)[selected] ?? null : null;
  }, [result, lastGood, selected]);

  const showResults = resultsOpen && result !== null;

  return (
    <div className="dsl">
     <div className="dsl-main">
      <div className="dsl-bar">
        <OperationSelect value={dataOperationId} operations={dataOperations} onChange={selectOperation} />
        <input
          className="dsl-input"
          placeholder="anchor record id (optional)"
          value={anchorId}
          onChange={(e) => setAnchorId(e.target.value)}
          title="Sets context.record. Leave empty and context.record is null."
        />
        <div className="dsl-bar-spacer" />
        <button className="dsl-btn dsl-btn--ghost" onClick={() => setActivityPick(true)}>
          Run activity…
        </button>
        <button className="dsl-btn" onClick={() => void run()} disabled={running || errors.length > 0}>
          {running ? 'Running…' : hasSelection ? 'Run selection ▸' : 'Run ▸'}
        </button>
      </div>

      <div className="dsl-editor" style={showResults ? { flex: `0 0 ${splitPct}%` } : { flex: '1 1 auto' }}>
        <Editor
          language={FLUXSCRIPT}
          theme="vs"
          value={source}
          beforeMount={registerFluxscript}
          onMount={onMount}
          onChange={(v) => setSource(v ?? '')}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            wordWrap: 'on',
            overviewRulerLanes: 0,
            placeholder: PLACEHOLDER,
          }}
        />
      </div>

      {showResults && <Splitter onDrag={setSplitPct} />}

      {diagnostics.length > 0 && (
        <div className="dsl-diagnostics">
          <div className="dsl-diagnostics-head">
            <span className="dsl-status-meta">
              {errors.length > 0 ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : 'Warnings'}
            </span>
            <button
              className="dsl-link"
              onClick={() =>
                copy(
                  'Errors',
                  diagnostics.map((d) => `${d.severity} [${d.line}:${d.col}] ${plainMessage(d.message)}`).join('\n'),
                )
              }
            >
              Copy all
            </button>
          </div>
          {diagnostics.map((d, i) => (
            <div key={i} className={`dsl-diag dsl-diag--${d.severity}`}>
              <button
                className="dsl-diag-text"
                onClick={() => {
                  editorRef.current?.setPosition({ lineNumber: d.line, column: d.col });
                  editorRef.current?.focus();
                }}
              >
                {d.severity} [{d.line}:{d.col}] {plainMessage(d.message)}
              </button>
              <button
                className="dsl-link dsl-diag-copy"
                title="Copy this message"
                onClick={() => copy('Error', `${d.severity} [${d.line}:${d.col}] ${plainMessage(d.message)}`)}
              >
                copy
              </button>
            </div>
          ))}
        </div>
      )}

      {showResults ? (
        <ResultPane
          result={result}
          lastGood={lastGood}
          selected={selected}
          onSelect={setSelected}
          onCopy={copy}
          copied={copied}
          onClose={() => { setResultsOpen(false); setSelected(null); }}
          onJump={(line, col) => {
            editorRef.current?.setPosition({ lineNumber: line, column: col });
            editorRef.current?.focus();
          }}
        />
      ) : (
        result && (
          <button className="dsl-reopen" onClick={() => setResultsOpen(true)}>
            Show results{result.rowCount !== undefined ? ` (${result.rowCount} rows)` : ''}
          </button>
        )
      )}
     </div>

      {inspected !== null && (
        <>
        <SideSplitter width={inspectorPx} onDrag={setInspectorPx} />
        <div className="dsl-inspector" style={{ width: inspectorPx }}>
          <div className="dsl-inspector-header">
            <span>Row {(selected ?? 0) + 1}</span>
            <div>
              <button className="dsl-link" onClick={() => copy('Row', JSON.stringify(inspected, null, 2))}>Copy</button>
              <button className="dsl-dialog-close" onClick={() => setSelected(null)}>✕</button>
            </div>
          </div>
          <pre className="dsl-inspector-body">{jsonTokens(JSON.stringify(inspected, null, 2))}</pre>
        </div>
        </>
      )}

      {activityPick && (
        <ActivityPicker
          activities={activities}
          onClose={() => setActivityPick(false)}
          onPick={(a) => { setActivityPick(false); setRunningActivity(a); }}
          anchorTypeRef={anchorRecord?.typeRef ?? null}
        />
      )}

      {runningActivity && (
        <ActivityFormModal
          activity={runningActivity.activity}
          anchorRecord={anchorRecord}
          // The activity's OWNING type, which is what resolves reference
          // display labels — not the anchor's type, which differs whenever the
          // anchor is of another type and is empty for a CREATE.
          recordTypeId={runningActivity.typeId}
          host={pageRuntime.captureHost}
          onClose={() => setRunningActivity(null)}
          onSubmit={async (captured, options): Promise<RunActivityResult> => {
            const r = await sdmClient.runActivity({
              activityId: runningActivity.activity.id,
              recordId: anchorRecord?.id,
              attributes: captured,
              waived: options?.waived,
              acknowledgedWarnings: options?.acknowledgedWarnings,
            });
            // 'needs-confirmation' stays open — the form turns it into its own
            // Continue/Cancel decision, so closing here would discard it.
            if (r.status === 'done') setRunningActivity(null);
            return r;
          }}
        />
      )}
    </div>
  );
}

/** The drag handle between editor and results. Percentages of the container so
 *  the split survives a window resize; clamped so neither half can be dragged
 *  out of existence. */
function Splitter({ onDrag }: { onDrag: (pct: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function start(e: ReactPointerEvent<HTMLDivElement>) {
    const parent = ref.current?.parentElement;
    const editorEl = ref.current?.previousElementSibling;
    if (!parent || !editorEl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = parent.getBoundingClientRect();
    // Measured from the EDITOR's top, not the container's: the toolbar sits
    // above it, so taking the container's top made the first pointer move off
    // by the toolbar's height and the grid jumped down to close the gap. The
    // denominator stays the container height, which is what the editor's
    // flex-basis percentage resolves against.
    const top = editorEl.getBoundingClientRect().top;
    const move = (ev: PointerEvent) => {
      const pct = ((ev.clientY - top) / box.height) * 100;
      onDrag(Math.min(80, Math.max(15, pct)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  return <div ref={ref} className="dsl-splitter" onPointerDown={start} />;
}

/** Width drag for the inspector. Measured from the right edge of the view, so
 *  it tracks the pointer whichever way the window is sized; clamped so the
 *  panel cannot be dragged shut or over the grid. */
function SideSplitter({ width, onDrag }: { width: number; onDrag: (px: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function start(e: ReactPointerEvent<HTMLDivElement>) {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = parent.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      onDrag(Math.min(box.width - 260, Math.max(220, box.right - ev.clientX)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  return (
    <div
      ref={ref}
      className="dsl-side-splitter"
      onPointerDown={start}
      title={`${Math.round(width)}px`}
    />
  );
}

function OperationSelect({
  value, operations, onChange,
}: {
  value: string | null;
  operations: { id: string; name: string }[];
  onChange: (id: string | null) => void;
}) {
  // The Console's own picker. @fluxus/workbench exports only Workbench,
  // workbenchCss and useWorkbench, and its OperationPicker takes no props — it
  // reads useWorkbench(), so it cannot be mounted outside a WorkbenchProvider.
  return (
    <select className="dsl-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No operation</option>
      {operations.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

function ActivityPicker({
  activities, onPick, onClose, anchorTypeRef,
}: {
  activities: { activity: ActivityDef; typeId: string }[];
  onPick: (a: { activity: ActivityDef; typeId: string }) => void;
  onClose: () => void;
  /** The anchor's record type, so an activity that needs one it does not match
   *  is called out before it is submitted with no record. */
  anchorTypeRef: string | null;
}) {
  const [filter, setFilter] = useState('');
  const shown = activities.filter(
    (a) => a.activity.name.toLowerCase().includes(filter.toLowerCase()) || a.typeId.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="dsl-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dsl-dialog">
        <div className="dsl-dialog-header">
          <span className="dsl-dialog-title">Run an activity</span>
          <button className="dsl-dialog-close" onClick={onClose}>✕</button>
        </div>
        <input className="dsl-input dsl-input--wide" autoFocus placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="dsl-activity-list">
          {shown.map(({ activity, typeId }) => (
            <button key={`${typeId}:${activity.id}`} className="dsl-activity" onClick={() => onPick({ activity, typeId })}>
              <span className="dsl-activity-name">{activity.name}</span>
              <span className="dsl-activity-meta">
                {typeId} · {activity.record_map ?? 'log only'}
                {needsAnchor(activity, typeId, anchorTypeRef) && (
                  <span className="dsl-activity-warn"> · needs an anchor record of {typeId}</span>
                )}
              </span>
            </button>
          ))}
          {shown.length === 0 && <p className="dsl-empty-hint">Nothing matches.</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Some validator messages are written for a hook author — "move update() to the
 * after hook", "mutations run in after hooks". There is no hook here and no
 * after hook to move anything to, so they are restated. The message is rewritten
 * at the point of display rather than in @fluxus/dsl, where it is correct for
 * every other caller.
 */
function plainMessage(message: string): string {
  if (/after hook/i.test(message)) {
    return message.replace(/\s*—.*$/, '') + ' — this tool is read-only; change data by running an activity';
  }
  return message;
}

/** Anything but CREATE runs against an existing record, so without a matching
 *  anchor it would submit with `recordId: undefined` and fail in the engine
 *  rather than here. Said in the picker, not enforced — the anchor can be set
 *  after seeing this. */
function needsAnchor(activity: ActivityDef, typeId: string, anchorTypeRef: string | null): boolean {
  if (activity.record_map === 'CREATE') return false;
  return anchorTypeRef !== typeId;
}

// ── Results ──────────────────────────────────────────────────────────────────

function ResultPane({
  result, lastGood, selected, onSelect, onCopy, copied, onJump, onClose,
}: {
  result: ScriptQueryResult | null;
  lastGood: ScriptQueryResult | null;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onCopy: (label: string, text: string) => void;
  copied: string | null;
  onJump: (line: number, col: number) => void;
  onClose: () => void;
}) {
  // The host renders this only once there is a result, so `result` is never
  // null here — the guard is for the type, not for a state that occurs.
  if (!result) return null;

  // On a failure the status strip carries the error and the body keeps showing
  // the last result that had one.
  const body = result.error ? lastGood : result;
  const rows = body ? asRows(body.value) : null;
  const columns = rows ? columnsOf(rows) : null;
  const shown = rows ? rows.slice(0, DISPLAY_CAP) : null;

  return (
    <div className="dsl-results">
      <div className="dsl-status">
        {result.error ? (
          <button
            className="dsl-status-error"
            onClick={() => { if (result.error?.line) onJump(result.error.line, result.error.col ?? 1); }}
          >
            {result.error.kind === 'compile' ? 'Did not compile' : 'Failed to run'}
            {result.error.line ? ` [${result.error.line}:${result.error.col ?? 1}]` : ''} — {result.error.message}
          </button>
        ) : (
          <span className="dsl-status-meta">
            {result.rowCount !== undefined ? `${result.rowCount} row${result.rowCount === 1 ? '' : 's'}` : 'value'}
            {' · '}{result.elapsedMs} ms
            {shown && rows && rows.length > shown.length ? ` · showing first ${DISPLAY_CAP}` : ''}
          </span>
        )}
        <div className="dsl-status-actions">
          {copied && <span className="dsl-copied">{copied} copied</span>}
          {result.error ? (
            <button className="dsl-link" onClick={() => onCopy('Error', result.error!.message)}>Copy error</button>
          ) : (
            <>
              <button className="dsl-link" onClick={() => onCopy('JSON', JSON.stringify(rows ?? result.value, null, 2))}>Copy JSON</button>
              {rows && <button className="dsl-link" onClick={() => onCopy('CSV', toCsv(rows, columns!))}>Copy CSV</button>}
            </>
          )}
          <button className="dsl-dialog-close" title="Close results" onClick={onClose}>✕</button>
        </div>
      </div>

      {body && (
        <div className="dsl-output">
          {shown && columns && shown.length === 0 ? (
            <p className="dsl-empty-hint dsl-no-rows">No rows.</p>
          ) : shown && columns ? (
            <div className="dsl-grid-wrap">
              <table className="dsl-grid">
                <thead>
                  <tr>
                    {/* The row-number gutter, as every grid of this kind has:
                        sticky through horizontal scroll, and a click selects
                        the row the same as clicking its cells. */}
                    <th className="dsl-rownum dsl-rownum--head" />
                    {columns.map((c) => <th key={c}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i} className={selected === i ? 'is-selected' : ''} onClick={() => onSelect(selected === i ? null : i)}>
                      <td className="dsl-rownum">{i + 1}</td>
                      {columns.map((c) => (
                        <td
                          key={c}
                          title="Double-click to copy"
                          onDoubleClick={(e) => { e.stopPropagation(); onCopy('Cell', cellText(r[c])); }}
                        >
                          {cell(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="dsl-value">{format(body.value)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Grid or value, by one rule, over every row shape the evaluator emits.
 *
 * Three have to work. `records.<type>` with no projection returns DslRecord
 * objects — { id, type, fields } — which would otherwise draw three columns, so
 * `fields` is flattened up. `.select()` already returns flat rows. And a list
 * of scalars gets a single value column.
 *
 * **The decision is made over the whole array, not over row 0.** A field that
 * is optional gives an array whose first element is an object and whose later
 * ones are null — `values(photo_field)` across records where some are unset is
 * the everyday case — and judging by the first element alone then walked every
 * row expecting an object.
 */
function asRows(value: unknown): Row[] | null {
  if (!Array.isArray(value)) return null;
  // An empty list is still a list: the grid says "no rows" rather than the
  // value pane printing `[]`.
  if (value.length === 0) return [];
  const anyObject = value.some((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
  if (!anyObject) return value.map((v) => ({ value: v }));
  return value.map((v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { value: v };
    const o = v as Row;
    return isDslRecord(o) ? { id: o.id, ...(o.fields as Row) } : o;
  });
}

/** A DslRecord as the host emits it, not a record type with fields of those
 *  names: `type` must be a string and `fields` a plain object. */
function isDslRecord(o: Row): boolean {
  return (
    'id' in o && 'type' in o && 'fields' in o &&
    typeof o.type === 'string' &&
    !!o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)
  );
}

/** Union of the keys present, in first-seen order — rows need not agree on
 *  their shape, and one that lacks a column reads as absent, not as null. */
function columnsOf(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    for (const k of Object.keys(r)) seen.add(k);
  }
  return [...seen];
}

/** null, empty string and absent must not look alike — reading one for another
 *  is how a wrong conclusion gets drawn off a result set. */
function cell(v: unknown) {
  if (v === undefined) return <span className="dsl-nil">—</span>;
  if (v === null) return <span className="dsl-nil">null</span>;
  if (v === '') return <span className="dsl-nil">(empty)</span>;
  if (typeof v === 'object') return <span className="dsl-obj">{JSON.stringify(v)}</span>;
  return String(v);
}

/** What a cell copies: the value as text, not the placeholder the grid draws
 *  for null and empty. */
function cellText(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * Colour the pretty-printed JSON. Tokenised with one regex over the output of
 * `JSON.stringify`, which is already well-formed — so this only has to tell
 * the token kinds apart, not parse. A key is a string followed by a colon.
 *
 * Deliberately not a highlighting library: the input is our own serializer's
 * output, and the panel shows one record.
 */
const JSON_TOKEN = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function jsonTokens(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  JSON_TOKEN.lastIndex = 0;
  while ((m = JSON_TOKEN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [raw, key, str, bool, nul, num] = m;
    const cls = key ? 'j-key' : str ? 'j-str' : bool ? 'j-bool' : nul ? 'j-null' : num ? 'j-num' : '';
    out.push(<span key={m.index} className={cls}>{raw}</span>);
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function format(v: unknown): string {
  if (v === undefined) return 'no value';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

function toCsv(rows: Row[], columns: string[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

export const DslEditorView = DslEditorViewComponent;

// Monaco's own stylesheet is injected once by the Shell — both editor surfaces
// need it and neither owns it.
export const css = `
  /* Light, unlike the rest of the Console chrome. This is a data surface — the
     workbench next door is light for the same reason — and reading a result
     grid and formatted JSON for any length of time is what it is for. The
     palette is the workbench's, so the two Data sections match.

     Everything is stated explicitly rather than taken from the shell's
     variables, which carry the dark values. */

  .dsl {
    display: flex;
    flex: 1;
    min-height: 0;
    background: #fff;
    color: #0f172a;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .dsl *, .dsl *::before, .dsl *::after { box-sizing: border-box; }
  .dsl-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }

  .dsl-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  .dsl-bar-spacer { flex: 1; }
  .dsl-select, .dsl-input {
    background: #fff; color: #0f172a; border: 1px solid #cbd5e1;
    border-radius: 3px; font-size: 0.78rem; padding: 3px 8px;
  }
  .dsl-input { width: 200px; }
  .dsl-input--wide { width: auto; margin: 0 14px 8px; }
  .dsl-btn { background: #0e639c; border: none; border-radius: 3px; color: #fff; cursor: pointer; font-size: 0.78rem; padding: 4px 14px; }
  .dsl-btn:disabled { opacity: 0.4; cursor: default; }
  .dsl-btn--ghost { background: #fff; border: 1px solid #cbd5e1; color: #334155; }

  .dsl-editor { flex: 0 0 45%; min-height: 80px; }
  /* The splitters read as ordinary 1px borders. A 1px grab target is unusable,
     so each carries an invisible overlay a few pixels either side — the hit
     area is 7px, the thing you see is a border. */
  .dsl-splitter, .dsl-side-splitter {
    position: relative;
    flex-shrink: 0;
    background: #e2e8f0;
    z-index: 1;
  }
  .dsl-splitter { height: 1px; cursor: row-resize; }
  .dsl-side-splitter { width: 1px; cursor: col-resize; }
  .dsl-splitter::after, .dsl-side-splitter::after {
    content: '';
    position: absolute;
    inset: -3px;
  }
  .dsl-splitter:hover, .dsl-side-splitter:hover { background: #94a3b8; }

  .dsl-diagnostics { max-height: 96px; overflow-y: auto; border-top: 1px solid #e2e8f0; background: #fffbfa; padding: 4px 12px; }
  .dsl-diagnostics-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 2px; }
  .dsl-diag { display: flex; align-items: baseline; gap: 8px; width: 100%; font-family: ui-monospace, monospace; font-size: 0.72rem; padding: 1px 0; }
  .dsl-diag-text { flex: 1; text-align: left; background: none; border: none; cursor: pointer; color: inherit; font: inherit; padding: 0; }
  .dsl-diag-copy { flex-shrink: 0; font-family: system-ui, sans-serif; }
  .dsl-diag--error { color: #b91c1c; }
  .dsl-diag--warning { color: #a16207; }

  .dsl-results { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid #e2e8f0; }
  .dsl-results--idle { align-items: center; justify-content: center; }
  .dsl-status { display: flex; align-items: center; gap: 10px; padding: 5px 12px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; font-size: 0.72rem; }
  .dsl-status-meta { color: #64748b; }
  .dsl-status-error { flex: 1; text-align: left; background: none; border: none; cursor: pointer; color: #b91c1c; font-size: 0.72rem; font-family: ui-monospace, monospace; }
  .dsl-status-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .dsl-copied { color: #64748b; font-style: italic; }
  .dsl-link { background: none; border: none; color: #0e639c; cursor: pointer; font-size: 0.72rem; padding: 0; }
  .dsl-link:hover { text-decoration: underline; }

  .dsl-output { flex: 1; min-height: 0; display: flex; }
  .dsl-grid-wrap { flex: 1; min-width: 0; overflow: auto; }
  .dsl-grid { border-collapse: collapse; font-size: 0.75rem; width: max-content; min-width: 100%; }
  .dsl-grid th, .dsl-grid td { border-bottom: 1px solid #e2e8f0; padding: 3px 10px; text-align: left; white-space: nowrap; }
  .dsl-grid th { position: sticky; top: 0; z-index: 2; background: #f1f5f9; color: #475569; font-weight: 600; }

  .dsl-grid .dsl-rownum {
    position: sticky; left: 0; z-index: 1;
    width: 1%; padding: 3px 8px;
    background: #f1f5f9; border-right: 1px solid #e2e8f0;
    color: #94a3b8; font-variant-numeric: tabular-nums; text-align: right;
    user-select: none;
  }
  .dsl-grid th.dsl-rownum--head { z-index: 3; }
  .dsl-grid tbody tr:hover .dsl-rownum { background: #e2e8f0; color: #475569; }
  .dsl-grid tbody tr.is-selected .dsl-rownum { background: #bfdbfe; color: #1e3a8a; font-weight: 600; }
  .dsl-grid tbody tr { cursor: pointer; }
  .dsl-grid tbody tr:hover { background: #f8fafc; }
  .dsl-grid tbody tr.is-selected { background: #dbeafe; }
  .dsl-nil { color: #94a3b8; font-style: italic; }
  .dsl-obj { color: #7c3aed; }
  .dsl-value { flex: 1; margin: 0; padding: 12px; overflow: auto; font-size: 0.78rem; color: #0f172a; font-family: ui-monospace, monospace; }

  .dsl-inspector { flex-shrink: 0; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; min-height: 0; background: #f8fafc; }
  .dsl-inspector-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 10px; border-bottom: 1px solid #e2e8f0; font-size: 0.72rem; color: #64748b; }
  .dsl-inspector-body { margin: 0; padding: 10px; overflow: auto; font-size: 0.72rem; color: #334155; font-family: ui-monospace, monospace; }
  .dsl-inspector-body .j-key { color: #0b6b8f; }
  .dsl-inspector-body .j-str { color: #0a7d3f; }
  .dsl-inspector-body .j-num { color: #b45309; }
  .dsl-inspector-body .j-bool { color: #7c3aed; }
  .dsl-inspector-body .j-null { color: #94a3b8; font-style: italic; }

  .dsl-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; background: #fff; color: #0f172a; }
  .dsl-empty-title { margin: 0; font-size: 0.875rem; font-weight: 600; }
  .dsl-empty-hint { margin: 0; font-size: 0.75rem; color: #64748b; max-width: 34em; }
  .dsl-no-rows { padding: 14px; }
  .dsl-results--idle { position: relative; }
  .dsl-results-close { position: absolute; top: 6px; right: 10px; }
  .dsl-reopen {
    flex-shrink: 0; background: #f8fafc; border: none; border-top: 1px solid #e2e8f0;
    color: #0e639c; cursor: pointer; font-size: 0.72rem; padding: 5px 12px; text-align: left;
  }
  .dsl-reopen:hover { background: #f1f5f9; }
  .dsl-error-text { margin: 0; font-size: 0.75rem; color: #b91c1c; }

  .dsl-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .dsl-dialog { width: 460px; max-width: 92vw; background: #fff; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.2); display: flex; flex-direction: column; }
  .dsl-dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px; }
  .dsl-dialog-title { font-size: 0.85rem; font-weight: 600; }
  .dsl-dialog-close { background: none; border: none; color: #64748b; cursor: pointer; font-size: 0.8rem; }
  .dsl-activity-list { max-height: 320px; overflow-y: auto; padding: 0 8px 10px; }
  .dsl-activity { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; background: none; border: none; border-radius: 3px; cursor: pointer; padding: 5px 8px; text-align: left; }
  .dsl-activity:hover { background: #f1f5f9; }
  .dsl-activity-name { font-size: 0.78rem; color: #0f172a; }
  .dsl-activity-meta { font-size: 0.68rem; color: #64748b; }
  .dsl-activity-warn { color: #a16207; }
`;
