import type { Arg, Expr, Position } from './ast';
import { parseExpression } from './parser';
import { DEFAULT_QUOTAS, DslRecord, EvalHost, FkPointer, Quotas, RecordsHost } from './host';

export class FluxRuntimeError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, pos: Position) {
    super(`${message} (line ${pos.line}, col ${pos.col})`);
    this.name = 'FluxRuntimeError';
    this.line = pos.line;
    this.col = pos.col;
  }
}

/** Evaluate an expression-tier source string against a host. */
export function evaluateExpression(source: string, host: EvalHost = {}): unknown {
  return evaluateAst(parseExpression(source), host);
}

export function evaluateAst(expr: Expr, host: EvalHost = {}): unknown {
  return new Evaluator(host).run(expr);
}

// ── Internal values ─────────────────────────────────────────────────────────────

/** Marker for the `records` root; member access yields materialized record lists. */
class RecordsRoot {
  constructor(readonly host: RecordsHost) {}
}

const CHAIN_METHODS = new Set(['where', 'orderby', 'select', 'values', 'top']);
const DATE_METHODS = new Set(['adddays', 'addmonths', 'addyears']);

function isRecord(value: unknown): value is DslRecord {
  return typeof value === 'object' && value !== null && 'id' in value && 'type' in value && 'fields' in value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof FkPointer) &&
    !(value instanceof RecordsRoot) &&
    !isRecord(value)
  );
}

