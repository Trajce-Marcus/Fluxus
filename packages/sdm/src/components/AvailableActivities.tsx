import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { AttributesForm } from './AttributesForm';
import { Modal } from './Modal';
import { ComponentLabel } from '../context/UatLabels';
import type { ActivityDef, RecordInstance, WorkflowDef } from '@fluxus/engine';

interface Props {
  record: RecordInstance;
  workflow: WorkflowDef;
}

export function AvailableActivities({ record, workflow }: Props) {
  const { runActivity, isActivityAvailable } = useAppContext();
  const [activeActivity, setActiveActivity] = useState<ActivityDef | null>(null);

  // Record-level activities: CREATE excluded (no anchor; lives in the grid).
  // Availability (activity show_condition) filters against the current record;
  // runActivity re-checks the same rule as the pipeline gate.
  const activities = workflow.activities
    .filter(a => a.record_map !== 'CREATE' && isActivityAvailable(a, record))
    .sort((a, b) => a.sort_order - b.sort_order);

  if (activities.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <ComponentLabel name="AvailableActivities" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {activities.map(a => (
          <button
            key={a.id}
            onClick={() => setActiveActivity(a)}
            style={{
              padding: '6px 14px',
              background: '#f1f5f9',
              color: '#374151',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {a.name}
          </button>
        ))}
      </div>

      {activeActivity && (
        <Modal title={activeActivity.name} onClose={() => setActiveActivity(null)}>
          <AttributesForm
            activity={activeActivity}
            anchorRecord={record}
            recordTypeId={record.typeRef}
            onSubmit={(captured, options) => {
              const result = runActivity(activeActivity, captured, record, options);
              if (result.status === 'done') setActiveActivity(null);
              return result;
            }}
            onClose={() => setActiveActivity(null)}
          />
        </Modal>
      )}
    </div>
  );
}
