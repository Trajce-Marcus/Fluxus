# Auto page components — spec

**Status:** draft for cold review, 2026-09-23. Not built. Direction recorded in
[BLUEPRINT.md](../../../docs/BLUEPRINT.md) § The page header.

## 1. The rule

**A page is drawn in two parts: the parts every page has, which the page draws
itself, and content, which the author lays out.** The auto parts are the
**header**, the **tabs**, the **actions** and the **errors**. Everything else —
lists, text, photos, buttons — is content, placed in slots exactly as today.

The author never places an auto part. They give the page what the part needs —
a title, a status, a section's tab name — and the page draws it. So every page
looks the same at the top, and that part of authoring does itself.

## 2. Where the auto parts sit

```
┌───────────────────────────────────────────────────────────┐
│ ←  Shift Report SR-0042   [Submitted]        [Approve] [Reject] │  header + actions
│    12/09/2026 · Day                                      │
│  Details   WBS Rows   Resources Used   Defects   Photos  │  tabs
├───────────────────────────────────────────────────────────┤
│                                                           │
│   content — the page's layout, scrolling                  │
│                                                           │
├───────────────────────────────────────────────────────────┤
│ errors (only when there are any)                          │
└───────────────────────────────────────────────────────────┘
```

- `PageRenderer` draws the header, actions and tabs **above** the layout, and
  the errors **below** it. They are outside the layout, so they stay put while
  the content scrolls under them.
- The layout is unchanged: it is the content, and its scrolling panel scrolls
  as today.
- The Console's page preview uses `PageRenderer` too, so the preview shows the
  auto parts with no work of its own.

## 3. Header

**What the page states** (new page-definition fields; names proposed, see §8):

| Field | What it is | Example |
|---|---|---|
| `title` | The page's title. `{{ }}` holes, as `Text` takes them. | `Shift Report {{ context.record.report_no }}` |
| `subtitle` | Optional line under the title. Holes as above. | `{{ context.record.report_date }} · {{ context.record.shift }}` |
| `status` | Optional. A value shown as a label beside the title. Holes as above. | `{{ context.record.status }}` |
| `statusColours` | Optional. Which colour each status value is drawn in. | `{ Draft: grey, Submitted: blue, Approved: green, Rejected: red }` |
| `header` | Optional, default on. `false` draws no header, and so no actions. | a landing page or a dashboard with its own top |

**What it draws:** ← , the title, the status label, and the subtitle beneath,
the same as today's `PageHeader` plus the status.

- **Back** works as `PageHeader`'s does today: the host's history, greyed on the
  first page opened (page-runtime SPEC § PageHeader).
