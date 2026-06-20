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
