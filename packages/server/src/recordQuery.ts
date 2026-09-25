// A record query as one SQL statement (SERVER_DATA_LOADING §5). The evaluator
// hands the store a description — the type, its filters, sort keys, a limit or
// a count — with every part that does not read the row already worked out and
// converted; this turns it into SQL written to §5.3's rules:
//
//   - a field reads by its declared type; a blank (`''`) or a value that does
//     not fit the type reads as null;
//   - text compares and sorts by its lower-cased form; `like` is ILIKE with no
//     escape character; dates and date-times are instants read in UTC;
//   - comparisons are wrapped so SQL's three-valued logic never shows: `=`,
//     `in`, `like` and ordering never match null, `!=` is IS DISTINCT FROM;
//   - nulls sort last whichever the direction, ties by id, and without an
//     orderby the order is by id.
//
// Values, field keys and type ids always go in as parameters, never spliced
// into the SQL text.

import { sql, type SQL } from 'drizzle-orm';
import { INSTANT_TEXT, NUMBER_TEXT, queryPartType as partType, type QueryExpr, type QueryValueType, type RecordQuery } from '@fluxus/dsl';

/** Build the statement: rows as `id, type_ref, custom_fields`, or `n` for a count. */
export function recordQuerySql(query: RecordQuery, operationId: string): SQL {
  const compiler = new Compiler(operationId);
  const where = [sql`r.operation_id = ${operationId}`, sql`r.type_ref = ${query.type}`];
  for (const condition of query.where) where.push(sql`COALESCE(${compiler.part(condition)}, false)`);
  const order = query.orderBy.map(({ key, desc }) => {
    const value = compiler.part(key);
    const sortable = partType(key) === 'text' ? sql`lower(${value})` : value;
    return desc ? sql`${sortable} DESC NULLS LAST` : sql`${sortable} ASC NULLS LAST`;
  });
  const from = sql.join([sql`FROM records r`, ...compiler.joins], sql` `);
  const filter = sql.join(where, sql` AND `);
  if (query.count) return sql`SELECT count(*)::int AS n ${from} WHERE ${filter}`;
  order.push(sql`r.id`);
  const limit = Math.min(query.limit ?? Infinity, query.maxRows + 1);
  return sql`SELECT r.id, r.type_ref, r.custom_fields ${from} WHERE ${filter} ORDER BY ${sql.join(order, sql`, `)} LIMIT ${limit}`;
}

/** Whether running the statement can fail on a row's values — a division or a remainder by zero. */
export function canFailOnRows(query: RecordQuery): boolean {
  const divides = (p: QueryExpr): boolean => {
    switch (p.kind) {
      case 'binary':
        return p.op === '/' || p.op === '%' || divides(p.left) || divides(p.right);
      case 'not':
      case 'neg':
        return divides(p.operand);
      case 'in':
        return divides(p.target) || p.items.some(divides);
      case 'between':
        return divides(p.target) || divides(p.lower) || divides(p.upper);
      case 'like':
        return divides(p.target) || divides(p.pattern);
      case 'isnull':
        return divides(p.target);
      case 'call':
        return p.args.some(divides);
      default:
        return false;
    }
  };
  return query.where.some(divides) || query.orderBy.some((o) => divides(o.key));
}

class Compiler {
  /** One join per referenced record reached, keyed by the path that reaches it. */
  readonly joins: SQL[] = [];
  private aliases = new Map<string, string>();

  constructor(private operationId: string) {}

  part(p: QueryExpr): SQL {
    switch (p.kind) {
      case 'value':
        return value(p.value, p.as);
      case 'field':
        return this.field(p);
      case 'binary':
        return this.binary(p);
      case 'not':
        return sql`(NOT COALESCE(${this.part(p.operand)}, false))`;
      case 'neg':
        return sql`(- ${this.part(p.operand)})`;
      case 'isnull':
        return p.negated ? sql`(${this.part(p.target)} IS NOT NULL)` : sql`(${this.part(p.target)} IS NULL)`;
      case 'like': {
        const matched = sql`COALESCE(${this.part(p.target)} ILIKE ${this.part(p.pattern)} ESCAPE '', false)`;
        return p.negated ? sql`(NOT ${matched})` : matched;
      }
      case 'between': {
        const text = partType(p.target) === 'text';
        const t = this.comparable(p.target, text);
        const inside = sql`COALESCE(${t} BETWEEN ${this.comparable(p.lower, text)} AND ${this.comparable(p.upper, text)}, false)`;
        return p.negated ? sql`(NOT ${inside})` : inside;
      }
      case 'in':
        return this.in(p);
      case 'call':
        return this.call(p);
      case 'dsl':
        // The evaluator refuses these before a host ever sees them (ruling 14).
        throw new Error('This part of a query filter cannot run in the database');
    }
  }

