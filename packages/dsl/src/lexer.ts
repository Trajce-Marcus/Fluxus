import { KEYWORDS, CONTINUATION_KEYWORDS, Token, TokenType } from './tokens';
import { FluxSyntaxError } from './errors';

// Two-char operators must be tried before their one-char prefixes.
const TWO_CHAR_OPS = ['==', '!=', '<>', '<=', '>='];
const ONE_CHAR_OPS = ['=', '<', '>', '+', '-', '*', '/', '%'];

const BRACKETS: Record<string, TokenType> = {
  '(': TokenType.LParen,
  ')': TokenType.RParen,
  '[': TokenType.LBracket,
  ']': TokenType.RBracket,
  '{': TokenType.LBrace,
  '}': TokenType.RBrace,
};

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** A newline after this token continues the line instead of ending a statement (GRAMMAR.md §1.4). */
function continuesAfter(token: Token): boolean {
  switch (token.type) {
    case TokenType.Operator:
    case TokenType.Comma:
    case TokenType.Colon:
    case TokenType.Dot:
    case TokenType.LParen:
    case TokenType.LBracket:
    case TokenType.LBrace:
      return true;
    case TokenType.Keyword:
      return CONTINUATION_KEYWORDS.has(token.value);
    default:
      return false;
  }
}

/** Peek past whitespace, newlines, and comments: does a "." begin the next line? (chain continuation) */
function nextSignificantIsDot(source: string, from: number): boolean {
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    return ch === '.';
  }
  return false;
}

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let bracketDepth = 0;

  const push = (type: TokenType, value: string, raw: string, l = line, c = col) => {
    tokens.push({ type, value, raw, line: l, col: c });
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      col++;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        i++;
        col++;
      }
      continue;
    }

    if (ch === '\n') {
      const nlLine = line;
      const nlCol = col;
      i++;
      line++;
      col = 1;
      if (bracketDepth > 0) continue;
      const prev = tokens[tokens.length - 1];
      if (!prev || prev.type === TokenType.Newline) continue;
      if (continuesAfter(prev)) continue;
      if (nextSignificantIsDot(source, i)) continue;
      push(TokenType.Newline, '\n', '\n', nlLine, nlCol);
      continue;
    }

    if (ch === ';') {
      throw new FluxSyntaxError("Statements end at the end of the line — remove the ';'", line, col);
    }

    if (ch === '"') {
      throw new FluxSyntaxError(
        "Strings use single quotes — 'like this'. Escape a quote by doubling it: 'O''Brien'",
        line,
        col,
      );
    }

    if (ch === "'") {
      const startLine = line;
      const startCol = col;
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === '\n') break;
        if (c === "'") {
          if (source[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        value += c;
        j++;
      }
      if (!closed) {
        throw new FluxSyntaxError('Unterminated string — strings may not span lines', startLine, startCol);
      }
      const raw = source.slice(i, j + 1);
      push(TokenType.String, value, raw, startLine, startCol);
      col += raw.length;
      i = j + 1;
      continue;
    }

    if (isDigit(ch)) {
      const startCol = col;
      let j = i;
      while (j < source.length && isDigit(source[j])) j++;
      if (source[j] === '.' && isDigit(source[j + 1])) {
        j++;
        while (j < source.length && isDigit(source[j])) j++;
      }
      const raw = source.slice(i, j);
      push(TokenType.Number, raw, raw, line, startCol);
      col += raw.length;
      i = j;
      continue;
    }

    if (isLetter(ch)) {
      const startCol = col;
      let j = i;
      while (j < source.length && (isLetter(source[j]) || isDigit(source[j]))) j++;
      const raw = source.slice(i, j);
      const value = raw.toLowerCase();
      push(KEYWORDS.has(value) ? TokenType.Keyword : TokenType.Identifier, value, raw, line, startCol);
      col += raw.length;
      i = j;
      continue;
    }

    if (ch in BRACKETS) {
      const type = BRACKETS[ch];
      // Braces don't suppress newlines: a `{` may open a statement block, where
      // newlines separate statements. The parser skips newlines inside object literals.
      if (type === TokenType.LParen || type === TokenType.LBracket) {
        bracketDepth++;
      } else if (type === TokenType.RParen || type === TokenType.RBracket) {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
      push(type, ch, ch);
      i++;
      col++;
      continue;
    }

    if (ch === '.') {
      push(TokenType.Dot, '.', '.');
      i++;
      col++;
      continue;
    }
    if (ch === ',') {
      push(TokenType.Comma, ',', ',');
      i++;
      col++;
      continue;
    }
    if (ch === ':') {
      push(TokenType.Colon, ':', ':');
      i++;
      col++;
      continue;
    }

    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      // Canonical forms: == → =, <> → != (GRAMMAR.md §3.3)
      const value = two === '==' ? '=' : two === '<>' ? '!=' : two;
      push(TokenType.Operator, value, two);
      i += 2;
      col += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      push(TokenType.Operator, ch, ch);
      i++;
      col++;
      continue;
    }

    throw new FluxSyntaxError(`Unexpected character '${ch}'`, line, col);
  }

  push(TokenType.EOF, '', '');
  return tokens;
}
