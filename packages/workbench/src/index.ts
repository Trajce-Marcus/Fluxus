// @fluxus/workbench — the out-of-the-box vanilla UI every SDM gets for free
// (record type list → records grid → record view with activities), packaged as
// one component its host mounts. Extracted from the Runtime app (then
// `@fluxus/sdm`) at the package restructure; the Console is its only host
// today (CONSOLE_RUNTIME_SPEC §4).
//
// Library rule: css ships as a string (`workbenchCss`), never a stylesheet
// import — the Console mounts its shell in a shadow root.

export { Workbench, css as workbenchCss, type WorkbenchProps } from './Workbench';
export { useWorkbench } from './WorkbenchContext';