  /** A field, read by its declared type through any references on the way. */
  private field(p: QueryExpr & { kind: 'field' }): SQL {
    let alias = 'r';
    let key = '';
    for (let i = 0; i < p.path.length - 1; i++) {
      key += `\u0000${p.path[i].key}\u0000${p.path[i + 1].type}`;
      let next = this.aliases.get(key);
      if (next === undefined) {
        next = `j${this.aliases.size + 1}`;
        this.aliases.set(key, next);
        const id = read(alias, p.path[i].key, 'text');
        this.joins.push(
          sql`LEFT JOIN records ${sql.raw(next)} ON ${sql.raw(next)}.operation_id = ${this.operationId} AND ${sql.raw(next)}.type_ref = ${p.path[i + 1].type} AND ${sql.raw(next)}.id = ${id}`,
        );
      }
      alias = next;
    }
    return read(alias, p.path[p.path.length - 1].key, p.as);
  }

  private comparable(p: QueryExpr, text: boolean): SQL {
    return text ? sql`lower(${this.part(p)})` : this.part(p);
  }

  private binary(p: QueryExpr & { kind: 'binary' }): SQL {
    const { op } = p;
    if (op === 'and' || op === 'or') {
      const joiner = op === 'and' ? sql` AND ` : sql` OR `;
      return sql`(COALESCE(${this.part(p.left)}, false)${joiner}COALESCE(${this.part(p.right)}, false))`;
    }
    if (op === '=' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
      const text = (partType(p.left) ?? partType(p.right)) === 'text';
      const l = this.comparable(p.left, text);
      const r = this.comparable(p.right, text);
      if (op === '!=') return sql`(${l} IS DISTINCT FROM ${r})`;
      return sql`COALESCE(${l} ${sql.raw(op)} ${r}, false)`;
    }
    if (p.as === 'text') return sql`(${this.asText(p.left)} || ${this.asText(p.right)})`;
    const l = this.part(p.left);
    const r = this.part(p.right);
    if (op === '%') return sql`mod((${l})::numeric, (${r})::numeric)::float8`;
    return sql`(${l} ${sql.raw(op)} ${r})`;
  }

  private asText(p: QueryExpr): SQL {
    return partType(p) === 'text' ? this.part(p) : sql`(${this.part(p)})::text`;
  }

  private in(p: QueryExpr & { kind: 'in' }): SQL {
    const text = partType(p.target) === 'text';
    const target = this.comparable(p.target, text);
    const tests: SQL[] = [];
    if (p.values.length > 0) {
      const as = partType(p.target) ?? 'text';
      const list = JSON.stringify(p.values.map((v) => (v instanceof Date ? v.toISOString() : v)));
      const element = text ? sql`lower(v)` : sql`(v)::${sql.raw(sqlType(as))}`;
      tests.push(sql`${target} IN (SELECT ${element} FROM jsonb_array_elements_text(${list}::jsonb) AS v)`);
    }
    for (const item of p.items) tests.push(sql`${target} = ${this.comparable(item, text)}`);
    const found = tests.length === 0 ? sql`false` : sql`COALESCE(${sql.join(tests, sql` OR `)}, false)`;
    return p.negated ? sql`(NOT ${found})` : found;
  }

