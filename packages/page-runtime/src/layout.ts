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
  size: { type: 'flex'; value: number } | { type: 'fixed'; value: number };
  minSize?: number;
  maxSize?: number;
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  background?: string;
  border?: {
    top?: BorderSide;
    right?: BorderSide;
    bottom?: BorderSide;
    left?: BorderSide;
  };
  borderRadius?: number;
  splitter?: 'top' | 'bottom' | 'left' | 'right';
  children: Panel[];
}

export interface LayoutDefinition {
  root: Panel;
}
