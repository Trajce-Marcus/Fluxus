import type { Arg, Call, Expr, FunctionDecl, Position, QueueStmt, Script, Stmt } from './ast';
import { parseExpression, parseFunction, parseScript } from './parser';
import { FluxFailError, FluxSyntaxError } from './errors';
import { DEFAULT_QUOTAS, DslRecord, EvalHost, FkPointer, MutationOp, Quotas, RecordsHost, RecordsMutationHost, ServiceFunctionDef, ServiceModuleDef, WriteThroughMutationHost } from './host';

/** Model collections are ordinary record types under this prefix, which no
 *  script ever writes — `model.record_types` reads `sdm_record_types`. */
export const MODEL_PREFIX = 'sdm_';

/** A host holds the model when it answers for the collections' own prefix.
 *  `record_types` is the one every projection has. */
function hostHasModelTypes(records: RecordsHost): boolean {
  return records.hasType(MODEL_PREFIX + 'record_types');
}

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

// ── Two drivers, one evaluator (SERVER_DATA_LOADING §4.1) ─────────────────────
//
// The evaluator's internals are generator functions. Whatever a host answers —
// a records read, a mutation, a service call, `invoke` — passes through
// `settle`, which yields it to the driver when it is a promise. The driver
// resumes the evaluator with the answer:
//   - the **immediate** driver (the browser's, and today's behaviour) is never
//     handed a promise — `settle` refuses one before yielding it, with an error
//     naming what answered asynchronously;
//   - the **waiting** driver (the server's) awaits it.
// A plain answer is not yielded at all, so evaluation over memory never leaves
// the call stack. The same technique as Babel's `gensync`; no dependency added.

type Gen<T> = Generator<unknown, T, unknown>;

function runImmediate<T>(gen: Gen<T>): T {
  const step = gen.next();
  // `settle` only yields in a waiting evaluator, so an immediate one finishes
  // in one step; anything else is a bug in the evaluator, not in a script.
  if (!step.done) throw new Error('Immediate evaluation was asked to wait');
  return step.value;
}

async function runWaiting<T>(evaluator: Evaluator, gen: Gen<T>): Promise<T> {
  let step = gen.next();
  while (!step.done) {
    const started = Date.now();
    let value: unknown;
    let failure: { error: unknown } | null = null;
    try {
      value = await step.value;
    } catch (error) {
      failure = { error };
    }
    // Waiting is not evaluating (ruling 20): the time budget stops runaway
    // scripts, not slow databases.
    evaluator.waited(Date.now() - started);
    step = failure ? gen.throw(failure.error) : gen.next(value);
  }
  return step.value;
}

/** Evaluate an expression-tier source string against a host. */
export function evaluateExpression(source: string, host: EvalHost = {}): unknown {
  return evaluateAst(parseExpression(source), host);
}

export function evaluateAst(expr: Expr, host: EvalHost = {}): unknown {
  return runImmediate(new Evaluator(host, 'read', false).run(expr));
}

/** `evaluateExpression`, waiting on whatever the host answers with a promise. */
export async function evaluateExpressionAsync(source: string, host: EvalHost = {}): Promise<unknown> {
  return evaluateAstAsync(parseExpression(source), host);
}