  private call(p: QueryExpr & { kind: 'call' }): SQL {
    const args = p.args.map((a) => this.part(a));
    switch (p.fn) {
      case 'len':
        return sql`length(${args[0]})::float8`;
      case 'lower':
        return sql`lower(${args[0]})`;
      case 'upper':
        return sql`upper(${args[0]})`;
      case 'trim':
        return sql`btrim(${args[0]})`;
      case 'abs':
        return sql`abs(${args[0]})`;
      case 'round':
        return args.length === 2
          ? sql`round((${args[0]})::numeric, (${args[1]})::int)::float8`
          : sql`round((${args[0]})::numeric)::float8`;
      case 'exact':
        return sql`COALESCE(${args[0]} = ${args[1]}, false)`;
      case 'date':
        return instant(args[0]);
      case 'iif':
        return sql`(CASE WHEN COALESCE(${args[0]}, false) THEN ${args[1]} ELSE ${args[2]} END)`;
      case 'adddays':
      case 'addmonths':
      case 'addyears': {
        const unit = p.fn === 'adddays' ? 'days' : p.fn === 'addmonths' ? 'months' : 'years';
        // Calendar arithmetic in UTC, whatever the session's time zone (ruling 18).
        return sql`(((${args[0]}) AT TIME ZONE 'UTC') + make_interval(${sql.raw(unit)} => trunc(${args[1]})::int)) AT TIME ZONE 'UTC'`;
      }
    }
  }
}

/** A worked-out value as a parameter of its type. */
function value(v: unknown, as: QueryValueType | null): SQL {
  if (v === null || v === undefined) return sql`NULL`;
  if (v instanceof Date) return sql`${v.toISOString()}::timestamptz`;
  if (typeof v === 'boolean') return sql`${v}::boolean`;
  if (typeof v === 'number') return sql`${v}::float8`;
  if (typeof v === 'string') return as === 'instant' ? sql`${v}::timestamptz` : sql`${v}::text`;
  throw new Error(`A query cannot compare ${Array.isArray(v) ? 'a list' : 'an object'} with a field`);
}

function sqlType(as: QueryValueType): string {
  switch (as) {
    case 'number':
      return 'float8';
    case 'instant':
      return 'timestamptz';
    case 'bool':
      return 'boolean';
    default:
      return 'text';
  }
}

/**
 * A stored field as a query reads it (§5.3). `id` is the row's own id. A key
 * goes in as a parameter.
 */
function read(alias: string, key: string, as: QueryValueType): SQL {
  const a = sql.raw(alias);
  if (key === 'id') return sql`${a}.id`;
  const json = sql`(${a}.custom_fields -> ${key}::text)`;
  const text = sql`(${a}.custom_fields ->> ${key}::text)`;
  switch (as) {
    case 'text':
      return sql`(CASE WHEN jsonb_typeof(${json}) IN ('string', 'number', 'boolean') THEN NULLIF(${text}, '') END)`;
    case 'number':
      return sql`(CASE jsonb_typeof(${json}) WHEN 'number' THEN (${text})::float8 WHEN 'string' THEN (CASE WHEN ${text} ~ ${NUMBER_TEXT} THEN (${text})::float8 END) END)`;
    case 'instant':
      return sql`(CASE WHEN jsonb_typeof(${json}) = 'string' THEN ${instant(text)} END)`;
    case 'bool':
      return sql`(CASE WHEN jsonb_typeof(${json}) IN ('boolean', 'string') THEN (CASE lower(${text}) WHEN 'true' THEN true WHEN 'false' THEN false END) END)`;
    case 'opaque':
    case 'list':
      // Only ever `is null`: blank is missing, null, '' or an empty list.
      return sql`(CASE WHEN ${json} IS NULL OR ${json} IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb) THEN NULL ELSE ${json} END)`;
  }
}

/**
 * Text as an instant, or null when it is not a date or a date-time (§5.3): the
 * shape first, then the calendar (2026-02-30 is no date). Without an offset it
 * is UTC.
 */
function instant(text: SQL): SQL {
  const zoned = sql`(CASE WHEN ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN ${text} || 'T00:00:00Z' WHEN ${text} ~ '(Z|z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN ${text} ELSE ${text} || 'Z' END)`;
  return sql`(CASE WHEN ${text} ~ ${INSTANT_TEXT} AND pg_input_is_valid(${zoned}, 'timestamptz') THEN (${zoned})::timestamptz END)`;
}
