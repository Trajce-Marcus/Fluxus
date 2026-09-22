# `Photos` — a component showing a record's photos

**Status: spec, reviewed, ready to build** (2026-09-23). Shift reports carry
photos of the shift and defects carry photos of the defect, and both are meant
to be seen on their pages. Today a page shows the file name.

Reviewed cold on 2026-09-23; §7 records what the review changed. Every claim
below about existing code was checked against it.

## 1. Almost all of it already exists

Nothing about drawing a photo needs writing. `PhotoThumbs`, `PhotoCountCell`
and `FileChips` already live in this package
(`src/capture/attributeWidgets.tsx:306-336`), exported, and the workbench
imports them **from here** rather than owning them.

**Clicking a thumbnail already opens the photo.** `Thumb`
(`attributeWidgets.tsx:263-272`) asks the upload service for the full-size
address and opens it in a new tab, and `PhotoThumbs` is built from `Thumb`. So
the viewing the user asked for comes with the existing widget.

What is missing is one thing, and the code says so itself. From
`src/components/columnFormat.ts:165-170`, explaining why the photo column draws
a file name:

> NOT the thumbnail §2.1 asks for: drawing the image needs a presigned URL, and
> a component has no door to the upload service — every host service reaches a
> component as a declared prop. The names are honest and the column shape is the
> final one, so the cell upgrades to a thumbnail the day that seam exists
> without a page changing a line.

## 2. How the upload service reaches a component — already decided

This package's own SPEC answers it (`docs/SPEC.md:191`): the component
container assigns host services onto a component's resolved properties, and
that is named there as *"the channel a photo cell would use to reach
`UploadService.resolveUrl`"*.

The precedent is live: `RecordList` declares a services property in its React
props marked "supplied by the host", and it is deliberately **not** in its
declared schema, so no page author writes it and the container injects it for
every component. Services are assigned last, so nothing a page declares can
shadow them.

So: **no new mechanism.** There is no fourth kind of property to invent — the
three kinds are the ones every component already uses, and a fourth would have
to be taught to the page validator as well.

What it does mean is widening the set of host services by one, to hand over the
ability to turn a stored key into an address. Every member of that set today is
a verb the host performs, so this fits. One of them is already deliberately
kept out of reach of scripts while still being available to components, which
is the precedent for adding one the same way — a page's script has no business
minting file addresses.

## 3. The component

| name | kind | type | required | what it is |
| --- | --- | --- | --- | --- |
| `title` | static-config | string | no | Heading above the photos |
| `value` | dynamic-data | array | yes | The photo field's value — the stored descriptors |
| `emptyMessage` | static-config | string | no | Shown when there are none |

It takes the field's value, not a record and a field name, so it does not need
to know which record type it is looking at. It mounts `PhotoThumbs`, which
draws every photo at a readable size and opens the full image on a click.

A dynamic-data array needs no declared item shape — that rule only bites
static configuration, which the page builder must be able to author.

## 4. The photo column in a list, separately

The `photo` column type already exists and already names itself honestly. Once
a component can reach the upload service, that column can draw the first
thumbnail with a count badge over it instead of a file name, and **no page
changes a line**.

One correction to how that lands: the formatter returns a string and the table
renders it as text, through a single call. A thumbnail is not a string, so the
photo case branches in the **table**, before the formatter — which keeps the
formatter pure and string-testable, and means the change is in `RecordList`,
not in `columnFormat`.

This is worth doing in the same pass. It is not what the shift report and
defect pages need, which is §3.

## 5. Writing photos into the demonstration data

Not this component's business, but it decides whether anything shows. The
loader writes descriptors directly: SHA-256 from `node:crypto`, dimensions read
from the JPEG header, and a row in the attachments ledger per photo so the
storage accounting stays honest.

The thumbnail key is left out — both widgets fall back to the full-size key
when it is absent, so the picture still draws, and building real thumbnails
would mean an image library for no gain here.

**One caution, confirmed by the review:** the thumbnail key is *not* optional in
the descriptor's declared shape, so a bag without it is accepted when written
straight to a record and would be rejected if it ever went through submission
checking. Demonstration photos never do. Making it genuinely optional is a
one-line change to the declared shape and is left alone here, because it
changes what every photo in the system is allowed to be.

## 6. Registering it

Four places, not one: the manifest the renderer resolves against, the Console's
two separate lists for the page builder's palette, and the package's exports.
Both Console files carry a standing note that deriving them from the manifest
is agreed and not done. This build adds to all four and does not attempt that
cleanup.

CSS is exported as a string, as every component here does.

## 7. What the review changed

- **The open question in §2 was already answered** by this package's own SPEC,
  which names the container's services channel for this exact purpose. No new
  mechanism, and no fourth kind of property.
- **Clicking a thumbnail already works** — the existing widget resolves the
  full-size address and opens it. What was marked out of scope is free.
- **"Only what it draws changes" was wrong** about the list column: the branch
  is in the table, not the formatter (§4).
- The thumbnail-key caution was confirmed exactly as written (§5).

## 8. Not built

- A gallery: previous and next, arrow keys, a caption.
- Reordering or removing photos from the page. Photos arrive through an
  activity and change through one.
