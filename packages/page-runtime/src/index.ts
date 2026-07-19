// @fluxus/page-runtime — the run-a-page cluster (see docs/SPEC.md).
// A host connects a FluxusClient, wraps it in createPageRuntime, and embeds
// PageRenderer. Page *editing* (layout editor, palette, Monaco) stays in the
// page builder — the Console side.

export { createPageRuntime, type PageRuntime, type FoundActivity } from './runtime';
export { PageRenderer, css as pageRendererCss } from './PageRenderer';
export { ComponentContainer } from './ComponentContainer';
export { ActivityFormModal } from './ActivityFormModal';
export { componentManifests } from './componentManifests';
export { AppHeader } from './components/AppHeader';
export { InventorList } from './components/InventorList';
export { InventorProfile } from './components/InventorProfile';
export { Map } from './components/Map';
export { WorkOrderList } from './components/WorkOrderList';
export {
  packCallbackData,
  buildPageServices,
  pageServicesStub,
  toComponentValue,
  type CallbackPayload,
  type PageContext,
  type PageServiceHandlers,
} from './pageHost';
export { type PageFinding, type PageValidationHost } from './validatePage';
export type { Panel, BorderSide, LayoutDefinition } from './layout';
export type { PropKind, PropType, PropSchema, ComponentManifest } from './manifest';
export type {
  PageDef,
  SlotConfig,
  ContextKeyDef,
  ContextKeyType,
  PageComponentEntry,
} from './pageDef';
