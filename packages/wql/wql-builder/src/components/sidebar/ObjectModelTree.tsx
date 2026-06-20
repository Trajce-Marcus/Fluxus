import React, { useState } from 'react';

interface TreeNode {
  label: string;
  type?: string;
  method?: boolean;
  children?: TreeNode[];
}

const MODEL: TreeNode[] = [
  {
    label: 'wo',
    children: [
      { label: 'woId',         type: 'uuid' },
      { label: 'status',       type: 'string' },
      { label: 'dueDate',      type: 'date' },
      { label: 'activityType', type: 'string' },
      { label: 'assignedTo',   type: 'User' },
      { label: 'asset',        type: 'Asset?' },
      {
        label: 'attributes', type: 'Attribute[]',
        children: [
          { label: '.find(fn)',   method: true },
          { label: '.filter(fn)', method: true },
        ],
      },
      {
        label: 'job', type: 'Job',
        children: [
          { label: 'job.jobNo',       type: 'string' },
          { label: 'job.status',      type: 'string' },
          { label: 'job.attributes',  type: 'Attribute[]' },
          { label: 'job.workOrders',  type: 'WO[]' },
          { label: 'job.project',     type: 'Project' },
        ],
      },
    ],
  },
  {
    label: 'wf',
    children: [
      { label: 'now',       type: 'date' },
      { label: 'trigger',   type: 'string' },
      { label: 'owner',     type: 'User' },
      { label: '.log(msg)',    method: true },
      { label: '.error(msg)',  method: true },
      { label: '.notify(user)', method: true },
    ],
  },
  {
    label: 'Attribute',
    children: [
      { label: 'code',  type: 'string' },
      { label: 'value', type: 'string' },
      { label: '.value.toInt()',  method: true },
      { label: '.value.toDate()', method: true },
      { label: '.value.toBool()', method: true },
    ],
  },
  {
    label: 'Asset',
    children: [
      { label: 'assetId',   type: 'uuid' },
      { label: 'assetNo',   type: 'string' },
      { label: 'assetType', type: 'string' },
      { label: 'status',    type: 'string' },
      { label: 'attributes', type: 'Attribute[]' },
    ],
  },
];

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        onClick={() => hasChildren && setOpen(o => !o)}
        className={`flex items-center gap-1 py-0.5 font-mono text-[11px] cursor-pointer
          ${depth === 0 ? 'text-white font-medium py-1' : 'text-wmuted hover:text-accent pl-3 border-l border-border ml-1'}
          ${node.method ? 'text-green-400' : ''}
        `}
      >
        {hasChildren && (
          <span className="text-wmuted text-[9px] w-3">{open ? '▾' : '▸'}</span>
        )}
        <span className={node.method ? 'text-green-400' : depth === 0 ? 'text-white' : 'text-sky-300'}>
          {node.label}
        </span>
        {node.type && (
          <span className="text-purple-400 text-[10px] ml-1">: {node.type}</span>
        )}
      </div>
      {hasChildren && open && (
        <div className="ml-2">
          {node.children!.map((child, i) => (
            <TreeItem key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ObjectModelTree() {
  return (
    <div className="p-3 flex-1 overflow-y-auto">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-wmuted mb-2">
        Object model
      </div>
      {MODEL.map((node, i) => (
        <div key={i} className="mb-1">
          <TreeItem node={node} depth={0} />
        </div>
      ))}
    </div>
  );
}