- **Status colours come from a fixed set** (proposed: grey, blue, green, amber,
  red), not free CSS colours. That is the rule `Text` already follows ("two
  fixed sets, no CSS"): once an author can write their own red, screens stop
  matching each other. A value missing from the list is drawn grey.
- **A blank status draws no label.** A page with no record, or a record with no
  status, simply has none.
- **A page with no `title`** draws its header with no title: ← on its own.
  `validatePage` warns, since a page with no title is almost certainly an
  oversight. It does not fail.

## 4. Tabs

**What the author states:** a `tabName` on a layout panel (the user's name and
design, 2026-09-23). A panel that has one is a section, and its `tabName` is
the tab's label. It is a property of the **panel**, beside `padding` and
`overflow`, not of the component in it.

**What it draws:** a tab strip under the header.

- **The strip shows only when more than one panel has a `tabName`** (ruled
  2026-09-23). One tab does nothing.
- **Tab order is layout order**, top to bottom as the layout lists the panels.
- **A named panel can be anywhere inside the scrolling area**, not only at the
  top level. So a section can be a panel wrapping its own "New" button and its
  list.
- **Clicking a tab scrolls the content to that panel.** The whole page is still
  there; nothing is hidden. This is SAP's object page anchor bar.
- **The tab of the section in view is highlighted** as the reader scrolls.
  Proposed rule: the last section whose top has passed the top of the
  scrolling area.
- `tabName` is not `Panel.name`. `name` is the layout editor's own label for a
  panel and never reaches the reader; `tabName` is what the reader sees.

## 5. Actions

**What it draws:** the record's actions, in the header on the right, where
SAP's object page puts them.

- **The actions are what `RecordActivities` shows today**: the workflow's
  actions on the page's record, minus those whose `show_condition` rules them
  out, re-asked after every run. The mechanism moves into the header; it is not
  rewritten.
- **A page with no record has no actions**, and a page with `header: false` has
  none either.
- A page that places a `RecordActivities` slot keeps working. It then shows the
  same buttons twice, and `validatePage` warns.

**Open: creates.** `RecordActivities` leaves out CREATE activities by design (a
CREATE belongs to a collection and has no record to act on). But many "create"
buttons on today's pages hang off the page's record: *Raise amendment*, *Add
WBS row*, *Raise defect*, *Add child*. They are hand-placed `RunActivity`
buttons, some of which fill in a field with the record's id. Three ways:

1. **They stay content.** The author places them as today. Simplest; the header
   only ever shows the record's own actions.
2. **The page lists them.** A page field names the creates to show in the
   header, each with the field to fill from the record, the same shape
   `RunActivity` already takes (`target`, `attribute`).
3. **The model works them out.** Every CREATE whose record type has a field
   pointing at this record type. Automatic, but it guesses: it would offer
   creates a page never wanted, and a record type pointing at another twice
   (two fields) is ambiguous.

Recommended: **1 for the first build**, then 2 once real pages show which
creates belong up top. 3 guesses, and the model is not the page.

## 6. Errors

**Already automatic.** `PageRenderer` draws a list of errors at the foot of
every page, and components cannot opt out. Since 2026-09-23 it is held against
the page and record it came from, so it does not follow the reader to the next
page. What reaches it: a component's dynamic props or `{{ }}` holes failing to
evaluate, an action failing to run, and a page that cannot be opened. A gate's
`fail()` message is **not** here; it shows in the activity form.

**What changes:** only how the list reads to someone who is not the author.
Today every entry is the raw message (`'projects' has no field 'wg_id' (line 1,
col 70)`). That is right for the author and useless to the person using the
page, who can do nothing about it.

- **In the Runtime:** one line per failing component, in plain words: *"Part of
  this page could not be shown: Details."* The raw message is under it, folded
  away, for whoever reports the fault. (Which name to show — the section's
  `tabName`, the component's title, or the component's type — is part of the
  review.)
- **In the Console preview:** the raw messages, as today. The author needs
  them.
- **Position:** stays at the foot. Proposed rather than ruled: the header is
  about the record, and an error is about the page.

## 7. Moving existing pages over

Mechanical, one script, drafts only (the pattern of `projects-page-headers.ts`):

- A `PageHeader` slot becomes the page's `title` and `subtitle`; the slot and
  its panel go.
- A `RecordActivities` slot in a page's header panel goes; the header's
  actions replace it.
- The projects solution's pages gain `status` where their record has one, and
  `tabName` on their sections (shift report: Details, Photos, WBS Rows,
  Resources Used, Defects, Amendments; project: its lists).
- The `PageHeader` component stays registered until no page uses it, then is
  retired.

## 8. Names needing sign-off

Per the naming rule, none of these is used until endorsed:

- `tabName` — **endorsed** (the user's, 2026-09-23).
- Page-definition fields: `title`, `subtitle`, `status`, `statusColours`, `header`.
- The colour set: grey, blue, green, amber, red.

## 9. The Console

- **Page settings** — the Page Access section's neighbour in `PageEditor`
  gains Title, Subtitle, Status (each an expression field with `{{ }}`, as the
  Text component's text box is), the status-colour list, and the header switch.
- **Layout editor** — a panel gains a Tab name box beside its padding.
- **Palette** — `PageHeader` leaves the palette when it is retired (§7).

## 10. Not in this build

- Restoring the scroll position on Back (raised 2026-09-23, left for later).
- A trail of the pages behind this one; it needs a readable name for each
  record, which nothing resolves yet.
- Header actions for creates (§5, option 2).
