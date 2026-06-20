import React from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { Workflow } from '@wql/types';

const STATUS_DOT: Record<Workflow['status'], string> = {
  active:   'bg-wgreen',
  inactive: 'bg-wamber',
  draft:    'bg-wmuted',
};

export default function WorkflowList() {
  const { workflows, activeId, setActiveId, addWorkflow } = useWorkflowStore();

  function handleNew() {
    const id = 'wf-' + Date.now();
    addWorkflow({
      id,
      name: 'New workflow',
      file: 'untitled.wql',
      status: 'draft',
      trigger: { event: 'wo.updated' },
      code: '// New workflow\n// Trigger: wo.updated\n\n',
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    });
  }

  return (
    <div className="p-3 border-b border-border">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-wmuted mb-2">
        Workflows
      </div>
      {workflows.map(wf => (
        <div
          key={wf.id}
          onClick={() => setActiveId(wf.id)}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer mb-0.5 transition-colors ${
            wf.id === activeId
              ? 'bg-surface3 text-accent'
              : 'hover:bg-surface2 text-white'
          }`}
        >
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[wf.status]}`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs truncate">{wf.name}</div>
            <div className="text-[10px] text-wmuted font-mono truncate">on: {wf.trigger.event}</div>
          </div>
        </div>
      ))}
      <button
        onClick={handleNew}
        className="mt-2 w-full px-2 py-1.5 rounded-md text-xs text-wmuted border border-border hover:text-white hover:border-accent transition-all bg-transparent"
      >
        + New workflow
      </button>
    </div>
  );
}
