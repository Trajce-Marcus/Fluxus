import React from 'react';
import { useWorkflowStore } from '../../store/workflowStore';

export default function StatusBar() {
  const { statusMsg, statusOk, cursorPos, lastRun } = useWorkflowStore();
  return (
    <div className="flex items-center gap-4 px-3 py-1 bg-surface2 border-t border-border text-[10px] font-mono flex-shrink-0">
      <span className={statusOk ? 'text-wgreen' : 'text-wred'}>{statusMsg}</span>
      <span className="text-wmuted">Ln {cursorPos.line}, Col {cursorPos.col}</span>
      <span className="text-wmuted">WQL</span>
      {lastRun && (
        <span className="ml-auto text-wmuted">Last run: {lastRun}</span>
      )}
    </div>
  );
}
