# @fluxus/engine

The shared activity engine — the SDM core every host drives. One pipeline
(`runActivity`: availability gate → before hook → record_map mapping → history
append → after hook), the `Store` contract, the core SDM types, and the bridge
that wires FluxScript evaluation/validation to a live store.

**Status:** Extraction milestone complete (July 2026). Two live hosts: the sdm
workbench and the page builder (`run-activity` callback action — app-triggered
runs with the `callbackData` root, hook-written entry attributes, and
`services.logger`).

- Depends on `@fluxus/dsl` only. Hosts depend on this package and supply a
  `Store` implementation (or configure the bundled `LocalStorageAdapter`),
  the SDM config, and their service modules.
- No UI, no React, no host channels: selection, toasts, and warning surfaces
  belong to hosts.

Run checks: `npm run build` (typecheck). Behavioural coverage currently lives
in the sdm package's `test/dsl-wiring.test.ts` (real config, real adapter,
real evaluator) — engine-local tests arrive with the second host.

Docs: [docs/SPEC.md](docs/SPEC.md) — the living design truth.
