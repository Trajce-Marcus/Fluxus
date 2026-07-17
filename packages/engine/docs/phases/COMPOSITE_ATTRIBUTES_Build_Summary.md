# Composite Attributes + Section Markers — Build Summary (2026-07-18)

Point-in-time snapshot; the living truth is [SPEC.md](../SPEC.md) ("Composite
attributes and section markers"), the SDM schema note (sdm
`SDM_Schema_Reference.md` §1.5), and the GLOSSARY entries *Composite
attribute* / *Section marker*.

## Why

Digitising a real multi-stage paper form (MR014 Electrical Inspection & Test
Plan Checklist, now the `rt_inspection_checklists` demo entity) exposed the
"sideways sprawl" problem: 18 checklist questions × their OK / Reference /
Comments answer slots exploded into 54 flat single-use pool attributes, with
nothing enforcing row completeness and no grouping in the form.

## The two-iteration design (both in one day — the lesson is the point)

**First cut: grid-level composite.** One attribute per stage grid
(`type_config.items` × inline `columns`). Worked, but the user identified the
flaw after using it: the questions stopped being attributes, so
**attribute-level show_conditions between questions were lost**, and the
construct conflated presentation (the section heading) with data shape (the
row). A second review folded in a further correction: columns as *inline*
definitions duplicated what the attribute pool exists for.

**Final design: row-level composite + section markers.**

- `type: "composite"` = one question's row of answer slots.
  `type_config.attributes` = usage wrappers over **real pool attributes**
  (`attribute_ref` + per-cell `required` / `can_waive` / `validation` /
  `show_condition`) — the same shape and adapter resolution an activity's
  attribute list uses (`AttributeDef.sub_attributes` after resolve). The
  shared atoms `ok` / `ref` / `comment` are defined once in the pool.
- Questions stay ordinary usages in the activity, keeping show_conditions
  between them. No nesting (`composite` in `composite` rejected);
  `reference` sub-attributes parked (no cell-picker plumbing yet).
- **Section markers** `{ "section": "…", "description": "…" }` in the
  activity list carry the grouping: resolved to pseudo-defs of
  `type: 'section'`, rendered as headings, capture nothing, headless-rejected
  if given a value.

## Mechanics (engine-owned; hosts touched)

- Cell addressing `attr.sub`; `'.'` reserved in every key namespace
  (validateConfig). Payloads flat-dotted or nested; scripts see the nested
  object with every cell present (empty → null); history entries store
  non-empty, non-waived cells nested; waivers are per cell (dotted keys in
  `waived`). Composite keys match no custom field — rows live in history.
- Server projection flattens plain-object entry values to one
  `rpt_attributes` row per cell under the dotted key; waived cells are
  ordinary dotted-key waive rows. tRPC `activities.run` accepts both payload
  shapes.
- Workbench renders stacked, mobile-first (ruled: never the paper form's
  sideways layout; no layout hint in config). ActivityCard displays entries
  in **activity-definition order** — jsonb does not preserve key order — with
  composite cells as dotted rows.
- Tests: server headless suite covers stage gating, missing-required-cell and
  unknown-cell-path rejection, nested + dotted submission, per-cell waiver,
  and the projection rows.

## Deliberately out / parked

- Repeating rows ("add row" table type) — different construct, not needed by
  the form.
- `reference` sub-attributes; `signature`, photo, richer choice types.
- Attribute-pool scoping (single-use attributes are local in spirit) —
  raised, parked, not to be solved en passant.
- Page builder's minimal ActivityFormModal renders neither composites nor
  list/reference — pre-existing gap.
