// Who is selected (RECORD_LIST_DESIGN §4.5, step 3). Pure — ids in, ids out —
// so it sits beside `columnFormat` rather than inside the table: testable
// without a DOM, and reusable by anything that wraps the table's guts (§6, the
// Gantt seam).
//
// Three modes, and the middle one is what the table already did: `one` selects
// the clicked row, `many` adds a checkbox per row and a select-all in the
// heading, `none` makes rows inert. Blank or unknown means `one`, so a page
// written before this step behaves exactly as it did.

export type SelectionMode = 'none' | 'one' | 'many';

/** The declared mode, or `one` for blank/unknown — never an error. */
export const selectionMode = (mode: string | undefined): SelectionMode =>
  mode === 'none' || mode === 'many' ? mode : 'one';

/** Whether the header box is empty, part-filled or full. No rows is `none`. */
export type HeaderState = 'none' | 'some' | 'all';

/**
 * The selection, in the order the screen reads. Also what prunes it: an id no
 * longer among the rows — the record was deleted, or a re-read narrowed the
 * answer — drops out rather than being carried on invisibly. Pruning is always
 * against **every delivered row**, never the searched-down ones: typing in the
 * search box must not untick anything (step 4).
 */
export const inRowOrder = (rowIds: readonly string[], selected: readonly string[]): string[] =>
  rowIds.filter((id) => selected.includes(id));

/**
 * Which rows are ticked but not on screen — a search hides them, and the count
 * has to say so or the selection looks like it shrank.
 */
export const hiddenCount = (visibleIds: readonly string[], selected: readonly string[]): number =>
  selected.length - inRowOrder(visibleIds, selected).length;

export const headerState = (rowIds: readonly string[], selected: readonly string[]): HeaderState => {
  const chosen = inRowOrder(rowIds, selected).length;
  if (chosen === 0) return 'none';
  return chosen === rowIds.length ? 'all' : 'some';
};

/**
 * What a click on a row leaves selected. `one` replaces (clicking the selected
 * row keeps it selected — a click is not a deselect); `many` toggles, so the
 * row itself works as its own checkbox; `none` selects nothing.
 */
export const nextSelection = (
  mode: SelectionMode,
  rowIds: readonly string[],
  selected: readonly string[],
  id: string,
): string[] => {
  if (mode === 'none') return [];
  if (mode === 'one') return [id];
  const toggled = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  return inRowOrder(rowIds, toggled);
};

/**
 * The header box, over **the rows shown** — which a search narrows (step 4).
 * It adds them to the selection or takes them out of it; it does not replace
 * it, because a row ticked before the search was typed is still ticked. That
 * is what lets someone tick a few, search again, tick a few more, and act on
 * all of them.
 */
export const selectAll = (
  visibleIds: readonly string[],
  allIds: readonly string[],
  selected: readonly string[],
): string[] => {
  if (headerState(visibleIds, selected) === 'all') {
    const dropped = new Set(visibleIds);
    return selected.filter((id) => !dropped.has(id));
  }
  return inRowOrder(allIds, [...selected, ...visibleIds]);
};

/**
 * What `onSelect` emits: **always a list**, one id or twenty (ruled
 * 2026-09-08). A callback carries one value, and that value having a different
 * shape in each mode would make every script that reads it mode-specific — a
 * script written for `one` breaks the day the page is switched to `many`. A
 * list of one costs a script `callbackData.value[0]`, or nothing at all when
 * it already walks the selection with `for each`.
 *
 * A copy, so nothing downstream can write back into the table's state.
 */
export const emitted = (selected: readonly string[]): string[] => [...selected];
