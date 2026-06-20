import Editor from '@monaco-editor/react';
import { registerWQLLanguage } from '@wql/runtime';
import { useWorkflowStore } from '../../store/workflowStore';

export default function WQLEditor() {
  const { workflows, activeId, updateCode, setCursorPos } = useWorkflowStore();
  const active = workflows.find(w => w.id === activeId);

  function handleChange(value: string | undefined) {
    if (value !== undefined) updateCode(activeId, value);
  }

  return (
    <Editor
      height="100%"
      language="wql"
      theme="wql-dark"
      beforeMount={(monaco) => registerWQLLanguage(monaco)}
      value={active?.code ?? ''}
      onChange={handleChange}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        wordWrap: 'on',
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
      }}
      onMount={(editor) => {
        editor.onDidChangeCursorPosition(e => {
          setCursorPos(e.position.lineNumber, e.position.column);
        });
      }}
    />
  );
}
