import React from 'react';
import WorkflowList from './WorkflowList';
import ObjectModelTree from './ObjectModelTree';

export default function Sidebar() {
  return (
    <div className="flex flex-col bg-surface border-r border-border overflow-hidden">
      <WorkflowList />
      <ObjectModelTree />
    </div>
  );
}
