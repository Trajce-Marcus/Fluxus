# Layout Editor — Specification

## Overview

The Layout Editor is a visual tool for building the layout structure of a Fluxus page. It produces a nested panel tree that defines how a page is divided into layout slots, where components can later be placed.

The editor lives inside the Shell's ContentArea when a page is open.

---

## Core Concepts

### Panel

A panel is the fundamental unit of the layout editor. Everything is a panel — the root surface, every subdivision, every layout slot. Panels nest recursively.

Each panel has:
- A **direction** (vertical or horizontal) controlling how its children are arranged
- A **size** (flex number or fixed size) controlling how it occupies space within its parent
- Zero or more **child panels**
- A set of **visual and spacing properties**

### Root Panel

The root panel is created automatically when the editor loads. It is always `100%` width and `100%` height of the containing view. Its size is not editable. It can have all other properties applied to it.

### Layout Slots

A panel with no children is a layout slot — a named region where a component can be placed. Panels with children are structural containers only.

---

## Default Behaviour

- On load: one root panel exists, is selected, is empty, fills the view
- New panels added via **Add Panel**: default size is `flex: 1`
- Default direction of any panel: **vertical**
- Two panels added to a vertical root each take `50%` height; three take `33%` each — no user intervention needed
- The selected panel always shows a visible border to indicate selection

---

## Panel Properties

Properties apply to the currently selected panel.

| Property | Type | Notes |
|---|---|---|
| Direction | vertical / horizontal | How child panels are arranged |
| Size type | Flex or Fixed | Mutually exclusive |
| — Flex number | integer ≥ 0 | Default: 1. Controls proportion of available space |
| — Fixed size | px | Explicit height (vertical parent) or width (horizontal parent) |
| Min size | px | Minimum height or width. Prevents panel collapsing to zero (critical when splitters are present) |
| Max size | px | Maximum height or width |
| Gap | px | Space between child panels |
| Padding | top / right / bottom / left (px) | Inner spacing |
| Overflow | hidden / scroll | Only relevant on fixed-size panels |
| Background colour | colour | Panel fill colour |
| Border | style / width / colour — per side | top / right / bottom / left independently |
| Border radius | px — per corner | top-left / top-right / bottom-right / bottom-left |
| Splitter | context-sensitive | See Splitter Rules below |

**Root panel exceptions:** no Size property, no Splitter.

---

## Actions

Structural operations that modify the panel tree.

| Action | Behaviour |
|---|---|
| Add Panel | Adds a child panel inside the selected panel. New panel defaults to `flex: 1`, direction: vertical |
| Delete Panel | Removes the selected panel and all its children. Root panel cannot be deleted |
| Reset | Clears the entire layout back to a blank root panel. Prompts confirmation |
| Undo | Steps back one change in history |
| Redo | Steps forward one change in history |
| Import Layout | Opens an existing saved layout and loads it into the editor |

---

## Splitter Rules

A splitter is a draggable resize handle on one edge of a panel. It makes a fixed-size panel user-resizable at runtime.

### Conditions — all must be true for a splitter to be available

1. The selected panel has a **fixed size** (not flex)
2. The side is **along the parent's flex axis** (top/bottom for vertical parent; left/right for horizontal parent)
3. There is an **adjacent sibling panel** on that side

### Valid options by case

| Situation | Options shown |
|---|---|
| Single panel (no siblings) | None |
| Top panel of 2 in vertical parent, fixed height | Bottom only |
| Bottom panel of 2 in vertical parent, fixed height | Top only |
| Middle panel of 3+ in vertical parent, fixed height | Top and Bottom |
| Left panel of 2 in horizontal parent, fixed width | Right only |
| Right panel of 2 in horizontal parent, fixed width | Left only |
| Middle panel of 3+ in horizontal parent, fixed width | Left and Right |
| Any panel with flex size | None |

### Behaviour

- The splitter handle sits on the nominated edge of the fixed-size panel
- Dragging the handle resizes that panel; the adjacent sibling flexes to fill the remainder
- Min/max size constraints are respected during drag

---

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│  Layout Editor — home                                    │
├────────────────────┬─────────────────────────────────────┤
│                    │                                      │
│  Actions           │                                      │
│  ─────────         │                                      │
│  + Add Panel       │          Canvas                      │
│  ✕ Delete Panel    │                                      │
│  ↺ Reset           │   ┌──────────────────────────────┐   │
│  ⎌ Undo            │   │ Root panel (selected)        │   │
│  ⎌ Redo            │   │                              │   │
│  ↑ Import          │   │                              │   │
│                    │   └──────────────────────────────┘   │
│  Properties        │                                      │
│  ─────────         │                                      │
│  Direction         │                                      │
│  [Vertical ▾]      │                                      │
│                    │                                      │
│  Size              │                                      │
│  ○ Flex  [1    ]   │                                      │
│  ○ Fixed [____]px  │                                      │
│                    │                                      │
│  Min [___]  Max [___]│                                    │
│  Gap [___]px       │                                      │
│  Padding           │                                      │
│  T[_] R[_] B[_] L[_]│                                    │
│                    │                                      │
│  Overflow          │                                      │
│  [Hidden ▾]        │                                      │
│                    │                                      │
│  Background [    ] │                                      │
│  Border            │                                      │
│  Radius            │                                      │
│                    │                                      │
│  Splitter          │                                      │
│  (none available)  │                                      │
└────────────────────┴─────────────────────────────────────┘
```

---

## Panel Tree Data Model

```ts
interface Panel {
  id: string;
  direction: 'vertical' | 'horizontal';
  size: { type: 'flex'; value: number } | { type: 'fixed'; value: number };
  minSize?: number;
  maxSize?: number;
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  overflow?: 'hidden' | 'scroll';
  background?: string;
  border?: {
    top?: BorderSide;
    right?: BorderSide;
    bottom?: BorderSide;
    left?: BorderSide;
  };
  borderRadius?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  splitter?: 'top' | 'bottom' | 'left' | 'right';
  children: Panel[];
}

interface BorderSide {
  style: 'solid' | 'dashed' | 'dotted' | 'none';
  width: number;
  color: string;
}

interface LayoutDefinition {
  root: Panel;
}
```

---

## Undo / Redo

The editor maintains a history stack of `LayoutDefinition` snapshots. Every structural change (add panel, delete panel, change direction, change size, etc.) pushes a new snapshot. Property changes (colour, padding etc.) also push snapshots.

Reset clears the history stack after confirmation.

---

## Relationship to Page File Format

The `LayoutDefinition` produced by the layout editor maps to the `layout` section of a page file. Layout slot IDs (leaf panels with no children) become the keys in the page file's `slots` map.

```json
{
  "layout": { ...LayoutDefinition... },
  "slots": {
    "panel-abc": { "component": "AppHeader", "props": {} },
    "panel-xyz": null
  }
}
```
