// Schema-aware static validation (DSL_SPEC §9) — the config-save-time check.
// Walks the AST tracking the static *shape* of each expression (record list of
// type T, record of type T, FK reference, scalar…) so unknown record types,
// unknown fields, and broken FK paths fail when the config is saved, not when
// a user runs the activity. Unknown/dynamic shapes (context, attributes, services)
// propagate silently — no false positives on host-defined content.
// Scripts add scope tracking (let/redeclare/shadowing) and mutation placement
// rules (before hooks validate only; bulk update needs a where; rows have no
// identity) — GRAMMAR §5, DSL_SPEC §6–§7.

import type { Arg, Expr, FunctionDecl, Stmt } from './ast';
import { parseExpression, parseFunction, parseScript } from './parser';
import { FluxSyntaxError } from './errors';

// ── Schema input (derived from the SDM by the host) ─────────────────────────────

export interface FieldSchema {
  /** Custom field type ('text' | 'int' | 'bool' | 'date' | 'fk_ref' | …). Optional — name checking works without it. */
  type?: string;
  /** Target record type when this field is an fk_ref. */
  fkTarget?: string;
}

export interface TypeSchema {
  fields: Record<string, FieldSchema>;
}

export interface DslSchema {
  /** Record types by the name used after `records.` */
  types: Record<string, TypeSchema>;
}

export interface ValidateOptions {
  /** Record type of context.record (the activity's anchor), when known. */
  anchorType?: string;
  /**
   * Extra roots available at this embedding point (e.g. ['value'] for attribute
   * validation rules, ['event'] for page-builder callbacks). Treated as dynamic.
   */
  extraRoots?: string[];
  /**
   * Standard roots NOT available at this embedding point (e.g. ['attributes']
   * for activity-level availability conditions, which are evaluated before
   * capture begins). Referencing one is an error.
   */
  bannedRoots?: string[];
  /** Named functions callable at this embedding point (name → parameter list). */
  functions?: Record<string, { params: string[] }>;
}

export interface ScriptValidateOptions extends ValidateOptions {
  /**
   * 'before': the gate — mutations and `queue` are errors (DSL_SPEC §6).
   * 'after' (default): effects — mutations and `queue` allowed.
   */
  mode?: 'before' | 'after';
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  line: number;
  col: number;
}

const ROOTS = new Set(['context', 'attributes', 'records', 'services']);

const BUILTINS: Record<string, { min: number; max: number }> = {
  iif: { min: 3, max: 3 },
  date: { min: 1, max: 1 },
  now: { min: 0, max: 0 },
  exact: { min: 2, max: 2 },
  len: { min: 1, max: 1 },
  lower: { min: 1, max: 1 },
  upper: { min: 1, max: 1 },
  trim: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  fail: { min: 1, max: 1 },
  warn: { min: 1, max: 1 },
};

const CHAIN_METHODS = new Set(['where', 'orderby', 'select', 'values', 'top']);
const DATE_METHODS = new Set(['adddays', 'addmonths', 'addyears']);
const LIST_PROPS = new Set(['count', 'first']);

/** Validate an expression-tier script against the SDM-derived schema. */
export function validateExpression(source: string, schema: DslSchema, options: ValidateOptions = {}): Diagnostic[] {
  let ast: Expr;
  try {
    ast = parseExpression(source);
  } catch (e) {
    if (e instanceof FluxSyntaxError) {
      return [{ severity: 'error', message: e.message, line: e.line, col: e.col }];
    }
    throw e;
  }
  const v = new Validator(schema, options, 'expression');
  v.check(ast, null);
  return v.diagnostics;
}

/** Validate a script-tier source (hook, headless workflow) against the schema. */
export function validateScript(source: string, schema: DslSchema, options: ScriptValidateOptions = {}): Diagnostic[] {
  let stmts: Stmt[];
  try {
    stmts = parseScript(source).body;
  } catch (e) {
    if (e instanceof FluxSyntaxError) {
      return [{ severity: 'error', message: e.message, line: e.line, col: e.col }];
    }
    throw e;
  }
  const v = new Validator(schema, options, options.mode ?? 'after');
  v.checkScript(stmts);
  return v.diagnostics;
}

/**
 * Validate a named function declaration. Bodies are checked in 'after' mode —
 * whether a mutation is allowed depends on the calling surface, which the
 * evaluator enforces at run time.
 */
