import { forwardRef } from 'react';
import type { RecordTypeDef } from '@fluxus/engine';

interface Props {
  typeDef: RecordTypeDef;
  highlightFields?: string[];
  isFocal?: boolean;
  onClick?: () => void;
}

export const SchemaNavCard = forwardRef<HTMLDivElement, Props>(
  ({ typeDef, highlightFields = [], isFocal = false, onClick }, ref) => (
    <div
      ref={ref}
      onClick={onClick}
      style={{
        width: 180,
        border: `2px solid ${isFocal ? '#3b82f6' : '#e2e8f0'}`,
        borderRadius: 8,
        padding: '10px 14px',
        background: isFocal ? '#eff6ff' : '#f8fafc',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        boxShadow: isFocal ? '0 0 0 3px #bfdbfe' : '0 1px 3px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.12s',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 8 }}>
        {typeDef.name}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {typeDef.custom_fields.map(f => {
          const highlighted = highlightFields.includes(f.key);
          return (
            <div
              key={f.key}
              data-fieldkey={f.key}
              style={{
                fontSize: 11,
                padding: '1px 4px',
                borderRadius: 3,
                background: highlighted ? '#dbeafe' : 'transparent',
                color: highlighted ? '#1d4ed8' : '#64748b',
                fontWeight: highlighted ? 600 : 400,
              }}
            >
              <span style={{ float: 'right', fontSize: 10 }}>{f.type}</span>
              {f.key}
            </div>
          );
        })}
      </div>
    </div>
  )
);
SchemaNavCard.displayName = 'SchemaNavCard';
