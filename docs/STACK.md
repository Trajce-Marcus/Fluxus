# Fluxus — Dependency Stack Inventory

The complete third-party dependency surface across all packages, with a maturity
read on each. Purpose: no dependency should be a surprise, and the bleeding-edge
ones should be known and contained (see the standing preference for
well-established libraries — young deps only behind a seam, kept shallow).

**Keep this current:** update it in the same change that adds, removes, or
majorly bumps a dependency. Last reviewed: **2026-07-15.**

Internal `@fluxus/*` workspace packages are omitted (they are not external deps).

Maturity legend: 🟢 bedrock/established · 🟡 modern, proven, well-maintained ·
🟠 young but low-risk (dev-only / behind a seam) · 🔴 watch-item (pre-1.0 in the
prod path).

## Ships in production

| Dependency | Version | Used in | Role | Maturity |
|---|---|---|---|---|
| `react` / `react-dom` | ^18.2 | sdm, page-builder | UI runtime | 🟢 Bedrock; deliberately one major behind latest (19) |
| `pg` (node-postgres) | ^8.16 | server | Postgres driver (prod path) | 🟢 Bedrock — the standard, 15+ yrs |
| `zod` | ^3.25 | server | Input validation (tRPC procedures) | 🟢 Bedrock — ubiquitous; v3 is the mature line |
| `monaco-editor` | ^0.55 | page-builder | The VS Code editor (FluxScript editing) | 🟢 Established — Microsoft-maintained; `0.x` scheme is decade-stable |
| `@trpc/server` + `@trpc/client` | ^11.4 | server, client | The API surface | 🟡 Modern — popular, maintained; a real architectural commitment |
| `hono` | ^4.8 | server | HTTP shell (one app on Node + Lambda) | 🟡 Modern — widely adopted; fetch-native design enables the dual runtime |
| `@hono/node-server` | ^1.14 | server | Hono's Node adapter | 🟡 Modern — tied to Hono |
| `@monaco-editor/react` | ^4.7 | page-builder | React wrapper for Monaco | 🟡 Community wrapper — popular but a smaller third-party project |
| `@electric-sql/pglite` | ^0.3 | server | **Dev/test** Postgres-in-WASM | 🟠 Young (0.x) — never runs in prod (only when no `DATABASE_URL`); behind the `createDb` seam |
| `drizzle-orm` | ^0.44 | server | Query builder + schema | 🔴 **Watch-item** — pre-1.0, in the prod path; usage kept shallow (raw DDL, simple queries) so Kysely/raw `pg` stay easy fallbacks |

## Dev / build only (never ships)

| Dependency | Version | Role | Maturity |
|---|---|---|---|
| `typescript` | ^5.3 | Language | 🟢 Bedrock |
| `vite` | ^5.2 | Bundler / dev server | 🟢 Established (one major behind latest) |
| `vitest` | ^3.0 | Test runner | 🟢 Established |
| `@vitejs/plugin-react` | ^4.2 | React plugin for Vite | 🟢 Established |
| `tsx` | ^4.20 | Run TS directly (server dev/seed) | 🟢 Established |
| `drizzle-kit` | ^0.31 | Generate/apply DB migrations (server) | 🟡 Modern — pairs with `drizzle-orm`; dev-only |
| `esbuild` | ^0.25 | Bundle the Vercel function (`build:vercel`) | 🟢 Established — Vite's own transform engine; decade-stable `0.x` scheme |
| `concurrently` | ^9.1 | Run the three dev servers together | 🟢 Established |
| `@types/*` | — | Type definitions (node, react, pg) | 🟢 Bedrock |

## Posture summary

- 9 of 10 shipping deps are green or modern-but-proven; nothing in prod is exotic.
- **One genuine watch-item — `drizzle-orm` (pre-1.0)** — mitigated by the storage
  seam (`Store` / `RecordsHost`) and deliberately shallow usage.
- Two "good to know, low risk": **PGlite** (young but dev-only) and
  **@monaco-editor/react** (a community wrapper over Microsoft's editor).
- The heavyweight foundations — React, Vite, TypeScript — are each held a major
  version behind the bleeding edge on purpose.

## Rules for adding a dependency

1. Prefer boring/proven. Reach for a young library only when it earns its place
   **and sits behind a seam** so it can be swapped cheaply.
2. Keep usage of any young dep shallow; pin versions; don't chase releases.
3. Flag and weigh maturity/maintenance **before** adopting — no silent additions.
4. Update this file in the same change.
