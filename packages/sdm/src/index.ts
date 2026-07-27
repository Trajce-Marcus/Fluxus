// @fluxus/sdm's library face. The package is the Runtime app (src/main.tsx),
// but since M15 it also *supplies* the workbench as a component for the
// Console to mount (CONSOLE_RUNTIME_SPEC §4). It stays here rather than
// becoming its own package until a second host wants it — a package
// extraction needs a name endorsement.

export { Workbench, css as workbenchCss, type WorkbenchProps } from './workbench/Workbench';
export { useWorkbench } from './workbench/WorkbenchContext';
