// @fluxus/page-runtime — the run-a-page cluster (see docs/SPEC.md).
// A host connects a FluxusClient, wraps it in createPageRuntime, and embeds
// PageRenderer. Page *editing* (layout editor, palette, Monaco) stays in the
// page builder — the Console side.

export { createPageRuntime, type PageRuntime, type FoundActivity } from './runtime';
export { PageRenderer, css as pageRendererCss } from './PageRenderer';
export { ComponentContainer } from './ComponentContainer';
export { ActivityFormModal } from './ActivityFormModal';

// The standard capture form and its host seam. Shared since 2026-08-16: a page
// and the workbench open the same form, and each supplies its own host.
export { AttributesForm } from './capture/AttributesForm';
export { CaptureHostProvider, useCaptureHost } from './capture/host';
export type { CaptureHost, CaptureScript, RecordPickerProps } from './capture/host';
// Capture + display widgets for the file/photo/scalar attribute types — pure
// controlled components, used by the form here and by the workbench's grid and
// record view.
export {
  DateTimeInput,
  FileChips,
  FileInput,
  NumberInput,
  PhotoCountCell,
  PhotoInput,
  PhotoThumbs,
  TextAreaInput,
  TimeInput,
  isDescriptorValue,
  toLocalInput,
  toOffsetIso,
} from './capture/attributeWidgets';
export { componentManifests } from './componentManifests';
export { OpenPage, RunActivity } from './components/actionComponents';
export { AppHeader } from './components/AppHeader';
export { InventorList } from './components/InventorList';
export { InventorProfile } from './components/InventorProfile';
export { Map } from './components/Map';
export { RecordList } from './components/RecordList';
export { RecordTree } from './components/RecordTree';
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
export { resolvePageAnchor, createActivityFor } from './pageAnchor';
export type { Panel, BorderSide, LayoutDefinition } from './layout';
export type { PropKind, PropType, PropSchema, ComponentManifest } from './manifest';
export type {
  PageDef,
  SlotConfig,
  ContextKeyDef,
  ContextKeyType,
  PageComponentEntry,
  PageRecordDef,
} from './pageDef';
