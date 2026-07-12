# tt_todo — TT's running queue

Working agreement: TT dumps new items into **Inbox** as they come up; Claude
reviews outstanding items at the start of each session (at least asks the
question), moves resolved ones to Done with a date and a pointer, and keeps
this file honest.

## Inbox (new, unsorted)

_(empty — add freely)_

## Outstanding

- [ ] **RBAC** (record level + activity level) — big open design. Strict default
  floated: no access unless specified. Open questions: who sets access and the
  change-management process around it (review → approve → publish, "cooked in");
  write-time + runtime checking + auditing; org/domain-based, possibly a
  review-body model for sensitive record types (like PII classifications by
  regulators/standards bodies) with domain-specific rules alongside. Goal: a
  single implementer can do full stack. Groundwork that already exists: the
  activity-level availability gate (fail-closed, server-enforced since Phase 4)
  is the enforcement point role rules will plug into; blocked on auth
  (`context.user` is still the demo stub).
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
- [ ] **Config authoring flow** — partially superseded by Phase 4: the SDM
  config is now a stored, save-time-validated artifact (`config.put`), but the
  workbench still reads local `config.ts` until backend stage 2, and the
  authoring tool/flow (AI-assisted editing against a running server) is the
  still-open "config distribution" thread on the ROADMAP.
- [ ] **Offline capability?** — open question (added 2026-07-12). Worth noting
  when it's discussed: the browser hosts already run the full engine locally,
  and the dev database (PGlite) is Postgres compiled to WASM that also runs
  in-browser — the pieces for an offline-first client with sync exist, but
  sync/conflict semantics against the activity stream would be the real design.

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
