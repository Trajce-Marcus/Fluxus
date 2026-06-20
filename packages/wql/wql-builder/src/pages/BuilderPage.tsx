import React from 'react';
import TopBar from '../components/layout/TopBar';
import Sidebar from '../components/sidebar/Sidebar';
import EditorArea from '../components/editor/EditorArea';
import OutputPanel from '../components/output/OutputPanel';

export default function BuilderPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden min-h-0" style={{ display: 'grid', gridTemplateColumns: '220px 1fr 300px' }}>
        <Sidebar />
        <EditorArea />
        <OutputPanel />
      </div>
    </div>
  );
}
