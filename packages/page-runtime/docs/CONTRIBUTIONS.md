# `Contributions` — a component showing activity over time

**Status: spec, reviewed, ready to build** (2026-09-23). Named by the user:
it shows contributions over time, the way GitHub's contributions graph does,
with the days of the week replaced by whatever the rows are.

Reviewed cold on 2026-09-23; §9 records what the review changed.

## 1. What it draws

One row per thing, one column per date, one small coloured square per cell.
Colour says what state that thing was in on that date.

```
              Mon 14  Tue 15  Wed 16  Thu 17  Fri 18  Sat 19
WG-TRENCH       ██      ██      ██      ██      ██      ██
WG-WELD         ██      ██      ██      ██      ██      ██
WG-COAT         ██      ██      ▒▒      ██      ██      ██
WG-TIE          ██      ██      ██      ██      ██      ██
```

A hole is a hole in a row, and the row is labelled with the thing and, if it is
given one, a second line under it — a manager's name. That is the point. One
row for everything would show that something was missing on Wednesday without
saying who to ask.

**Rows are the interesting axis, not the calendar.** GitHub has one row per
weekday because it shows one person over a year. Here the second thing — which
work group — matters more than which weekday, so it takes the rows, and dates
take the columns, one column per date rather than per week.

## 2. It knows nothing about shift reports

The component receives cells and rows and draws them. It has no idea what a
shift report is, what approval means, or why a cell is absent. That is what
lets the same component show defects raised per day, or anything else counted
per day, without change.

Everything specific — which rows are expected, what counts as done, what the
colours mean — lives in the GET that supplies the data and in the `states`
property that names the colours.

## 3. The component fills in what is absent

**A query cannot produce the holes.** It can return the records that exist —
one cell per shift report filed — but "this group, this date, nothing" is a
row-by-date cross product, and the DSL has no way to multiply rows: no
grouping, no list building, no union, and a named function cannot return a list
of lists to be flattened.

So the component does it. It has the rows and it has the date range, so for
every row and every date with no cell it draws the `missing` state. The query
returns what happened; a hole is a drawing rule, not data.

This is why `rows` is a property in its own right rather than being taken from
the cells: a work group that filed nothing all week has no cells at all, and
that group is exactly the one worth seeing.

## 4. Dates are dates

**A cell's `date` is a plain string, `2026-09-14`, and nothing else.** No time,
no zone, compared as text.

This matters more than it looks. A date carried as an instant in time comes
back from a query converted to UTC — the conversion that corrects it is applied
at one place in the server, the DSL editor, and not to the path a page uses.
The symptom is written up in the server's own code: a date round-trips as the
day before the one the record holds, so an Australian shift would draw one
column to the left. Carrying no time at all means there is nothing to convert.

The GET must therefore project its dates as text. A `datetime` field handed
straight to this component is a defect, and the component says so in place of
the grid rather than drawing something wrong.

Columns are every date between `from` and `to` inclusive, one each. No week
grouping, no month headers, no weekend shading — a pipeline works Saturdays.

## 5. Properties

| name | kind | type | required | what it is |
| --- | --- | --- | --- | --- |
| `title` | static-config | string | no | Heading above the grid |
| `cells` | dynamic-data | array | yes | One entry per square that exists: `{ key, date, state }` plus anything else, which the tooltip shows and the click emits |
| `rows` | dynamic-data | array | yes | The rows and their order: `{ key, label }`, optionally `sublabel` |
| `states` | static-config | array | yes | `{ state, colour, label }` — see below; needs `items` declared |
| `missingState` | static-config | string | no | Which state to draw where a row has no cell for a date. Blank ⇒ the cell is left empty |
| `from` / `to` | static-config | string | no | First and last date drawn, `2026-09-14`. Absent ⇒ the range present in `cells` |
| `emptyMessage` | static-config | string | no | Shown when there are no rows |
| `onSelect` | callback | function | no | A square was clicked |

`from` and `to` need no expression support of their own: the component
container already fills `{{ … }}` holes in any static string, so
`from: "{{ … }}"` works as it stands.

**`states` must declare its item shape.** An array property with no `items` is
read-only in the page builder, because nothing may guess what an undeclared
item holds. `RecordList` declares item shapes for its columns and its bulk
actions for exactly this reason, and `states` follows.

## 6. Colours

Named by the page, not fixed in the component:

```
states: [
  { state: 'approved',  colour: 'green',  label: 'Approved' },
  { state: 'submitted', colour: 'amber',  label: 'Filed, not approved' },
  { state: 'missing',   colour: 'red',    label: 'Not filed' },
]
```

A cell whose `state` is not named in `states` draws in a neutral grey and is
counted in a note under the grid, rather than being dropped — the same rule the
table uses for a row it cannot place: show it so it can be fixed.

Colour alone must not be the only difference. Every square carries its state's
label as its tooltip, and the legend under the grid names every state. A
red/green pair is the most common colour blindness there is, and this is
exactly the red/green case, so the legend is doing the real work and the
tooltip is a convenience — it is not reachable by keyboard and screen readers
treat it inconsistently.

## 7. Reading and clicking a square

Hovering shows the row's label, the date, and the state's label. Any other
field on the cell is shown beneath as `name: value`, so a report's number and
hours appear without the component knowing what either is.

**Clicking emits the whole cell.** The consumer takes what it needs from it.
The user's ruling, 2026-09-23, made knowing that existing callbacks are
narrower — `RecordList` emits a list of ids, and a payload was once deliberately
reduced to a single value. Bringing the two into line is worth doing and is not
this build.

## 8. Size

Five rows by six dates is the first use; a month is five by thirty, still
comfortable. Beyond that the grid scrolls sideways inside its own box with the
row labels held still, the way a wide table does. The page itself must never
scroll sideways.

Squares are fixed and small. The grid does not stretch to fill its container —
six columns stretched across a wide page reads as a table, not a glance.

## 9. What the review changed

- **The holes moved from the query to the component** (§3). The original had the
  query return red squares; it cannot.
- **Dates became plain strings** (§4), which turns a workaround into the right
  answer and sidesteps a real defect in how dates cross the wire.
- **`states` gained a declared item shape** (§5), without which the property is
  unauthorable in the page builder.
- **`from`/`to` needed nothing.** The open question about expressions was
  already answered by the component container.
- **Clicking emits the whole cell**, the user's ruling, with the tension against
  the narrower existing callbacks recorded rather than resolved (§7).

## 10. Registering it

A new component goes in **four** places, not one: the manifest the renderer
resolves against, the Console's two separate lists for the page builder's
palette, and the package's exports. Both Console files carry a standing note
that deriving them from the manifest is agreed and not done. This build adds to
all four and does not attempt that cleanup.

CSS is exported as a string, as every component in this package does, because
the Console mounts inside a shadow root that a document stylesheet never
reaches.

## 11. Not built

- Week or month grouping, month headers, weekend shading.
- A count per square (GitHub shades by how many). A cell here has one state.
- Clicking a row label to narrow, or dragging a date range.
- Anything that fetches. The component draws what it is handed.
- More than one cell for a row and a date. If two arrive, the last wins and the
  tooltip says so.
