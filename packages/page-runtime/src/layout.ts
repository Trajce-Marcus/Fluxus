// Layout types shared by the renderer and the Console-side layout editor
// (moved from page-builder's layout-editor/types.ts at the page-runtime
// extraction). The full property set is specified in the page builder's
// LAYOUT_EDITOR_SPEC.md.

export interface BorderSide {
  style: 'solid' | 'dashed' | 'dotted' | 'none';
  width: number;
  color: string;
}

export interface Panel {
  id: string;
  name?: string;
  direction: 'vertical' | 'horizontal';
  /**
   * How the panel's size is decided along its parent's direction.
   *
   * - `flex` — a share of what is left, the value being the weight.
   * - `fixed` — that many pixels.
   * - `auto` — **as big as its content**, growing and shrinking with it, the
   *   way an ordinary block does (2026-09-14). It is what lets a page be
   *   taller than the window: a scrolling panel holding `auto` children ends
   *   up with more content than height, so it scrolls as one column instead of
   *   dividing itself between them. `flex` and `fixed` both take their size
   *   from the space available, so a layout built only from those can never
   *   exceed the window, whatever it holds.
   *
   * The word is CSS's own (`height: auto`, `flex-basis: auto`) and the one a
   * blank column `width` already means in `RecordList`.
   */
  size: { type: 'flex'; value: number } | { type: 'fixed'; value: number } | { type: 'auto' };
  minSize?: number;
  maxSize?: number;
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  /**
   * What happens to content that does not fit. Specified in
   * LAYOUT_EDITOR_SPEC.md from the start; honoured by the renderer since
   * 2026-08-20. Left unset, a panel holding **other panels** clips (a split
   * layout must not grow when one side fills) and a panel holding a
   * **component** scrolls (clipping a leaf makes content unreachable with
   * nothing to say so). `'scroll'` renders as `auto` — scrollbars when there
   * is something to scroll, not before.
   */
  overflow?: 'hidden' | 'scroll';
  background?: string;
  border?: {
    top?: BorderSide;
    right?: BorderSide;
    bottom?: BorderSide;
    left?: BorderSide;
  };
  borderRadius?: number;
  /**
   * Where a tab scrolls to (2026-09-24). A panel with one is listed by the
   * `Tabs` component, and its element carries the name as `data-tab-name`.
   * Not `name`, which is the layout editor's own label and never reaches the
   * reader.
   */
  tabName?: string;
  splitter?: 'top' | 'bottom' | 'left' | 'right';
  children: Panel[];
}

export interface LayoutDefinition {
  root: Panel;
}
