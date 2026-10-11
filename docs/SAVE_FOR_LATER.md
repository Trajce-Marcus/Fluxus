# Save for later — spec

**Status:** spec, not built. Asked for 2026-10-11 by the user, from the
inspections solution: Inspection Details has many mandatory questions, some
answerable at the start of the visit and some only at the end. Today the form
is all or nothing — answer every mandatory question, or cancel and lose what
was typed. Awaiting cold review.

## What this changes, in one paragraph

An activity's form gets a **Save for later** button beside Submit and Cancel.
It keeps what has been entered so far — in this browser — and closes the form
without running the activity. When the same person opens the same activity on
the same record again, the form comes back with those answers, and they finish
it and submit. Mandatory questions stay mandatory: Save for later skips the
checks, Submit does not. Nothing reaches the server until Submit, so nothing
about records, history or the activity pipeline changes.

## Rulings this spec rests on (user, 2026-10-11)

- **Mandatory questions stay mandatory.** Partial answers are kept, not
  submitted; the activity runs only when the form is complete.
- **Kept in the browser.** Not on the server: the inspector is on site with one
  device, and server storage would be a new storage mechanism. Accepted cost:
  the answers are on that device only, and clearing the browser loses them.

## 1. Today

- The capture form is one component, `AttributesForm`
  (`page-runtime/src/capture/AttributesForm.tsx`), used by Runtime pages and
  the Console page preview (`ActivityFormModal`), and by the Console workbench
  (`AvailableActivities`, `RecordsGrid`).
- Its state is a flat `values` map (composite cells under `attr.sub`) and a
  `waived` map (key → reason). An UPDATE form starts from the record's current
  field values (`AttributesForm.tsx:140`); seeded and sourced values win over
  that.
- Submit checks required questions, waiver reasons and validation rules in the
  browser, then runs the activity; the server checks again. Cancel closes and
  keeps nothing.
- An UPDATE activity can be run again for as long as its availability
  condition allows; each run adds a history entry (Inspection Details is one).

## 2. The change

### 2.1 Which forms

**UPDATE activities only**, on every host that shows the form (Runtime pages,
the Console page preview, the Console workbench). A form about an existing
record has a clear identity — this activity on this record — and that is what
the saved answers are filed under. CREATE forms are left out for now: a
half-made record has no id to file it under (§5).

### 2.2 Save for later

- A **Save for later** button, beside Submit and Cancel, on the form's normal
  footer. Not shown while the form is waiting on Continue anyway / Cancel
  after a before-hook warning, or while a run is in flight.
- It keeps the form's current `values` and `waived` maps as they stand —
  **no required, reason or validation check** — together with when it was
  saved, then closes the form. Nothing is sent to the server.
- Seeded and sourced values are not kept: they come from where the form was
  opened, and are worked out again each time it opens.
- Files and photos are kept as their descriptors. They were uploaded when
  picked, as today; an upload in a form that is never submitted stays pending
  in the attachments ledger, exactly as one in a cancelled form does today.

### 2.3 Opening a form that has saved answers

- The saved `values` and `waived` replace the form's starting values for the
  questions they hold — they win over the record's current values, because
  they are what this person last entered. Seeded and sourced values still win
  over everything, as today.
- A line at the top of the form says so: **"Restored the answers you saved
  for later on <date, time>."** with a **Discard** link beside it. Discard
  removes the saved answers and resets the form to what it would have started
  with.
- A saved answer for a question the activity no longer asks is ignored.
- If the record changed after the answers were saved (someone ran the activity
  in between), the saved answers still win for the questions they hold; the
  date in the line is how the person knows how old they are.

### 2.4 When saved answers go

- On a **successful Submit** (the run is done, not waiting on confirmation).
- On **Discard** (2.3).
- **Cancel keeps them**: closing a restored form without submitting leaves the
  last saved answers as they were. Anything typed since the last Save for later
  is lost, as with Cancel today.
- Nothing expires them otherwise. Saved answers for an activity that is no
  longer offered on that record stay in the browser, unused.

### 2.5 Where they are kept

- `localStorage`, one entry per operation, activity and record, under the key
  **`fluxus:page-runtime:saved-form:<operationId>:<activityId>:<recordId>`**
  (the repo's `fluxus:<package>:` prefix).
- The host supplies the store, already bound to its operation, the way it
  supplies `uploads` — so the form stays blind to which operation it is in. A
  new optional `CaptureHost` member offers load, save and remove by activity and
  record. A host that supplies none shows no Save for later button.
- Every read and write is guarded: storage can be unavailable (private
  browsing, blocked site data) or full. A failed save leaves the form open with
  the reason in the form's error banner, and nothing typed is lost. A failed
  read opens the form as if nothing were saved.
- Per browser, not per person: two people signing in on one browser share
  what is saved there. Accepted with the browser choice.

## 3. Not in this spec

- **CREATE forms** (Add Finding, Create Pre-Purchase Job).
- **Saving on the server**, so answers follow a person between devices.
- **Showing elsewhere that a form has saved answers** (a marker on the action
  button, a list of saved forms).
- **Expiring old saved answers.**

## 4. Build list

1. **Page runtime:** the store member on `CaptureHost`; Save for later, the
   restored line and Discard in `AttributesForm`; clearing on a successful
   Submit.
2. **Hosts:** the Runtime/page host and the Console workbench supply the
   store, bound to their operation.
3. **Docs:** page-runtime and workbench SPECs; this spec's status.

## 5. Decided while writing — check these

Claude's calls, for the user to confirm or overrule:

- **UPDATE forms only** (2.1). CREATE needs a way to say which half-made
  record a draft is — e.g. Add Finding on job J-0005 versus on J-0009 — and is
  left until a solution asks for it.
- **On every host, the Console workbench included** (2.1) — a change to the
  workbench's UI.
- **The Discard link** and the restored line's wording (2.3).
- **Cancel keeps the saved answers** (2.4).
- **The storage key** (2.5).

## 6. Tests

- Save for later with mandatory questions blank: the form closes, nothing is
  sent to the server, the answers are kept.
- Reopening the same activity on the same record restores them, with the line;
  on another record, or another activity, nothing is restored.
- Saved answers win over the record's values; seeded and sourced values win
  over saved answers.
- Submit still refuses blank mandatory questions on a restored form.
- A successful Submit removes the saved answers; a refused one, or one waiting
  on Continue anyway, keeps them.
- Discard removes them and resets the form; Cancel keeps them.
- Waived questions and their reasons are restored.
- Storage unavailable: Save for later reports it and the form stays open;
  opening a form behaves as if nothing were saved.
- No button on a CREATE form, or on a host that supplies no store.
