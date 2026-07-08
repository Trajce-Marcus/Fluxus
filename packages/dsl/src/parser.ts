import { lex } from './lexer';
import { Token, TokenType } from './tokens';
import { FluxSyntaxError } from './errors';
import type { Arg, Call, Expr, FunctionDecl, Ident, Member, ObjectEntry, Position, Script, Stmt } from './ast';

const COMPARISON_OPS = new Set(['=', '!=', '<', '<=', '>', '>=']);

/**
 * Parse an expression-tier entry point (show condition, datasource, page binding).
 * The whole input must be a single expression (GRAMMAR.md §2).
 */
export function parseExpression(source: string): Expr {
  return new Parser(lex(source)).parseExpressionEntry();
}

/** Parse a script-tier entry point (hooks, headless workflows): `{ statement }` (GRAMMAR.md §2, §5). */
export function parseScript(source: string): Script {
  return new Parser(lex(source)).parseScriptEntry();
}

/** Parse a named-function entry point: a single `function name(params) { … }` declaration (GRAMMAR.md §2). */
export function parseFunction(source: string): FunctionDecl {
  return new Parser(lex(source)).parseFunctionEntry();
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ── Entry points ─────────────────────────────────────────────────────────────

  parseExpressionEntry(): Expr {
    this.skipNewlines();
    if (this.at(TokenType.EOF)) {
      throw new FluxSyntaxError('Expected an expression, found nothing', 1, 1);
    }
    const expr = this.expression();
    this.skipNewlines();
    const trailing = this.peek();
    if (trailing.type !== TokenType.EOF) {
      throw this.error(trailing, `Unexpected '${trailing.raw}' after the expression`);
    }
    return expr;
  }

  parseScriptEntry(): Script {
    const body = this.statements();
    const trailing = this.peek();
    if (trailing.type !== TokenType.EOF) {
      throw this.error(trailing, `Unexpected '${trailing.raw}'`);
    }
    return { kind: 'script', body };
  }

  parseFunctionEntry(): FunctionDecl {
    this.skipNewlines();
    this.expectKeyword('function', "Expected 'function'");
    const decl = this.functionDecl();
    this.skipNewlines();
    const trailing = this.peek();
    if (trailing.type !== TokenType.EOF) {
      throw this.error(trailing, `Unexpected '${trailing.raw}' after the function`);
    }
    return decl;
  }

  // ── Statements (GRAMMAR.md §5) ───────────────────────────────────────────────

  /** Newline-separated statements until '}' or end of input. */
  private statements(): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.at(TokenType.RBrace) || this.at(TokenType.EOF)) return out;
      out.push(this.statement());
      const next = this.peek();
      if (next.type !== TokenType.Newline && next.type !== TokenType.RBrace && next.type !== TokenType.EOF) {
        throw this.error(next, `Expected end of line after the statement, found '${next.raw}'`);
      }
    }
  }

  private statement(): Stmt {
    const token = this.peek();

    if (token.type === TokenType.Keyword) {
      switch (token.value) {
        case 'let': {
          this.advance();
          const name = this.expectName("Expected a variable name after 'let'");
          this.expectAssignOp("Expected '=' after the variable name");
          const value = this.expression();
          return { kind: 'let', name: name.value, value, pos: this.toPos(token) };
        }
        case 'if':
          return this.ifStatement();
        case 'for': {
          this.advance();
          this.expectKeyword('each', "Expected 'each' after 'for'");
          const name = this.expectName("Expected a variable name after 'for each'");
          this.expectKeyword('in', "Expected 'in' after the variable name");
          const source = this.expression();
          const body = this.block();
          return { kind: 'foreach', name: name.value, source, body, pos: this.toPos(token) };
        }
        case 'queue': {
          this.advance();
          const call = this.postfix();
          if (call.kind !== 'call') {
            throw this.error(token, "'queue' needs a service call: queue services.module.fn(...)");
          }
          return { kind: 'queue', call: call as Call, pos: this.toPos(token) };
        }
        case 'return': {
          this.advance();
          const next = this.peek();
          const done =
            next.type === TokenType.Newline || next.type === TokenType.RBrace || next.type === TokenType.EOF;
          return { kind: 'return', value: done ? null : this.expression(), pos: this.toPos(token) };
        }
        case 'function':
          throw this.error(token, 'Named functions live in the SDM functions collection, not inside scripts');
      }
    }

    // Assignment vs expression statement: tentatively parse an lvalue and look
    // for a plain '=' (not '=='). Anything else re-parses as an expression.
    if (token.type === TokenType.Identifier) {
      const save = this.pos;
      const target = this.tryLvalue();
      if (target !== null) {
        const next = this.peek();
        if (next.type === TokenType.Operator && next.value === '=' && next.raw === '=') {
          this.advance();
          const value = this.expression();
          return { kind: 'assign', target, value, pos: this.toPos(token) };
        }
      }
      this.pos = save;
    }

    const expr = this.expression();
    return { kind: 'exprstmt', expr, pos: expr.pos };
  }

  private ifStatement(): Stmt {
    const token = this.expectKeyword('if', "Expected 'if'");
    const cond = this.expression();
    const then = this.block();
    // Allow 'else' on the same line or the next
    const save = this.pos;
    this.skipNewlines();
    if (this.matchKeyword('else')) {
      if (this.atKeyword('if')) {
        return { kind: 'if', cond, then, else: [this.ifStatement()], pos: this.toPos(token) };
      }
      return { kind: 'if', cond, then, else: this.block(), pos: this.toPos(token) };
    }
    this.pos = save;
    return { kind: 'if', cond, then, pos: this.toPos(token) };
  }

  /** Braces are mandatory around statement bodies (GRAMMAR.md §5). */
  private block(): Stmt[] {
    this.expect(TokenType.LBrace, "Expected '{' — braces are required around the body");
    const body = this.statements();
    this.expect(TokenType.RBrace, "Expected '}' to close the block");
    return body;
  }

  private functionDecl(): FunctionDecl {
    const name = this.expectName("Expected the function's name");
    this.expect(TokenType.LParen, "Expected '(' after the function name");
    const params: string[] = [];
    if (!this.match(TokenType.RParen)) {
      for (;;) {
        params.push(this.expectName('Expected a parameter name').value);
        if (this.match(TokenType.Comma)) continue;
        this.expect(TokenType.RParen, "Expected ')' or ',' in the parameter list");
        break;
      }
    }
    const body = this.block();
    return { kind: 'functiondecl', name: name.value, params, body, pos: { line: name.line, col: name.col } };
  }

  /** lvalue = identifier { "." member } — no calls or indexing. Returns null (caller restores) otherwise. */
  private tryLvalue(): Ident | Member | null {
    const first = this.advance();
    let node: Ident | Member = { kind: 'ident', name: first.value, pos: this.toPos(first) };
    while (this.at(TokenType.Dot)) {
      this.advance();
      const nameToken = this.peek();
      if (nameToken.type !== TokenType.Identifier && nameToken.type !== TokenType.Keyword) return null;
      this.advance();
      node = { kind: 'member', object: node, name: nameToken.value, pos: this.toPos(nameToken) };
    }
    return node;
  }

  private expectName(message: string): Token {
    const token = this.peek();
    if (token.type === TokenType.Keyword) {
      throw this.error(token, `'${token.raw}' is a reserved word and cannot be used as a name`);
    }
    if (token.type !== TokenType.Identifier) throw this.error(token, message);
    return this.advance();
  }

  private expectAssignOp(message: string): void {
    const token = this.peek();
    if (token.type !== TokenType.Operator || token.value !== '=' || token.raw !== '=') {
      throw this.error(token, message);
    }
    this.advance();
  }

  // ── Expression cascade (GRAMMAR.md §3.1) ─────────────────────────────────────

  private expression(): Expr {
    return this.orExpr();
  }

  private orExpr(): Expr {
    let left = this.andExpr();
    while (this.matchKeyword('or')) {
      const pos = this.prevPos();
      const right = this.andExpr();
      left = { kind: 'binary', op: 'or', left, right, pos };
    }
    return left;
  }

  private andExpr(): Expr {
    let left = this.notExpr();
    while (this.matchKeyword('and')) {
      const pos = this.prevPos();
      const right = this.notExpr();
      left = { kind: 'binary', op: 'and', left, right, pos };
    }
    return left;
  }

  private notExpr(): Expr {
    if (this.matchKeyword('not')) {
      const pos = this.prevPos();
      const operand = this.notExpr();
      return { kind: 'unary', op: 'not', operand, pos };
    }
    return this.comparison();
  }

  private comparison(): Expr {
    const left = this.additive();
    const token = this.peek();

    if (token.type === TokenType.Operator && COMPARISON_OPS.has(token.value)) {
      this.advance();
      const right = this.additive();
      return { kind: 'binary', op: token.value as '=' | '!=' | '<' | '<=' | '>' | '>=', left, right, pos: this.toPos(token) };
    }

    if (this.atKeyword('is')) {
      const isToken = this.advance();
      const negated = this.matchKeyword('not');
      this.expectKeyword('null', "Expected 'null' after 'is'");
      return { kind: 'isnull', negated, target: left, pos: this.toPos(isToken) };
    }

    // [not] in | [not] between | [not] like
    let negated = false;
    if (this.atKeyword('not') && this.isComparisonKeyword(this.peek(1))) {
      this.advance();
      negated = true;
    }

    if (this.matchKeyword('in')) {
      const pos = this.prevPos();
      const source = this.inOperand();
      return { kind: 'in', negated, target: left, source, pos };
    }
    if (this.matchKeyword('between')) {
      const pos = this.prevPos();
      const lower = this.additive();
      this.expectKeyword('and', "Expected 'and' between the bounds of 'between'");
      const upper = this.additive();
      return { kind: 'between', negated, target: left, lower, upper, pos };
    }
    if (this.matchKeyword('like')) {
      const pos = this.prevPos();
      const pattern = this.additive();
      return { kind: 'like', negated, target: left, pattern, pos };
    }

    if (negated) {
      // Unreachable by construction (lookahead), but guard anyway.
      throw this.error(this.peek(), "Expected 'in', 'between', or 'like' after 'not'");
    }
    return left;
  }

  private isComparisonKeyword(token: Token): boolean {
    return token.type === TokenType.Keyword && (token.value === 'in' || token.value === 'between' || token.value === 'like');
  }

  /** GRAMMAR.md §3.1 in-operand: an additive expression, or a SQL-style parenthesised list. */
  private inOperand(): Expr {
    if (this.at(TokenType.LParen)) {
      const open = this.advance();
      const first = this.expression();
      if (this.at(TokenType.Comma)) {
        const items = [first];
        while (this.match(TokenType.Comma)) {
          items.push(this.expression());
        }
        this.expect(TokenType.RParen, "Expected ')' to close the list");
        return { kind: 'list', items, pos: this.toPos(open) };
      }
      this.expect(TokenType.RParen, "Expected ')'");
      return first; // single parenthesised expression — list-or-scalar resolved at runtime
    }
    return this.additive();
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.atOperator('+') || this.atOperator('-')) {
      const op = this.advance();
      const right = this.multiplicative();
      left = { kind: 'binary', op: op.value as '+' | '-', left, right, pos: this.toPos(op) };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.atOperator('*') || this.atOperator('/') || this.atOperator('%')) {
      const op = this.advance();
      const right = this.unary();
      left = { kind: 'binary', op: op.value as '*' | '/' | '%', left, right, pos: this.toPos(op) };
    }
    return left;
  }

  private unary(): Expr {
    if (this.atOperator('-')) {
      const op = this.advance();
      const operand = this.unary();
      return { kind: 'unary', op: '-', operand, pos: this.toPos(op) };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let expr = this.primary();
    for (;;) {
      if (this.match(TokenType.Dot)) {
        const nameToken = this.peek();
        if (nameToken.type !== TokenType.Identifier && nameToken.type !== TokenType.Keyword) {
          throw this.error(nameToken, `Expected a name after '.', found '${nameToken.raw}'`);
        }
        this.advance();
        expr = { kind: 'member', object: expr, name: nameToken.value, pos: this.toPos(nameToken) };
        continue;
      }
      if (this.at(TokenType.LParen)) {
        const open = this.advance();
        const args = this.callArgs();
        expr = { kind: 'call', callee: expr, args, pos: this.toPos(open) };
        continue;
      }
      if (this.at(TokenType.LBracket)) {
        const open = this.advance();
        const index = this.expression();
        this.expect(TokenType.RBracket, "Expected ']'");
        expr = { kind: 'index', object: expr, index, pos: this.toPos(open) };
        continue;
      }
      return expr;
    }
  }

  /** Arguments: `alias: expr` (select/object position) or `expr [asc|desc]` (orderBy position). */
  private callArgs(): Arg[] {
    const args: Arg[] = [];
    if (this.match(TokenType.RParen)) return args;
    for (;;) {
      const arg: Arg = { value: undefined as unknown as Expr };
      if (this.at(TokenType.Identifier) && this.peek(1).type === TokenType.Colon) {
        arg.alias = this.advance().value;
        this.advance(); // ':'
      }
      arg.value = this.expression();
      if (this.atKeyword('asc') || this.atKeyword('desc')) {
        arg.direction = this.advance().value as 'asc' | 'desc';
      }
      args.push(arg);
      if (this.match(TokenType.Comma)) continue;
      this.expect(TokenType.RParen, "Expected ')' or ',' in the argument list");
      return args;
    }
  }

  private primary(): Expr {
    const token = this.peek();

    switch (token.type) {
      case TokenType.Number:
        this.advance();
        return { kind: 'number', value: Number(token.value), pos: this.toPos(token) };
      case TokenType.String:
        this.advance();
        return { kind: 'string', value: token.value, pos: this.toPos(token) };
      case TokenType.Identifier:
        this.advance();
        return { kind: 'ident', name: token.value, pos: this.toPos(token) };
      case TokenType.Keyword:
        if (token.value === 'true' || token.value === 'false') {
          this.advance();
          return { kind: 'boolean', value: token.value === 'true', pos: this.toPos(token) };
        }
        if (token.value === 'null') {
          this.advance();
          return { kind: 'null', pos: this.toPos(token) };
        }
        throw this.error(token, `'${token.raw}' is a reserved word and cannot start an expression`);
      case TokenType.LParen: {
        this.advance();
        const expr = this.expression();
        this.expect(TokenType.RParen, "Expected ')'");
        return expr;
      }
      case TokenType.LBracket: {
        const open = this.advance();
        const items: Expr[] = [];
        if (!this.match(TokenType.RBracket)) {
          for (;;) {
            items.push(this.expression());
            if (this.match(TokenType.Comma)) continue;
            this.expect(TokenType.RBracket, "Expected ']' or ',' in the list");
            break;
          }
        }
        return { kind: 'list', items, pos: this.toPos(open) };
      }
      case TokenType.LBrace: {
        // Newlines inside object literals are layout, not statement separators
        const open = this.advance();
        const entries: ObjectEntry[] = [];
        this.skipNewlines();
        if (!this.match(TokenType.RBrace)) {
          for (;;) {
            const keyToken = this.peek();
            if (keyToken.type !== TokenType.Identifier && keyToken.type !== TokenType.String) {
              if (keyToken.type === TokenType.Keyword) {
                throw this.error(keyToken, `'${keyToken.raw}' is a reserved word — quote it to use it as a key: '${keyToken.value}'`);
              }
              throw this.error(keyToken, `Expected a key name, found '${keyToken.raw}'`);
            }
            this.advance();
            this.expect(TokenType.Colon, "Expected ':' after the key");
            const value = this.expression();
            entries.push({ key: keyToken.value, value });
            this.skipNewlines();
            if (this.match(TokenType.Comma)) {
              this.skipNewlines();
              continue;
            }
            this.expect(TokenType.RBrace, "Expected '}' or ',' in the object");
            break;
          }
        }
        return { kind: 'object', entries, pos: this.toPos(open) };
      }
      default:
        throw this.error(token, `Expected an expression, found '${token.raw === '\n' ? 'end of line' : token.raw || 'end of input'}'`);
    }
  }

  // ── Token helpers ────────────────────────────────────────────────────────────

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    if (token.type !== TokenType.EOF) this.pos++;
    return token;
  }

  private at(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private atKeyword(value: string): boolean {
    const token = this.peek();
    return token.type === TokenType.Keyword && token.value === value;
  }

  private atOperator(value: string): boolean {
    const token = this.peek();
    return token.type === TokenType.Operator && token.value === value;
  }

  private match(type: TokenType): boolean {
    if (this.at(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchKeyword(value: string): boolean {
    if (this.atKeyword(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, message: string): Token {
    if (!this.at(type)) throw this.error(this.peek(), message);
    return this.advance();
  }

  private expectKeyword(value: string, message: string): Token {
    if (!this.atKeyword(value)) throw this.error(this.peek(), message);
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.at(TokenType.Newline)) this.advance();
  }

  private prevPos(): Position {
    const token = this.tokens[Math.max(0, this.pos - 1)];
    return { line: token.line, col: token.col };
  }

  private toPos(token: Token): Position {
    return { line: token.line, col: token.col };
  }

  private error(token: Token, message: string): FluxSyntaxError {
    return new FluxSyntaxError(message, token.line, token.col);
  }
}
