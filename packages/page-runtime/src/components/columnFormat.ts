// How one cell is drawn: the column's type, and the format that goes with it
// (RECORD_LIST_DESIGN §2). Kept apart from the table itself because it is pure
// — value in, string out — so it can be tested without a DOM, and so display
// conditions (§3, a later step) can override the format without touching the
// table.
//
// The types are the **model's own attribute types** (@fluxus/engine's
// ATTRIBUTE_TYPES), not a second vocabulary: an implementer who wrote
// `decimal` in the SDM writes `decimal` here. `boolean` is the one addition —
// the language has booleans even though no attribute is one, and a GET's
// `returns` expression can hand the table a comparison's answer.
//
// A column works with nothing but a `key` (§7 step 1): every rule below has a
// default, and an unknown type or an unreadable format falls back to plain
// text rather than breaking the row.

/** Column types this step draws. Anything else falls back to text. */
export type ColumnType = 'text' | 'int' | 'decimal' | 'datetime' | 'time' | 'boolean' | 'photo' | 'file';

const KNOWN: readonly string[] = ['text', 'int', 'decimal', 'datetime', 'time', 'boolean', 'photo', 'file'];

/** The declared type, or 'text' for blank/unknown — never an error. */
export const columnType = (type: string | undefined): ColumnType =>
  type && KNOWN.includes(type) ? (type as ColumnType) : 'text';

/** Alignment is derived, never declared (§1.6): numbers right, everything else left. */
export const isRightAligned = (type: string | undefined): boolean => {
  const t = columnType(type);
  return t === 'int' || t === 'decimal';
};

/** Width is a hint in pixels; blank, zero or unreadable means auto (§1.5). */
export const columnWidth = (width: unknown): number | undefined => {
  const n = Number(width);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Nothing to draw. `false` and `0` are values, not blanks. */
const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

export const BLANK_CELL = '—';

// ── numbers ─────────────────────────────────────────────────────────────────

// Standard numeric format strings, as .NET writes them and as spreadsheets
// echo: a letter and an optional digit count. N groups thousands, F does not,
// C is money, P is a percentage. Anything else falls back to the type default.
const NUMBER_FORMAT = /^([NFCP])(\d*)$/i;

/**
 * The currency code for this cell (§2.4). Either fixed on the column — `AUD`,
 * every row the same — or `row.<field>`, naming a field of the row so each row
 * carries its own. The `row.` prefix is the same one display conditions use
 * (§3), so it is a convention already in the table's vocabulary rather than a
 * new one. It is a field lookup, not an expression.
 */
export function resolveCurrency(currency: string | undefined, row: Record<string, unknown>): string | undefined {
  if (!currency) return undefined;
  const code = currency.startsWith('row.') ? row[currency.slice(4)] : currency;
  return typeof code === 'string' && code.trim() !== '' ? code.trim().toUpperCase() : undefined;
}

function drawNumber(value: unknown, type: ColumnType, format: string | undefined, currency: string | undefined): string {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(value);

  const match = format ? NUMBER_FORMAT.exec(format.trim()) : null;
  if (!match) {
    // No format: an int shows no decimals, a decimal shows up to two — the
    // behaviour the `numeric` flag had before it became a type.
    const digits = type === 'int' ? 0 : 2;
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });
  }

  const letter = match[1].toUpperCase();
  const digits = match[2] === '' ? 2 : Number(match[2]);
  const fraction = { minimumFractionDigits: digits, maximumFractionDigits: digits };

  if (letter === 'C') {
    // No code to spend: a plain number beats a wrong symbol.
    return currency
      ? n.toLocaleString(undefined, { style: 'currency', currency, ...fraction })
      : n.toLocaleString(undefined, fraction);
  }
  if (letter === 'P') return (n * 100).toLocaleString(undefined, fraction) + '%';
  return n.toLocaleString(undefined, { ...fraction, useGrouping: letter === 'N' });
}

// ── dates and times ─────────────────────────────────────────────────────────

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

