interface MapProps {
  x: number;
  y: number;
}

const WIDTH = 320;
const HEIGHT = 320;
const PADDING = 32;
const RANGE = 100; // coordinate space: 0–100 on each axis

function toSvg(val: number, axis: 'x' | 'y'): number {
  const ratio = val / RANGE;
  if (axis === 'x') return PADDING + ratio * (WIDTH - PADDING * 2);
  // y-axis: flip so 0 is at the bottom
  return HEIGHT - PADDING - ratio * (HEIGHT - PADDING * 2);
}

const GRID_LINES = [0, 25, 50, 75, 100];

function MapComponent({ x, y }: MapProps) {
  const cx = toSvg(x, 'x');
  const cy = toSvg(y, 'y');

  return (
    <div className="map-card">
      <div className="map-title">Map</div>
      <svg width={WIDTH} height={HEIGHT} className="map-svg">
        {/* Grid lines */}
        {GRID_LINES.map((v) => (
          <g key={v}>
            <line
              x1={toSvg(v, 'x')} y1={PADDING}
              x2={toSvg(v, 'x')} y2={HEIGHT - PADDING}
              stroke="#e5e7eb" strokeWidth={1}
            />
            <line
              x1={PADDING} y1={toSvg(v, 'y')}
              x2={WIDTH - PADDING} y2={toSvg(v, 'y')}
              stroke="#e5e7eb" strokeWidth={1}
            />
            <text x={toSvg(v, 'x')} y={HEIGHT - 8} textAnchor="middle" className="map-label">{v}</text>
            <text x={10} y={toSvg(v, 'y') + 4} textAnchor="middle" className="map-label">{v}</text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PADDING} y1={PADDING} x2={PADDING} y2={HEIGHT - PADDING} stroke="#9ca3af" strokeWidth={1.5} />
        <line x1={PADDING} y1={HEIGHT - PADDING} x2={WIDTH - PADDING} y2={HEIGHT - PADDING} stroke="#9ca3af" strokeWidth={1.5} />

        {/* Crosshair */}
        <line x1={cx} y1={PADDING} x2={cx} y2={HEIGHT - PADDING} stroke="#4f46e5" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
        <line x1={PADDING} y1={cy} x2={WIDTH - PADDING} y2={cy} stroke="#4f46e5" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />

        {/* Marker */}
        <circle cx={cx} cy={cy} r={7} fill="#4f46e5" />
        <circle cx={cx} cy={cy} r={3} fill="white" />

        {/* Coordinate label */}
        <text x={cx + 10} y={cy - 10} className="map-coord">({x}, {y})</text>
      </svg>
    </div>
  );
}

const css = `
  .map-card {
    font-family: system-ui, sans-serif;
    background: white;
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    display: inline-block;
  }
  .map-title {
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #111;
  }
  .map-svg { display: block; }
  .map-label {
    font-size: 10px;
    fill: #9ca3af;
    font-family: system-ui, sans-serif;
  }
  .map-coord {
    font-size: 12px;
    fill: #4f46e5;
    font-weight: 600;
    font-family: system-ui, sans-serif;
  }
`;

import type { PropSchema } from './schema';

const schema: PropSchema[] = [
  { name: 'x', kind: 'dynamic-data', type: 'number', required: true,  description: 'X coordinate (0–100)' },
  { name: 'y', kind: 'dynamic-data', type: 'number', required: true,  description: 'Y coordinate (0–100)' },
];

export const Map = Object.assign(MapComponent, { css, schema });