/** `evaluateAst`, waiting on whatever the host answers with a promise. */
export function evaluateAstAsync(expr: Expr, host: EvalHost = {}): Promise<unknown> {
  const evaluator = new Evaluator(host, 'read', true);
  return runWaiting(evaluator, evaluator.run(expr));
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
 *
 * A write-through host (the server's database store) takes each mutation as it
 * happens and undoes a failed script itself; see `WriteThroughMutationHost`.
 */
export function executeScript(source: string | Script, host: EvalHost = {}, options: ScriptOptions = {}): ScriptResult {
  const script = typeof source === 'string' ? parseScript(source) : source;
  return runImmediate(new Evaluator(host, options.mode ?? 'read', false).runScript(script));
}

/** `executeScript`, waiting on whatever the host answers with a promise. */
export async function executeScriptAsync(source: string | Script, host: EvalHost = {}, options: ScriptOptions = {}): Promise<ScriptResult> {
  const script = typeof source === 'string' ? parseScript(source) : source;
  const evaluator = new Evaluator(host, options.mode ?? 'read', true);
  return runWaiting(evaluator, evaluator.runScript(script));
}

// ── Internal values ─────────────────────────────────────────────────────────────

/** Marker for the `records` root; member access yields materialized record lists. */
class RecordsRoot {
  /**
   * `prefix` is how the `model` root reaches the SDM's own collections. They
   * are ordinary record types in the same table, named `sdm_*` so a solution's
   * types can never collide with them, and the prefix never appears in a
   * script: `model.record_types` reads `sdm_record_types`.
   *
   * One root class rather than two, so every chain, projection and shape rule
   * applies to the model exactly as it does to data (QUERYING_THE_MODEL §2).
   */
  constructor(readonly host: RecordsHost, readonly prefix = '') {}

  typeName(name: string): string {
    return this.prefix + name;
  }

  /** What an error should call it — the name as written, never the prefix. */
  label(): string {
    return this.prefix === '' ? 'record type' : 'model collection';
  }
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

/** `model` resolves as a root only where the host supplied the collections, so
 *  it is not in ROOT_NAMES: that set bans `let <name> = …` everywhere, and
 *  `model` is an ordinary word (vehicle model, equipment model). */
const CONDITIONAL_ROOT_NAMES = new Set(['model']);
const MAX_CALL_DEPTH = 64;

type Signal = { signal: 'return'; value: unknown } | null;

/** What `leaf` answers for an expression that needs the full evaluator. */
const NOT_LEAF = Symbol('not-leaf');

const leafShapeCache = new WeakMap<Expr, boolean>();

/**
 * Literals, names, member access and operators over nothing else — the shapes
 * `leaf` tries. Evaluating them has no effect but the step count, so an
 * attempt that meets a member needing the host can be backed out cleanly.
 */
function leafShaped(expr: Expr): boolean {
  switch (expr.kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'null':
    case 'ident':
      return true;
    case 'member':
    case 'binary': {
      let known = leafShapeCache.get(expr);
      if (known === undefined) {
        known = expr.kind === 'member' ? leafShaped(expr.object) : leafShaped(expr.left) && leafShaped(expr.right);
        leafShapeCache.set(expr, known);
      }
      return known;
    }
    default:
      return false;
  }
}

/** Where an error raised at a script's start or end is reported. */
const SCRIPT_POS: Position = { line: 1, col: 1 };

class Evaluator {
  private host: EvalHost;
  private quotas: Quotas;
  private mode: 'read' | 'mutate';
  /** Whether a waiting driver runs this evaluator — `settle` may then yield. */
  private waiting: boolean;
  private steps = 0;
  private deadline = 0;
  /** Time spent waiting on the host, which the time budget does not count. */
  private waitedMs = 0;
  private callDepth = 0;

  // Transaction staging (DSL_SPEC §7): ops in order, plus overlays so the
  // script reads its own writes before anything commits. Unused for a
  // write-through host, whose writes land as they happen.
  private staged: MutationOp[] = [];
  private stagedCreates = new Map<string, DslRecord[]>();
  private stagedPatches = new Map<string, Map<string, Record<string, unknown>>>();
  // Write-through bookkeeping: whether the host's undo point is open, and what
  // the script deleted, for the reference check at its end.
  private writeThroughBegun = false;
  private deleted: { type: string; id: string }[] = [];
  private queued: { label: string; invoke: () => unknown }[] = [];
  private warnings: string[] = [];

  // Named functions (DSL_SPEC §8), parsed lazily from host.functions.
  private functions: Map<string, FunctionDecl> | null = null;

  constructor(host: EvalHost, mode: 'read' | 'mutate', waiting: boolean) {
    this.host = host;
    this.mode = mode;
    this.waiting = waiting;
    this.quotas = { ...DEFAULT_QUOTAS, ...host.quotas };
  }

  /**
   * Scratch slot for leaf-first evaluation, written by `leaf` callers as
   * `(this.v = this.leaf(e, s)) !== NOT_LEAF ? this.v : yield* this.eval(e, s)`:
   * a literal, a name or an operator over them is answered without creating a
   * generator, which is most of what a filter or a hook evaluates. Read
   * immediately after it is written, so nested evaluation cannot disturb it.
   */
  private v: unknown = undefined;

  /** The waiting driver reports each wait here. */
  waited(ms: number): void {
    this.waitedMs += ms;
  }

  *run(expr: Expr): Gen<unknown> {
    this.steps = 0;
    this.deadline = Date.now() + this.quotas.timeoutMs;
    return yield* this.eval(expr, this.rootScope());
  }

  *runScript(script: Script): Gen<ScriptResult> {
    this.steps = 0;
    this.deadline = Date.now() + this.quotas.timeoutMs;
    const writeThrough = this.writeThroughHost();
    let sig: Signal;
    try {
      sig = yield* this.execBlock(script.body, new Env(null));
      if (writeThrough) {
        if (this.writeThroughBegun) yield* this.settle(writeThrough.finish(this.deleted), SCRIPT_POS, 'The records host');
      } else {
        yield* this.commitStaged(SCRIPT_POS);
      }
    } catch (err) {
      // A write-through host already holds the script's writes; it undoes them.
      if (writeThrough && this.writeThroughBegun) yield* this.settle(writeThrough.undo(), SCRIPT_POS, 'The records host');
      throw err;
    }
    if (writeThrough) {
      // Queued calls wait for the host's writes to commit, and are dropped if
      // they roll back (SERVER_DATA_LOADING §4.1).
      if (this.queued.length > 0) {
        const queued = this.queued;
        writeThrough.afterCommit(() => this.dispatchQueued(queued, (label, message) => this.host.onQueuedFailure?.(label, message)));
      }
    } else {
      this.dispatchQueued(this.queued, (label, message) => this.warnings.push(`queued ${label} failed: ${message}`));
    }
    return { value: sig ? sig.value : null, warnings: this.warnings };
  }

  /**
   * A host's answer, as a plain value. A promise is yielded to the driver: the
   * waiting driver resumes with what it resolves to (or throws what it rejects
   * with); the immediate evaluator cannot wait, so a promise is an error here.
   */
  private *settle<T>(value: T | Promise<T>, pos: Position, what: string): Gen<T> {
    if (!isThenable(value)) return value;
    if (!this.waiting) this.cannotWait(value, pos, what);
    return (yield value) as T;
  }

  /** The immediate evaluator was handed a promise. */
  private cannotWait(value: Promise<unknown>, pos: Position, what: string): never {
    // Nothing will ever look at it; keep a rejection from going unhandled.
    value.then(undefined, () => undefined);
    throw new FluxRuntimeError(`${what} answered asynchronously — this evaluation cannot wait for it`, pos);
  }

  /** Commit staged mutations (a staging host only). */
  private *commitStaged(pos: Position): Gen<void> {
    if (this.staged.length > 0) {
      const mutate = this.host.records!.mutate as RecordsMutationHost; // guarded at staging time
      yield* this.settle(mutate.apply(this.staged), pos, 'The records host');
    }
  }

  /** Dispatch queued calls (outbox — only after a clean commit). */
  private dispatchQueued(queued: { label: string; invoke: () => unknown }[], onFailure: (label: string, message: string) => void): void {
    for (const q of queued) {
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
        onFailure(q.label, e instanceof Error ? e.message : String(e));
      }
    }
  }

  // ── Statements (GRAMMAR §5) ───────────────────────────────────────────────────

  private *execBlock(stmts: Stmt[], env: Env): Gen<Signal> {
    for (const stmt of stmts) {
      const sig = yield* this.execStmt(stmt, env);
      if (sig) return sig;
    }
    return null;
  }

  private *execStmt(stmt: Stmt, env: Env): Gen<Signal> {
    this.tick(stmt.pos);
    const scope = this.scopeOf(env);
    switch (stmt.kind) {
      case 'let': {
        if (ROOT_NAMES.has(stmt.name)) {
          throw new FluxRuntimeError(`'${stmt.name}' is a root and cannot be redeclared`, stmt.pos);
        }
        if (!env.declare(stmt.name, ((this.v = this.leaf(stmt.value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(stmt.value, scope)))) {
          throw new FluxRuntimeError(`'${stmt.name}' is already declared in this block`, stmt.pos);
        }
        return null;
      }
      case 'assign': {
        const value = ((this.v = this.leaf(stmt.value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(stmt.value, scope));
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
        const object = ((this.v = this.leaf(stmt.target.object, scope)) !== NOT_LEAF ? this.v : yield* this.eval(stmt.target.object, scope));
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
        if (this.toBool(((this.v = this.leaf(stmt.cond, scope)) !== NOT_LEAF ? this.v : yield* this.eval(stmt.cond, scope)), stmt.pos)) {
          return yield* this.execBlock(stmt.then, new Env(env));
        }
        return stmt.else ? yield* this.execBlock(stmt.else, new Env(env)) : null;
      }
      case 'foreach': {
        const source = ((this.v = this.leaf(stmt.source, scope)) !== NOT_LEAF ? this.v : yield* this.eval(stmt.source, scope));
        const list = source === null ? [] : source; // null-safe: iterate nothing
        if (!Array.isArray(list)) {
          throw new FluxRuntimeError(`'for each' needs a list, got ${describe(source)}`, stmt.pos);
        }
        for (const item of list) {
          this.tick(stmt.pos);
          const loopEnv = new Env(env);
          loopEnv.declare(stmt.name, item);
          const sig = yield* this.execBlock(stmt.body, loopEnv);
          if (sig) return sig;
        }
        return null;
      }
      case 'queue':
        return yield* this.queueStmt(stmt, scope);
      case 'return':
        return { signal: 'return', value: stmt.value ? ((this.v = this.leaf(stmt.value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(stmt.value, scope)) : null };
      case 'exprstmt':
        ((this.v = this.leaf(stmt.expr, scope)) !== NOT_LEAF ? this.v : yield* this.eval(stmt.expr, scope));
        return null;
    }
  }

  private *queueStmt(stmt: QueueStmt, scope: Scope): Gen<null> {
    if (this.mode !== 'mutate') {
      throw new FluxRuntimeError("'queue' runs in after hooks only — before hooks validate, they don't act", stmt.pos);
    }
    const callee = stmt.call.callee;
    if (callee.kind !== 'member') {
      throw new FluxRuntimeError("'queue' needs a service call: queue services.module.fn(...)", stmt.pos);
    }
    const object = ((this.v = this.leaf(callee.object, scope)) !== NOT_LEAF ? this.v : yield* this.eval(callee.object, scope));
    if (!(object instanceof ServiceModuleValue)) {
      throw new FluxRuntimeError("'queue' needs a service call: queue services.module.fn(...)", stmt.pos);
    }
    const resolved = object.fn(callee.name);
    if (resolved === null) {
      throw new FluxRuntimeError(`Service '${object.def.name}' has no function '${callee.name}'`, stmt.pos);
    }
    // Arguments evaluate now (snapshot); the call itself dispatches after commit.
    // `queue` is the effect path, so `kind` is not checked here.
    const args: unknown[] = [];
    for (const a of stmt.call.args) args.push(((this.v = this.leaf(a.value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(a.value, scope)));
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
        case 'model': {
          // Only a root where the host actually holds the collections — which
          // is how exposure stays opt-in, and why `model` is not a reserved
          // word anywhere else.
          if (!this.host.records || !hostHasModelTypes(this.host.records)) {
            return { found: false, value: undefined };
          }
          return { found: true, value: new RecordsRoot(this.host.records, MODEL_PREFIX) };
        }
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
    if (this.steps % 512 === 0 && Date.now() - this.waitedMs > this.deadline) {
      throw new FluxRuntimeError(`Script exceeded the time budget (${this.quotas.timeoutMs}ms)`, pos);
    }
  }

  private *eval(expr: Expr, scope: Scope): Gen<unknown> {
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
      case 'ident':
        return this.ident(expr, scope);
      case 'list': {
        const out: unknown[] = [];
        for (const item of expr.items) out.push(((this.v = this.leaf(item, scope)) !== NOT_LEAF ? this.v : yield* this.eval(item, scope)));
        return out;
      }
      case 'object': {
        const out: Record<string, unknown> = {};
        for (const entry of expr.entries) {
          out[entry.key] = ((this.v = this.leaf(entry.value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(entry.value, scope));
        }
        return out;
      }
      case 'unary': {
        const value = ((this.v = this.leaf(expr.operand, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.operand, scope));
        if (expr.op === 'not') return !this.toBool(value, expr.pos);
        if (value === null) return null;
        if (typeof value !== 'number') {
          throw new FluxRuntimeError(`Unary '-' needs a number, got ${describe(value)}`, expr.pos);
        }
        return -value;
      }
      case 'binary': {
        // Inline rather than a generator of its own: operators are most of a
        // filter, and each generator is an allocation per row.
        const { op } = expr;
        let left = this.leaf(expr.left, scope);
        if (left === NOT_LEAF) left = yield* this.eval(expr.left, scope);
        if (op === 'and' || op === 'or') {
          const l = this.toBool(left, expr.pos);
          if (op === 'and' ? !l : l) return l;
        }
        let right = this.leaf(expr.right, scope);
        if (right === NOT_LEAF) right = yield* this.eval(expr.right, scope);
        if (op === 'and' || op === 'or') return this.toBool(right, expr.pos);
        return this.applyBinary(op, left, right, expr.pos);
      }
      case 'in': {
        const target = unwrap(((this.v = this.leaf(expr.target, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.target, scope)));
        const sourceValue = ((this.v = this.leaf(expr.source, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.source, scope));
        const list = Array.isArray(sourceValue) ? sourceValue : sourceValue === null ? [] : [sourceValue];
        const found = list.some((item) => this.looseEquals(target, unwrap(item)));
        return expr.negated ? !found : found;
      }
      case 'between': {
        const target = ((this.v = this.leaf(expr.target, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.target, scope));
        const lower = ((this.v = this.leaf(expr.lower, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.lower, scope));
        const upper = ((this.v = this.leaf(expr.upper, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.upper, scope));
        const cmpLower = this.compare(target, lower, expr.pos);
        const cmpUpper = this.compare(target, upper, expr.pos);
        const result = cmpLower !== null && cmpUpper !== null && cmpLower >= 0 && cmpUpper <= 0;
        return expr.negated ? !result : result;
      }
      case 'like': {
        const target = unwrap(((this.v = this.leaf(expr.target, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.target, scope)));
        const pattern = unwrap(((this.v = this.leaf(expr.pattern, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.pattern, scope)));
        if (target === null || pattern === null) return expr.negated;
        if (typeof target !== 'string' || typeof pattern !== 'string') {
          throw new FluxRuntimeError(`'like' compares text, got ${describe(target)} like ${describe(pattern)}`, expr.pos);
        }
        const regex = likeToRegex(pattern);
        const result = regex.test(target);
        return expr.negated ? !result : result;
      }
      case 'isnull': {
        const target = ((this.v = this.leaf(expr.target, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.target, scope));
        const isNull = target === null;
        return expr.negated ? !isNull : isNull;
      }
      case 'member': {
        let object = this.leaf(expr.object, scope);
        if (object === NOT_LEAF) object = yield* this.eval(expr.object, scope);
        if (!this.waiting) return this.memberImmediate(object, expr.name, expr.pos);
        const now = this.memberNow(object, expr.name, expr.pos);
        return now !== NOT_LEAF ? now : yield* this.member(object, expr.name, expr.pos);
      }
      case 'index': {
        const object = ((this.v = this.leaf(expr.object, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.object, scope));
        if (object === null) return null;
        const index = ((this.v = this.leaf(expr.index, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.index, scope));
        if (!Array.isArray(object)) {
          throw new FluxRuntimeError(`Indexing needs a list, got ${describe(object)}`, expr.pos);
        }
        if (typeof index !== 'number') {
          throw new FluxRuntimeError(`List index must be a number, got ${describe(index)}`, expr.pos);
        }
        return object[index] ?? null;
      }
      case 'call':
        return expr.callee.kind === 'ident'
          ? yield* this.builtin(expr.callee.name, expr, scope)
          : yield* this.call(expr, scope);
    }
  }

  private ident(expr: Expr & { kind: 'ident' }, scope: Scope): unknown {
    const result = scope(expr.name);
    if (!result.found) {
      // `model` is a root only where the host supplied the collections, so
      // it is an ordinary name elsewhere — but "Unknown name 'model'" reads
      // as a typo when the real answer is that this surface does not have
      // the model.
      if (expr.name === 'model') {
        throw new FluxRuntimeError(
          "'model' is not available here — the model collections are supplied to the DSL Editor only",
          expr.pos,
        );
      }
      throw new FluxRuntimeError(
        `Unknown name '${expr.name}' — bare field names are only available inside query methods`,
        expr.pos,
      );
    }
    return result.value;
  }

  /**
   * An expression answered without a generator — or NOT_LEAF, having changed
   * nothing. Literals, names, member access and operators over them are most
   * of what a filter or a hook evaluates; answering them here, at the caller,
   * is what keeps evaluation over memory close to its speed before the
   * evaluator could wait. Only shapes `leafShaped` admits are tried; a member
   * that turns out to need the host (a reference to follow, a collection)
   * backs the whole attempt out, step count included, and `eval` takes over.
   */
  private leaf(expr: Expr, scope: Scope): unknown {
    if (!leafShaped(expr)) return NOT_LEAF;
    const steps = this.steps;
    const value = this.leafNow(expr, scope);
    if (value === NOT_LEAF) this.steps = steps;
    return value;
  }

  private leafNow(expr: Expr, scope: Scope): unknown {
    this.tick(expr.pos);
    switch (expr.kind) {
      case 'number':
      case 'string':
      case 'boolean':
        return expr.value;
      case 'null':
        return null;
      case 'ident':
        return this.ident(expr, scope);
      case 'member': {
        const object = this.leafNow(expr.object, scope);
        if (object === NOT_LEAF) return NOT_LEAF;
        return this.waiting ? this.memberNow(object, expr.name, expr.pos) : this.memberImmediate(object, expr.name, expr.pos);
      }
      case 'binary': {
        const { op } = expr;
        const left = this.leafNow(expr.left, scope);
        if (left === NOT_LEAF) return NOT_LEAF;
        if (op === 'and' || op === 'or') {
          const l = this.toBool(left, expr.pos);
          if (op === 'and' ? !l : l) return l;
          const right = this.leafNow(expr.right, scope);
          return right === NOT_LEAF ? NOT_LEAF : this.toBool(right, expr.pos);
        }
        const right = this.leafNow(expr.right, scope);
        return right === NOT_LEAF ? NOT_LEAF : this.applyBinary(op, left, right, expr.pos);
      }
      default:
        return NOT_LEAF; // unreachable: leafShaped admits nothing else
    }
  }

  private applyBinary(op: string, left: unknown, right: unknown, pos: Position): unknown {
    if (op === '=') return this.looseEquals(unwrap(left), unwrap(right));
    if (op === '!=') return !this.looseEquals(unwrap(left), unwrap(right));

    if (op === '<' || op === '<=' || op === '>' || op === '>=') {
      const cmp = this.compare(left, right, pos);
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
        return this.toText(left, pos) + this.toText(right, pos);
      }
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      throw new FluxRuntimeError(`Cannot add ${describe(left)} and ${describe(right)}`, pos);
    }

    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new FluxRuntimeError(`'${op}' needs numbers, got ${describe(left)} and ${describe(right)}`, pos);
    }
    switch (op) {
      case '-': return left - right;
      case '*': return left * right;
      case '/':
        if (right === 0) throw new FluxRuntimeError('Division by zero', pos);
        return left / right;
      case '%':
        if (right === 0) throw new FluxRuntimeError('Division by zero', pos);
        return left % right;
    }
    throw new FluxRuntimeError(`Unsupported operator '${op}'`, pos);
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

  private *member(object: unknown, name: string, pos: Position): Gen<unknown> {
    if (!this.waiting) return this.memberImmediate(object, name, pos);
    const now = this.memberNow(object, name, pos);
    if (now !== NOT_LEAF) return now;
    if (object instanceof RecordsRoot) return yield* this.readAll(this.collectionType(object, name, pos), pos);
    if (object instanceof FkPointer) {
      const target = yield* this.readById(object.targetType, object.id, pos);
      return target === null ? null : yield* this.member(target, name, pos);
    }
    const { record, reverse } = this.reverseOf(object, name);
    return this.reverseRows(record, reverse, yield* this.readAll(reverse.sourceType, pos));
  }

  /**
   * `member` for the immediate evaluator, which reads the host directly — a
   * promise is an error there anyway. The same three host cases as `member`,
   * without a generator, so `leaf` can answer member access over memory.
   */
  private memberImmediate(object: unknown, name: string, pos: Position): unknown {
    const now = this.memberNow(object, name, pos);
    if (now !== NOT_LEAF) return now;
    if (object instanceof RecordsRoot) return this.readAllNow(this.collectionType(object, name, pos), pos);
    if (object instanceof FkPointer) {
      const target = this.readByIdNow(object.targetType, object.id, pos);
      return target === null ? null : this.memberImmediate(target, name, pos);
    }
    const { record, reverse } = this.reverseOf(object, name);
    return this.reverseRows(record, reverse, this.readAllNow(reverse.sourceType, pos));
  }

  /** The type a collection name reads — `records.<name>` or `model.<name>`. */
  private collectionType(root: RecordsRoot, name: string, pos: Position): string {
    // The prefix is the model's, and it is reached through `model.` only.
    // Without this, `records.sdm_record_types` read the model through the
    // data root — the reserved prefix leaking back into script surface.
    if (root.prefix === '' && name.startsWith(MODEL_PREFIX)) {
      throw new FluxRuntimeError(`'${name}' is a model collection — reach it as model.${name.slice(MODEL_PREFIX.length)}`, pos);
    }
    const type = root.typeName(name);
    if (!root.host.hasType(type)) {
      throw new FluxRuntimeError(`Unknown ${root.label()} '${name}'`, pos);
    }
    return type;
  }

  /** A record's reverse reference — the only other case `memberNow` leaves. */
  private reverseOf(object: unknown, name: string): { record: DslRecord; reverse: { sourceType: string; field: string } } {
    const record = object as DslRecord;
    return { record, reverse: this.host.records!.reverseRef(record.type, name)! };
  }

  private reverseRows(record: DslRecord, reverse: { sourceType: string; field: string }, all: DslRecord[]): DslRecord[] {
    return all.filter((r) => this.looseEquals(unwrap(r.fields[reverse.field]), record.id));
  }

  /**
   * Member access that needs no host — or NOT_LEAF for the cases that read
   * records (a collection, a reference followed, a reverse reference), which
   * `member` then answers.
   */
  private memberNow(object: unknown, name: string, pos: Position): unknown {
    if (object === null) return null; // null-safe navigation

    if (object instanceof RecordsRoot || object instanceof FkPointer) return NOT_LEAF;

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
      if ((this.host.records?.reverseRef(object.type, name) ?? null) !== null) return NOT_LEAF;
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

  private *call(expr: Expr & { kind: 'call' }, scope: Scope): Gen<unknown> {
    const { callee } = expr;

    // Builtin and named functions
    if (callee.kind === 'ident') {
      return yield* this.builtin(callee.name, expr, scope);
    }

    if (callee.kind === 'member') {
      const method = callee.name;

      // Mutations (GRAMMAR §5 D13/D14). The collection patterns
      // records.<type>.create / records.<type>.update are recognized on the AST
      // so the collection is never materialized just to mutate it; the inner
      // object is evaluated once and the chain resumed from it.
      let object: unknown;
      if ((method === 'create' || method === 'update' || method === 'delete') && callee.object.kind === 'member') {
        const inner = ((this.v = this.leaf(callee.object.object, scope)) !== NOT_LEAF ? this.v : yield* this.eval(callee.object.object, scope));
        if (inner instanceof RecordsRoot) {
          // The model is read-only in every host: it changes through the
          // Console's SDM editors and `config.put*`, never through a script.
          // Both spellings are refused as read-only, not as unknown.
          if (inner.prefix !== '' || callee.object.name.startsWith(MODEL_PREFIX)) {
            throw new FluxRuntimeError(`The model is read-only — '${method}' is not available on model.${callee.object.name}`, callee.object.pos);
          }
          const type = callee.object.name;
          if (!inner.host.hasType(type)) {
            throw new FluxRuntimeError(`Unknown record type '${type}'`, callee.object.pos);
          }
          if (method === 'create') {
            return yield* this.createRecord(type, yield* this.fieldsArg(expr, scope, 'create'), expr.pos);
          }
          if (method === 'delete') {
            throw new FluxRuntimeError(
              `Bulk delete needs a filter: records.${type}.where(...).delete()`,
              expr.pos,
            );
          }
          throw new FluxRuntimeError(
            `Bulk update needs a filter: records.${type}.where(...).update({...})`,
            expr.pos,
          );
        }
        object = yield* this.member(inner, callee.object.name, callee.object.pos);
      } else {
        object = ((this.v = this.leaf(callee.object, scope)) !== NOT_LEAF ? this.v : yield* this.eval(callee.object, scope));
      }

      // FK auto-deref extends to method calls: wo.workgroup_id.update({...})
      if (object instanceof FkPointer) {
        object = yield* this.readById(object.targetType, object.id, expr.pos);
      }

      if (object === null) return null; // null-safe: method on null is null

      if (method === 'update' && isRecord(object)) {
        return yield* this.updateRecord(object, yield* this.fieldsArg(expr, scope, 'update'), expr.pos);
      }
      if (method === 'update' && Array.isArray(object)) {
        // Bulk update as chain terminal — every element must carry record identity
        const fields = yield* this.fieldsArg(expr, scope, 'update');
        for (const item of object) {
          // The model is read-only whatever route reaches it. Guarding the
          // rows rather than the root catches the chain terminal too, which
          // otherwise fell through to the store and failed as "record not
          // found" — a confusing answer to an act that is simply not allowed.
          if (isRecord(item) && item.type.startsWith(MODEL_PREFIX)) {
            throw new FluxRuntimeError('The model is read-only — it changes through the SDM editors, not a script', expr.pos);
          }
          if (!isRecord(item)) {
            throw new FluxRuntimeError(
              'Only records can be updated — projected rows have no identity',
              expr.pos,
            );
          }
        }
        for (const item of object) {
          this.tick(expr.pos);
          yield* this.updateRecord(item as DslRecord, fields, expr.pos);
        }
        return object.length;
      }
      if (method === 'delete' && isRecord(object)) {
        this.noArgs(expr, 'delete');
        return yield* this.deleteRecord(object, expr.pos);
      }
      if (method === 'delete' && Array.isArray(object)) {
        // Bulk delete as chain terminal — the selection decides what goes, the
        // same way bulk update decides what changes.
        this.noArgs(expr, 'delete');
        for (const item of object) {
          if (!isRecord(item)) {
            throw new FluxRuntimeError(
              'Only records can be deleted — projected rows have no identity',
              expr.pos,
            );
          }
        }
        for (const item of object) {
          this.tick(expr.pos);
          yield* this.deleteRecord(item as DslRecord, expr.pos);
        }
        return object.length;
      }
      if (method === 'create' && (Array.isArray(object) || isRecord(object))) {
        throw new FluxRuntimeError('create is collection-level: records.<type>.create({...})', expr.pos);
      }

      if (Array.isArray(object) && CHAIN_METHODS.has(method)) {
        return yield* this.chainMethod(object, method, expr.args, scope, expr.pos);
      }

      if (object instanceof Date && DATE_METHODS.has(method)) {
        const n = yield* this.numberArg(expr, scope, `${method} needs a number`);
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
        const args: unknown[] = [];
        for (const arg of expr.args) args.push(((this.v = this.leaf(arg.value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(arg.value, scope)));
        const result = resolved.def.fn(...args);
        if (isThenable(result) && !this.waiting) {
          result.then(undefined, () => undefined);
          throw new FluxRuntimeError(
            `'${label}' is asynchronous — this evaluation cannot wait for it; use 'queue' for fire-and-forget`,
            expr.pos,
          );
        }
        return yield* this.settle(result, expr.pos, `'${label}'`);
      }

      throw new FluxRuntimeError(`Unknown method '${method}' on ${describe(object)}`, expr.pos);
    }

    throw new FluxRuntimeError('This is not something that can be called', expr.pos);
  }

  private *builtin(name: string, expr: Expr & { kind: 'call' }, scope: Scope): Gen<unknown> {
    const args = expr.args;

    const need = (n: number) => {
      if (args.length !== n) {
        throw new FluxRuntimeError(`${name}() takes ${n} argument${n === 1 ? '' : 's'}, got ${args.length}`, expr.pos);
      }
    };

    switch (name) {
      case 'iif': {
        need(3);
        return this.toBool(((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope)), expr.pos) ? ((this.v = this.leaf(args[1].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[1].value, scope)) : ((this.v = this.leaf(args[2].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[2].value, scope)); // lazy branches
      }
      case 'now':
        need(0);
        return this.host.now ? this.host.now() : new Date();
      case 'invoke': {
        if (args.length < 1 || args.length > 2) {
          throw new FluxRuntimeError(`invoke() takes 1–2 arguments, got ${args.length}`, expr.pos);
        }
        const activityId = ((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope));
        if (typeof activityId !== 'string') {
          throw new FluxRuntimeError(`invoke() needs an activity id, got ${describe(activityId)}`, expr.pos);
        }
        if (!this.host.invoke) {
          throw new FluxRuntimeError(`invoke() is not available here — this host runs no activities`, expr.pos);
        }
        const raw = args.length === 2 ? ((this.v = this.leaf(args[1].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[1].value, scope)) : {};
        if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
          throw new FluxRuntimeError(`invoke() parameters must be an object, got ${describe(raw)}`, expr.pos);
        }
        return yield* this.settle(this.host.invoke(activityId, (raw ?? {}) as Record<string, unknown>), expr.pos, 'invoke()');
      }
      case 'date': {
        need(1);
        const raw = ((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope));
        if (typeof raw !== 'string') throw new FluxRuntimeError(`date() needs text like '2026-07-01'`, expr.pos);
        const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
        if (Number.isNaN(parsed.getTime())) throw new FluxRuntimeError(`Invalid date: '${raw}'`, expr.pos);
        return parsed;
      }
      case 'exact': {
        need(2);
        const a = ((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope));
        const b = ((this.v = this.leaf(args[1].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[1].value, scope));
        return typeof a === 'string' && typeof b === 'string' ? a === b : a === b;
      }
      case 'len': {
        need(1);
        const v = ((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope));
        if (v === null) return null;
        if (typeof v === 'string' || Array.isArray(v)) return v.length;
        throw new FluxRuntimeError(`len() needs text or a list, got ${describe(v)}`, expr.pos);
      }
      case 'lower':
      case 'upper':
      case 'trim': {
        need(1);
        const v = ((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope));
        if (v === null) return null;
        if (typeof v !== 'string') throw new FluxRuntimeError(`${name}() needs text, got ${describe(v)}`, expr.pos);
        return name === 'lower' ? v.toLowerCase() : name === 'upper' ? v.toUpperCase() : v.trim();
      }
      case 'abs': {
        need(1);
        const v = ((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope));
        if (v === null) return null;
        if (typeof v !== 'number') throw new FluxRuntimeError(`abs() needs a number, got ${describe(v)}`, expr.pos);
        return Math.abs(v);
      }
      case 'round': {
        if (args.length < 1 || args.length > 2) {
          throw new FluxRuntimeError(`round() takes 1 or 2 arguments, got ${args.length}`, expr.pos);
        }
        const v = ((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope));
        if (v === null) return null;
        if (typeof v !== 'number') throw new FluxRuntimeError(`round() needs a number, got ${describe(v)}`, expr.pos);
        const places = args.length === 2 ? ((this.v = this.leaf(args[1].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[1].value, scope)) : 0;
        if (typeof places !== 'number') throw new FluxRuntimeError('round() places must be a number', expr.pos);
        const factor = 10 ** places;
        return Math.round(v * factor) / factor;
      }
      case 'fail': {
        need(1);
        throw new FluxFailError(this.toText(((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope)), expr.pos));
      }
      case 'warn': {
        need(1);
        this.warnings.push(this.toText(((this.v = this.leaf(args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, scope)), expr.pos));
        return null;
      }
      default: {
        const fn = this.functionByName(name, expr.pos);
        if (fn) return yield* this.callFunction(fn, expr, scope);
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

  private *callFunction(fn: FunctionDecl, expr: Expr & { kind: 'call' }, scope: Scope): Gen<unknown> {
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
    for (let i = 0; i < fn.params.length; i++) env.declare(fn.params[i], ((this.v = this.leaf(expr.args[i].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.args[i].value, scope)));
    this.callDepth++;
    try {
      const sig = yield* this.execBlock(fn.body, env);
      return sig ? sig.value : null;
    } finally {
      this.callDepth--;
    }
  }

  private *numberArg(expr: Expr & { kind: 'call' }, scope: Scope, message: string): Gen<number> {
    if (expr.args.length !== 1) throw new FluxRuntimeError(message, expr.pos);
    const value = ((this.v = this.leaf(expr.args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.args[0].value, scope));
    if (typeof value !== 'number') throw new FluxRuntimeError(`${message}, got ${describe(value)}`, expr.pos);
    return value;
  }

  // ── Query chains (GRAMMAR §4) ─────────────────────────────────────────────────

  private *chainMethod(list: unknown[], method: string, args: Arg[], outer: Scope, pos: Position): Gen<unknown> {
    switch (method) {
      case 'where': {
        if (args.length !== 1) throw new FluxRuntimeError('where() takes one condition', pos);
        const cond = args[0].value;
        const out: unknown[] = [];
        for (const item of list) {
          const scope = this.itemScope(item, outer);
          let keep = this.leaf(cond, scope);
          if (keep === NOT_LEAF) keep = yield* this.eval(cond, scope);
          if (this.toBool(keep, cond.pos)) out.push(item);
        }
        return out;
      }
      case 'orderby': {
        if (args.length === 0) throw new FluxRuntimeError('orderBy() needs at least one field', pos);
        const decorated: { item: unknown; keys: unknown[] }[] = [];
        for (const item of list) {
          const scope = this.itemScope(item, outer);
          const keys: unknown[] = [];
          for (const arg of args) {
            let key = this.leaf(arg.value, scope);
            if (key === NOT_LEAF) key = yield* this.eval(arg.value, scope);
            keys.push(key);
          }
          decorated.push({ item, keys });
        }
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
        const rows: Record<string, unknown>[] = [];
        for (const item of list) {
          const row: Record<string, unknown> = {};
          const scope = this.itemScope(item, outer);
          for (let i = 0; i < args.length; i++) {
            let value = this.leaf(args[i].value, scope);
            if (value === NOT_LEAF) value = yield* this.eval(args[i].value, scope);
            row[keys[i]] = unwrap(value);
          }
          rows.push(row);
        }
        return rows;
      }
      case 'values': {
        if (args.length !== 1) throw new FluxRuntimeError('values() takes one field', pos);
        const out: unknown[] = [];
        for (const item of list) {
          const scope = this.itemScope(item, outer);
          let value = this.leaf(args[0].value, scope);
          if (value === NOT_LEAF) value = yield* this.eval(args[0].value, scope);
          out.push(unwrap(value));
        }
        return out;
      }
      case 'top': {
        if (args.length !== 1) throw new FluxRuntimeError('top() takes one number', pos);
        const n = ((this.v = this.leaf(args[0].value, outer)) !== NOT_LEAF ? this.v : yield* this.eval(args[0].value, outer));
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
   * A write-through host has nothing staged; its reads already include them.
   */
  private *readAll(type: string, pos: Position): Gen<DslRecord[]> {
    const answer = this.recordsHost(pos).getAll(type);
    return this.overlayAll(type, isThenable(answer) ? yield* this.settle(answer, pos, 'The records host') : answer, pos);
  }

  private readAllNow(type: string, pos: Position): DslRecord[] {
    const answer = this.recordsHost(pos).getAll(type);
    return this.overlayAll(type, isThenable(answer) ? this.cannotWait(answer, pos, 'The records host') : answer, pos);
  }

  private overlayAll(type: string, base: DslRecord[], pos: Position): DslRecord[] {
    const patches = this.stagedPatches.get(type);
    const out = base.map((r) => {
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

  private *readById(type: string, id: unknown, pos: Position): Gen<DslRecord | null> {
    const raw = unwrap(id);
    const created = this.stagedCreates.get(type)?.find((r) => this.looseEquals(r.id, raw));
    if (created) return this.copyRecord(created);
    const answer = this.recordsHost(pos).getById(type, raw);
    return this.overlayOne(type, isThenable(answer) ? yield* this.settle(answer, pos, 'The records host') : answer);
  }

  private readByIdNow(type: string, id: unknown, pos: Position): DslRecord | null {
    const raw = unwrap(id);
    const created = this.stagedCreates.get(type)?.find((r) => this.looseEquals(r.id, raw));
    if (created) return this.copyRecord(created);
    const answer = this.recordsHost(pos).getById(type, raw);
    return this.overlayOne(type, isThenable(answer) ? this.cannotWait(answer, pos, 'The records host') : answer);
  }

  private overlayOne(type: string, record: DslRecord | null): DslRecord | null {
    if (record === null) return null;
    const copy = this.copyRecord(record);
    const patch = this.stagedPatches.get(type)?.get(record.id);
    if (patch) Object.assign(copy.fields, patch);
    return copy;
  }

  private copyRecord(record: DslRecord): DslRecord {
    return { id: record.id, type: record.type, fields: { ...record.fields } };
  }

  // ── Mutations (staged and committed by runScript, or written through) ─────────

  private mutationHost(pos: Position, what: string): RecordsMutationHost | WriteThroughMutationHost {
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

  /** The write-through host, when this script's host declares one and may mutate. */
  private writeThroughHost(): WriteThroughMutationHost | null {
    if (this.mode !== 'mutate') return null;
    const mutate = this.host.records?.mutate;
    return mutate && isWriteThrough(mutate) ? mutate : null;
  }

  /** A host error from a mutation, as a script error at the call. */
  private *mutation<T>(write: () => T | Promise<T>, pos: Position): Gen<T> {
    try {
      return yield* this.settle(write(), pos, 'The records host');
    } catch (e) {
      if (e instanceof FluxRuntimeError) throw e;
      throw new FluxRuntimeError(e instanceof Error ? e.message : String(e), pos);
    }
  }

  /** Open the write-through host's undo point before the script's first write. */
  private *beginWriteThrough(host: WriteThroughMutationHost, pos: Position): Gen<void> {
    if (this.writeThroughBegun) return;
    yield* this.settle(host.begin(), pos, 'The records host');
    this.writeThroughBegun = true;
  }

  private *createRecord(type: string, fields: Record<string, unknown>, pos: Position): Gen<DslRecord> {
    const mutate = this.mutationHost(pos, 'create');
    if (isWriteThrough(mutate)) {
      yield* this.beginWriteThrough(mutate, pos);
      return this.copyRecord(yield* this.mutation(() => mutate.create(type, fields), pos));
    }
    const record = yield* this.mutation(() => mutate.prepareCreate(type, fields), pos);
    const list = this.stagedCreates.get(type) ?? [];
    list.push(record);
    this.stagedCreates.set(type, list);
    this.staged.push({ op: 'create', type, record });
    return record;
  }

  private *updateRecord(record: DslRecord, fields: Record<string, unknown>, pos: Position): Gen<DslRecord> {
    // The model never changes through a script, whichever route reaches the
    // row — including a single record held in a variable or arrived at by
    // dereference. Without this the write reaches the mutation host, which
    // keys on id alone, so a model row whose id matched a real record's would
    // have written to that record.
    if (record.type.startsWith(MODEL_PREFIX)) {
      throw new FluxRuntimeError('The model is read-only — it changes through the SDM editors, not a script', pos);
    }
    const mutate = this.mutationHost(pos, 'update');

    if (isWriteThrough(mutate)) {
      yield* this.beginWriteThrough(mutate, pos);
      yield* this.mutation(() => mutate.update(record.type, record.id, fields), pos);
      Object.assign(record.fields, fields); // the held snapshot reads its own write
      return record;
    }

    // Updating a record this script created: fold into the staged create.
    const created = this.stagedCreates.get(record.type)?.find((r) => r.id === record.id);
    if (created) {
      Object.assign(created.fields, fields);
      if (created !== record) Object.assign(record.fields, fields);
      return record;
    }

    yield* this.mutation(() => mutate.prepareUpdate(record.type, record.id, fields), pos);
    this.staged.push({ op: 'update', type: record.type, id: record.id, fields });
    const patches = this.stagedPatches.get(record.type) ?? new Map<string, Record<string, unknown>>();
    patches.set(record.id, { ...patches.get(record.id), ...fields });
    this.stagedPatches.set(record.type, patches);
    Object.assign(record.fields, fields); // the held snapshot reads its own write
    return record;
  }

  /**
   * Delete a record: the row and its history both go (the user's ruling,
   * 2026-09-21 — a delete is for what should never have existed, and anything
   * worth keeping is marked instead). Deleting one this script created cancels
   * the create rather than staging a delete of a record that was never
   * persisted; any patches staged against it go too, since there is nothing
   * left to patch.
   *
   * A write-through host deletes at once; what still points at the record is
   * checked when the script ends, across everything it deleted.
   */
  private *deleteRecord(record: DslRecord, pos: Position): Gen<DslRecord> {
    // Same rule as bulk update: the model never changes through a script,
    // whichever route reaches the row.
    if (record.type.startsWith(MODEL_PREFIX)) {
      throw new FluxRuntimeError('The model is read-only — it changes through the SDM editors, not a script', pos);
    }
    const mutate = this.mutationHost(pos, 'delete');

    if (isWriteThrough(mutate)) {
      yield* this.beginWriteThrough(mutate, pos);
      yield* this.mutation(() => mutate.delete(record.type, record.id), pos);
      this.deleted.push({ type: record.type, id: record.id });
      return record;
    }

    const creates = this.stagedCreates.get(record.type);
    const createdAt = creates?.findIndex((r) => r.id === record.id) ?? -1;
    if (creates && createdAt !== -1) {
      creates.splice(createdAt, 1);
      this.staged = this.staged.filter(
        (op) => !((op.op === 'create' && op.record.id === record.id) || (op.op !== 'create' && op.id === record.id)),
      );
      this.stagedPatches.get(record.type)?.delete(record.id);
      return record;
    }

    yield* this.mutation(() => mutate.prepareDelete(record.type, record.id), pos);
    this.staged = this.staged.filter((op) => op.op === 'create' || op.id !== record.id);
    this.stagedPatches.get(record.type)?.delete(record.id);
    this.staged.push({ op: 'delete', type: record.type, id: record.id });
    return record;
  }

  /** A method that answers nothing but the call itself — `delete()` takes no argument. */
  private noArgs(expr: Expr & { kind: 'call' }, what: string): void {
    if (expr.args.length !== 0) {
      throw new FluxRuntimeError(`${what}() takes no arguments`, expr.pos);
    }
  }

  /** The single `{ field: value }` argument of create/update, values normalized to ids. */
  private *fieldsArg(expr: Expr & { kind: 'call' }, scope: Scope, what: string): Gen<Record<string, unknown>> {
    if (expr.args.length !== 1) {
      throw new FluxRuntimeError(`${what}() takes one object: ${what}({ field: value, … })`, expr.pos);
    }
    const raw = ((this.v = this.leaf(expr.args[0].value, scope)) !== NOT_LEAF ? this.v : yield* this.eval(expr.args[0].value, scope));
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

function isWriteThrough(mutate: RecordsMutationHost | WriteThroughMutationHost): mutate is WriteThroughMutationHost {
  return (mutate as WriteThroughMutationHost).writesThrough === true;
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