export function validateFunction(source: string, schema: DslSchema, options: ValidateOptions = {}): Diagnostic[] {
  let decl: FunctionDecl;
  try {
    decl = parseFunction(source);
  } catch (e) {
    if (e instanceof FluxSyntaxError) {
      return [{ severity: 'error', message: e.message, line: e.line, col: e.col }];
    }
    throw e;
  }
  const v = new Validator(schema, options, 'after');
  v.checkFunction(decl);
  return v.diagnostics;
}

/** D8 lint: warn about SDM fields that shadow root names inside query chains. */
export function lintSchema(schema: DslSchema): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [typeName, type] of Object.entries(schema.types)) {
    for (const field of Object.keys(type.fields)) {
      if (ROOTS.has(field.toLowerCase())) {
        out.push({
          severity: 'warning',
          message: `Field '${field}' on '${typeName}' shadows the '${field.toLowerCase()}' root inside query methods`,
          line: 1,
          col: 1,
        });
      }
    }
  }
  return out;
}

// ── Shapes ──────────────────────────────────────────────────────────────────────

type Shape =
  | { kind: 'unknown' }                             // dynamic (context/attributes/services content)
  | { kind: 'scalar' }
  | { kind: 'recordsRoot' }
  | { kind: 'record'; type: string }
  // collection: bare `records.<type>` (create lives here); filtered: a where() ran (D13)
  | { kind: 'recordList'; type: string; collection?: boolean; filtered?: boolean }
  | { kind: 'rowList'; keys: string[] }             // result of select()
  | { kind: 'row'; keys: string[] }
  | { kind: 'scalarList' }
  | { kind: 'date' };

const UNKNOWN: Shape = { kind: 'unknown' };
const SCALAR: Shape = { kind: 'scalar' };

type Mode = 'expression' | 'before' | 'after';

class Validator {
  readonly diagnostics: Diagnostic[] = [];
  private schema: DslSchema;
  private options: ValidateOptions;
  private mode: Mode;
  /** Variable shapes, one map per block (scripts tier). */
  private scopes: Map<string, Shape>[] = [];

  constructor(schema: DslSchema, options: ValidateOptions, mode: Mode) {
    this.schema = schema;
    this.options = options;
    this.mode = mode;
  }

  private error(expr: Expr | Stmt, message: string): void {
    this.diagnostics.push({ severity: 'error', message, line: expr.pos.line, col: expr.pos.col });
  }

  // ── Statements (scripts tier) ─────────────────────────────────────────────────

  checkScript(stmts: Stmt[]): void {
    this.scopes.push(new Map());
    stmts.forEach((s) => this.checkStmt(s));
    this.scopes.pop();
  }

  checkFunction(decl: FunctionDecl): void {
    this.scopes.push(new Map());
    for (const param of decl.params) {
      this.declare(param, UNKNOWN, decl);
    }
    decl.body.forEach((s) => this.checkStmt(s));
    this.scopes.pop();
  }

