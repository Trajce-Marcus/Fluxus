export enum TokenType {
  Number = 'number',
  String = 'string',
  Identifier = 'identifier',
  Keyword = 'keyword',
  Operator = 'operator',
  Dot = 'dot',
  Comma = 'comma',
  Colon = 'colon',
  LParen = 'lparen',
  RParen = 'rparen',
  LBracket = 'lbracket',
  RBracket = 'rbracket',
  LBrace = 'lbrace',
  RBrace = 'rbrace',
  Newline = 'newline',
  EOF = 'eof',
}

export interface Token {
  type: TokenType;
  /** Canonical value: lowercased for identifiers/keywords, normalized for operators, decoded for strings. */
  value: string;
  /** Original source text. */
  raw: string;
  line: number; // 1-based
  col: number;  // 1-based
}

// GRAMMAR.md §1.3 — reserved words. Case-insensitive; valid as member names after ".".
export const KEYWORDS = new Set([
  'and', 'or', 'not', 'in', 'between', 'like', 'is', 'null', 'true', 'false',
  'let', 'if', 'else', 'for', 'each', 'queue', 'return', 'function', 'asc', 'desc',
]);

// Word operators that allow line continuation when a line ends with them (GRAMMAR.md §1.4).
export const CONTINUATION_KEYWORDS = new Set([
  'and', 'or', 'not', 'in', 'between', 'like', 'is',
]);
