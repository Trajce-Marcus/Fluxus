import { useEffect, useState } from 'react';
import { useWorkbench } from '../WorkbenchContext';
import { AttributesForm } from '@fluxus/page-runtime';
import { Modal } from './Modal';
import type { ActivityDef, ActivityOption, RecordInstance, WorkflowDef } from '@fluxus/engine';

interface Props {
  record: RecordInstance;
  workflow: WorkflowDef;
}

export function AvailableActivities({ record, workflow }: Props) {
  const { runActivity, offeredActivities, snapshotVersion } = useWorkbench();
  const [activeActivity, setActiveActivity] = useState<ActivityDef | null>(null);
  // The answer, with the record it was for — so a newly selected record draws
  // nothing until its own answer arrives, rather than the last one's buttons.
  const [offered, setOffered] = useState<{ recordId: string; list: ActivityOption[] } | null>(null);

  // The server decides what is offered (`page.activities`), with the
  // designer's real roles; it re-checks the same rule when the action runs.
  // Asked again whenever the snapshot refreshes, which it does after every run.
  useEffect(() => {
    let cancelled = false;
    offeredActivities({ recordId: record.id }).then(
      (list) => { if (!cancelled) setOffered({ recordId: record.id, list }); },
      (err: unknown) => {
        console.error('[workbench] could not ask which actions are offered', err);
        if (!cancelled) setOffered({ recordId: record.id, list: [] });
      },
    );
    return () => { cancelled = true; };
  }, [offeredActivities, record.id, snapshotVersion]);

  // CREATE left out (it runs with no record — that is the grid's button), and
  // the server never offers a GET. In the workflow's order, as answered.
  const offeredIds = new Set(offered?.recordId === record.id ? offered.list.map(a => a.id) : []);
  const activities = workflow.activities
    .filter(a => a.record_map !== 'CREATE' && offeredIds.has(a.id));

  if (activities.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
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
            onSubmit={async (captured, options) => {
              const result = await runActivity(activeActivity, captured, record, options);
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
