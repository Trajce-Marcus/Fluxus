import React from 'react';
import WQLEditor from './WQLEditor';
import StatusBar from './StatusBar';
import { useWorkflowStore } from '../../store/workflowStore';

export default function EditorArea() {
  const { workflows, activeId } = useWorkflowStore();
  const active = workflows.find(w => w.id === activeId);

  return (
    <div className="flex flex-col overflow-hidden min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 bg-surface border-b border-border flex-shrink-0">
        <div className="px-3 py-2 text-xs font-mono text-white border-b-2 border-accent cursor-default">
          {active?.file ?? 'untitled.wql'}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <WQLEditor />
      </div>

      <StatusBar />
    </div>
  );
}
