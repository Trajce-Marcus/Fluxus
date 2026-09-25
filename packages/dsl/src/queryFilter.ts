// What a record-query filter may hold (SERVER_DATA_LOADING §5.2). One static
// walk, shared by the validator (refused at save, §5.6) and the evaluator
// (refused when it runs on a host that answers queries itself, ruling 14; in
// memory the refused parts run per row instead).
//
// The walk answers two questions about a `where` condition or an `orderby`
// key: which parts depend on the row being filtered — everything else is
// worked out once, before the query runs, and used as a value — and which of
// the row-dependent parts cannot become SQL.

import type { Expr } from './ast';

/** What a query compares a value as (SERVER_DATA_LOADING §5.3). */
export type QueryValueType = 'text' | 'number' | 'instant' | 'bool' | 'opaque' | 'list';

/**
 * A declared field type, as a query reads it. `time` compares as text, as a
 * reference id does. Photo, file, geopoint and composite values are only ever
 * `is null` in a query; a list-valued type is refused wherever its items would
 * be reached. An undeclared type reads as text.
 */
export function fieldValueType(fieldType: string | undefined): QueryValueType {
  switch (fieldType) {
    case 'int':
    case 'decimal':
    case 'number':
      return 'number';
    case 'date':
    case 'datetime':
      return 'instant';
    case 'bool':
    case 'boolean':
      return 'bool';
    case 'photo':
    case 'file':
    case 'geopoint':
    case 'composite':
      return 'opaque';
    case 'list':
      return 'list';
    default:
      return 'text';
  }
}

/** What the walk needs to know about the model. */
export interface QuerySchema {
  /** A type's declared fields and their types, or null for a type not known. */
  fields(type: string): Record<string, string> | null;
  /** Target type when `key` on `type` is a reference, else null. */
  fkTarget(type: string, key: string): string | null;
  /** Whether `name` on a record of `type` is a reverse reference. */
  reverseRef(type: string, name: string): boolean;
}

