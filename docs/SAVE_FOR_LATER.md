# Save for later — spec

**Status:** spec, not built. On hold while the user thinks it over
(2026-10-11). Rewritten the same day to the user's design: a flag on the
workflow's activity entry, not a button on every form.

## What it does

Some activities ask questions that can't all be answered in one go — the
inspections solution's Inspection Details asks about the roof and whether gas
is connected, some answerable at the start of a visit and some only at the end.
Today the form is all or nothing: answer every mandatory question, or cancel
and lose what was typed.

An activity flagged **save for later** in a workflow gets a **Save for later**
button on its form. It stores the answers entered so far in the browser and
closes the form, without running the activity. When the activity is opened
again on the same record, the saved answers are filled back in and the person
carries on. Mandatory questions stay mandatory: Submit still needs them all.

## The user's rulings (2026-10-11)

- **Only flagged activities get it** — a flag on the workflow's activity entry.
- **Mandatory stays mandatory.** Saved answers are kept, never submitted.
- **Kept in the browser**, not on the server. The answers are on that device
  only; clearing the browser loses them.
- **The whole form is saved and restored.** If someone else changes the record
  meanwhile, submitting the restored answers can overwrite their change.
  Accepted.

## The flag

- `save_for_later: true` on an entry in a workflow's activity list
  (`ActivityUsage`, `engine/src/types.ts` — an object so that settings per
  workflow could be added later; this is the first). *Name proposed, not yet
  agreed.*
- Not allowed on a CREATE — a half-made record has no record to file its
  answers under. Refused when the model is saved.
- Shipped to the browser with the workflow (`projectConfig` names each field
  it copies, so the flag is added there).
- Set in the Console's workflow editor: a **Save for later** checkbox on each
  activity in the list. *Proposed, not yet agreed.*

## The form

- **Save for later** sits beside Submit and Cancel. It stores the answers as
  they stand, skipping the mandatory and validation checks, and closes the form.
- **Opening** a flagged activity on a record with saved answers fills them back
  in, with a line saying when they were saved and a **Discard** link that
  drops them and starts the form afresh.
- **Saved answers go** when the activity is submitted and recorded, or on
  Discard. Cancel keeps them.
- Stored per operation, activity and record, in the browser's local storage
  (`fluxus:page-runtime:saved-form:<operation>:<activity>:<record>`).

## Details the build must get right (from the cold review of the first draft)

- **List choices** keep the name shown beside the stored value, so a restored
  answer doesn't show a raw id.
- **A run whose after hook failed** was still recorded, so its saved answers
  are cleared — otherwise a second Submit runs it twice.
- **Save for later waits for a photo upload to finish**, or the photo is
  dropped.
- **One store in the shared form code** (`page-runtime`), which each place that
  shows the form connects to its operation.
- **The planned clean-up of unused uploads** must not delete photos held in
  saved answers.

## Not in this

Create activities; saving on the server; any sign elsewhere that a form has
saved answers; expiring old saved answers.
