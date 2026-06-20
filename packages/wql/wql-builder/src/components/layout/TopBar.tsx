import React from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { executeWQL } from '@wql/runtime';

export default function TopBar() {
  const {
    workflows, activeId, contextConfig,
    setLogs, setStatus, setLastRun, setActivePanel,
    updateCode,
  } = useWorkflowStore();

  const active = workflows.find(w => w.id === activeId);

  function handleSave() {
    setStatus('Saved', true);
    setTimeout(() => setStatus('WQL ready', true), 1500);
  }

  function handleRun() {
    if (!active) return;
    setStatus('Running...', true);

    setTimeout(() => {
      const result = executeWQL(active.code, contextConfig);
      setLogs(result.logs);
      setActivePanel('log');
      if (result.success) {
        setStatus('Run successful', true);
        setLastRun(new Date().toTimeString().slice(0, 8));
      } else {
        setStatus('Error: ' + result.error, false);
      }
    }, 300);
  }

  return (
    <div className="flex items-center gap-3 px-4 h-11 bg-surface border-b border-border flex-shrink-0">
      <span className="font-mono text-accent font-semibold tracking-wider text-sm">WQL</span>
      <div className="w-px h-5 bg-border" />
      <span className="font-mono text-wmuted text-xs">{active?.file ?? 'untitled.wql'}</span>
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface3 text-wmuted border border-border">
        Workflow Query Language
      </span>
      <div className="ml-auto flex gap-2 items-center">
        <button
          onClick={handleSave}
          className="px-3 py-1 rounded-md text-xs font-medium bg-transparent text-wmuted border border-border hover:text-white hover:border-accent transition-all"
        >
          Save
        </button>
        <button
          onClick={() => setActivePanel('trigger')}
          className="px-3 py-1 rounded-md text-xs font-medium bg-transparent text-wmuted border border-border hover:text-white hover:border-accent transition-all"
        >
          Configure Trigger
        </button>
        <button
          onClick={handleRun}
          className="px-3 py-1 rounded-md text-xs font-medium bg-wgreen text-white flex items-center gap-1.5 hover:bg-green-600 transition-all"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <polygon points="2,1 9,5 2,9" />
          </svg>
          Run
        </button>
      </div>
    </div>
  );
}
