// Schema-aware static validation (DSL_SPEC §9) — the config-save-time check.
// Walks the AST tracking the static *shape* of each expression (record list of
// type T, record of type T, FK reference, scalar…) so unknown record types,
// unknown fields, and broken FK paths fail when the config is saved, not when
// a user runs the activity. Unknown/dynamic shapes (ctx, attrs, services)
// propagate silently — no false positives on host-defined content.

import type { Arg, Expr } from './ast';
import { parseExpression } from './parser';
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
  /** Record type of ctx.record (the activity's anchor), when known. */
  anchorType?: string;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  line: number;
  col: number;
}

const ROOTS = new Set(['ctx', 'attrs', 'records', 'services']);

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
  const v = new Validator(schema, options);
  v.check(ast, null);
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
  | { kind: 'unknown' }                             // dynamic (ctx/attrs/services content)
  | { kind: 'scalar' }
  | { kind: 'recordsRoot' }
  | { kind: 'record'; type: string }
  | { kind: 'recordList'; type: string }
  | { kind: 'rowList'; keys: string[] }             // result of select()
  | { kind: 'row'; keys: string[] }
  | { kind: 'scalarList' }
  | { kind: 'date' };

const UNKNOWN: Shape = { kind: 'unknown' };
const SCALAR: Shape = { kind: 'scalar' };

class Validator {
  readonly diagnostics: Diagnostic[] = [];
  private schema: DslSchema;
  private options: ValidateOptions;

  constructor(schema: DslSchema, options: ValidateOptions) {
    this.schema = schema;
    this.options = options;
  }

  private error(expr: Expr, message: string): void {
    this.diagnostics.push({ severity: 'error', message, line: expr.pos.line, col: expr.pos.col });
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
          // fall through to roots — outer scope is still visible inside chains
        }
        if (expr.name === 'records') return { kind: 'recordsRoot' };
        if (ROOTS.has(expr.name)) return UNKNOWN;
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
        return { kind: 'recordList', type: name };
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
        // ctx.record is typable when the host declares the anchor type
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
    return expr.name === 'record' && expr.object.kind === 'ident' && expr.object.name === 'ctx';
  }

  // ── Calls ─────────────────────────────────────────────────────────────────────

  private call(expr: Expr & { kind: 'call' }, itemType: string | null): Shape {
    const { callee } = expr;

    if (callee.kind === 'ident') {
      const spec = BUILTINS[callee.name];
      if (!spec) {
        this.error(expr, `Unknown function '${callee.name}'`);
        expr.args.forEach((arg) => this.check(arg.value, itemType));
        return UNKNOWN;
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

  private chain(object: Shape & { kind: 'recordList' | 'rowList' | 'scalarList' }, method: string, expr: Expr & { kind: 'call' }, outerItemType: string | null): Shape {
    // Bare-field scope for chain args: the element type when filtering records.
    const innerType = object.kind === 'recordList' ? object.type : outerItemType;
    const checkArg = (arg: Arg) => this.check(arg.value, innerType);

    switch (method) {
      case 'where':
        if (expr.args.length !== 1) this.error(expr, 'where() takes one condition');
        expr.args.forEach(checkArg);
        return object;
      case 'top':
        if (expr.args.length !== 1) this.error(expr, 'top() takes one number');
        expr.args.forEach((arg) => this.check(arg.value, outerItemType));
        return object;
      case 'orderby':
        if (expr.args.length === 0) this.error(expr, 'orderBy() needs at least one field');
        expr.args.forEach(checkArg);
        return object;
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
