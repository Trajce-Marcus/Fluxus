# Fluxus — Deployment

Where the platform runs outside a dev machine, and why. Companion to
[STACK.md](STACK.md) (what we depend on) and [ARCHITECTURE.md](ARCHITECTURE.md)
(how the parts connect).

## Decision (2026-07-16): Vercel now, raw AWS Lambda later if needed

**Ruling (user, 2026-07-16):** `@fluxus/server` deploys to **Vercel**
(serverless functions, Sydney `syd1`, Neon stays the database). The original
plan — raw AWS Lambda with self-managed deploy tooling (SAM/CDK/zip) — is
**deferred, not rejected**: `src/lambda.ts` stays in the repo as the warm exit
path.

### Why Vercel first

- **MVP-first:** the goal of this step is "the platform lives on a URL so real
  POCs can happen", not "own AWS infrastructure". Vercel removes the entire
  deploy-tooling decision (no SAM vs CDK vs zip) — git push deploys.
- Vercel functions **are** AWS Lambda underneath; same runtime economics,
  scale-to-zero, and the code stays fetch-native Hono either way.
- The frontends (workbench, page builder) are static Vite builds Vercel can
  host on the same push — raw Lambda leaves that unsolved.
- Free (Hobby) to start; **the moment a POC is in front of a real client or
  organisation that's commercial use — upgrade to Pro** (US$20/month) and treat
  it as the pilot's cost.

### Why the exit stays cheap (and the rules that keep it so)

The app is vendor-neutral Hono + tRPC; Neon is independent of the compute; the
API URL is client config. Moving to raw AWS later = redoing only the deploy
plumbing we skipped, plus one URL + CORS change.

**Seam rules (binding):**

1. Everything Vercel-specific lives in exactly two places:
   `packages/server/src/vercel.ts` (the entry) and
   `packages/server/vercel.json`. At deploy time `npm run build:vercel`
   (esbuild) bundles the entry into a single ESM file, `api/index.mjs` —
   Vercel serves that. The file is **committed** even though it's generated:
   Vercel discovers functions from the source checkout *before* the build
   command runs, so it must exist in git; the build regenerates it on every
   deploy, so the committed copy is only a discovery marker (stale content
   never ships). Bundling is not optional
   polish: Node's strict ESM resolution can't follow the repo's extensionless
   imports, and the workspace packages (engine, dsl) are consumed as
   TypeScript source.
2. `src/lambda.ts` is kept compiling — it is the exit, not dead code.
3. No Vercel-proprietary services (KV, cron, queues, edge middleware, blob)
   without an explicit ruling first — each is a new lock-in decision, same
   posture as adding a dependency (STACK.md rules).

**Flip triggers** (revisit the ruling if any occurs): Fluxus must run inside a
client's AWS account; we need AWS neighbours next to the compute (SQS for the
outbox, cron, etc. — currently deferred behind the unified-log design); Vercel
pricing/limits start to bite.

## Dev workflow (unchanged)

Local development stays local: root `npm run dev` (server :8787 + both hosts
on Vite) — hot reload, no deploy in the loop. The deployed instance is the
**shared/POC** instance, not where development happens.

## Environments (posture, 2026-07-16)

No formal dev/test/prod pipeline yet — deliberately (MVP-first). The tools
give us environments almost free when we want them:

- **prod** = Vercel production deployment (main branch) + the Neon main branch.
- **dev** = local `npm run dev` + a **separate Neon branch** (or PGlite).
  Splitting local dev off the deployed database is required from the first
  deploy — see below.
- **preview/test** = Vercel's automatic preview deployments per push/PR;
  Neon branch-per-preview can be automated later if ever needed.
- **tests** = in-memory PGlite (unchanged).

Hard rule from the first deploy: **local dev must not share a database with
the deployed instance.** Neon branching makes this a one-command split — the
deployed app keeps the current data (main), local `.env` repoints to a `dev`
branch.

The trigger for formalising more than that: the first POC holding data that
can't be trashed. Until then, one deployed instance + local dev is the whole
story.

## How to deploy

Vercel Git integration on the GitHub repo, project root `packages/server`
(npm-workspace aware — install runs at the repo root). Push to main → deploy:
the build command (`npm run build:vercel`, set in `vercel.json`) produces
`api/index.mjs`, the one serverless function. The function does **not**
migrate at cold start (`applyMigrations: false` — no migrations/ on disk next
to the bundle): schema changes are applied from a dev machine with
`npm run db:migrate` **before** pushing code that needs them. `DATABASE_URL`
(Neon
**pooled** connection string) is set in the Vercel project's environment
variables. Region `syd1` lives in `vercel.json`. Seeding
(`npm run seed:server`) runs from a dev machine against the same
`DATABASE_URL` — the interim config-authoring loop is unchanged.
