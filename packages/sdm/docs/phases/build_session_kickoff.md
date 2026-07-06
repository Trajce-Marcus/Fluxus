# Build session kickoff prompt

*(Copy this in as the first message of the new VS Code session, with the project docs + the two POC1 files attached.)*

---

This project builds a metadata-driven operational platform (working name: Aber) configured by business users/consultants, not IT. Read `START_HERE_Project_Brief.md` first — it maps the other docs and lists decisions already made. `SDM_Schema_Reference.md` is the single source of truth for the model; flag contradictions rather than diverging. Keep answers concise and challenge ideas honestly rather than agreeing by default.

We are building the **POC1 runtime UI** (end-user surface; the admin/config builder is deferred, config is hand-edited JSON). Two files drive this cut, alongside the project docs:

1. `POC1_Runtime_UI_Scope.md` — the build brief: components, layout, app context, storage interface + adapters, the activity pipeline, and (§7) the decisions *with their reasons*. **Read §7a ("Expected behaviours — DO NOT fix these") carefully** — there are two behaviours (a captured attribute that drops silently, and a status field that never changes this cut) that are intended and must not be "fixed." They follow from model rules; patching them breaks the model.

2. `sample_inspection_type.json` — hand-edited config to build against. One Record type + workflow, with a `record_map: CREATE` activity and an ordinary capture activity. Hook *shapes* are shown but marked not-executed (stubbed this cut).

The `record_map` semantics this cut depends on are already defined in `SDM_Schema_Reference.md` §1.9 (CREATE implemented; UPDATE/DELETE reserved) — read it there; it's canonical. If anything in the build brief appears to conflict with the SDM on the *model*, the SDM wins; flag it.

**This cut (POC1·a)** builds: list Record types → grid of instances (custom fields as columns) → create via the CREATE activity → run capture activities appending history → view details + history. **Staged for later, still on the POC1 ledger, not dropped:** hooks actually firing (pipeline slots exist now, bodies stubbed), UPDATE/DELETE, default-seeding. POC1 is not "done" until at least one hook fires — don't let "POC1·a done" be mistaken for "POC1 done."

Build order is suggested in §8: storage interface + in-memory adapter (seed from the sample config), then the layout shell (header / side panel / two panels), then wire selection → the two gets → grid → CREATE → capture. Ask before building anything on the deferred list.
