// A record's photos, drawn (COMPONENT_PHOTOS, 2026-09-23). Shift reports carry
// photos of the shift and defects carry photos of the defect, and both are
// meant to be seen on their pages; a page showed the file name.
//
// **Almost all of it already existed.** `PhotoThumbs` lives in `capture/`,
// exported, and the workbench imports it from there — and clicking a thumbnail
// already asks the upload service for the full-size address and opens it. So
// the viewing came with the existing widget and nothing about drawing a photo
// needed writing.
//
// What was missing was a component's route to that service, and this package's
// SPEC already named it: the container assigns host services onto every
// component's resolved props, "the channel a photo cell would use to reach
// `UploadService.resolveUrl`". So this is not a new mechanism and not a fourth
// kind of property — `services` is the same host-supplied prop `RecordList`
// already takes, widened by one verb (`PageServiceHandlers.resolveUrl`), kept
// out of every service module so a script cannot mint file addresses.
//
// **It takes the field's value, not a record and a field name**, so it never
// has to know which record type it is looking at.
//
// Not built: a gallery (previous/next, arrow keys, a caption), and reordering
// or removing photos from the page — photos arrive through an activity and
// change through one.

import { PhotoThumbs } from '../capture/attributeWidgets';
import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';

interface PhotosProps {
  title?: string;
  /** The photo field's value — one stored descriptor or the list a multi
   *  attribute holds. A dynamic-data array needs no declared item shape: that
   *  rule only bites static configuration, which the builder must author. */
  value?: unknown;
  emptyMessage?: string;
  /** Supplied by the host: where `resolveUrl` comes from. */
  services?: PageServiceHandlers;
}

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

function PhotosComponent({ title, value, emptyMessage, services }: PhotosProps) {
  return (
    <div className="ph-root">
      {title && <h3 className="ph-title">{title}</h3>}
      {isEmpty(value) ? (
        <div className="ph-empty">{emptyMessage ?? 'No photos.'}</div>
      ) : !services ? (
        // Without the host's channel there is no address to load, and a broken
        // image frame would look like a missing photo rather than a missing
        // host. Every real host supplies it; this is the page builder's
        // stand-alone preview saying which half is absent.
        <div className="ph-empty">This host cannot resolve file addresses.</div>
      ) : (
        <PhotoThumbs value={value} uploads={{ resolveUrl: services.resolveUrl }} />
      )}
    </div>
  );
}

// The thumbnails are the widget's own, so there is little left to style here —
// a heading, and the empty line. Exported as a string like every component in
// this package, because the Console mounts inside a shadow root a document
// stylesheet never reaches.
const css = `
  .ph-root { font-family: system-ui, sans-serif; box-sizing: border-box; height: 100%; overflow: auto; color: #1e293b; }
  .ph-title { font-size: 1rem; margin: 0 0 0.75rem; }
  .ph-empty { color: #94a3b8; font-size: 0.8rem; }
`;

const schema: PropSchema[] = [
  { name: 'title',        kind: 'static-config', type: 'string', required: false, description: 'Heading above the photos' },
  { name: 'value',        kind: 'dynamic-data',  type: 'array',  required: true,  description: "The photo field's value — context.record.shift_photos" },
  { name: 'emptyMessage', kind: 'static-config', type: 'string', required: false, description: 'Shown when there are none' },
];

export const Photos = Object.assign(PhotosComponent, { css, schema });
