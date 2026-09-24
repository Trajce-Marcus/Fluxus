// Performance logging (docs/PERFORMANCE_LOGGING.md) — one import for callers
// outside this folder (trpc.ts, host.ts, router.ts, db/client.ts).

export {
  currentCtx,
  newTraceId,
  parseTraceHeader,
  pushDbConnectSpan,
  recordDbQuery,
  runRequest,
  setScope,
  withSpan,
  type Outcome,
  type Side,
  type SpanRow,
} from './context';
export { classifyOutcome } from './outcome';
export { countClientQueries, timeClientConnects } from './dbWrap';
export {
  deleteSettings,
  getSettings,
  invalidateSettingsCache,
  rawSettings,
  setSettings,
  type RawSettingsRow,
  type ResolvedSettings,
  type SwitchValue,
} from './settings';
export { flushSpans, resetSweepClock } from './store';
export { buildReport, type ReportInput, type ReportResult } from './report';
