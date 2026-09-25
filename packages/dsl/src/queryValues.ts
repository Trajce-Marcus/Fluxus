// What a record query means for values (SERVER_DATA_LOADING §5.3), in memory.
// The server's SQL is written to the same rules; the patterns below are shared
// with it so a stored value that reads as a number or a date in one reads the
// same in the other.

import { FkPointer, type QueryExpr } from './host';
import type { QueryValueType } from './queryFilter';

/**
 * Text a query reads as a number. The same pattern guards the SQL cast, so a
 * value that would not convert reads as null rather than failing the query.
 */
export const NUMBER_TEXT = '^\\s*[-+]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][-+]?[0-9]+)?\\s*$';

/**
 * Text a query reads as a date or a date-time: `YYYY-MM-DD`, optionally with a
 * time, optionally with an offset. No offset means UTC (ruling 18).
 */
export const INSTANT_TEXT =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?(Z|z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$';

const NUMBER_RE = new RegExp(NUMBER_TEXT);
const INSTANT_RE = new RegExp(INSTANT_TEXT);

/** A date or date-time text as an instant, or null when it is not one (§5.3). */
export function parseInstant(text: string): Date | null {
  if (!INSTANT_RE.test(text)) return null;
  const [datePart, rest] = [text.slice(0, 10), text.slice(11)];
  const [y, m, d] = datePart.split('-').map(Number);
  // A calendar check: Postgres refuses 2026-02-30, where Date would roll over.
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return null;
  if (text.length === 10) return day;
  const offset = /(Z|z|[+-]\d{2}(:?\d{2})?)$/.exec(rest);
  let time = offset ? rest.slice(0, rest.length - offset[0].length) : rest;
  const [hh, mm] = time.split(':').map(Number);
  // 24:00 is the next midnight, as Postgres reads it; any other 24:xx is no time.
  if (hh > 24 || mm > 59 || (hh === 24 && !/^24:00(:00(\.0+)?)?$/.test(time))) return null;
  if (time.length === 5) time += ':00';
  let zone = 'Z';
  if (offset && offset[1].toUpperCase() !== 'Z') {
    const raw = offset[1].replace(':', '');
    zone = `${raw.slice(0, 3)}:${raw.length > 3 ? raw.slice(3) : '00'}`;
  }
  const parsed = new Date(`${datePart}T${time}${zone}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Whether a stored value is blank for `is null` on a photo, file, geopoint,
 * composite or list field: missing, null, `''`, or an empty list.
 */
function blankBag(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * A stored field value as a query reads it, by the field's declared type: a
 * blank (null, or `''` stored before blanks were null) or a value that does not
 * fit the type reads as null (ruling 12).
 */
export function readStored(value: unknown, as: QueryValueType): unknown {
  switch (as) {
    case 'text':
      if (typeof value === 'string') return value === '' ? null : value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return null;
    case 'number':
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string' && NUMBER_RE.test(value)) return Number(value);
      return null;
    case 'instant':
      if (typeof value === 'string') return parseInstant(value);
      return null;
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        return lower === 'true' ? true : lower === 'false' ? false : null;
      }
      return null;
    case 'opaque':
    case 'list':
      return blankBag(value) ? null : value;
  }
}

/** The type of a value worked out before a query, as it would compare. Null for null and for what no rule covers. */
export function valueTypeOf(value: unknown): QueryValueType | null {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  if (value instanceof Date) return 'instant';
  if (value instanceof FkPointer) return 'text';
  if (isDslRecordLike(value)) return 'text';
  return null;
}

function isDslRecordLike(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && 'id' in value && 'type' in value && 'fields' in value;
}

/**
 * A value compared with a field, converted to the field's type (ruling 12):
 * text against a date field becomes a date. Null stays null. Answers a message
 * when the value does not convert — an error in the query.
 */
export function convertValue(value: unknown, as: QueryValueType): { value: unknown } | { error: string } {
  if (value === null || value === undefined) return { value: null };
  if (value instanceof FkPointer) value = value.id;
  else if (isDslRecordLike(value)) value = value.id;
  switch (as) {
    case 'text':
      if (typeof value === 'string') return { value };
      if (typeof value === 'number' || typeof value === 'boolean') return { value: String(value) };
      if (value instanceof Date) return { value: value.toISOString() };
      break;
    case 'number':
      if (typeof value === 'number') return { value };
      if (typeof value === 'string' && NUMBER_RE.test(value)) return { value: Number(value) };
      if (typeof value === 'string') return { error: `'${value}' is not a number` };
      break;
    case 'instant': {
      if (value instanceof Date) return { value };
      if (typeof value === 'string') {
        const parsed = parseInstant(value);
        return parsed ? { value: parsed } : { error: `Invalid date: '${value}'` };
      }
      break;
    }
    case 'bool':
      if (typeof value === 'boolean') return { value };
      if (typeof value === 'string' && (value.toLowerCase() === 'true' || value.toLowerCase() === 'false')) {
        return { value: value.toLowerCase() === 'true' };
      }
      break;
    default:
      break;
  }
  return { error: `Cannot compare ${describeValue(value)} with ${article(as)} field` };
}

export function article(as: QueryValueType): string {
  switch (as) {
    case 'text': return 'a text';
    case 'number': return 'a number';
    case 'instant': return 'a date';
    case 'bool': return 'a true/false';
    case 'opaque': return 'a photo, file, geopoint or composite';
    case 'list': return 'a list';
  }
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  if (value instanceof Date) return 'a date';
  if (typeof value === 'string') return `text ('${value.length > 20 ? value.slice(0, 20) + '…' : value}')`;
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/** Equality of two non-null values of one query type. */
export function queryEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Ordering of two non-null values of one query type, or null when they are
 * not of one type. Text by its lower-cased form; false before true.
 */
export function queryCompare(a: unknown, b: unknown): number | null {
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
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return null;
}

/** `like` in a query: `%` any run (line breaks included), `_` one character, no escape character; case-insensitive. */
export function queryLike(pattern: string): RegExp {
  let out = '^';
  for (const ch of pattern) {
    if (ch === '%') out += '[\\s\\S]*';
    else if (ch === '_') out += '[\\s\\S]';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$', 'iu');
}

/** A date method on an instant, in UTC (ruling 18). */
export function addToInstant(date: Date, method: 'adddays' | 'addmonths' | 'addyears', n: number): Date {
  const out = new Date(date.getTime());
  const whole = Math.trunc(n);
  if (method === 'adddays') out.setUTCDate(out.getUTCDate() + whole);
  else if (method === 'addmonths') out.setUTCMonth(out.getUTCMonth() + whole);
  else out.setUTCFullYear(out.getUTCFullYear() + whole);
  return out;
}

/** The type a query part reads as, or null where nothing says. */
export function queryPartType(part: QueryExpr): QueryValueType | null {
  switch (part.kind) {
    case 'value':
    case 'field':
    case 'binary':
    case 'call':
      return part.as;
    case 'not':
    case 'in':
    case 'between':
    case 'like':
    case 'isnull':
      return 'bool';
    case 'neg':
      return 'number';
    case 'dsl':
      return null;
  }
}
