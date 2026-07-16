# tt_todo — TT's running queue

Working agreement: TT dumps new items into **Inbox** as they come up; Claude
reviews outstanding items at the start of each session (at least asks the
question), moves resolved ones to Done with a date and a pointer, and keeps
this file honest.

## Inbox (new, unsorted)

_(empty — add freely)_

## Outstanding

- [ ] **RBAC** (record level + activity level) — big open design. **Design
  draft under review: [docs/RBAC_DESIGN.md](RBAC_DESIGN.md)** (rev 2, 2026-07-14).
  Shape so far: three surfaces (record type `read` role-list / activity access =
  the availability gate expression / page `open` role-list); strict-by-default
  for record types + pages, open-by-default for activities; implementer plane =
  read/write/admin; roles declared in config, assignments via an admin tool;
  row-level read conditions deferred. Still open in the draft: gate double-duty,
  anchor-readability, page client-only enforcement interim, role registry home.
  Blocked on auth (`context.user` is still the demo stub). Original notes: who
  sets access and change-management (review → approve → publish, "cooked in");
  write-time + runtime checking + auditing; a possible review-body model for
  sensitive record types (PII classifications by regulators/standards bodies).
- [ ] **External integrations** — not yet designed. Inbound largely exists now:
  headless `activities.run` (Phase 4) is exactly how an external system would
  deliver a new work order. Outbound (sending completed-WO info) has the
  pattern (`queue` service dispatch post-commit / the outbox) but no real
  gateway modules. Needs a session.
- [ ] **Workbench activity bar** — like the page builder's. (Workbench UI
  changes get proposed before building.)
- [ ] **Workflow manager** for the workbench — list workflows, view/edit
  definitions as JSON, run activities; needs scoping. Related parked item:
  one-way workflow visualisation (ROADMAP).
- [ ] **Attribute type with edit ≠ display component** — e.g. Yes/No/NA as
  radio buttons.
- [ ] **Essential 8 assessment** — how the platform does/doesn't abide; not
  yet assessed.
- [ ] **FluxScript comprehensive doc** — implementer-facing guide (variables
  in hooks, the four roots, patterns). The mechanics already work (`let`
  bindings since DSL Phase 2); the doc doesn't exist. GRAMMAR.md + DSL_SPEC.md
  are spec, not tutorial.
- [ ] **Config authoring flow** — narrowed further by stage 2 (2026-07-12):
  both hosts now read config from the server; local `config.ts` is only the
  seed script's input (`npm run seed:server` = the interim authoring loop:
  edit files → push up). The authoring tool/flow proper (AI-assisted editing
  against a running server) is the still-open "config distribution" thread on
  the ROADMAP.
- [ ] **PII field flag → hashing** (much later; added 2026-07-14). In a record
  type def, flag a custom field as PII so its value is protected at rest.
  Feasibility: doable as a field flag, but "hashed" (one-way) only supports
  *match*, not display or retrieval — if the value must ever be shown/read back
  it's **encryption** (reversible) or **tokenisation**, not hashing; the choice
  is per use-case. Interacts with the reporting projection (the single text
  `value` column), with search/filtering (can't `where` on a plaintext you
  don't store), and with any future row-level read conditions. Distinct from
  RBAC's row/type access (that hides whole rows; this protects a column's
  contents even from those who can read the row). Park until the access model
  and reporting layer are further along.
- [ ] **Offline capability?** — open question (added 2026-07-12). Worth noting
  when it's discussed: the browser hosts already run the full engine locally,
  and the dev database (PGlite) is Postgres compiled to WASM that also runs
  in-browser — the pieces for an offline-first client with sync exist, but
  sync/conflict semantics against the activity stream would be the real design.
  - [ ] **PDF'd reports and emailing** — there will be need to send email and sms and pdf's reports.  Initially I thought reports would be external to fluxus but could we reuse the page builder as a report builder and have a report building capability, integrated, and also a wf (non ui to create and email pdfs).  for discussion

## Done / answered

- [x] **CREATE selects + scrolls to the new record** — done 2026-07-12
  (b5e6127) via `RunActivityResult.recordId`; CSV import leaves selection alone.
- [x] **UAT component-name labels, toggleable** — done 2026-07-12 (b5e6127):
  "Labels" header toggle (`UatLabels.tsx`), ten regions badged.
- [x] **Sticky grid/detail headers** — done 2026-07-12 (b5e6127): fixed
  `panel-header` + scrolling `panel-body`, sticky grid column headers.
- [x] **Activity-level access control via show_condition, server-checked** —
  mechanism done: availability gate built 2026-07-09 (fail-closed, UI hides,
  pipeline re-checks); server-side enforcement landed with Phase 4 stage 1
  (2026-07-12 — headless callers hit the same gate; acceptance-tested). The
  `ctx.user.roles` example needs auth → folded into the RBAC item above.
- [x] **Cancel activities?** — settled as doctrine 2026-07-09:
  cancellation-as-compensation — compensate with a new activity, never delete
  history; no generic undo; a future `cancels` link on history entries may
  formalise it (sdm SPEC "Hooks"). Whether an admin console ever fronts this
  is part of the RBAC/governance discussion.
- [x] **"Is GET still a tRPC call?"** — answered 2026-07-12: GET *activities*
  (DSL_SPEC §5a) aren't built yet (their logging posture waits on the
  unified-log design); when built they ride the same tRPC surface. Meanwhile
  reads go through `records.list/get`.
- [x] **"Are we using tRPC proper?"** — yes (2026-07-12): `initTRPC` from
  `@trpc/server`, typed procedures with zod inputs, fetch adapter on Hono —
  `packages/server/src/router.ts`.
