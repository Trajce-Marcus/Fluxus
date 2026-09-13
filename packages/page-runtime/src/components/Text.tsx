// Words on a page: a heading, a sentence, a caption. One component rather than
// several (2026-09-13, the user's framing): it is a single cell of text that
// fills whatever panel the layout gives it, so it needs no size of its own.
//
// **Two fixed sets, no CSS.** `style` is how loud the text is — its place in
// the page's structure — and `align` is where it sits. Neither takes a font, a
// colour or a size, for the reason display conditions already ruled (§3.3):
// once an author can write their own red, screens stop matching each other and
// nothing survives a change of theme. A `tone` for meaning — warning, danger,
// good — was designed and then **deliberately left out** until a real screen
// needs it; it may turn out to be a boxed callout with an icon rather than
// coloured words, and that is a different component, not this property.
//
// **The text may carry `{{ }}` holes** — `Project {{ record.project_no }}` —
// filled by the host before the component ever sees them. Nothing here knows
// about that: this draws the string it is given, which is what keeps it
// model-blind like every other component.

import type { PropSchema } from '../manifest';

/** How loud the text is. Anything unknown reads as body, never as an error. */
export type TextStyle = 'title' | 'heading' | 'subheading' | 'body' | 'caption';

const STYLES: readonly string[] = ['title', 'heading', 'subheading', 'body', 'caption'];
const ALIGNMENTS: readonly string[] = ['left', 'center', 'right'];
// Across and down are two questions, the way a spreadsheet asks them: a cell
// fills its panel, so where the words sit in the empty space is a real choice.
const VERTICAL: readonly string[] = ['top', 'middle', 'bottom'];

const textStyle = (style: string | undefined): string =>
  style && STYLES.includes(style) ? style : 'body';

const textAlign = (align: string | undefined): string =>
  align && ALIGNMENTS.includes(align) ? align : 'left';

const verticalAlignment = (align: string | undefined): string =>
  align && VERTICAL.includes(align) ? align : 'top';

interface TextProps {
  /**
   * What it says. Line breaks are kept as typed, and `{{ expression }}` holes
   * are filled by the host before this is drawn.
   */
  text?: string;
  /** title, heading, subheading, body (the default) or caption. */
  style?: string;
  /** Across the cell: left (the default), center or right. */
  align?: string;
  /** Down the cell: top (the default), middle or bottom. */
  verticalAlign?: string;
}

function TextComponent({ text = '', style, align, verticalAlign }: TextProps) {
  return (
    <div className={`tx-root tx-v${verticalAlignment(verticalAlign)}`}>
      <div className={`tx-${textStyle(style)} tx-${textAlign(align)}`}>{text}</div>
    </div>
  );
}

// `pre-wrap` is the whole of "line breaks show as line breaks": the text is
// stored with the breaks the author typed, and this stops the browser eating
// them. Wrapping still happens, so a long line is not a horizontal scroll.
const css = `
  .tx-root { font-family: system-ui, sans-serif; padding: 1rem; box-sizing: border-box; height: 100%; display: flex; flex-direction: column; white-space: pre-wrap; overflow-wrap: anywhere; color: #1e293b; }
  .tx-vtop { justify-content: flex-start; }
  .tx-vmiddle { justify-content: center; }
  .tx-vbottom { justify-content: flex-end; }
  .tx-title { font-size: 1.5rem; font-weight: 700; line-height: 1.25; }
  .tx-heading { font-size: 1.125rem; font-weight: 700; line-height: 1.3; }
  .tx-subheading { font-size: 0.9rem; font-weight: 600; line-height: 1.35; color: #475569; }
  .tx-body { font-size: 0.85rem; line-height: 1.5; }
  .tx-caption { font-size: 0.72rem; line-height: 1.45; color: #64748b; }
  .tx-left { text-align: left; }
  .tx-center { text-align: center; }
  .tx-right { text-align: right; }
`;

const schema: PropSchema[] = [
  { name: 'text',          kind: 'static-config', type: 'string', required: false, description: 'What it says — line breaks are kept, and {{ expression }} reads page data' },
  { name: 'style',         kind: 'static-config', type: 'string', required: false, description: 'How loud the text is', choices: STYLES },
  { name: 'align',         kind: 'static-config', type: 'string', required: false, description: 'Across the cell', choices: ALIGNMENTS },
  { name: 'verticalAlign', kind: 'static-config', type: 'string', required: false, description: 'Down the cell', choices: VERTICAL },
];

export const Text = Object.assign(TextComponent, { css, schema });
