# Record picker on a page — spec

**Status: spec, reviewed, ready to build** (2026-09-23). Written because the
shift-report build needs a manager to pick one WBS node out of 27 while filing,
and a page today offers a text box for a raw record id.

Reviewed cold on 2026-09-23; §12 records what the review changed. Every claim
below about existing code was checked against it.

## 1. What is missing today

`CaptureHost.recordPicker` is declared but nothing fills it
(`src/capture/host.ts:72`). The workbench fills it with `RecordPickerDialog` —
nine lines wrapping `RecordsGrid` in a modal. A page fills it with nothing, so
`AttributesForm.tsx:458` falls back to a plain text input and its comment says
why: *"Browsing records to choose one needs records, and a page holds none."*

The comment beside it already names the way out: *"It plugs in when a page can
reach records through a GET."* That is what this specifies.

**This is not a new attribute type.** `reference` is the type. The picker is
how a `reference` is rendered when the host can supply one.

## 2. Why the workbench's implementation cannot be reused

`RecordPickerDialog` takes a `targetTypeId` and hands it to `RecordsGrid`,
which reads the browser's full record snapshot. A page has no snapshot by
design — the capture host hands over *evaluation*, not data
(`host.ts:1-11`). Every candidate row must therefore arrive over the wire, from
a GET, the same way a `list` attribute's datasource has fetched its options since 2026-08-16.

## 3. The mechanism

A `reference` attribute gains a `datasource` config key naming the GET that
supplies candidates:

```
{ key: 'sr_wbs', type: 'reference',
  type_config: {
    field: 'rt_shift_wbs.wbs_id',
    datasource: "invoke('act_search_wbs_nodes', { project_id: context.page.record.id, term: attributes.search })",
    display_field: 'code',
  } }
```

`reference` currently allows `fk_record_type` and `field`
(`engine/src/attributeTypes.ts`). `datasource`, `display_field` and `columns`
are added to it, spelled exactly as `list` already spells them. The same setting, read by a second kind of attribute.

