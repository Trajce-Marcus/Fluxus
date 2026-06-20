import React from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { TriggerEvent, Workflow } from '@wql/types';

const TRIGGER_EVENTS: TriggerEvent[] = [
  'wo.created', 'wo.updated', 'wo.completed', 'wo.cancelled',
  'job.created', 'job.updated', 'asset.updated',
];

const WF_STATUSES: Workflow['status'][] = ['active', 'inactive', 'draft'];

export default function TriggerConfig() {
  const { workflows, activeId, updateTrigger, updateStatus, setStatus } = useWorkflowStore();
  const active = workflows.find(w => w.id === activeId);
  if (!active) return null;

  function handleSave() {
    setStatus('Trigger saved', true);
    setTimeout(() => setStatus('WQL ready', true), 1500);
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      <div>
        <label className="block text-[11px] text-wmuted mb-1">Trigger event</label>
        <select
          value={active.trigger.event}
          onChange={e => updateTrigger(activeId, { ...active.trigger, event: e.target.value as TriggerEvent })}
          className="w-full px-2.5 py-1.5 bg-surface2 border border-border rounded-md text-white text-xs font-mono focus:outline-none focus:border-accent"
        >
          {TRIGGER_EVENTS.map(ev => (
            <option key={ev} value={ev}>{ev}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] text-wmuted mb-1">Filter by activity type <span className="text-[10px]">(optional)</span></label>
        <input
          value={active.trigger.activityType ?? ''}
          onChange={e => updateTrigger(activeId, { ...active.trigger, activityType: e.target.value || undefined })}
          placeholder="e.g. inspection, maintenance"
          className="w-full px-2.5 py-1.5 bg-surface2 border border-border rounded-md text-white text-xs font-mono focus:outline-none focus:border-accent placeholder:text-wmuted"
        />
      </div>

      <div>
        <label className="block text-[11px] text-wmuted mb-1">Filter by tenant <span className="text-[10px]">(optional)</span></label>
        <input
          value={active.trigger.tenantId ?? ''}
          onChange={e => updateTrigger(activeId, { ...active.trigger, tenantId: e.target.value || undefined })}
          placeholder="tenant-id or blank for all"
          className="w-full px-2.5 py-1.5 bg-surface2 border border-border rounded-md text-white text-xs font-mono focus:outline-none focus:border-accent placeholder:text-wmuted"
        />
      </div>

      <div>
        <label className="block text-[11px] text-wmuted mb-1">Filter by project <span className="text-[10px]">(optional)</span></label>
        <input
          value={active.trigger.projectId ?? ''}
          onChange={e => updateTrigger(activeId, { ...active.trigger, projectId: e.target.value || undefined })}
          placeholder="project-id or blank for all"
          className="w-full px-2.5 py-1.5 bg-surface2 border border-border rounded-md text-white text-xs font-mono focus:outline-none focus:border-accent placeholder:text-wmuted"
        />
      </div>

      <div>
        <label className="block text-[11px] text-wmuted mb-1">Workflow status</label>
        <select
          value={active.status}
          onChange={e => updateStatus(activeId, e.target.value as Workflow['status'])}
          className="w-full px-2.5 py-1.5 bg-surface2 border border-border rounded-md text-white text-xs font-mono focus:outline-none focus:border-accent"
        >
          {WF_STATUSES.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSave}
        className="w-full py-2 bg-accent text-white rounded-md text-xs font-medium hover:bg-blue-500 transition-colors"
      >
        Save trigger config
      </button>
    </div>
  );
}
