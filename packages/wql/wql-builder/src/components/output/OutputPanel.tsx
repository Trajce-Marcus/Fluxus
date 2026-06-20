import React from 'react';
import ContextPanel from './ContextPanel';
import ExecutionLog from './ExecutionLog';
import TriggerConfig from './TriggerConfig';
import { useWorkflowStore } from '../../store/workflowStore';

const TABS = [
  { id: 'context', label: 'Context' },
  { id: 'log',     label: 'Execution log' },
  { id: 'trigger', label: 'Trigger' },
] as const;

export default function OutputPanel() {
  const { activePanel, setActivePanel } = useWorkflowStore();

  return (
    <div className="flex flex-col bg-surface border-l border-border overflow-hidden min-h-0">
      {/* Tabs */}
      <div className="flex bg-surface2 border-b border-border flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActivePanel(tab.id)}
            className={`px-3.5 py-2 text-[11px] border-b-2 transition-colors ${
              activePanel === tab.id
                ? 'text-white border-accent'
                : 'text-wmuted border-transparent hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {activePanel === 'context' && <ContextPanel />}
        {activePanel === 'log'     && <ExecutionLog />}
        {activePanel === 'trigger' && <TriggerConfig />}
      </div>
    </div>
  );
}
