# Auto page components — spec

**Status: parked 2026-09-24.** After its second cold review the user set this spec aside and chose to build progressively instead; the first piece, the `Tabs` component, is built as its own design (page-runtime SPEC § Tabs). Kept for reference, not a plan.

*Previously:* draft, revision 2 (2026-09-24), for a second cold review. Not built.
Revision 1 had the page draw its header, actions and tabs itself; the user
chose **placed components** instead (§1), so this revision replaces it.

## 1. The rule

**Nothing changes from today except two things: a new tab strip component, and
a new page starts with the standard top already laid out.**

- **Header, actions and tabs are ordinary placed components.** `PageHeader`
  (exists; gains a status label, §3), `RecordActivities` (exists, unchanged,
  §4) and a new tab strip, `PageTabs` (§5). An author may move or remove them
  like any component.
- **Errors are a page feature, not a component** (§6). The page draws them at
  its foot, always; nothing to place, nothing to remove, exactly as today.
- **A new page starts with them placed** (§7), which is what gives every page
  the same top without the page drawing it.
- **Everything else is content**, laid out as today.

"Auto parts" is fine as the group name where one is needed.

Why placed and not drawn by the page: a placed component gets action runs,
`{{ }}` filling, refresh after a run and error reporting from its container.
Drawn by the page, each of those would have had to be rebuilt outside a slot.
If the page ever draws them automatically, it would draw these same
components.

## 2. The standard page

```
┌─ root (vertical) ─────────────────────────────────────────┐
│ ┌─ top panel (auto: as tall as its content) ────────────┐ │
│ │ ←  Shift Report SR-0042   [Submitted]                 │ │  PageHeader
│ │    12/09/2026 · Day                                   │ │
│ │    [Modify] [Calculate] [Submit]                      │ │  RecordActivities
│ │  Details   WBS Rows   Resources Used   Defects        │ │  PageTabs
│ └───────────────────────────────────────────────────────┘ │
│ ┌─ bottom panel (flex 1, scrolls) ──────────────────────┐ │
│ │   content                                             │ │
│ └───────────────────────────────────────────────────────┘ │
│  errors, drawn by the page (only when there are any)      │
└───────────────────────────────────────────────────────────┘
```

The top panel stays put; the bottom panel scrolls under it. Tabs scroll the
bottom panel (§5).

## 3. PageHeader — gains a status label

Today: ←, a title, an optional subtitle (page-runtime SPEC § PageHeader). Added:

| Prop | Kind | What it is |
|---|---|---|
| `status` | static config, `{{ }}` holes | A value drawn as a label on the title line, e.g. `{{ context.record.status }}`. |
| `statusColours` | static config, array | Which colour each status is drawn in: items `{ state, colour }`. |

- **Holes are filled by the container**, as for every static string today
  (`ComponentContainer.tsx` fills any static value with `{{ }}`), so `status`
  refreshes after a run like the title does.
- **`statusColours` is an array with a declared item shape**, so the Console's
  existing row editor (`ArrayPropertyEditor`, via `PropSchema.items`) edits it
  with no new editor. Item shape: `state` (string), `colour` (string, one of
  the choices below).
- **The colour words are Contributions' own**: green, amber, orange, red, blue,
  purple, grey. One vocabulary on the platform, so "Approved" can't be green in
  one component and a different green in another. The word-to-hex map moves out
  of `Contributions.tsx` into a shared module both import. **Named words only in
  the header**: no free CSS colour, the rule `Text` holds to (it has no colours
  at all).
- **Matching:** the status is trimmed and compared case-insensitively with
  `state`. No match → grey. Blank status → no label.
- **Where the label sits:** on the title line, after the title. New css; today's
  `PageHeader` has nowhere for it.

## 4. Actions — `RecordActivities`, unchanged

No change to the component. The page's own control over its actions is the
user's, to be specified separately (2026-09-23). Creates stay hand-placed
`RunActivity` buttons.

One correction to page-runtime SPEC § RecordActivities: it says the list
re-asks after a run "because the container re-evaluates props". The real
reason is that the container swaps every component for "Loading…" while it
re-evaluates, which remounts it (`ComponentContainer.tsx` loading branch), and
the remount re-asks. It works, but the SPEC should say so, because anything
that removes the loading swap breaks it.

## 5. PageTabs — the tab strip

**What the author states:** a `tabName` on a layout panel. It marks where that
tab scrolls to; the panel is whatever should sit at the top of the view when
the tab is clicked. It is a property of the **panel** (`layout.ts` `Panel`),
beside `padding` and `overflow`. It is not `Panel.name`, which is the layout
editor's own label and never reaches the reader.

**What it draws:**
- **Nothing unless more than one panel has a `tabName`** (ruled 2026-09-23).
- Otherwise one tab per named panel, **in layout order**: depth-first, the
  order the panels appear in the layout definition.
- **Click → the panel's nearest scrolling ancestor scrolls** until the panel's
  top meets its top. Nothing is hidden; it's SAP's object page anchor bar.
- **The tab whose panel is at, or last passed, the top of that scrolling panel
  is highlighted**, updated as the reader scrolls.

**How it reaches the layout** (new host doors, component-only, absent from every
service module like `listActivities`):
- `services.listTabs()` → `{ panelId, tabName }[]`, read by `PageRenderer`
  from the page's layout.
- `services.scrollToTab(panelId)`. `PanelNode` renders each panel as an
  anonymous div today, so named panels gain a `data-panel-id` attribute, and
  the lookup runs **inside the page's own root element**, never `document`: the
  Console renders the page in a shadow root that a document query can't see
  into.