  private checkStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case 'let': {
        const shape = this.check(stmt.value, null);
        this.declare(stmt.name, shape, stmt);
        return;
      }
      case 'assign': {
        const shape = this.check(stmt.value, null);
        if (stmt.target.kind === 'ident') {
          const name = stmt.target.name;
          if (ROOTS.has(name)) {
            this.error(stmt, `'${name}' is a root and cannot be assigned`);
            return;
          }
          const scope = this.scopeWith(name);
          if (scope === null) {
            this.error(stmt, `Unknown variable '${name}' — declare it with 'let ${name} = …'`);
            return;
          }
          scope.set(name, shape);
          return;
        }
        const object = this.check(stmt.target.object, null);
        if (object.kind === 'record') {
          this.error(
            stmt,
            `Records are read-only values — use .update({ ${stmt.target.name}: … }) to change '${stmt.target.name}'`,
          );
        } else if (object.kind !== 'unknown' && object.kind !== 'row' && object.kind !== 'rowList') {
          this.error(stmt, `Cannot set '.${stmt.target.name}' on this value`);
        }
        return;
      }
      case 'if': {
        this.check(stmt.cond, null);
        this.scopes.push(new Map());
        stmt.then.forEach((s) => this.checkStmt(s));
        this.scopes.pop();
        if (stmt.else) {
          this.scopes.push(new Map());
          stmt.else.forEach((s) => this.checkStmt(s));
          this.scopes.pop();
        }
        return;
      }
      case 'foreach': {
        const source = this.check(stmt.source, null);
        this.scopes.push(new Map());
        this.declare(stmt.name, this.elementOf(source), stmt);
        stmt.body.forEach((s) => this.checkStmt(s));
        this.scopes.pop();
        return;
      }
      case 'queue': {
        if (this.mode === 'before') {
          this.error(stmt, "'queue' runs in after hooks only — before hooks validate, they don't act");
        }
        if (!isServiceCall(stmt.call.callee)) {
          this.error(stmt, "'queue' needs a service call: queue services.module.fn(...)");
        } else {
          this.check(stmt.call.callee, null);
        }
        stmt.call.args.forEach((arg) => this.check(arg.value, null));
        return;
      }
      case 'return':
        if (stmt.value) this.check(stmt.value, null);
        return;
      case 'exprstmt':
        this.check(stmt.expr, null);
        return;
    }
  }

  private declare(name: string, shape: Shape, at: Expr | Stmt | FunctionDecl): void {
    const here = { pos: at.pos } as Stmt;
    if (ROOTS.has(name) || this.options.extraRoots?.some((r) => r.toLowerCase() === name)) {
      this.error(here, `'${name}' is a root and cannot be redeclared`);
      return;
    }
    if (name in BUILTINS || this.functionSpec(name) !== null) {
      this.error(here, `'${name}' is a function name and cannot be redeclared`);
      return;
    }
    const scope = this.scopes[this.scopes.length - 1];
    if (scope.has(name)) {
      this.error(here, `'${name}' is already declared in this block`);
      return;
    }
    scope.set(name, shape);
  }

  private scopeWith(name: string): Map<string, Shape> | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i];
    }
    return null;
  }

  private lookupVar(name: string): Shape | null {
    return this.scopeWith(name)?.get(name) ?? null;
  }

  private functionSpec(name: string): { params: string[] } | null {
    const fns = this.options.functions;
    if (!fns) return null;
    if (name in fns) return fns[name];
    for (const key of Object.keys(fns)) {
      if (key.toLowerCase() === name) return fns[key];
    }
    return null;
  }

  /** itemType: record type whose fields are in bare-field scope (inside chain args), else null. */
  check(expr: Expr, itemType: string | null): Shape {
    switch (expr.kind) {
      case 'number':
      case 'string':
      case 'boolean':
      case 'null':
        return SCALAR;

      case 'ident': {
        if (itemType !== null) {
          if (expr.name === 'id') return SCALAR;
          const field = this.fieldOf(itemType, expr.name);
          if (field !== null) return this.fieldShape(field);
          // fall through to variables and roots — the outer scope is still visible inside chains
        }
        const variable = this.lookupVar(expr.name);
        if (variable !== null) return variable;
        if (ROOTS.has(expr.name) && this.options.bannedRoots?.some((r) => r.toLowerCase() === expr.name)) {
          this.error(expr, `'${expr.name}' is not available at this embedding point`);
          return UNKNOWN;
        }
        if (expr.name === 'records') return { kind: 'recordsRoot' };
        if (ROOTS.has(expr.name)) return UNKNOWN;
        if (this.options.extraRoots?.some((r) => r.toLowerCase() === expr.name)) return UNKNOWN;
        if (itemType !== null) {
          this.error(expr, `'${itemType}' has no field '${expr.name}'`);
        } else {
          this.error(expr, `Unknown name '${expr.name}' — bare field names are only available inside query methods`);
        }
        return UNKNOWN;
      }

      case 'list':
        expr.items.forEach((item) => this.check(item, itemType));
        return { kind: 'scalarList' };

      case 'object':
        expr.entries.forEach((entry) => this.check(entry.value, itemType));
        return { kind: 'row', keys: expr.entries.map((e) => e.key) };

      case 'unary':
        this.check(expr.operand, itemType);
        return SCALAR;

      case 'binary':
        this.check(expr.left, itemType);
        this.check(expr.right, itemType);
        return SCALAR;

      case 'in':
        this.check(expr.target, itemType);
        this.check(expr.source, itemType);
        return SCALAR;

      case 'between':
        this.check(expr.target, itemType);
        this.check(expr.lower, itemType);
        this.check(expr.upper, itemType);
        return SCALAR;

      case 'like':
        this.check(expr.target, itemType);
        this.check(expr.pattern, itemType);
        return SCALAR;

      case 'isnull':
        this.check(expr.target, itemType);
        return SCALAR;

      case 'index':
        this.check(expr.index, itemType);
        return this.elementOf(this.check(expr.object, itemType));

      case 'member':
        return this.member(this.check(expr.object, itemType), expr, itemType);

      case 'call':
        return this.call(expr, itemType);
    }
  }

  // ── Member shapes ─────────────────────────────────────────────────────────────

  private member(object: Shape, expr: Expr & { kind: 'member' }, itemType: string | null): Shape {
    const name = expr.name;

    switch (object.kind) {
      case 'recordsRoot': {
        if (!(name in this.schema.types)) {
          this.error(expr, `Unknown record type '${name}'`);
          return UNKNOWN;
        }
        return { kind: 'recordList', type: name, collection: true };
      }

      case 'record': {
        if (name === 'id') return SCALAR;
        const field = this.fieldOf(object.type, name);
        if (field !== null) return this.fieldShape(field);
        const reverse = this.reverseOf(object.type, name);
        if (reverse !== null) return { kind: 'recordList', type: reverse };
        this.error(expr, `'${object.type}' has no field '${name}'`);
        return UNKNOWN;
      }

      case 'recordList': {
        if (name === 'count') return SCALAR;
        if (name === 'first') return { kind: 'record', type: object.type };
        if (CHAIN_METHODS.has(name)) {
          this.error(expr, `'${name}' is a method — call it: .${name}(...)`);
          return UNKNOWN;
        }
        this.error(expr, `Lists have no property '${name}'`);
        return UNKNOWN;
      }

      case 'rowList': {
        if (name === 'count') return SCALAR;
        if (name === 'first') return { kind: 'row', keys: object.keys };
        if (CHAIN_METHODS.has(name)) {
          this.error(expr, `'${name}' is a method — call it: .${name}(...)`);
          return UNKNOWN;
        }
        this.error(expr, `Lists have no property '${name}'`);
        return UNKNOWN;
      }

      case 'scalarList': {
        if (name === 'count') return SCALAR;
        if (name === 'first') return SCALAR;
        this.error(expr, `Lists have no property '${name}'`);
        return UNKNOWN;
      }

      case 'row': {
        if (!object.keys.some((k) => k.toLowerCase() === name)) {
          this.error(expr, `This row has no column '${name}' (columns: ${object.keys.join(', ')})`);
        }
        return UNKNOWN;
      }

      case 'unknown': {
        // context.record is typable when the host declares the anchor type
        if (this.options.anchorType && this.isCtxRecord(expr)) {
          return { kind: 'record', type: this.options.anchorType };
        }
        return UNKNOWN;
      }

      case 'scalar':
      case 'date':
        this.error(expr, `Cannot access '.${name}' on a ${object.kind === 'date' ? 'date' : 'simple value'}`);
        return UNKNOWN;
    }
  }

  private isCtxRecord(expr: Expr & { kind: 'member' }): boolean {
    return expr.name === 'record' && expr.object.kind === 'ident' && expr.object.name === 'context';
  }

  // ── Calls ─────────────────────────────────────────────────────────────────────

  private call(expr: Expr & { kind: 'call' }, itemType: string | null): Shape {
    const { callee } = expr;

    if (callee.kind === 'ident') {
      const spec = BUILTINS[callee.name];
      if (!spec) {
        const fn = this.functionSpec(callee.name);
        if (fn !== null) {
          if (expr.args.length !== fn.params.length) {
            this.error(
              expr,
              `${callee.name}() takes ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'}, got ${expr.args.length}`,
            );
          }
          expr.args.forEach((arg) => this.check(arg.value, itemType));
          return UNKNOWN;
        }
        this.error(expr, `Unknown function '${callee.name}'`);
        expr.args.forEach((arg) => this.check(arg.value, itemType));
        return UNKNOWN;
      }
      if ((callee.name === 'fail' || callee.name === 'warn') && this.mode === 'expression') {
        this.error(expr, `${callee.name}() belongs to scripts (hooks, functions), not expressions`);
      }
      if (expr.args.length < spec.min || expr.args.length > spec.max) {
        const wants = spec.min === spec.max ? `${spec.min}` : `${spec.min}–${spec.max}`;
        this.error(expr, `${callee.name}() takes ${wants} argument${spec.max === 1 ? '' : 's'}, got ${expr.args.length}`);
      }
      expr.args.forEach((arg) => this.check(arg.value, itemType));
      if (callee.name === 'now' || callee.name === 'date') return { kind: 'date' };
      return SCALAR;
    }

    if (callee.kind === 'member') {
      const object = this.check(callee.object, itemType);
      const method = callee.name;

      if (method === 'create' || method === 'update') {
        const handled = this.mutation(object, method, expr, itemType);
        if (handled !== null) return handled;
        // not a records mutation — fall through (e.g. a service module's own method)
      }

      if ((object.kind === 'recordList' || object.kind === 'rowList' || object.kind === 'scalarList') && CHAIN_METHODS.has(method)) {
        return this.chain(object, method, expr, itemType);
      }
      if (object.kind === 'date' && DATE_METHODS.has(method)) {
        if (expr.args.length !== 1) this.error(expr, `${method}() takes 1 argument`);
        expr.args.forEach((arg) => this.check(arg.value, itemType));
        return { kind: 'date' };
      }
      if (object.kind === 'unknown') {
        // services.x.y(...) and other host-defined calls — arguments still get checked
        expr.args.forEach((arg) => this.check(arg.value, itemType));
        return UNKNOWN;
      }
      if ((object.kind === 'recordList' || object.kind === 'rowList' || object.kind === 'scalarList') && LIST_PROPS.has(method)) {
        this.error(expr, `'${method}' is a property, not a method — drop the parentheses: .${method}`);
        return UNKNOWN;
      }
      this.error(expr, `Unknown method '${method}'`);
      expr.args.forEach((arg) => this.check(arg.value, itemType));
      return UNKNOWN;
    }

    this.error(expr, 'This is not something that can be called');
    return UNKNOWN;
  }

  /**
   * Mutation placement rules (D13/D14, DSL_SPEC §6–§7). Returns null when the
   * call is not a records mutation and should fall through to generic handling.
   */
  private mutation(object: Shape, method: 'create' | 'update', expr: Expr & { kind: 'call' }, itemType: string | null): Shape | null {
    const target =
      object.kind === 'record' || object.kind === 'recordList' || object.kind === 'rowList' ? object : null;
    if (target === null && !(object.kind === 'unknown' && this.isCtxRecordChain(expr.callee))) return null;

    if (this.mode === 'expression') {
      this.error(expr, `${method}() is not allowed in expressions — mutations run in after hooks`);
    } else if (this.mode === 'before') {
      this.error(expr, `Before hooks validate only — move ${method}() to the after hook`);
    }

    const type =
      object.kind === 'record' || object.kind === 'recordList'
        ? object.type
        : this.options.anchorType ?? null;

    if (method === 'create') {
      if (object.kind !== 'recordList' || !object.collection) {
        this.error(expr, 'create is collection-level: records.<type>.create({...})');
        expr.args.forEach((arg) => this.check(arg.value, itemType));
        return UNKNOWN;
      }
      this.checkFieldsArg(expr, object.type, itemType, 'create');
      return { kind: 'record', type: object.type };
    }

    // update
    if (object.kind === 'rowList') {
      this.error(expr, 'Projected rows have no identity and cannot be updated — update the records themselves');
      expr.args.forEach((arg) => this.check(arg.value, itemType));
      return UNKNOWN;
    }
    if (object.kind === 'recordList' && !object.filtered) {
      this.error(expr, `Bulk update needs a filter: records.${object.type}.where(...).update({...}) — updating every record must say .where(true)`);
    }
    this.checkFieldsArg(expr, type, itemType, 'update');
    if (object.kind === 'record') return object;
    if (object.kind === 'recordList') return SCALAR; // bulk update yields the affected count
    return UNKNOWN;
  }

  /** `context.record.update(...)` (or deeper) when the anchor type is not declared: still a mutation. */
  private isCtxRecordChain(callee: Expr): boolean {
    let node = callee;
    while (node.kind === 'member') {
      if (this.isCtxRecord(node)) return true;
      node = node.object;
    }
    return false;
  }

  /** The single object argument of create/update; keys checked against the target type. */
  private checkFieldsArg(expr: Expr & { kind: 'call' }, type: string | null, itemType: string | null, what: string): void {
    if (expr.args.length !== 1) {
      this.error(expr, `${what}() takes one object: ${what}({ field: value, … })`);
      expr.args.forEach((arg) => this.check(arg.value, itemType));
      return;
    }
    const arg = expr.args[0].value;
    this.check(arg, itemType);
    if (arg.kind !== 'object') return; // dynamic argument — checked at run time
    if (type === null || !(type in this.schema.types)) return;
    for (const entry of arg.entries) {
      if (entry.key === 'id') {
        this.error(arg, `'id' is not writable`);
        continue;
      }
      if (this.fieldOf(type, entry.key.toLowerCase()) === null) {
        this.error(arg, `'${type}' has no field '${entry.key}'`);
      }
    }
  }

  private chain(object: Shape & { kind: 'recordList' | 'rowList' | 'scalarList' }, method: string, expr: Expr & { kind: 'call' }, outerItemType: string | null): Shape {
    // Bare-field scope for chain args: the element type when filtering records.
    const innerType = object.kind === 'recordList' ? object.type : outerItemType;
    const checkArg = (arg: Arg) => this.check(arg.value, innerType);

    switch (method) {
      case 'where':
        if (expr.args.length !== 1) this.error(expr, 'where() takes one condition');
        expr.args.forEach(checkArg);
        return object.kind === 'recordList' ? { ...object, collection: false, filtered: true } : object;
      case 'top':
        if (expr.args.length !== 1) this.error(expr, 'top() takes one number');
        expr.args.forEach((arg) => this.check(arg.value, outerItemType));
        return object.kind === 'recordList' ? { ...object, collection: false } : object;
      case 'orderby':
        if (expr.args.length === 0) this.error(expr, 'orderBy() needs at least one field');
        expr.args.forEach(checkArg);
        return object.kind === 'recordList' ? { ...object, collection: false } : object;
      case 'select': {
        if (expr.args.length === 0) this.error(expr, 'select() needs at least one field');
        const keys: string[] = [];
        for (const arg of expr.args) {
          checkArg(arg);
          if (arg.alias) keys.push(arg.alias);
          else if (arg.value.kind === 'ident') keys.push(arg.value.name);
          else this.error(arg.value, 'Give this select expression a name: alias: expression');
        }
        return { kind: 'rowList', keys };
      }
      case 'values':
        if (expr.args.length !== 1) this.error(expr, 'values() takes one field');
        expr.args.forEach(checkArg);
        return { kind: 'scalarList' };
      default:
        this.error(expr, `Unknown chain method '${method}'`);
        return UNKNOWN;
    }
  }

  // ── Schema lookups (case-insensitive) ─────────────────────────────────────────

  private fieldOf(typeName: string, fieldName: string): FieldSchema | null {
    const type = this.schema.types[typeName];
    if (!type) return null;
    if (fieldName in type.fields) return type.fields[fieldName];
    for (const key of Object.keys(type.fields)) {
      if (key.toLowerCase() === fieldName) return type.fields[key];
    }
    return null;
  }

  private fieldShape(field: FieldSchema): Shape {
    if (field.fkTarget) {
      if (!(field.fkTarget in this.schema.types)) return UNKNOWN; // broken schema — lint elsewhere
      return { kind: 'record', type: field.fkTarget }; // FK auto-deref: dots continue into the target
    }
    if (field.type === 'date') return { kind: 'date' };
    return SCALAR;
  }

  /** Reverse-FK navigation (D12): `record.<sourceType>` where sourceType has an FK to this type. */
  private reverseOf(typeName: string, name: string): string | null {
    for (const [sourceName, source] of Object.entries(this.schema.types)) {
      if (sourceName.toLowerCase() !== name) continue;
      for (const field of Object.values(source.fields)) {
        if (field.fkTarget === typeName) return sourceName;
      }
    }
    return null;
  }

  private elementOf(shape: Shape): Shape {
    switch (shape.kind) {
      case 'recordList':
        return { kind: 'record', type: shape.type };
      case 'rowList':
        return { kind: 'row', keys: shape.keys };
      case 'scalarList':
        return SCALAR;
      default:
        return UNKNOWN;
    }
  }
}

/** `queue`'s operand must be a call on a member chain rooted at `services`. */
function isServiceCall(callee: Expr): boolean {
  let node = callee;
  while (node.kind === 'member') node = node.object;
  return node.kind === 'ident' && node.name === 'services';
}
