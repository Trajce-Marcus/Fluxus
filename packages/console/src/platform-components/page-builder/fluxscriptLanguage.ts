// Registers the `fluxscript` language with Monaco (tokens + config) — the
// DSL spec's authoring posture: expression dialogs speak the language by id.
// Keyword list mirrors @fluxus/dsl tokens.ts (KEYWORDS).
//
// Monaco is bundled locally (monaco-editor + Vite `?worker`), not fetched
// from @monaco-editor/react's default CDN loader — the CDN path renders a
// bare textarea when unreachable.

import * as monaco from 'monaco-editor';
// The shell renders inside a shadow root, and document-head styles don't
// pierce it — monaco's stylesheet must ride the shell's own css-injection
// channel (a <style> inside the shadow root). Export the aggregate sheet as
// a string; ExpressionDialog folds it into its exported css. Without this
// the editor renders as a bare unstyled textarea (same symptom the CDN
// loader showed — it appends styles to the document head too).
import monacoCss from 'monaco-editor/min/vs/editor/editor.main.css?inline';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { loader, type Monaco } from '@monaco-editor/react';

self.MonacoEnvironment = { getWorker: () => new editorWorker() };
loader.config({ monaco });

export { monacoCss };

export const FLUXSCRIPT = 'fluxscript';

const KEYWORDS = [
  'and', 'or', 'not', 'in', 'between', 'like', 'is', 'null', 'true', 'false',
  'let', 'if', 'else', 'for', 'each', 'queue', 'return', 'function', 'asc', 'desc',
];

const ROOTS = ['context', 'records', 'services', 'attributes', 'callbackData'];

const BUILTINS = ['iif', 'date', 'now', 'exact', 'len', 'fail', 'warn'];

let registered = false;

export function registerFluxscript(monaco: Monaco): void {
  if (registered || monaco.languages.getLanguages().some((l: { id: string }) => l.id === FLUXSCRIPT)) return;
  registered = true;

  monaco.languages.register({ id: FLUXSCRIPT });

  monaco.languages.setLanguageConfiguration(FLUXSCRIPT, {
    comments: { lineComment: '//' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
  });

  monaco.languages.setMonarchTokensProvider(FLUXSCRIPT, {
    keywords: KEYWORDS,
    roots: ROOTS,
    builtins: BUILTINS,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\d+(\.\d+)?/, 'number'],
        [/[a-zA-Z_][a-zA-Z0-9_]*/, {
          cases: {
            '@keywords': 'keyword',
            '@roots': 'type.identifier',
            '@builtins': 'predefined',
            '@default': 'identifier',
          },
        }],
        [/[=<>!+\-*/%]+/, 'operator'],
        [/[{}()[\]]/, '@brackets'],
        [/[,.]/, 'delimiter'],
      ],
    },
  });
}
