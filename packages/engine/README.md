# @fluxus/engine

The shared activity engine — the SDM core every host drives. One pipeline
(`runActivity`: availability gate → before hook → record_map mapping → history
append → after hook), the `Store` contract, the core SDM types, and the bridge
that wires FluxScript evaluation/validation to a live store.

**Status:** extracted from `@fluxus/sdm` at the Extraction milestone (stage 1).
Current hosts: the sdm workbench. Next host: the page builder (`run activity`
callback action — stage 2).

- Depends on `@fluxus/dsl` only. Hosts depend on this package and supply a
  `Store` implementation (or configure the bundled `LocalStorageAdapter`),
  the SDM config, and their service modules.
- No UI, no React, no host channels: selection, toasts, and warning surfaces
  belong to hosts.

Run checks: `npm run build` (typecheck). Behavioural coverage currently lives
in the sdm package's `test/dsl-wiring.test.ts` (real config, real adapter,
real evaluator) — engine-local tests arrive with the second host.

Docs: [docs/SPEC.md](docs/SPEC.md) — the living design truth.
