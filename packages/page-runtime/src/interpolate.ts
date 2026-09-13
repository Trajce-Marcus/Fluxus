// Typed-in text with holes in it: `Project {{ record.project_no }} — overdue`.
//
// Pure, and deliberately tiny (2026-09-13). The braces are a **delimiter, not a
// language**: what sits inside one is an ordinary FluxScript expression, read by
// the same evaluator that reads a dynamic prop and checked by the same
// validator. There is one expression language and this does not add a second.
//
// **Why two braces.** A single `{` turns up in ordinary prose — a JSON snippet,
// a code sample, a pair written literally — so `{ }` as the delimiter would
// force an escape rule for a literal brace, learned by everyone who writes text
// and removable by nobody. With `{{ }}` a lone brace is just a brace. One extra
// character is paid per binding, by the person writing a binding.
//
// It is not tied to any one component: **any** typed-in string may carry holes,
// so a table's title interpolates exactly as a text box does. The evaluating is
// the host's (`ComponentContainer`), because only the host has the page context
// and the evaluator; this file only says where the holes are and how the string
// goes back together.

/** A hole, and where it sits in the template. */
export interface Hole {
  /** The expression between the braces, trimmed. */
  expression: string;
  /** Offsets into the template, including the braces. */
  start: number;
  end: number;
}

// Lazy up to the first `}}`, so a single `}` inside an expression — a string
// literal, say — does not end the hole early. Two of them: a global regex
// carries its own position between calls, which is a bug waiting for the test
// that shares it.
const HOLE = /\{\{([\s\S]*?)\}\}/g;
const ANY_HOLE = /\{\{[\s\S]*?\}\}/;

/** Every hole in the template, in the order they appear. */
export function holes(template: string): Hole[] {
  const found: Hole[] = [];
  for (const match of template.matchAll(HOLE)) {
    found.push({
      expression: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return found;
}

/** Whether this string has anything to fill — the cheap check before any work. */
export const hasHoles = (value: unknown): value is string =>
  typeof value === 'string' && ANY_HOLE.test(value);

/**
 * What a value looks like in the middle of a sentence. Nothing (`null`,
 * `undefined`) draws as nothing rather than as the word "null" — an empty field
 * in a sentence is a gap, not the text "undefined". `false` and `0` are values
 * and draw as themselves.
 */
export const drawValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * The template with each hole replaced by its answer, in order. A template with
 * no holes comes back untouched, which is the common case and costs nothing.
 */
export function fill(template: string, values: readonly unknown[]): string {
  let i = 0;
  return template.replace(HOLE, () => drawValue(values[i++]));
}
