// A point on a map. Replaces the demo Map (a dot on a 0–100 grid) that came
// from the react-in-html prototype and stood for nothing real.
//
// Deliberately the smallest thing that works: an OpenStreetMap embed in an
// iframe, one marker, no key, no account, no script to load. The frame's
// vocabulary is a bounding box plus `marker=<lat>,<lng>` — it cannot label a
// pin or draw a second one, which is why the component takes neither. Zoom is
// expressed as the box we ask for, since the embed has no zoom parameter.
//
// The interface is the narrow one the user ruled for this first cut: one
// point, one pin. Lines, polygons and lists of points are expected later, and
// will take a different service (a real map library over tiles) — the props
// here are the ones that survive that change, not a shape chosen to be
// extended in place.

import type { PropSchema } from '../manifest';

interface MapProps {
  lat: number;
  lng: number;
  /** Map zoom, 1 (the globe) to 19 (a building). Blank shows a suburb. */
  zoom?: number;
}

const DEFAULT_ZOOM = 13;

/**
 * Half-width in degrees of longitude for a zoom level — the embed takes a box,
 * not a zoom. Level 13 is about 0.04°, and each level halves it, which is what
 * a slippy map's zoom means. Latitude uses half the span so the box matches the
 * frame's landscape shape rather than stretching the view.
 */
function halfSpan(zoom: number): number {
  const level = Math.min(19, Math.max(1, Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM));
  return 0.04 * 2 ** (DEFAULT_ZOOM - level);
}

/** Degrees, or NaN for anything that is not a reading — blank included, since
 *  `Number('')` is 0 and 0,0 is a point in the Gulf of Guinea, not "nowhere". */
const degrees = (value: unknown): number =>
  value === '' || value === null || value === undefined ? NaN : Number(value);

function MapComponent({ lat, lng, zoom }: MapProps) {
  const y = degrees(lat);
  const x = degrees(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) {
    return <div className="map-card map-empty">No location</div>;
  }

  const dx = halfSpan(degrees(zoom ?? DEFAULT_ZOOM));
  const dy = dx / 2;
  const bbox = [x - dx, y - dy, x + dx, y + dy].map((n) => n.toFixed(6)).join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${y.toFixed(6)},${x.toFixed(6)}`;

  return (
    <div className="map-card">
      <iframe className="map-frame" src={src} title="Map" loading="lazy" />
      <a className="map-link" href={`https://www.openstreetmap.org/?mlat=${y}&mlon=${x}#map=${Math.round(degrees(zoom) || DEFAULT_ZOOM)}/${y}/${x}`}
        target="_blank" rel="noreferrer">View larger map</a>
    </div>
  );
}

// The component states its own size, and the page gives it an `auto` panel.
// A map has a shape — a landscape frame — where a table has only a width, so
// "as tall as the window leaves" is the wrong answer for one. 700px wide is
// the user's call (2026-09-22), and it stops short of the page's full width on
// purpose; below that it fills what it is given and keeps the proportion.
const css = `
  .map-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 700px;
    font-family: system-ui, sans-serif;
  }
  .map-frame {
    width: 100%;
    aspect-ratio: 16 / 10;
    /* If aspect-ratio is not honoured, a landscape frame still stands. */
    min-height: 300px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #f8fafc;
  }
  .map-link {
    margin-top: 6px;
    font-size: 12px;
    color: #4f46e5;
    text-decoration: none;
  }
  .map-link:hover { text-decoration: underline; }
  .map-empty {
    align-items: center;
    justify-content: center;
    min-height: 120px;
    color: #9ca3af;
    font-size: 13px;
    border: 1px dashed #e5e7eb;
    border-radius: 8px;
  }
`;

const schema: PropSchema[] = [
  { name: 'lat', kind: 'dynamic-data', type: 'number', required: true, description: 'Latitude in degrees (WGS 84)' },
  { name: 'lng', kind: 'dynamic-data', type: 'number', required: true, description: 'Longitude in degrees (WGS 84)' },
  { name: 'zoom', kind: 'static-config', type: 'number', required: false, description: 'Zoom 1–19; blank shows the suburb' },
];

export const Map = Object.assign(MapComponent, { css, schema });
