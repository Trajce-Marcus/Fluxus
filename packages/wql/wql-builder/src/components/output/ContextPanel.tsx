import React from 'react';
import { useWorkflowStore } from '../../store/workflowStore';

interface CtxRowProps {
  label: string;
  value: string;
  kind?: 'str' | 'num' | 'bool';
}

function CtxRow({ label, value, kind = 'str' }: CtxRowProps) {
  const valueClass =
    kind === 'num'  ? 'text-pink-300' :
    kind === 'bool' ? 'text-wamber' :
    'text-green-300';
  return (
    <div className="flex justify-between items-center px-2 py-1 rounded bg-surface2 mb-0.5">
      <span className="font-mono text-[11px] text-sky-300">{label}</span>
      <span className={`font-mono text-[11px] ${valueClass}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-wmuted mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

export default function ContextPanel() {
  const { contextConfig } = useWorkflowStore();
  return (
    <div className="flex-1 overflow-y-auto p-3">
      <Section title="wo">
        <CtxRow label="woId"         value={`"${contextConfig.woId}"`} />
        <CtxRow label="status"       value={`"${contextConfig.status}"`} />
        <CtxRow label="activityType" value={`"${contextConfig.activityType}"`} />
        <CtxRow label="dueDate"      value={`"${contextConfig.dueDate}"`} />
        <CtxRow label="asset.status" value={`"${contextConfig.assetStatus}"`} />
      </Section>
      <Section title="wo.attributes">
        <CtxRow label="riskScore"   value={String(contextConfig.riskScore)} kind="num" />
        <CtxRow label="priority"    value={`"${contextConfig.priority}"`} />
        <CtxRow label="KPI missed"  value="false" kind="bool" />
      </Section>
      <Section title="wo.job">
        <CtxRow label="jobId"  value='"job-901"' />
        <CtxRow label="jobNo"  value='"JOB-2024-0042"' />
        <CtxRow label="status" value='"active"' />
        <CtxRow label="workOrders (2)" value="1 done, 1 pending" />
      </Section>
      <Section title="wf">
        <CtxRow label="now"        value='"2026-04-03"' />
        <CtxRow label="trigger"    value='"wo.updated"' />
        <CtxRow label="owner.name" value='"Alex Chen"' />
      </Section>
    </div>
  );
}