// Unicode/ICU date tokens — what every date library already speaks, so nobody
// learns ours (§2.3). One mercy on top: in a pattern with no hour token,
// lowercase `mm`/`m` mean the month, because `dd/mm/yyyy` is how people write
// a date. With an hour present they mean minutes, as ICU says.
const DATE_TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|a/g;

function drawDatePattern(d: Date, pattern: string): string {
  const monthly = !/[Hh]/.test(pattern);
  const h12 = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return pattern.replace(DATE_TOKEN, (token) => {
    switch (token) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return pad(d.getFullYear() % 100);
      case 'MMMM': return MONTHS_LONG[d.getMonth()];
      case 'MMM': return MONTHS_LONG[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'dd': return pad(d.getDate());
      case 'd': return String(d.getDate());
      case 'HH': return pad(d.getHours());
      case 'H': return String(d.getHours());
      case 'hh': return pad(h12);
      case 'h': return String(h12);
      case 'mm': return monthly ? pad(d.getMonth() + 1) : pad(d.getMinutes());
      case 'm': return monthly ? String(d.getMonth() + 1) : String(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      case 's': return String(d.getSeconds());
      case 'a': return d.getHours() < 12 ? 'am' : 'pm';
      default: return token;
    }
  });
}

function drawDateTime(value: unknown, format: string | undefined): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  if (format && format.trim() !== '') return drawDatePattern(d, format.trim());
  // No format: the reader's own short date and time, which is what a table of
  // timestamps wants and what the browser already knows how to write.
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

// A time attribute is 'HH:MM' or 'HH:MM:SS' — a clock reading, not an instant.
// It is placed on an arbitrary day so one pattern formatter serves both types.
function drawTime(value: unknown, format: string | undefined): string {
  const parts = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value));
  if (!parts) return String(value);
  const [h, m, s] = [Number(parts[1]), Number(parts[2]), Number(parts[3] ?? 0)];
  if (!format || format.trim() === '') return `${pad(h)}:${pad(m)}`;
  return drawDatePattern(new Date(1970, 0, 1, h, m, s), format.trim());
}

// ── booleans, files ─────────────────────────────────────────────────────────

const isTrue = (v: unknown): boolean => v === true || v === 1 || /^(true|yes|y|1)$/i.test(String(v));

// The format is the two words themselves — `Active/Inactive` — since there is
// no established string for "how to spell a boolean" and inventing codes for
// it would be a vocabulary nobody asked for.
function drawBoolean(value: unknown, format: string | undefined): string {
  const [yes = 'Yes', no = 'No'] = format && format.includes('/') ? format.split('/') : [];
  return isTrue(value) ? yes : no;
}

/** One descriptor bag, or the list a multi attribute holds. */
const descriptors = (value: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
};

// NOT the thumbnail §2.1 asks for: drawing the image needs a presigned URL, and
// a component has no door to the upload service — every host service reaches a
// component as a declared prop. The names are honest and the column shape is
// the final one, so the cell upgrades to a thumbnail the day that seam exists
// without a page changing a line.
function drawDescriptor(value: unknown): string {
  const list = descriptors(value);
  if (list.length === 0) return BLANK_CELL;
  const name = typeof list[0].name === 'string' ? list[0].name : String(list[0].storage_key ?? '');
  return list.length > 1 ? `${name} +${list.length - 1}` : name;
}

// ── the cell ────────────────────────────────────────────────────────────────

/** Draw one value the way its column says to. Never throws; never empty. */
export function drawCell(
  value: unknown,
  type: string | undefined,
  format: string | undefined,
  currency: string | undefined,
): string {
  const t = columnType(type);
  // A missing value is missing, whatever the type — a blank boolean drawn as
  // "No" would be the table making something up.
  if (isBlank(value)) return BLANK_CELL;
  switch (t) {
    case 'int':
    case 'decimal': return drawNumber(value, t, format, currency);
    case 'datetime': return drawDateTime(value, format);
    case 'time': return drawTime(value, format);
    case 'boolean': return drawBoolean(value, format);
    case 'photo':
    case 'file': return drawDescriptor(value);
    default: return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}
