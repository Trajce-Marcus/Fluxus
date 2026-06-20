import React, { useEffect, useRef } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { LogLine } from '@wql/types';

const LEVEL_CLASS: Record<LogLine['level'], string> = {
  info:    'text-white',
  action:  'text-accent',
  success: 'text-wgreen',
  warn:    'text-wamber',
  error:   'text-wred',
};

export default function ExecutionLog() {
  const { logs } = useWorkflowStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className="flex-1 p-3 font-mono text-[11px] text-wmuted">
        No executions yet. Press Run to execute.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px]">
      {logs.map((line, i) => (
        <div key={i} className="flex gap-2.5 py-0.5 border-b border-border">
          <span className="text-wmuted flex-shrink-0">{line.time}</span>
          <span className={LEVEL_CLASS[line.level]}>{line.msg}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
