import type { Arg, Call, Expr, FunctionDecl, Position, QueueStmt, Script, Stmt } from './ast';
import { parseExpression, parseFunction, parseScript } from './parser';
import { FluxFailError, FluxSyntaxError } from './errors';
import { DEFAULT_QUOTAS, DslRecord, EvalHost, FkPointer, MutationOp, Quotas, RecordsHost, ServiceFunctionDef, ServiceModuleDef } from './host';

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
  return new Evaluator(host, 'read').run(expr);
}

export interface ScriptOptions {
  /**
   * 'read' (default): validation surfaces — before hooks, expression embeddings.
   * Mutations and `queue` are runtime errors.
   * 'mutate': after hooks — mutations stage and commit atomically (DSL_SPEC §7).
   */
  mode?: 'read' | 'mutate';
}

export interface ScriptResult {
  /** Value of a top-level `return`, else null. */
  value: unknown;
  /** Messages from `warn(...)`, plus any queued-dispatch failures. */
  warnings: string[];
}

/**
 * Execute a script-tier source (hook, headless workflow). Record mutations are
 * staged during the run and committed only if the whole script succeeds; `queue`d
 * service calls dispatch only after the commit (outbox). `fail('msg')` throws
 * FluxFailError — the caller rejects the activity and nothing persists.
 */
export function executeScript(source: string | Script, host: EvalHost = {}, options: ScriptOptions = {}): ScriptResult {
  const script = typeof source === 'string' ? parseScript(source) : source;
  return new Evaluator(host, options.mode ?? 'read').runScript(script);
}

// ── Internal values ─────────────────────────────────────────────────────────────

/** Marker for the `records` root; member access yields materialized record lists. */
class RecordsRoot {
  constructor(readonly host: RecordsHost) {}
}

/** Marker for the `services` root; member access yields service modules. */
class ServicesRoot {
  constructor(readonly modules: ServiceModuleDef[]) {}

  module(name: string): ServiceModuleValue | null {
    const lower = name.toLowerCase();
    const def = this.modules.find((m) => m.name.toLowerCase() === lower);
    return def ? new ServiceModuleValue(def) : null;
  }
}

/** A resolved service module; its functions are callable, nothing is readable. */
class ServiceModuleValue {
  constructor(readonly def: ServiceModuleDef) {}

  fn(name: string): { key: string; def: ServiceFunctionDef } | null {
    const lower = name.toLowerCase();
    for (const [key, def] of Object.entries(this.def.functions)) {
      if (key.toLowerCase() === lower) return { key, def };
    }
    return null;
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
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
    !(value instanceof ServicesRoot) &&
    !(value instanceof ServiceModuleValue) &&
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

/** Block-scoped variables (GRAMMAR §5): `let` declares, `x = …` assigns up the chain. */
class Env {
  private vars = new Map<string, unknown>();

  constructor(private parent: Env | null) {}

  lookup(name: string): { found: boolean; value: unknown } {
    if (this.vars.has(name)) return { found: true, value: this.vars.get(name) };
    return this.parent ? this.parent.lookup(name) : { found: false, value: undefined };
  }

  /** False when the name is already declared in this block. */
  declare(name: string, value: unknown): boolean {
    if (this.vars.has(name)) return false;
    this.vars.set(name, value);
    return true;
  }

  /** False when the name is not declared in any enclosing block. */
  assign(name: string, value: unknown): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return true;
    }
    return this.parent ? this.parent.assign(name, value) : false;
  }
}

const ROOT_NAMES = new Set(['context', 'attributes', 'records', 'services']);
const MAX_CALL_DEPTH = 64;

type Signal = { signal: 'return'; value: unknown } | null;

class Evaluator {
  private host: EvalHost;
  private quotas: Quotas;
  private mode: 'read' | 'mutate';
  private steps = 0;
  private deadline = 0;
  private callDepth = 0;

  // Transaction staging (DSL_SPEC §7): ops in order, plus overlays so the
  // script reads its own writes before anything commits.
  private staged: MutationOp[] = [];
  private stagedCreates = new Map<string, DslRecord[]>();
  private stagedPatches = new Map<string, Map<string, Record<string, unknown>>>();
  private queued: { label: string; invoke: () => unknown }[] = [];
  private warnings: string[] = [];

  // Named functions (DSL_SPEC §8), parsed lazily from host.functions.
  private functions: Map<string, FunctionDecl> | null = null;

