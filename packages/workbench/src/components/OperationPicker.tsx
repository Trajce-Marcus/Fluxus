import { useWorkbench } from '../WorkbenchContext';

// Which operation's records the workbench shows (ruled 2026-07-31). The
// workbench's model — record types, workflows, activities — comes from the
// solution; its *data* comes from one operation's partition, and two operations
// running the same solution hold entirely different records. That split was
// invisible while the choice lived in the Console header, so the picker moved
// here, above the record types, where the data it governs is.
//
// Nothing is auto-selected: no operation until someone picks one.

export function OperationPicker() {
  const { operationId, operations, selectOperation, operationError } = useWorkbench();

  if (!selectOperation) return null;

  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: '1px solid #e2e8f0',
      background: '#fff',
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: '#64748b',
        marginBottom: 6,
      }}>
        Operation
      </div>
      {operations.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          None running this solution yet.
        </div>
      ) : (
        <select
          value={operationId ?? ''}
          onChange={(e) => selectOperation(e.target.value || null)}
          style={{
            width: '100%',
            padding: '5px 8px',
            border: '1px solid #e2e8f0',
            borderRadius: 4,
            fontSize: 13,
            fontFamily: 'inherit',
            color: operationId ? '#0f172a' : '#94a3b8',
            background: '#fff',
            outline: 'none',
          }}
        >
          <option value="">No operation selected</option>
          {operations.map((op) => (
            <option key={op.id} value={op.id}>{op.name}</option>
          ))}
        </select>
      )}
      {operationError && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c', lineHeight: 1.5 }}>
          Could not switch: {operationError}
        </div>
      )}
    </div>
  );
}

/** The shared "you have not picked an operation" line — the grid and the record
 *  pane both say it, because both are showing a partition, not the model. */
export function NoOperationNotice({ what }: { what: string }) {
  return (
    <div style={{ color: '#94a3b8', padding: 8, fontSize: 13, lineHeight: 1.6 }}>
      No operation selected — pick one above to see {what}.
      <div style={{ fontSize: 12, marginTop: 4 }}>
        Record types come from the solution; records belong to an operation.
      </div>
    </div>
  );
}