/** Case-insensitive key lookup on a plain object. */
function lookupKey(obj: Record<string, unknown>, name: string): string | null {
  if (name in obj) return name;
  const lower = name.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

/** FkPointer compares as its raw id; records compare as their id. */
function unwrap(value: unknown): unknown {
  if (value instanceof FkPointer) return value.id;
  return value;
}

// ── Evaluator ───────────────────────────────────────────────────────────────────

type Scope = (name: string) => { found: boolean; value: unknown };

class Evaluator {
  private host: EvalHost;
  private quotas: Quotas;
  private steps = 0;
  private deadline = 0;

  constructor(host: EvalHost) {
    this.host = host;
    this.quotas = { ...DEFAULT_QUOTAS, ...host.quotas };
  }

  run(expr: Expr): unknown {
    this.steps = 0;
    this.deadline = Date.now() + this.quotas.timeoutMs;
    return this.eval(expr, this.rootScope());
  }

  private rootScope(): Scope {
    return (name) => {
      switch (name) {
        case 'context':
          return { found: true, value: this.host.context ?? {} };
        case 'attributes':
          return { found: true, value: this.host.attributes ?? {} };
        case 'services':
          return { found: true, value: this.host.services ?? {} };
        case 'records':
          if (!this.host.records) return { found: false, value: undefined };
          return { found: true, value: new RecordsRoot(this.host.records) };
        default: {
          // Embedding-point extras (e.g. `value` in validation, `event` in wiring)
          const extras = this.host.extras;
          if (extras) {
            const key = lookupKey(extras, name);
            if (key !== null) return { found: true, value: extras[key] ?? null };
          }
          return { found: false, value: undefined };
        }
      }
    };
  }

  private tick(pos: Position): void {
    this.steps++;
    if (this.steps > this.quotas.maxSteps) {
      throw new FluxRuntimeError(`Script exceeded the step quota (${this.quotas.maxSteps})`, pos);
    }
    if (this.steps % 512 === 0 && Date.now() > this.deadline) {
      throw new FluxRuntimeError(`Script exceeded the time budget (${this.quotas.timeoutMs}ms)`, pos);
    }
  }

  private eval(expr: Expr, scope: Scope): unknown {
    this.tick(expr.pos);
    switch (expr.kind) {
      case 'number':
        return expr.value;
      case 'string':
        return expr.value;
      case 'boolean':
        return expr.value;
      case 'null':
        return null;
      case 'ident': {
        const result = scope(expr.name);
        if (!result.found) {
          throw new FluxRuntimeError(
            `Unknown name '${expr.name}' — bare field names are only available inside query methods`,
            expr.pos,
          );
        }
        return result.value;
      }
      case 'list':
        return expr.items.map((item) => this.eval(item, scope));
      case 'object': {
        const out: Record<string, unknown> = {};
        for (const entry of expr.entries) {
          out[entry.key] = this.eval(entry.value, scope);
        }
        return out;
      }
      case 'unary': {
        const value = this.eval(expr.operand, scope);
        if (expr.op === 'not') return !this.toBool(value, expr.pos);
        if (value === null) return null;
        if (typeof value !== 'number') {
          throw new FluxRuntimeError(`Unary '-' needs a number, got ${describe(value)}`, expr.pos);
        }
        return -value;
      }
      case 'binary':
        return this.binary(expr, scope);
      case 'in': {
        const target = unwrap(this.eval(expr.target, scope));
        const sourceValue = this.eval(expr.source, scope);
        const list = Array.isArray(sourceValue) ? sourceValue : sourceValue === null ? [] : [sourceValue];
        const found = list.some((item) => this.looseEquals(target, unwrap(item)));
        return expr.negated ? !found : found;
      }
      case 'between': {
        const target = this.eval(expr.target, scope);
        const lower = this.eval(expr.lower, scope);
        const upper = this.eval(expr.upper, scope);
        const cmpLower = this.compare(target, lower, expr.pos);
        const cmpUpper = this.compare(target, upper, expr.pos);
        const result = cmpLower !== null && cmpUpper !== null && cmpLower >= 0 && cmpUpper <= 0;
        return expr.negated ? !result : result;
      }
      case 'like': {
        const target = unwrap(this.eval(expr.target, scope));
        const pattern = unwrap(this.eval(expr.pattern, scope));
        if (target === null || pattern === null) return expr.negated;
        if (typeof target !== 'string' || typeof pattern !== 'string') {
          throw new FluxRuntimeError(`'like' compares text, got ${describe(target)} like ${describe(pattern)}`, expr.pos);
        }
        const regex = likeToRegex(pattern);
        const result = regex.test(target);
        return expr.negated ? !result : result;
      }
      case 'isnull': {
        const target = this.eval(expr.target, scope);
        const isNull = target === null;
        return expr.negated ? !isNull : isNull;
      }
      case 'member':
        return this.member(this.eval(expr.object, scope), expr.name, expr.pos);
      case 'index': {
        const object = this.eval(expr.object, scope);
        if (object === null) return null;
        const index = this.eval(expr.index, scope);
        if (!Array.isArray(object)) {
          throw new FluxRuntimeError(`Indexing needs a list, got ${describe(object)}`, expr.pos);
        }
        if (typeof index !== 'number') {
          throw new FluxRuntimeError(`List index must be a number, got ${describe(index)}`, expr.pos);
        }
        return object[index] ?? null;
      }
      case 'call':
        return this.call(expr, scope);
    }
  }

  // ── Operators ─────────────────────────────────────────────────────────────────

  private binary(expr: Expr & { kind: 'binary' }, scope: Scope): unknown {
    const { op } = expr;

    if (op === 'and') {
      if (!this.toBool(this.eval(expr.left, scope), expr.pos)) return false;
      return this.toBool(this.eval(expr.right, scope), expr.pos);
    }
    if (op === 'or') {
      if (this.toBool(this.eval(expr.left, scope), expr.pos)) return true;
      return this.toBool(this.eval(expr.right, scope), expr.pos);
    }

    const left = this.eval(expr.left, scope);
    const right = this.eval(expr.right, scope);

    if (op === '=') return this.looseEquals(unwrap(left), unwrap(right));
    if (op === '!=') return !this.looseEquals(unwrap(left), unwrap(right));

    if (op === '<' || op === '<=' || op === '>' || op === '>=') {
      const cmp = this.compare(left, right, expr.pos);
      if (cmp === null) return false; // ordering against null → false (D5)
      switch (op) {
        case '<': return cmp < 0;
        case '<=': return cmp <= 0;
        case '>': return cmp > 0;
        case '>=': return cmp >= 0;
      }
    }

    // + - * / % : null propagates (GRAMMAR §3.3)
    if (left === null || right === null) return null;

    if (op === '+') {
      if (typeof left === 'string' || typeof right === 'string') {
        return this.toText(left, expr.pos) + this.toText(right, expr.pos);
      }
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      throw new FluxRuntimeError(`Cannot add ${describe(left)} and ${describe(right)}`, expr.pos);
    }

    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new FluxRuntimeError(`'${op}' needs numbers, got ${describe(left)} and ${describe(right)}`, expr.pos);
    }
    switch (op) {
      case '-': return left - right;
      case '*': return left * right;
      case '/':
        if (right === 0) throw new FluxRuntimeError('Division by zero', expr.pos);
        return left / right;
      case '%':
        if (right === 0) throw new FluxRuntimeError('Division by zero', expr.pos);
        return left % right;
    }
    throw new FluxRuntimeError(`Unsupported operator '${op}'`, expr.pos);
  }

  /** Total equality (D5): null = null is true; strings compare case-insensitively; dates by time. */
  private looseEquals(a: unknown, b: unknown): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (isRecord(a) && isRecord(b)) return a.type === b.type && a.id === b.id;
    return a === b;
  }

  /** Ordering comparison; null involvement yields null (caller maps to false). */
  private compare(rawA: unknown, rawB: unknown, pos: Position): number | null {
    const a = unwrap(rawA);
    const b = unwrap(rawB);
    if (a === null || b === null) return null;
    if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
    if (typeof a === 'string' && typeof b === 'string') {
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      return la === lb ? 0 : la < lb ? -1 : 1;
    }
    if (a instanceof Date && b instanceof Date) {
      const ta = a.getTime();
      const tb = b.getTime();
      return ta === tb ? 0 : ta < tb ? -1 : 1;
    }
    throw new FluxRuntimeError(`Cannot compare ${describe(a)} with ${describe(b)}`, pos);
  }

  /** Conditions must be boolean; null counts as false (null-safety); anything else is an error. */
  private toBool(value: unknown, pos: Position): boolean {
    if (value === null) return false;
    if (typeof value === 'boolean') return value;
    throw new FluxRuntimeError(`Expected true/false, got ${describe(value)}`, pos);
  }

  private toText(value: unknown, pos: Position): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value instanceof Date) return value.toISOString();
    if (value instanceof FkPointer) return String(value.id);
    if (isRecord(value)) return value.id;
    throw new FluxRuntimeError(`Cannot convert ${describe(value)} to text`, pos);
  }

  // ── Member access ─────────────────────────────────────────────────────────────

  private member(object: unknown, name: string, pos: Position): unknown {
    if (object === null) return null; // null-safe navigation

    if (object instanceof RecordsRoot) {
      if (!object.host.hasType(name)) {
        throw new FluxRuntimeError(`Unknown record type '${name}'`, pos);
      }
      return this.materialize(object.host.getAll(name), pos);
    }

    if (object instanceof FkPointer) {
      const target = this.recordsHost(pos).getById(object.targetType, object.id);
      return target === null ? null : this.member(this.copyRecord(target), name, pos);
    }

    if (isRecord(object)) {
      if (name === 'id') return object.id;
      const key = lookupKey(object.fields, name);
      if (key !== null) {
        const value = object.fields[key];
        const fkTarget = this.host.records?.fkTarget(object.type, key) ?? null;
        if (fkTarget !== null && value !== null && value !== undefined) {
          return new FkPointer(fkTarget, value);
        }
        return value ?? null;
      }
      const reverse = this.host.records?.reverseRef(object.type, name) ?? null;
      if (reverse !== null) {
        const all = this.recordsHost(pos).getAll(reverse.sourceType);
        const matches = all.filter((r) => this.looseEquals(unwrap(r.fields[reverse.field]), object.id));
        return this.materialize(matches, pos);
      }
      throw new FluxRuntimeError(`'${object.type}' has no field '${name}'`, pos);
    }

    if (Array.isArray(object)) {
      if (name === 'count') return object.length;
      if (name === 'first') return object.length > 0 ? object[0] : null;
      throw new FluxRuntimeError(`Lists have no property '${name}'`, pos);
    }

    if (isPlainObject(object)) {
      const key = lookupKey(object, name);
      return key === null ? null : (object[key] ?? null); // context/attributes content is host-defined — missing keys are null
    }

    throw new FluxRuntimeError(`Cannot access '.${name}' on ${describe(object)}`, pos);
  }

  // ── Calls ─────────────────────────────────────────────────────────────────────

  private call(expr: Expr & { kind: 'call' }, scope: Scope): unknown {
    const { callee } = expr;

    // Builtin functions
    if (callee.kind === 'ident') {
      return this.builtin(callee.name, expr, scope);
    }

    if (callee.kind === 'member') {
      const object = this.eval(callee.object, scope);
      const method = callee.name;

      if (object === null) return null; // null-safe: method on null is null

      if (Array.isArray(object) && CHAIN_METHODS.has(method)) {
        return this.chainMethod(object, method, expr.args, scope, expr.pos);
      }

      if (object instanceof Date && DATE_METHODS.has(method)) {
        const n = this.numberArg(expr, scope, `${method} needs a number`);
        const out = new Date(object.getTime());
        if (method === 'adddays') out.setDate(out.getDate() + n);
        else if (method === 'addmonths') out.setMonth(out.getMonth() + n);
        else out.setFullYear(out.getFullYear() + n);
        return out;
      }

      // Service module functions (host-provided)
      if (isPlainObject(object)) {
        const key = lookupKey(object, method);
        const fn = key === null ? null : object[key];
        if (typeof fn === 'function') {
          const args = expr.args.map((arg) => this.eval(arg.value, scope));
          return (fn as (...a: unknown[]) => unknown)(...args);
        }
      }

      throw new FluxRuntimeError(`Unknown method '${method}' on ${describe(object)}`, expr.pos);
    }

    throw new FluxRuntimeError('This is not something that can be called', expr.pos);
  }

  private builtin(name: string, expr: Expr & { kind: 'call' }, scope: Scope): unknown {
    const args = expr.args;
    const evalArg = (i: number) => this.eval(args[i].value, scope);
    const need = (n: number) => {
      if (args.length !== n) {
        throw new FluxRuntimeError(`${name}() takes ${n} argument${n === 1 ? '' : 's'}, got ${args.length}`, expr.pos);
      }
    };

    switch (name) {
      case 'iif': {
        need(3);
        return this.toBool(evalArg(0), expr.pos) ? evalArg(1) : evalArg(2); // lazy branches
      }
      case 'now':
        need(0);
        return this.host.now ? this.host.now() : new Date();
      case 'date': {
        need(1);
        const raw = evalArg(0);
        if (typeof raw !== 'string') throw new FluxRuntimeError(`date() needs text like '2026-07-01'`, expr.pos);
        const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
        if (Number.isNaN(parsed.getTime())) throw new FluxRuntimeError(`Invalid date: '${raw}'`, expr.pos);
        return parsed;
      }
      case 'exact': {
        need(2);
        const a = evalArg(0);
        const b = evalArg(1);
        return typeof a === 'string' && typeof b === 'string' ? a === b : a === b;
      }
      case 'len': {
        need(1);
        const v = evalArg(0);
        if (v === null) return null;
        if (typeof v === 'string' || Array.isArray(v)) return v.length;
        throw new FluxRuntimeError(`len() needs text or a list, got ${describe(v)}`, expr.pos);
      }
      case 'lower':
      case 'upper':
      case 'trim': {
        need(1);
        const v = evalArg(0);
        if (v === null) return null;
        if (typeof v !== 'string') throw new FluxRuntimeError(`${name}() needs text, got ${describe(v)}`, expr.pos);
        return name === 'lower' ? v.toLowerCase() : name === 'upper' ? v.toUpperCase() : v.trim();
      }
      case 'abs': {
        need(1);
        const v = evalArg(0);
        if (v === null) return null;
        if (typeof v !== 'number') throw new FluxRuntimeError(`abs() needs a number, got ${describe(v)}`, expr.pos);
        return Math.abs(v);
      }
      case 'round': {
        if (args.length < 1 || args.length > 2) {
          throw new FluxRuntimeError(`round() takes 1 or 2 arguments, got ${args.length}`, expr.pos);
        }
        const v = evalArg(0);
        if (v === null) return null;
        if (typeof v !== 'number') throw new FluxRuntimeError(`round() needs a number, got ${describe(v)}`, expr.pos);
        const places = args.length === 2 ? evalArg(1) : 0;
        if (typeof places !== 'number') throw new FluxRuntimeError('round() places must be a number', expr.pos);
        const factor = 10 ** places;
        return Math.round(v * factor) / factor;
      }
      default:
        throw new FluxRuntimeError(`Unknown function '${name}'`, expr.pos);
    }
  }

  private numberArg(expr: Expr & { kind: 'call' }, scope: Scope, message: string): number {
    if (expr.args.length !== 1) throw new FluxRuntimeError(message, expr.pos);
    const value = this.eval(expr.args[0].value, scope);
    if (typeof value !== 'number') throw new FluxRuntimeError(`${message}, got ${describe(value)}`, expr.pos);
    return value;
  }

  // ── Query chains (GRAMMAR §4) ─────────────────────────────────────────────────

  private chainMethod(list: unknown[], method: string, args: Arg[], outer: Scope, pos: Position): unknown {
    switch (method) {
      case 'where': {
        if (args.length !== 1) throw new FluxRuntimeError('where() takes one condition', pos);
        return list.filter((item) => {
          const value = this.eval(args[0].value, this.itemScope(item, outer));
          return this.toBool(value, args[0].value.pos);
        });
      }
      case 'orderby': {
        if (args.length === 0) throw new FluxRuntimeError('orderBy() needs at least one field', pos);
        const decorated = list.map((item) => ({
          item,
          keys: args.map((arg) => this.eval(arg.value, this.itemScope(item, outer))),
        }));
        decorated.sort((a, b) => {
          for (let i = 0; i < args.length; i++) {
            const ua = unwrap(a.keys[i]);
            const ub = unwrap(b.keys[i]);
            if (ua === null || ub === null) {
              if (ua === null && ub === null) continue;
              return ua === null ? 1 : -1; // nulls last, regardless of direction
            }
            const cmp = this.compare(ua, ub, args[i].value.pos) ?? 0;
            if (cmp !== 0) return args[i].direction === 'desc' ? -cmp : cmp;
          }
          return 0;
        });
        return decorated.map((d) => d.item);
      }
      case 'select': {
        if (args.length === 0) throw new FluxRuntimeError('select() needs at least one field', pos);
        const keys = args.map((arg) => {
          if (arg.alias) return arg.alias;
          if (arg.value.kind === 'ident') return arg.value.name;
          throw new FluxRuntimeError("Give this select expression a name: alias: expression", arg.value.pos);
        });
        return list.map((item) => {
          const row: Record<string, unknown> = {};
          const scope = this.itemScope(item, outer);
          args.forEach((arg, i) => {
            row[keys[i]] = unwrap(this.eval(arg.value, scope));
          });
          return row;
        });
      }
      case 'values': {
        if (args.length !== 1) throw new FluxRuntimeError('values() takes one field', pos);
        return list.map((item) => unwrap(this.eval(args[0].value, this.itemScope(item, outer))));
      }
      case 'top': {
        if (args.length !== 1) throw new FluxRuntimeError('top() takes one number', pos);
        const n = this.eval(args[0].value, outer);
        if (typeof n !== 'number' || n < 0) {
          throw new FluxRuntimeError(`top() needs a non-negative number, got ${describe(n)}`, pos);
        }
        return list.slice(0, Math.floor(n));
      }
      default:
        throw new FluxRuntimeError(`Unknown chain method '${method}'`, pos);
    }
  }

  /** Bare-field scope (GRAMMAR §4.1): item fields first, then the outer scope. */
  private itemScope(item: unknown, outer: Scope): Scope {
    return (name) => {
      if (isRecord(item)) {
        if (name === 'id') return { found: true, value: item.id };
        const key = lookupKey(item.fields, name);
        if (key !== null) {
          const value = item.fields[key];
          const fkTarget = this.host.records?.fkTarget(item.type, key) ?? null;
          if (fkTarget !== null && value !== null && value !== undefined) {
            return { found: true, value: new FkPointer(fkTarget, value) };
          }
          return { found: true, value: value ?? null };
        }
      } else if (isPlainObject(item)) {
        const key = lookupKey(item, name);
        if (key !== null) return { found: true, value: item[key] ?? null };
      }
      return outer(name);
    };
  }

  // ── Records ───────────────────────────────────────────────────────────────────

  private recordsHost(pos: Position): RecordsHost {
    if (!this.host.records) {
      throw new FluxRuntimeError("The 'records' root is not available in this context", pos);
    }
    return this.host.records;
  }

  /** Snapshot copies (D11): what scripts hold never aliases the store. */
  private materialize(records: DslRecord[], pos: Position): DslRecord[] {
    if (records.length > this.quotas.maxRows) {
      throw new FluxRuntimeError(`Query exceeded the row quota (${this.quotas.maxRows})`, pos);
    }
    return records.map((r) => this.copyRecord(r));
  }

  private copyRecord(record: DslRecord): DslRecord {
    return { id: record.id, type: record.type, fields: { ...record.fields } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (value instanceof Date) return 'a date';
  if (value instanceof FkPointer) return 'a reference';
  if (isRecord(value)) return `a ${value.type} record`;
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return `text ('${value.length > 20 ? value.slice(0, 20) + '…' : value}')`;
  return `a ${typeof value}`;
}

/** SQL LIKE → RegExp: % = any run, _ = one char; case-insensitive. */
function likeToRegex(pattern: string): RegExp {
  let out = '^';
  for (const ch of pattern) {
    if (ch === '%') out += '.*';
    else if (ch === '_') out += '.';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$', 'i');
}
