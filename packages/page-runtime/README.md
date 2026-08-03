# @fluxus/page-runtime

The **page runtime** (see root GLOSSARY): everything a host embeds to turn a stored page definition into working UI against live records — `PageRenderer`, `ComponentContainer`, the component registry, the page expression host, save-time `validatePage`, and the standard activity capture form. Page *editing* (layout editor, palette, Monaco) stays in `@fluxus/console`.

**Status:** extracted from the then-`@fluxus/page-builder` (now `@fluxus/console`) 2026-07-19 (first step of workbench → Runtime app). Two embedding hosts: the **Console** (editor preview + published rendering) and the **Runtime app** (published pages).

A host connects a `FluxusClient`, wraps it once at bootstrap in `createPageRuntime({ client })`, and passes the handle to `PageRenderer` — no singletons of the package's own.

Run via the repo root (`npm run dev`); this package has no dev server of its own. Design truth: [docs/SPEC.md](docs/SPEC.md).