  constructor(host: EvalHost, mode: 'read' | 'mutate') {
    this.host = host;
    this.mode = mode;
    this.quotas = { ...DEFAULT_QUOTAS, ...host.quotas };
  }

  run(expr: Expr): unknown {
    this.steps = 0;
    this.deadline = Date.now() + this.quotas.timeoutMs;
    return this.eval(expr, this.rootScope());
  }

  runScript(script: Script): ScriptResult {
    this.steps = 0;
    this.deadline = Date.now() + this.quotas.timeoutMs;
    const sig = this.execBlock(script.body, new Env(null));
    this.commit();
    return { value: sig ? sig.value : null, warnings: this.warnings };
  }

  /** Commit staged mutations, then dispatch queued calls (outbox — only after a clean commit). */
  private commit(): void {
    if (this.staged.length > 0) {
      this.host.records!.mutate!.apply(this.staged); // guarded at staging time
    }
    for (const q of this.queued) {
      try {
        const result = q.invoke();
        if (isThenable(result)) {
          // Fire-and-forget: the script has already returned when an async
          // dispatch fails, so the failure goes to the host, not to warnings.
          result.then(undefined, (e: unknown) => {
            this.host.onQueuedFailure?.(q.label, e instanceof Error ? e.message : String(e));
          });
        }
      } catch (e) {
        this.warnings.push(`queued ${q.label} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── Statements (GRAMMAR §5) ───────────────────────────────────────────────────

  private execBlock(stmts: Stmt[], env: Env): Signal {
    for (const stmt of stmts) {
      const sig = this.execStmt(stmt, env);
      if (sig) return sig;
    }
    return null;
  }

  private execStmt(stmt: Stmt, env: Env): Signal {
    this.tick(stmt.pos);
    const scope = this.scopeOf(env);
    switch (stmt.kind) {
      case 'let': {
        if (ROOT_NAMES.has(stmt.name)) {
          throw new FluxRuntimeError(`'${stmt.name}' is a root and cannot be redeclared`, stmt.pos);
        }
        if (!env.declare(stmt.name, this.eval(stmt.value, scope))) {
          throw new FluxRuntimeError(`'${stmt.name}' is already declared in this block`, stmt.pos);
        }
        return null;
      }
      case 'assign': {
        const value = this.eval(stmt.value, scope);
        if (stmt.target.kind === 'ident') {
          if (ROOT_NAMES.has(stmt.target.name)) {
            throw new FluxRuntimeError(`'${stmt.target.name}' is a root and cannot be assigned`, stmt.pos);
          }
          if (!env.assign(stmt.target.name, value)) {
            throw new FluxRuntimeError(`Unknown variable '${stmt.target.name}' — declare it with 'let'`, stmt.pos);
          }
          return null;
        }
        // Member assignment: records are read-only values (D14); plain objects
        // (rows, object literals) accept local-only writes.
        const object = this.eval(stmt.target.object, scope);
        const field = stmt.target.name;
        if (object === null) throw new FluxRuntimeError(`Cannot set '.${field}' on null`, stmt.pos);
        if (isRecord(object)) {
          throw new FluxRuntimeError(
            `Records are read-only values — use .update({ ${field}: … }) to change '${field}'`,
            stmt.pos,
          );
        }
        if (!isPlainObject(object)) {
          throw new FluxRuntimeError(`Cannot set '.${field}' on ${describe(object)}`, stmt.pos);
        }
        object[lookupKey(object, field) ?? field] = value;
        return null;
      }
      case 'if': {
        if (this.toBool(this.eval(stmt.cond, scope), stmt.pos)) {
          return this.execBlock(stmt.then, new Env(env));
        }
        return stmt.else ? this.execBlock(stmt.else, new Env(env)) : null;
      }
      case 'foreach': {
        const source = this.eval(stmt.source, scope);
        const list = source === null ? [] : source; // null-safe: iterate nothing
        if (!Array.isArray(list)) {
          throw new FluxRuntimeError(`'for each' needs a list, got ${describe(source)}`, stmt.pos);
        }
        for (const item of list) {
          this.tick(stmt.pos);
          const loopEnv = new Env(env);
          loopEnv.declare(stmt.name, item);
          const sig = this.execBlock(stmt.body, loopEnv);
          if (sig) return sig;
        }
        return null;
      }
      case 'queue':
        return this.queueStmt(stmt, scope);
      case 'return':
        return { signal: 'return', value: stmt.value ? this.eval(stmt.value, scope) : null };
      case 'exprstmt':
        this.eval(stmt.expr, scope);
        return null;
    }
  }

  private queueStmt(stmt: QueueStmt, scope: Scope): null {
    if (this.mode !== 'mutate') {
      throw new FluxRuntimeError("'queue' runs in after hooks only — before hooks validate, they don't act", stmt.pos);
    }
    const callee = stmt.call.callee;
    if (callee.kind !== 'member') {
      throw new FluxRuntimeError("'queue' needs a service call: queue services.module.fn(...)", stmt.pos);
    }
    const object = this.eval(callee.object, scope);
    if (!(object instanceof ServiceModuleValue)) {
      throw new FluxRuntimeError("'queue' needs a service call: queue services.module.fn(...)", stmt.pos);
    }
    const resolved = object.fn(callee.name);
    if (resolved === null) {
      throw new FluxRuntimeError(`Service '${object.def.name}' has no function '${callee.name}'`, stmt.pos);
    }
    // Arguments evaluate now (snapshot); the call itself dispatches after commit.
    // `queue` is the effect path, so `kind` is not checked here.
    const args = stmt.call.args.map((a) => this.eval(a.value, scope));
    this.queued.push({ label: calleePath(callee), invoke: () => resolved.def.fn(...args) });
    return null;
  }

  private scopeOf(env: Env): Scope {
    const roots = this.rootScope();
    return (name) => {
      const local = env.lookup(name);
      return local.found ? local : roots(name);
    };
  }

  private rootScope(): Scope {
    return (name) => {
      switch (name) {
        case 'context':
          return { found: true, value: this.host.context ?? {} };
        case 'attributes':
          return { found: true, value: this.host.attributes ?? {} };
        case 'services':
          return { found: true, value: new ServicesRoot(this.host.services ?? []) };
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
      return this.readAll(name, pos);
    }

    if (object instanceof ServicesRoot) {
      const module = object.module(name);
      if (module === null) {
        throw new FluxRuntimeError(`Unknown service module '${name}'`, pos);
      }
      return module;
    }

    if (object instanceof ServiceModuleValue) {
      throw new FluxRuntimeError(
        `Service functions are called, not read: services.${object.def.name}.${name}(…)`,
        pos,
      );
    }

    if (object instanceof FkPointer) {
      const target = this.readById(object.targetType, object.id, pos);
      return target === null ? null : this.member(target, name, pos);
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
        const all = this.readAll(reverse.sourceType, pos);
        return all.filter((r) => this.looseEquals(unwrap(r.fields[reverse.field]), object.id));
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
      const value = key === null ? null : (object[key] ?? null); // context/attributes content is host-defined — missing keys are null
      // Records handed out by host roots (context.record, …) are snapshotted so
      // scripts never alias live store objects, and read staged patches.
      if (isRecord(value)) {
        const copy = this.copyRecord(value);
        const patch = this.stagedPatches.get(copy.type)?.get(copy.id);
        if (patch) Object.assign(copy.fields, patch);
        return copy;
      }
      return value;
    }

    throw new FluxRuntimeError(`Cannot access '.${name}' on ${describe(object)}`, pos);
  }

  // ── Calls ─────────────────────────────────────────────────────────────────────

  private call(expr: Expr & { kind: 'call' }, scope: Scope): unknown {
    const { callee } = expr;

    // Builtin and named functions
    if (callee.kind === 'ident') {
      return this.builtin(callee.name, expr, scope);
    }

    if (callee.kind === 'member') {
      const method = callee.name;

      // Mutations (GRAMMAR §5 D13/D14). The collection patterns
      // records.<type>.create / records.<type>.update are recognized on the AST
      // so the collection is never materialized just to mutate it; the inner
      // object is evaluated once and the chain resumed from it.
      let object: unknown;
      if ((method === 'create' || method === 'update') && callee.object.kind === 'member') {
        const inner = this.eval(callee.object.object, scope);
        if (inner instanceof RecordsRoot) {
          const type = callee.object.name;
          if (!inner.host.hasType(type)) {
            throw new FluxRuntimeError(`Unknown record type '${type}'`, callee.object.pos);
          }
          if (method === 'create') {
            return this.createRecord(type, this.fieldsArg(expr, scope, 'create'), expr.pos);
          }
          throw new FluxRuntimeError(
            `Bulk update needs a filter: records.${type}.where(...).update({...})`,
            expr.pos,
          );
        }
        object = this.member(inner, callee.object.name, callee.object.pos);
      } else {
        object = this.eval(callee.object, scope);
      }

      // FK auto-deref extends to method calls: wo.workgroup_id.update({...})
      if (object instanceof FkPointer) {
        object = this.readById(object.targetType, object.id, expr.pos);
      }

      if (object === null) return null; // null-safe: method on null is null

      if (method === 'update' && isRecord(object)) {
        return this.updateRecord(object, this.fieldsArg(expr, scope, 'update'), expr.pos);
      }
      if (method === 'update' && Array.isArray(object)) {
        // Bulk update as chain terminal — every element must carry record identity
        const fields = this.fieldsArg(expr, scope, 'update');
        for (const item of object) {
          if (!isRecord(item)) {
            throw new FluxRuntimeError(
              'Only records can be updated — projected rows have no identity',
              expr.pos,
            );
          }
        }
        for (const item of object) {
          this.tick(expr.pos);
          this.updateRecord(item as DslRecord, fields, expr.pos);
        }
        return object.length;
      }
      if (method === 'create' && (Array.isArray(object) || isRecord(object))) {
        throw new FluxRuntimeError('create is collection-level: records.<type>.create({...})', expr.pos);
      }

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

      // Service module functions (Phase 3): registry-resolved, purity-checked
      if (object instanceof ServiceModuleValue) {
        const resolved = object.fn(method);
        if (resolved === null) {
          throw new FluxRuntimeError(`Service '${object.def.name}' has no function '${method}'`, expr.pos);
        }
        const label = `services.${object.def.name}.${resolved.key}`;
        if (resolved.def.kind === 'effect' && this.mode !== 'mutate') {
          throw new FluxRuntimeError(`'${label}' has effects — it runs in after hooks only (prefer 'queue')`, expr.pos);
        }
        const args = expr.args.map((arg) => this.eval(arg.value, scope));
        const result = resolved.def.fn(...args);
        if (isThenable(result)) {
          throw new FluxRuntimeError(
            `'${label}' is asynchronous — waiting async service calls arrive with the async evaluator; use 'queue' for fire-and-forget`,
            expr.pos,
          );
        }
        return result;
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
      case 'fail': {
        need(1);
        throw new FluxFailError(this.toText(evalArg(0), expr.pos));
      }
      case 'warn': {
        need(1);
        this.warnings.push(this.toText(evalArg(0), expr.pos));
        return null;
      }
      default: {
        const fn = this.functionByName(name, expr.pos);
        if (fn) return this.callFunction(fn, expr, scope);
        throw new FluxRuntimeError(`Unknown function '${name}'`, expr.pos);
      }
    }
  }

  // ── Named functions (DSL_SPEC §8) ─────────────────────────────────────────────

  private functionByName(name: string, pos: Position): FunctionDecl | null {
    if (this.functions === null) {
      this.functions = new Map();
      for (const source of this.host.functions ?? []) {
        try {
          const decl = parseFunction(source);
          this.functions.set(decl.name, decl);
        } catch (e) {
          if (e instanceof FluxSyntaxError) {
            throw new FluxRuntimeError(`A named function failed to parse: ${e.message}`, pos);
          }
          throw e;
        }
      }
    }
    return this.functions.get(name) ?? null;
  }

  private callFunction(fn: FunctionDecl, expr: Expr & { kind: 'call' }, scope: Scope): unknown {
    if (expr.args.length !== fn.params.length) {
      throw new FluxRuntimeError(
        `${fn.name}() takes ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'}, got ${expr.args.length}`,
        expr.pos,
      );
    }
    if (this.callDepth >= MAX_CALL_DEPTH) {
      throw new FluxRuntimeError(`Call depth exceeded (${MAX_CALL_DEPTH}) — check for runaway recursion`, expr.pos);
    }
    // Lexical isolation: parameters + the roots; never the caller's variables.
    const env = new Env(null);
    fn.params.forEach((param, i) => env.declare(param, this.eval(expr.args[i].value, scope)));
    this.callDepth++;
    try {
      const sig = this.execBlock(fn.body, env);
      return sig ? sig.value : null;
    } finally {
      this.callDepth--;
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

  // ── Records: reads through the staging overlay, staged mutations ───────────────

  private recordsHost(pos: Position): RecordsHost {
    if (!this.host.records) {
      throw new FluxRuntimeError("The 'records' root is not available in this context", pos);
    }
    return this.host.records;
  }

  /**
   * Snapshot copies (D11) with read-your-writes: staged updates patch the base
   * rows, staged creates append — the script sees its own uncommitted changes.
   */
  private readAll(type: string, pos: Position): DslRecord[] {
    const patches = this.stagedPatches.get(type);
    const out = this.recordsHost(pos).getAll(type).map((r) => {
      const copy = this.copyRecord(r);
      const patch = patches?.get(r.id);
      if (patch) Object.assign(copy.fields, patch);
      return copy;
    });
    for (const created of this.stagedCreates.get(type) ?? []) {
      out.push(this.copyRecord(created));
    }
    if (out.length > this.quotas.maxRows) {
      throw new FluxRuntimeError(`Query exceeded the row quota (${this.quotas.maxRows})`, pos);
    }
    return out;
  }

  private readById(type: string, id: unknown, pos: Position): DslRecord | null {
    const raw = unwrap(id);
    const created = this.stagedCreates.get(type)?.find((r) => this.looseEquals(r.id, raw));
    if (created) return this.copyRecord(created);
    const record = this.recordsHost(pos).getById(type, raw);
    if (record === null) return null;
    const copy = this.copyRecord(record);
    const patch = this.stagedPatches.get(type)?.get(record.id);
    if (patch) Object.assign(copy.fields, patch);
    return copy;
  }

  private copyRecord(record: DslRecord): DslRecord {
    return { id: record.id, type: record.type, fields: { ...record.fields } };
  }

  // ── Mutations (staged; committed by runScript on success) ──────────────────────

  private mutationHost(pos: Position, what: string) {
    if (this.mode !== 'mutate') {
      throw new FluxRuntimeError(
        `${what} is not allowed here — mutations run in after hooks only`,
        pos,
      );
    }
    const mutate = this.host.records?.mutate;
    if (!mutate) {
      throw new FluxRuntimeError('This host does not support record mutations', pos);
    }
    return mutate;
  }

  private createRecord(type: string, fields: Record<string, unknown>, pos: Position): DslRecord {
    const mutate = this.mutationHost(pos, 'create');
    let record: DslRecord;
    try {
      record = mutate.prepareCreate(type, fields);
    } catch (e) {
      throw new FluxRuntimeError(e instanceof Error ? e.message : String(e), pos);
    }
    const list = this.stagedCreates.get(type) ?? [];
    list.push(record);
    this.stagedCreates.set(type, list);
    this.staged.push({ op: 'create', type, record });
    return record;
  }

  private updateRecord(record: DslRecord, fields: Record<string, unknown>, pos: Position): DslRecord {
    const mutate = this.mutationHost(pos, 'update');

    // Updating a record this script created: fold into the staged create.
    const created = this.stagedCreates.get(record.type)?.find((r) => r.id === record.id);
    if (created) {
      Object.assign(created.fields, fields);
      if (created !== record) Object.assign(record.fields, fields);
      return record;
    }

    try {
      mutate.prepareUpdate(record.type, record.id, fields);
    } catch (e) {
      throw new FluxRuntimeError(e instanceof Error ? e.message : String(e), pos);
    }
    this.staged.push({ op: 'update', type: record.type, id: record.id, fields });
    const patches = this.stagedPatches.get(record.type) ?? new Map<string, Record<string, unknown>>();
    patches.set(record.id, { ...patches.get(record.id), ...fields });
    this.stagedPatches.set(record.type, patches);
    Object.assign(record.fields, fields); // the held snapshot reads its own write
    return record;
  }

  /** The single `{ field: value }` argument of create/update, values normalized to ids. */
  private fieldsArg(expr: Expr & { kind: 'call' }, scope: Scope, what: string): Record<string, unknown> {
    if (expr.args.length !== 1) {
      throw new FluxRuntimeError(`${what}() takes one object: ${what}({ field: value, … })`, expr.pos);
    }
    const raw = this.eval(expr.args[0].value, scope);
    if (!isPlainObject(raw)) {
      throw new FluxRuntimeError(`${what}() needs an object: ${what}({ field: value, … })`, expr.pos);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = isRecord(value) ? value.id : unwrap(value);
    }
    return out;
  }
}

/** Dotted path of a member callee, for queue labels: `services.notify.sms`. */
function calleePath(expr: Expr): string {
  if (expr.kind === 'member') return `${calleePath(expr.object)}.${expr.name}`;
  if (expr.kind === 'ident') return expr.name;
  return '(…)';
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (value instanceof Date) return 'a date';
  if (value instanceof FkPointer) return 'a reference';
  if (value instanceof ServicesRoot) return 'the services root';
  if (value instanceof ServiceModuleValue) return `the '${value.def.name}' service`;
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
