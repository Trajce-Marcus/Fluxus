import type * as Monaco from 'monaco-editor';

export function registerWQLLanguage(monaco: typeof Monaco) {
  monaco.languages.register({ id: 'wql' });

  monaco.languages.setMonarchTokensProvider('wql', {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\b(wo|wf)\b/, 'wql-object'],
        [/\b(notify|log|error|toInt|toDate|toBool|find|filter|every|some)\b/, 'wql-method'],
        [/\b(if|else|const|let|var|return|true|false|null|undefined)\b/, 'keyword'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\d+/, 'number'],
        [/[a-zA-Z_]\w*/, 'identifier'],
        [/[{}()\[\]]/, 'bracket'],
        [/[=><!+\-*\/&|?:.]/, 'operator'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration('wql', {
    comments: { lineComment: '//' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  monaco.editor.defineTheme('wql-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment',    foreground: '4a5568', fontStyle: 'italic' },
      { token: 'wql-object', foreground: '7dd3fc', fontStyle: 'bold' },
      { token: 'wql-method', foreground: '86efac' },
      { token: 'keyword',    foreground: 'c084fc' },
      { token: 'string',     foreground: 'fcd34d' },
      { token: 'number',     foreground: 'f9a8d4' },
      { token: 'operator',   foreground: '94a3b8' },
    ],
    colors: {
      'editor.background':                 '#0f1117',
      'editor.foreground':                 '#e2e8f0',
      'editorLineNumber.foreground':       '#2a3348',
      'editorLineNumber.activeForeground': '#4f8ef7',
      'editor.selectionBackground':        '#1e3a5f',
      'editorCursor.foreground':           '#4f8ef7',
      'editor.lineHighlightBackground':    '#161b27',
      'editorGutter.background':           '#0f1117',
    },
  });

  // Basic autocomplete for wo and wf context objects
  monaco.languages.registerCompletionItemProvider('wql', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const wordBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const suggestions: Monaco.languages.CompletionItem[] = [];
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column,
        endColumn: position.column,
      };

      if (wordBefore.endsWith('wo.')) {
        ['woId', 'status', 'activityType', 'dueDate', 'assignedTo', 'asset', 'attributes', 'job'].forEach(label => {
          suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Field, insertText: label, range });
        });
      } else if (wordBefore.endsWith('wf.')) {
        ['now', 'trigger', 'owner', 'log()', 'error()', 'notify()'].forEach(label => {
          suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Method, insertText: label.replace('()', '($0)'), insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range });
        });
      } else if (wordBefore.endsWith('wo.job.')) {
        ['jobId', 'jobNo', 'status', 'attributes', 'workOrders', 'project'].forEach(label => {
          suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Field, insertText: label, range });
        });
      } else if (wordBefore.endsWith('wo.asset.')) {
        ['assetId', 'assetNo', 'assetType', 'status', 'attributes'].forEach(label => {
          suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Field, insertText: label, range });
        });
      } else if (wordBefore.endsWith('.value.')) {
        ['toInt()', 'toDate()', 'toBool()', 'toString()'].forEach(label => {
          suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Method, insertText: label, range });
        });
      }

      return { suggestions };
    },
  });
}
