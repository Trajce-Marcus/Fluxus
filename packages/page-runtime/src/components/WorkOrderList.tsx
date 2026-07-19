// Demo app component for Extraction stage 2: an implementer-built, model-blind
// work order list whose named callbacks are wired (in the container config) to
// activities. Note the callback contract: (record, data object).

import type { PropSchema } from '../manifest';

export interface WorkOrderRow {
  id: string;
  location: string;
  status: string;
  crew: string;
  due_date: string;
}

interface WorkOrderListProps {
  workOrders: WorkOrderRow[];
  /** Named callback: dispatch this work order. Emits (record, { crew }). */
  onDispatch?: (record: string, data: { crew: string }) => void;
  /** Named callback: reschedule. Emits (record) — the activity's form captures the rest. */
  onReschedule?: (record: string) => void;
}

function WorkOrderListComponent({ workOrders = [], onDispatch, onReschedule }: WorkOrderListProps) {
  return (
    <div className="wol-root">
      <h2 className="wol-title">Work Orders</h2>
      <table className="wol-table">
        <thead>
          <tr><th>WO</th><th>Location</th><th>Status</th><th>Crew</th><th>Due</th><th></th></tr>
        </thead>
        <tbody>
          {workOrders.map((wo) => (
            <tr key={wo.id}>
              <td className="wol-id">{wo.id}</td>
              <td>{wo.location}</td>
              <td><span className={`wol-status wol-status--${wo.status.toLowerCase()}`}>{wo.status}</span></td>
              <td>{wo.crew || '—'}</td>
              <td>{wo.due_date}</td>
              <td className="wol-actions">
                {onDispatch && (
                  <button className="wol-btn" onClick={() => onDispatch(wo.id, { crew: 'Crew A' })}>
                    Dispatch
                  </button>
                )}
                {onReschedule && (
                  <button className="wol-btn wol-btn--ghost" onClick={() => onReschedule(wo.id)}>
                    Reschedule
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const css = `
  .wol-root { font-family: system-ui, sans-serif; padding: 1rem; }
  .wol-title { font-size: 1rem; margin: 0 0 0.75rem; }
  .wol-table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  .wol-table th { text-align: left; color: #64748b; font-weight: 600; padding: 4px 10px 4px 0; border-bottom: 1px solid #e2e8f0; }
  .wol-table td { padding: 6px 10px 6px 0; border-bottom: 1px solid #f1f5f9; }
  .wol-id { font-weight: 700; }
  .wol-status { padding: 1px 8px; border-radius: 999px; font-size: 0.7rem; background: #f1f5f9; }
  .wol-status--dispatched { background: #dcfce7; color: #166534; }
  .wol-actions { white-space: nowrap; }
  .wol-btn { padding: 3px 10px; margin-right: 6px; border: none; border-radius: 4px; background: #2563eb; color: #fff; cursor: pointer; font-size: 0.72rem; }
  .wol-btn--ghost { background: #fff; color: #2563eb; border: 1px solid #93c5fd; }
`;

const schema: PropSchema[] = [
  { name: 'workOrders',   kind: 'dynamic-data', type: 'array',    required: true,  description: 'Work order rows (id, location, status, crew, due_date)' },
  { name: 'onDispatch',   kind: 'callback',     type: 'function', required: false, description: 'Dispatch a work order — emits (record, { crew })' },
  { name: 'onReschedule', kind: 'callback',     type: 'function', required: false, description: 'Reschedule a work order — emits (record)' },
];

export const WorkOrderList = Object.assign(WorkOrderListComponent, { css, schema });
