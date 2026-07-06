import { describe, it, expect } from 'vitest';
import { lex } from '../src/lexer';
import { TokenType } from '../src/tokens';
import { FluxSyntaxError } from '../src/errors';

function types(source: string): TokenType[] {
  return lex(source).map((t) => t.type);
}

function values(source: string): string[] {
  return lex(source)
    .filter((t) => t.type !== TokenType.EOF)
    .map((t) => t.value);
}

describe('lexer — tokens', () => {
  it('lexes identifiers, keywords, numbers, strings', () => {
    expect(values("status = 'Open' and qty > 12.5")).toEqual([
      'status', '=', 'Open', 'and', 'qty', '>', '12.5',
    ]);
  });

  it('is case-insensitive: keywords and identifiers lowercase to canonical form', () => {
    const tokens = lex("Status = 'x' AND Rest_Type IN ('a')");
    expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: 'status', raw: 'Status' });
    expect(tokens[3]).toMatchObject({ type: TokenType.Keyword, value: 'and', raw: 'AND' });
    expect(tokens[5]).toMatchObject({ type: TokenType.Keyword, value: 'in', raw: 'IN' });
  });

  it('normalizes operator aliases: == to =, <> to !=', () => {
    expect(values('a == b')).toEqual(['a', '=', 'b']);
    expect(values('a <> b')).toEqual(['a', '!=', 'b']);
  });

  it('lexes all bracket and punctuation tokens', () => {
    expect(types('( ) [ ] { } . , :')).toEqual([
      TokenType.LParen, TokenType.RParen,
      TokenType.LBracket, TokenType.RBracket,
      TokenType.LBrace, TokenType.RBrace,
      TokenType.Dot, TokenType.Comma, TokenType.Colon,
      TokenType.EOF,
    ]);
  });
});

describe('lexer — strings (D1)', () => {
  it('single-quoted strings with SQL-style doubled-quote escaping', () => {
    const tokens = lex("'O''Brien'");
    expect(tokens[0]).toMatchObject({ type: TokenType.String, value: "O'Brien" });
  });

  it('rejects double-quoted strings with a helpful message', () => {
    expect(() => lex('"hello"')).toThrowError(/single quotes/);
  });

  it('rejects unterminated strings', () => {
    expect(() => lex("'abc")).toThrowError(/Unterminated string/);
    expect(() => lex("'abc\ndef'")).toThrowError(/Unterminated string/);
  });
});

describe('lexer — comments (D3)', () => {
  it('strips // comments to end of line (comment after a continuing operator)', () => {
    expect(values("status = // the current state\n'Open'")).toEqual(['status', '=', 'Open']);
  });

  it('a trailing comment does not suppress the statement-ending newline', () => {
    expect(types('a // note\nb')).toEqual([
      TokenType.Identifier, TokenType.Newline, TokenType.Identifier, TokenType.EOF,
    ]);
  });

  it('has no -- comment form: -- lexes as two minus operators', () => {
    expect(values('a -- b')).toEqual(['a', '-', '-', 'b']);
  });
});

describe('lexer — semicolons (D9)', () => {
  it('rejects semicolons with a friendly message', () => {
    expect(() => lex("let x = 1;")).toThrowError(/end of the line/);
  });
});

describe('lexer — newlines and continuation (§1.4)', () => {
  it('emits a newline token between statements', () => {
    expect(types('a\nb')).toEqual([
      TokenType.Identifier, TokenType.Newline, TokenType.Identifier, TokenType.EOF,
    ]);
  });

  it('collapses consecutive blank lines into one newline token', () => {
    expect(types('a\n\n\nb')).toEqual([
      TokenType.Identifier, TokenType.Newline, TokenType.Identifier, TokenType.EOF,
    ]);
  });

  it('suppresses newlines inside brackets', () => {
    expect(types('(a\n+ b)')).not.toContain(TokenType.Newline);
  });

  it('continues the line after a trailing operator', () => {
    expect(types('a +\nb')).toEqual([
      TokenType.Identifier, TokenType.Operator, TokenType.Identifier, TokenType.EOF,
    ]);
  });

  it('continues the line after a trailing word operator (and/or)', () => {
    expect(types('a and\nb')).not.toContain(TokenType.Newline);
  });

  it('continues the line when the next line starts with a dot (chain style)', () => {
    const source = "records.resources\n  .where(rest_type = 'Labour')\n  .orderBy(name)";
    expect(types(source)).not.toContain(TokenType.Newline);
  });

  it('does not treat a comment-only line as ending the chain', () => {
    const source = "records.resources\n  // filter to labour\n  .where(rest_type = 'Labour')";
    expect(types(source)).not.toContain(TokenType.Newline);
  });
});

describe('lexer — errors carry position', () => {
  it('reports line and column', () => {
    try {
      lex("a = 'x'\nb = ;");
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FluxSyntaxError);
      expect((e as FluxSyntaxError).line).toBe(2);
      expect((e as FluxSyntaxError).col).toBe(5);
    }
  });
});