/** The declared key a (lower-cased) name reads, or null — names are case-insensitive. */
export function declaredKey(fields: Record<string, string> | null, name: string): string | null {
  if (!fields) return null;
  if (name in fields) return name;
  const lower = name.toLowerCase();
  for (const key of Object.keys(fields)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

/** Why a part of a filter cannot become SQL — the words both the save check and the run use. */
export const REFUSED = {
  callOnField: (what: string) =>
    `A query filter cannot pass a record field to ${what} — it would run once per record; work the value out before the query, or filter a list held in a variable`,
  index: () => 'A query filter cannot index into a list field',
  readInside: (name: string) =>
    `A query filter cannot read '.${name}' inside a field's value — only a reference field is followed`,
  inListField: () => "A query filter cannot test 'in' against a list field",
  countList: () => 'A query filter cannot count or measure a list field',
  reverse: (name: string) => `A query filter cannot follow the reverse reference '${name}'`,
  nested: () => 'A query filter cannot hold a records query that refers to the record being filtered',
  opaque: () => "A query filter can only test a photo, file, geopoint or composite field with 'is null'",
  iif: () => 'iif() in a query filter needs both branches of one type',
  other: () => 'This part of a query filter cannot run in the database',
} as const;

export interface FilterRefusal {
  expr: Expr;
  message: string;
}

export interface FilterAnalysis {
  /** Every node that depends on the row. Anything else is worked out first. */
  row: Set<Expr>;
  /**
   * Why the filter cannot become SQL — one entry per cause: a node over a part
   * already refused is not reported again.
   */
  refusals: FilterRefusal[];
  /**
   * The parts that cannot become SQL themselves — in memory each runs per row
   * as DSL, while what encloses it still follows §5.3.
   */
  refused: Set<Expr>;
}

const DATE_METHODS = new Set(['adddays', 'addmonths', 'addyears']);
const CHAIN_METHODS = new Set(['where', 'orderby', 'select', 'values', 'top']);
/** Built-ins a filter may apply to the row (ruling 15). */
const ROW_BUILTINS = new Set(['len', 'lower', 'upper', 'trim', 'abs', 'round', 'exact', 'date', 'iif']);

/** What the walk learns of one node. `ref` is the target type when it is a reference field. */
interface Info {
  row: boolean;
  type: QueryValueType | null;
  ref: string | null;
  /** A field read, as opposed to an expression over one — `tags.count` is refused as a list field. */
  field: boolean;
}

const VALUE: Info = { row: false, type: null, ref: null, field: false };

/**
 * Walk a filter condition or an orderby key of a query over `type`.
 *
 * `prefix` is how a `model.<name>` chain nested in the filter names its type
 * (the model collections live under a prefix scripts never write).
 */
export function analyseFilter(expr: Expr, type: string, schema: QuerySchema, prefix: string, sortKey = false): FilterAnalysis {
  const out: FilterAnalysis = { row: new Set(), refusals: [], refused: new Set() };
  const walk = new Walk(type, schema, prefix, out);
  const info = walk.info(expr, []);
  // A sort key is compared row with row, so a value only `is null` can test
  // cannot be one.
  if (sortKey && info.row && (info.type === 'opaque' || info.type === 'list') && !out.refused.has(expr)) {
    out.refusals.push({ expr, message: REFUSED.opaque() });
    out.refused.add(expr);
  }
  return out;
}

class Walk {
  constructor(
    private type: string,
    private schema: QuerySchema,
    private prefix: string,
    private out: FilterAnalysis,
  ) {}

  /** Refusals already recorded when each node on the walk's path was entered. */
  private entered: number[] = [];

  private refuse(expr: Expr, message: string): Info {
    // A part inside this node was refused already: that is the cause to report.
    if (this.out.refusals.length === this.entered[this.entered.length - 1]) {
      this.out.refusals.push({ expr, message });
    }
    this.out.refused.add(expr);
    this.out.row.add(expr);
    return { row: true, type: null, ref: null, field: false };
  }

  private rowInfo(expr: Expr, type: QueryValueType | null, ref: string | null = null, field = false): Info {
    this.out.row.add(expr);
    return { row: true, type, ref, field };
  }

  /**
   * `nested` holds the element types of records queries this node sits inside,
   * innermost last: a bare name inside one reads that query's own row first.
   */
  info(expr: Expr, nested: (string | null)[]): Info {
    this.entered.push(this.out.refusals.length);
    try {
      return this.node(expr, nested);
    } finally {
      this.entered.pop();
    }
  }

  private node(expr: Expr, nested: (string | null)[]): Info {
    switch (expr.kind) {
      case 'number':
        return { ...VALUE, type: 'number' };
      case 'string':
        return { ...VALUE, type: 'text' };
      case 'boolean':
        return { ...VALUE, type: 'bool' };
      case 'null':
        return VALUE;

      case 'ident': {
        for (let i = nested.length - 1; i >= 0; i--) {
          const inner = nested[i];
          // A nested query of a type the walk cannot see might hold any name;
          // it is not taken for the outer row.
          if (inner === null) return VALUE;
          if (expr.name === 'id' || declaredKey(this.schema.fields(inner), expr.name) !== null) return VALUE;
        }
        if (expr.name === 'id') return this.rowInfo(expr, 'text', null, true);
        const fields = this.schema.fields(this.type);
        const key = declaredKey(fields, expr.name);
        if (key === null) return VALUE; // an outer variable or a root (ruling 13)
        return this.rowInfo(expr, fieldValueType(fields![key]), this.schema.fkTarget(this.type, key), true);
      }

      case 'member': {
        const object = this.info(expr.object, nested);
        if (!object.row) return VALUE;
        if (object.ref !== null) {
          if (expr.name === 'id') return this.rowInfo(expr, 'text', null, true);
          const fields = this.schema.fields(object.ref);
          const key = declaredKey(fields, expr.name);
          if (key !== null) {
            return this.rowInfo(expr, fieldValueType(fields![key]), this.schema.fkTarget(object.ref, key), true);
          }
          if (this.schema.reverseRef(object.ref, expr.name)) return this.refuse(expr, REFUSED.reverse(expr.name));
          return this.rowInfo(expr, null); // an unknown field: its own error, not a refusal
        }
        if (object.field && object.type === 'list' && (expr.name === 'count' || expr.name === 'first')) {
          return this.refuse(expr, REFUSED.countList());
        }
        return this.refuse(expr, REFUSED.readInside(expr.name));
      }

      case 'list': {
        let row = false;
        for (const item of expr.items) row = this.info(item, nested).row || row;
        return row ? this.refuse(expr, REFUSED.other()) : VALUE;
      }

      case 'object': {
        let row = false;
        for (const entry of expr.entries) row = this.info(entry.value, nested).row || row;
        return row ? this.refuse(expr, REFUSED.other()) : VALUE;
      }

      case 'index': {
        const object = this.info(expr.object, nested);
        const index = this.info(expr.index, nested);
        return object.row || index.row ? this.refuse(expr, REFUSED.index()) : VALUE;
      }

      case 'unary': {
        const operand = this.info(expr.operand, nested);
        if (!operand.row) return VALUE;
        if (isOpaque(operand)) return this.refuse(expr, REFUSED.opaque());
        return this.rowInfo(expr, expr.op === 'not' ? 'bool' : 'number');
      }

      case 'binary': {
        const left = this.info(expr.left, nested);
        const right = this.info(expr.right, nested);
        if (!left.row && !right.row) return VALUE;
        if (isOpaque(left) || isOpaque(right)) return this.refuse(expr, REFUSED.opaque());
        switch (expr.op) {
          case 'and':
          case 'or':
          case '=':
          case '!=':
          case '<':
          case '<=':
          case '>':
          case '>=':
            return this.rowInfo(expr, 'bool');
          case '+':
            return this.rowInfo(expr, left.type === 'text' || right.type === 'text' ? 'text' : left.type === 'number' || right.type === 'number' ? 'number' : null);
          default:
            return this.rowInfo(expr, 'number');
        }
      }

      case 'in': {
        const target = this.info(expr.target, nested);
        let row = target.row;
        if (expr.source.kind === 'list') {
          for (const item of expr.source.items) {
            const info = this.info(item, nested);
            if (isOpaque(info)) return this.refuse(expr, REFUSED.opaque());
            row = info.row || row;
          }
        } else if (this.info(expr.source, nested).row) {
          return this.refuse(expr, REFUSED.inListField());
        }
        if (!row) return VALUE;
        if (isOpaque(target)) return this.refuse(expr, REFUSED.opaque());
        return this.rowInfo(expr, 'bool');
      }

      case 'between': {
        const parts = [expr.target, expr.lower, expr.upper].map((part) => this.info(part, nested));
        if (!parts.some((p) => p.row)) return VALUE;
        if (parts.some(isOpaque)) return this.refuse(expr, REFUSED.opaque());
        return this.rowInfo(expr, 'bool');
      }

      case 'like': {
        const target = this.info(expr.target, nested);
        const pattern = this.info(expr.pattern, nested);
        if (!target.row && !pattern.row) return VALUE;
        if (isOpaque(target) || isOpaque(pattern)) return this.refuse(expr, REFUSED.opaque());
        return this.rowInfo(expr, 'bool');
      }

      case 'isnull': {
        const target = this.info(expr.target, nested);
        return target.row ? this.rowInfo(expr, 'bool') : VALUE;
      }

      case 'call':
        return this.call(expr, nested);
    }
    return VALUE;
  }

  private call(expr: Expr & { kind: 'call' }, nested: (string | null)[]): Info {
    const { callee } = expr;

    if (callee.kind === 'ident') {
      const args = expr.args.map((arg) => this.info(arg.value, nested));
      if (!args.some((a) => a.row)) return VALUE;
      const name = callee.name;
      if (!ROW_BUILTINS.has(name)) {
        const what = name === 'invoke' ? 'invoke()' : `${name}()`;
        return this.refuse(expr, REFUSED.callOnField(what));
      }
      if (name === 'len' && args[0]?.field && args[0].type === 'list') return this.refuse(expr, REFUSED.countList());
      if (args.some(isOpaque)) return this.refuse(expr, REFUSED.opaque());
      switch (name) {
        case 'len':
        case 'abs':
        case 'round':
          return this.rowInfo(expr, 'number');
        case 'lower':
        case 'upper':
        case 'trim':
          return this.rowInfo(expr, 'text');
        case 'exact':
          return this.rowInfo(expr, 'bool');
        case 'date':
          return this.rowInfo(expr, 'instant');
        case 'iif': {
          const [, a, b] = args;
          if (a && b && a.type !== null && b.type !== null && a.type !== b.type) {
            return this.refuse(expr, REFUSED.iif());
          }
          return this.rowInfo(expr, a?.type ?? b?.type ?? null);
        }
      }
      return this.rowInfo(expr, null);
    }

    if (callee.kind === 'member') {
      const method = callee.name;

      // A records query nested in the filter: its own arguments read its own
      // row first; it may be worked out once only if it never reaches ours.
      if (CHAIN_METHODS.has(method)) {
        const element = this.chainType(callee.object);
        const object = this.info(callee.object, nested);
        const inner = [...nested, element];
        let row = object.row;
        for (const arg of expr.args) row = this.info(arg.value, method === 'top' ? nested : inner).row || row;
        return row ? this.refuse(expr, REFUSED.nested()) : VALUE;
      }

      const object = this.info(callee.object, nested);
      const args = expr.args.map((arg) => this.info(arg.value, nested));
      if (!object.row && !args.some((a) => a.row)) return VALUE;

      if (DATE_METHODS.has(method)) {
        if (isOpaque(object) || args.some(isOpaque)) return this.refuse(expr, REFUSED.opaque());
        return this.rowInfo(expr, 'instant');
      }
      if (!object.row && isServiceCall(callee)) {
        return this.refuse(expr, REFUSED.callOnField(`services.${memberPath(callee.object)}.${method}`));
      }
      return this.refuse(expr, REFUSED.other());
    }

    return this.refuse(expr, REFUSED.other());
  }

  /** The element type of a records query chain, when the walk can see it. */
  private chainType(expr: Expr): string | null {
    let node = expr;
    while (node.kind === 'call' && node.callee.kind === 'member' && CHAIN_METHODS.has(node.callee.name)) {
      node = node.callee.object;
    }
    if (node.kind === 'member' && node.object.kind === 'ident') {
      if (node.object.name === 'records') return node.name;
      if (node.object.name === 'model') return this.prefix + node.name;
    }
    return null;
  }
}

function isOpaque(info: Info): boolean {
  return info.row && info.type === 'opaque';
}

function isServiceCall(callee: Expr & { kind: 'member' }): boolean {
  let node: Expr = callee;
  while (node.kind === 'member') node = node.object;
  return node.kind === 'ident' && node.name === 'services';
}

function memberPath(expr: Expr): string {
  if (expr.kind === 'member') {
    const head = memberPath(expr.object);
    return head === 'services' ? expr.name : `${head}.${expr.name}`;
  }
  if (expr.kind === 'ident') return expr.name;
  return '(…)';
}