The target type is unchanged: it comes from the field the attribute names
(`field: 'rt_shift_wbs.wbs_id'` → that field's declaration), the 2026-09-15
rule. `fk_record_type` still works for an attribute naming no field.

An attribute with no `datasource` keeps today's behaviour — the raw id text
box. Nothing existing changes.

## 4. Searching is server-side, and the GET owns the policy

The picker exists for the case where there are too many records to list, so the
term goes to the server and the matching happens in the GET's own script. The
DSL has `like` with `%` and `_`, case-insensitive (GRAMMAR D4), so the model
author writes what "matches" means:

```
records.wbs_nodes
  .where(project_id = attributes.project_id and expired <> 'true'
         and (code like attributes.term + '%' or name like '%' + attributes.term + '%'))
  .select(id, code, name)
```

**Typing is debounced, not submitted.** 300 ms after the last keystroke, with a
minimum of 2 characters; Enter searches immediately without waiting. An
explicit "go" button was considered and rejected: it costs an extra action on
every pick, and a manager filing a shift report picks three or four times a
shift.

**There is no debounce anywhere in this package to copy.** The dropdown re-runs
its datasource whenever any form value changes, with no delay. So the search
term lives in its own state, debounced, and that state is what triggers the
fetch — the term must not ride in the form's values or every keystroke would
re-evaluate every other datasource on the form as well.

**The picker opens by calling the GET with an empty term.** What that returns is
the GET's decision, not the component's:

- six work groups — it returns all six, and nothing is ever typed;
- forty-six WBS nodes — it returns the top level, or a capped list;
- five hundred — it returns nothing, and the empty state reads *type to search*.

Putting the policy in the GET is what lets one component serve both the short
and the long case. It also removes the reason to reach for a `list` attribute
with a datasource as a substitute dropdown for references (§9).

Below the minimum character count the picker shows the empty-term result, not
an error.

## 5. What the GET must return

A list of rows, each carrying at least the stored value and something readable.
Resolved the way `list` already resolves its options:

- `key_field` — the stored value, default `id`.
- `display_field` — the readable label, default `name`.
- `columns` — optional extra fields to show as secondary text on each row, so
  `3.4` can be shown beside `Mechanized Welding`.

A row missing `key_field` is skipped, and the picker says how many were
skipped rather than silently showing fewer. **This is new behaviour, not
copied:** the dropdown's own row handling turns such a row into a blank entry
and counts it, which is a quieter version of the same bug. A result that is not
a list is an error in place of the dialog body, which *is* what the dropdown
does.

`columns` is declared as a setting on the `list` attribute and **read nowhere in
the repo** — an inert key. So the secondary text here is built by this
component, not inherited from anything working.

## 6. The label problem

`onSelect` today hands back a record, and **the form** then resolves the label
— `AttributesForm` reads the display field off the attribute's declared `field`
and asks the host to turn the id into something readable. The workbench's
dialog is a pass-through: it receives only a target type and forwards the
record the grid selected, and it never sees the display field.

On a page that resolution returns the raw id, because it reads a record
snapshot a page does not have. So the label has to come back with the choice.

**The picker supplies the label, and is told which field to use.**
`RecordPickerProps` gains the display field, and `onSelect` widens:

```ts
export interface RecordPickerProps {
  targetTypeId: string;
  /** The GET supplying candidates, from the attribute's type_config. Absent in the workbench. */
  datasource?: string;
  /** Which field of a candidate to show. From the attribute's declared field. */
  displayField?: string;
  onSelect: (value: string, label: string) => void;
  onClose: () => void;
}
```

Both callers change and nothing else does — the workbench's dialog and this
one are the only two. The workbench's passes the display field it is now given
instead of the form resolving it afterwards; behaviour there is unchanged as
long as the form keeps passing the attribute's declared field rather than the
record type's default.

## 7. Hierarchy

A WBS tree flattened to `3.4 — Mechanized Welding`, ordered by code, is what
this build needs: the code carries the hierarchy, and searching a tree is a
flat operation anyway. **No tree rendering.** If a picker over a genuinely deep
structure is wanted later, it is the GET returning a `parent_id` column and the
component learning to indent — additive, and not designed here.

## 8. Errors, loading, cancellation

The same rules `ListField` already follows, because the same
`evaluateWithGets` call to the server is underneath:

- a run overtaken by a newer one discards its answer rather than painting it;
- a GET error shows in place of the list, with the message;
- loading shows only when something is genuinely in flight — an opening search
  the GET answers without going to the server paints immediately;
- a host with no `query` makes `invoke` fail loudly, and the picker reports it.

The picked value is **not** validated against the list afterwards. Unlike a
dropdown, whose stale selection clears itself when its options change
(`AttributesForm.tsx:715-720`), a chosen record stays chosen: the candidate
list is a search result, not the set of legal values.

## 9. What this replaces

With a picker for references, declaring a `list` attribute with `key_field: 'id'` to imitate a record reference is no longer needed. `list`
keeps its own job — fixed value sets like `Day` / `Night`, and dependent
dropdowns.

## 10. Settled by the review

- **The form evaluates the datasource, not the picker.** Every existing caller
  of the evaluate-then-fetch-then-evaluate-again helper is a form field, and a
  page's other route to a GET is the component container's batched pass. The
  picker is handed rows. Having it evaluate would work — it renders inside the
  form's provider — but it would make the workbench's dialog and the page's
  dialog structurally different components rather than two fills of one slot.
- **The search term travels as an extra root, not in the form's values.** Extra
  roots already exist and are used today for `value` inside a validation rule.
  Putting the term in the form's values instead would collide silently: the
  form's values are unknown-shaped, so `attributes.term` raises no error at
  save and simply reads as blank at runtime, which is worse than failing.
- **One change is needed where a datasource is validated.** A datasource naming
  the term will not save today, because the place that checks it passes no
  extra roots. That check must learn the term's name, or every reference
  datasource is saved as an error.
- **`columns` is not worth inheriting** — it is declared and read nowhere
  (§5). Secondary text is this component's own.

## 11. What the review changed

- The claim that the workbench resolves the label was **wrong** — the form does,
  which is why the display field must now be handed to the picker (§6).
- Two of the three row-handling behaviours claimed as "the same as the
  dropdown" **do not exist** (§5).
- There is **no debounce anywhere** to copy, and the term must not live in the
  form's values (§4).
- Adding settings to the `reference` attribute is **safe and free**: validation
  only ever widens, and the place that validates a datasource does so without
  caring which attribute type it came from.

## 12. Not built

- Tree rendering, multi-select, create-from-picker ("not in the list? add it").
- Paging a long result. The GET caps; the picker does not scroll for more.
- Recently-picked or favourites.