- Highlighting listens to the scrolling ancestor of the first named panel.

**When named panels sit in different scrolling panels** (a side-by-side
layout), each click still scrolls the right one, but the highlight follows only
the first's. `validatePage` warns (§8). On a standard page (§2) there is one
scrolling panel, so this does not arise.

## 6. Errors — a page feature, at the foot

**Stays as today:** `PageRenderer` draws the list at the page's foot, it can't
be placed or removed, and since 2026-09-23 it's held against the page and
record it came from.

**What reaches it:** a component's dynamic props or `{{ }}` holes failing to
evaluate, and an action failing when it is launched from a component. **Not**
a page that fails to open (that is drawn in place of the page), and **not** a
gate's `fail()` on an activity with a form (the form shows it).

**What changes: how it reads.**
1. **A refused action is shown as its own plain message, never hidden.** An
   activity with no form (Submit, Calculate) has no form to show its gate's
   `fail()`, so the refusal lands here today, e.g. *"Submit: the report has not
   been calculated."* It is the one message the user can act on, so it is shown
   in full.
2. **Anything else is one plain line naming what failed:** *"Part of this page
   could not be shown: Resources Used."* The raw message sits under it, hidden
   until clicked, for whoever reports the fault. The name is the `tabName` of
   the nearest named panel holding the component, else the component's
   `title` config, else its component type.
3. **A repeat replaces, it doesn't pile up.** Each refresh that fails again
   today appends another copy.
4. **The Console preview shows raw messages**, as today; the author needs them.

**What the build must add for this:**
- Error entries carry the **slot id** as well as the component name (today
  only `manifest.name` reaches `handleError`), which is what finds the tab name
  or title and what makes "a repeat replaces" possible.
- A way to tell a refusal from a failure. `fail()` throws, and
  `launchActivity` catches it (`ComponentContainer.tsx`). **The build checks
  whether a gate refusal is distinguishable from any other error thrown during
  a run. If it isn't, every error from a launched action counts as a refusal**
  and is shown in full, which errs on the side of showing.
- A `PageRenderer` prop telling it which way to draw (plain for the Runtime,
  raw for the preview). The preview's existing `debug` prop is dev-only and is
  not it. The prop's name needs sign-off.

## 7. A new page starts with the standard top

The Console creates a new page as an empty definition
([PageExplorer.tsx](../../console/src/platform-components/page-builder/PageExplorer.tsx),
`savePage(path, {})`). It instead creates the §2 layout:

- `root`, vertical:
  - **top panel**, `auto` size, vertical, holding three slots: header
    (`PageHeader`, title = the page's name), actions (`RecordActivities`,
    `record` bound to `context.record.id`) and tabs (`PageTabs`);
  - **bottom panel**, `flex 1`, `overflow: 'scroll'`, empty.
- The three components in `componentDependencies`.
- A page with no record still works: `RecordActivities` with no record and a
  blank `emptyMessage` draws nothing, and `PageTabs` draws nothing until
  panels are named.

Existing pages are not touched by this; see §9.

## 8. Save-time checks (`validatePage`)

Warnings, never errors:
- The page has no `PageHeader`.
- Two panels share a `tabName`.
- Named panels do not all sit inside one scrolling panel (§5).
- A `statusColours` colour is not one of the words.

`validatePage` walks `slotConfigs` today, so the `status` holes are checked
with no new code; the `tabName` checks walk the layout, which is new.

## 9. Moving the projects pages over

User's call (2026-09-24): **add it to every page, remove it where it isn't
wanted, then republish.**

- Every projects page gains a `PageTabs` slot in its header panel, after its
  `RecordActivities` if it has one, and `tabName` on the panels that start its
  sections (shift report: Details, Photos, WBS Rows, Resources Used, Defects,
  Amendments; the project page: its lists; and so on).
- `PageHeader` gains `status` wherever its subtitle ends in the status. The
  status comes **out** of the subtitle so it isn't shown twice (today: shift
  report, amendment, defect).
- One script, drafts only (the pattern of `projects-page-headers.ts`), **and
  the page-building scripts change to match** (`shift-reports-pages.ts`), so a
  re-run doesn't undo it.
- Then the user removes what isn't wanted, and republishes.

## 10. The Console

- **Layout editor:** a panel gains a Tab name box beside its padding.
- **Palette:** `PageTabs` added (`componentSchemas.ts`, `sessionComponents.ts`).
- **New page:** the starter layout (§7).
- `PageHeader`'s `statusColours` uses the existing row editor (§3).

## 11. Names

Endorsed: `tabName`, `status`, `statusColours`, and the colour words (now
Contributions' seven, §3), plus "auto parts" as the group name.

**Needing sign-off:** `PageTabs` (the component), `listTabs` / `scrollToTab`
(the host doors), `data-panel-id`, and the `PageRenderer` prop for plain vs raw
errors (§6).

## 12. SPEC updates the build makes

page-runtime SPEC: PageHeader (status), a PageTabs section, the error list
(§6), the RecordActivities correction (§4), `Panel.tabName` in the layout
section. Console LAYOUT_EDITOR_SPEC: the Tab name box. Console SPEC: the new
page's starter layout.

## 13. Not in this build

- The page drawing the auto parts itself (revision 1); these components are
  what it would draw.
- The page's own control over its actions (§4).
- Restoring the scroll position on Back.
- A trail of the pages behind this one.
- Wrapping existing panels into a new panel in the layout editor.
