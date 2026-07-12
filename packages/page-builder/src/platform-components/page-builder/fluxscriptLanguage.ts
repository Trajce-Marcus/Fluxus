// Registers the `fluxscript` language with Monaco (tokens + config) — the
// DSL spec's authoring posture: expression dialogs speak the language by id.
// Keyword list mirrors @fluxus/dsl tokens.ts (KEYWORDS).

import type { Monaco } from '@monaco-editor/react';

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
