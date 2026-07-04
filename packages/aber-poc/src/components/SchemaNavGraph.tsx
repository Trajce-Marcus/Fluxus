import { useRef, useState, useLayoutEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { SchemaNavCard } from './SchemaNavCard';

type Cardinality = '1:1' | 'N:1';

interface SvgLine {
  x1: number; y1: number;
  x2: number; y2: number;
  cardinality: Cardinality;
}

interface Props {
  focalTypeId: string;
  onSelectType: (typeId: string) => void;
}

function fieldMidY(cardEl: HTMLElement, fieldKey: string | undefined, containerTop: number): number {
  const fallback = () => {
    const r = cardEl.getBoundingClientRect();
    return r.top - containerTop + r.height / 2;
  };
  if (!fieldKey) return fallback();
  const el = cardEl.querySelector(`[data-fieldkey="${fieldKey}"]`) as HTMLElement | null;
  if (!el) return fallback();
  const r = el.getBoundingClientRect();
  return r.top - containerTop + r.height / 2;
}

export function SchemaNavGraph({ focalTypeId, onSelectType }: Props) {
  const { getRecordTypeDef, getReverseRefs } = useAppContext();

  const focalDef = getRecordTypeDef(focalTypeId);
  if (!focalDef) return <div style={{ color: '#94a3b8', padding: 24 }}>Unknown type.</div>;

  const forwardFKs = focalDef.custom_fields
    .filter(f => f.type === 'fk_ref' && f.fk_record_type)
    .map(f => ({ fieldKey: f.key, targetTypeId: f.fk_record_type!, isUnique: f.unique ?? false }));

  const seenTargets = new Set<string>();
  const uniqueForward = forwardFKs.filter(f => {
    if (seenTargets.has(f.targetTypeId)) return false;
    seenTargets.add(f.targetTypeId);
    return true;
  });

  const reverseRefs = getReverseRefs(focalTypeId);
  const seenSources = new Set<string>();
  const uniqueReverse = reverseRefs.filter(r => {
    if (seenSources.has(r.sourceTypeId)) return false;
    seenSources.add(r.sourceTypeId);
    return true;
  });

  const focalFKKeys = forwardFKs.map(f => f.fieldKey);

  const sourceFieldsFor = (sourceTypeId: string) => {
    const def = getRecordTypeDef(sourceTypeId);
    if (!def) return [];
    return def.custom_fields
      .filter(f => f.type === 'fk_ref' && f.fk_record_type === focalTypeId)
      .map(f => f.key);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const focalWrapRef = useRef<HTMLDivElement>(null);
  const leftRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rightRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [svgLines, setSvgLines] = useState<SvgLine[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    leftRefs.current = leftRefs.current.slice(0, uniqueForward.length);
    rightRefs.current = rightRefs.current.slice(0, uniqueReverse.length);

    if (!containerRef.current || !focalWrapRef.current) return;
    const cr = containerRef.current.getBoundingClientRect();
    const fr = focalWrapRef.current.getBoundingClientRect();

    const lines: SvgLine[] = [];

    uniqueForward.forEach((fk, i) => {
      const leftEl = leftRefs.current[i];
      if (!leftEl) return;
      const targetDef = getRecordTypeDef(fk.targetTypeId);
      const targetAnchorKey = targetDef?.id_field ?? targetDef?.custom_fields[0]?.key;
      const leftRect = leftEl.getBoundingClientRect();
      lines.push({
        x1: fr.left - cr.left,
        y1: fieldMidY(focalWrapRef.current!, fk.fieldKey, cr.top),
        x2: leftRect.right - cr.left,
        y2: fieldMidY(leftEl, targetAnchorKey, cr.top),
        cardinality: fk.isUnique ? '1:1' : 'N:1',
      });
    });

    uniqueReverse.forEach((rev, i) => {
      const rightEl = rightRefs.current[i];
      if (!rightEl) return;
      const sourceDef = getRecordTypeDef(rev.sourceTypeId);
      if (!sourceDef) return;
      const fkFieldDef = sourceDef.custom_fields.find(f => f.key === rev.fieldKey);
      const focalAnchorKey = focalDef.id_field ?? focalDef.custom_fields[0]?.key;
      const rightRect = rightEl.getBoundingClientRect();
      lines.push({
        x1: rightRect.left - cr.left,
        y1: fieldMidY(rightEl, rev.fieldKey, cr.top),
        x2: fr.right - cr.left,
        y2: fieldMidY(focalWrapRef.current!, focalAnchorKey, cr.top),
        cardinality: fkFieldDef?.unique ? '1:1' : 'N:1',
      });
    });

    setSvgLines(lines);
    setSvgSize({ w: cr.width, h: cr.height });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focalTypeId, uniqueForward.length, uniqueReverse.length]);

  const colStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    minWidth: 200,
    zIndex: 1,
    position: 'relative',
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 380,
        padding: '32px 24px',
      }}
    >
      {svgSize.w > 0 && (
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: svgSize.w,
            height: svgSize.h,
            pointerEvents: 'none',
            overflow: 'visible',
            zIndex: 2,
          }}
        >
          {svgLines.map((line, i) => {
            const dx = Math.abs(line.x2 - line.x1) * 0.5;
            const cx1 = line.x1 - dx;
            const cx2 = line.x2 + dx;
            const midX = (line.x1 + line.x2) / 2;
            const midY = (line.y1 + line.y2) / 2;
            const labelW = line.cardinality === '1:1' ? 22 : 26;
            return (
              <g key={i}>
                <path
                  d={`M ${line.x1},${line.y1} C ${cx1},${line.y1} ${cx2},${line.y2} ${line.x2},${line.y2}`}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth="1.5"
                />
                <circle cx={line.x1} cy={line.y1} r={3} fill="#94a3b8" />
                <circle cx={line.x2} cy={line.y2} r={3} fill="#94a3b8" />
                <rect x={midX - labelW / 2} y={midY - 9} width={labelW} height={16} rx={4} fill="white" stroke="#e2e8f0" strokeWidth={1} />
                <text x={midX} y={midY + 4} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill="#64748b">
                  {line.cardinality}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {/* Left column — FK targets */}
      <div style={colStyle}>
        {uniqueForward.length > 0 ? uniqueForward.map((fk, i) => {
          const def = getRecordTypeDef(fk.targetTypeId);
          if (!def) return null;
          const targetAnchorKey = def.id_field ?? def.custom_fields[0]?.key;
          return (
            <SchemaNavCard
              key={fk.targetTypeId}
              ref={el => { leftRefs.current[i] = el; }}
              typeDef={def}
              highlightFields={targetAnchorKey ? [targetAnchorKey] : []}
              onClick={() => onSelectType(fk.targetTypeId)}
            />
          );
        }) : (
          <div style={{ color: '#e2e8f0', fontSize: 12, fontStyle: 'italic' }}>No forward FKs</div>
        )}
      </div>

      {/* Centre — focal RT */}
      <div style={{ ...colStyle, flex: '0 0 auto' }}>
        <div ref={focalWrapRef}>
          <SchemaNavCard
            typeDef={focalDef}
            isFocal
            highlightFields={[
              ...focalFKKeys,
              ...(uniqueReverse.length > 0
                ? [(focalDef.id_field ?? focalDef.custom_fields[0]?.key)].filter(Boolean) as string[]
                : []),
            ]}
          />
        </div>
      </div>

      {/* Right column — reverse FK sources */}
      <div style={colStyle}>
        {uniqueReverse.length > 0 ? uniqueReverse.map((rev, i) => {
          const def = getRecordTypeDef(rev.sourceTypeId);
          if (!def) return null;
          return (
            <SchemaNavCard
              key={rev.sourceTypeId}
              ref={el => { rightRefs.current[i] = el; }}
              typeDef={def}
              highlightFields={sourceFieldsFor(rev.sourceTypeId)}
              onClick={() => onSelectType(rev.sourceTypeId)}
            />
          );
        }) : (
          <div style={{ color: '#e2e8f0', fontSize: 12, fontStyle: 'italic' }}>Not referenced</div>
        )}
      </div>
    </div>
  );
}
