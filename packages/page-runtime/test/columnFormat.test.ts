// The columns work (RECORD_LIST_DESIGN §7 step 1). The rule under test
// throughout: a column works with nothing but a key, so every default has to
// read sensibly on its own.

import { describe, expect, it } from 'vitest';
import { BLANK_CELL, columnType, columnWidth, drawCell, isRightAligned, resolveCurrency } from '../src/components/columnFormat';

const draw = (value: unknown, type?: string, format?: string, currency?: string) =>
  drawCell(value, type, format, currency);

describe('a column with nothing but a key', () => {
  it('draws any value as text', () => {
    expect(draw('Bridge deck')).toBe('Bridge deck');
    expect(draw(42)).toBe('42');
    expect(draw(true)).toBe('true');
  });

  it('draws a missing value as a dash, whatever the type', () => {
    for (const type of [undefined, 'int', 'decimal', 'datetime', 'time', 'boolean', 'photo']) {
      expect(draw(null, type)).toBe('—');
      expect(draw(undefined, type)).toBe('—');
      expect(draw('', type)).toBe('—');
    }
  });

  it('does not mistake false or zero for missing', () => {
    expect(draw(false, 'boolean')).toBe('No');
    expect(draw(0, 'int')).toBe('0');
  });

  it('leaves an unknown type as text rather than failing', () => {
    expect(columnType('Number')).toBe('text');
    expect(draw('anything', 'Number')).toBe('anything');
  });
});

describe('alignment comes from the type', () => {
  it('sends numbers right and everything else left', () => {
    expect(isRightAligned('int')).toBe(true);
    expect(isRightAligned('decimal')).toBe(true);
    expect(isRightAligned('text')).toBe(false);
    expect(isRightAligned('datetime')).toBe(false);
    expect(isRightAligned(undefined)).toBe(false);
  });
});

describe('width is a hint', () => {
  it('is auto when blank, zero or unreadable', () => {
    // The array editor writes '' for an untouched field and 0 for a cleared one.
    expect(columnWidth('')).toBeUndefined();
    expect(columnWidth(0)).toBeUndefined();
    expect(columnWidth(undefined)).toBeUndefined();
    expect(columnWidth('wide')).toBeUndefined();
    expect(columnWidth(-10)).toBeUndefined();
  });

  it('is pixels when given', () => {
    expect(columnWidth(120)).toBe(120);
    expect(columnWidth('120')).toBe(120);
  });
});

describe('numbers', () => {
  it('defaults an int to no decimals and a decimal to at most two', () => {
    expect(draw(1234, 'int')).toBe('1,234');
    expect(draw(1234.5, 'int')).toBe('1,235');
    expect(draw(1234.5, 'decimal')).toBe('1,234.5');
    expect(draw(1234, 'decimal')).toBe('1,234');
  });

  it('reads the standard numeric format strings', () => {
    expect(draw(1234.567, 'decimal', 'N2')).toBe('1,234.57');
    expect(draw(1234.567, 'decimal', 'N0')).toBe('1,235');
    expect(draw(1234.567, 'decimal', 'F2')).toBe('1234.57');
    expect(draw(0.256, 'decimal', 'P1')).toBe('25.6%');
    expect(draw(1234.5, 'decimal', 'n2')).toBe('1,234.50');
  });

  it('falls back to the type default when the format is not one of them', () => {
    expect(draw(1234.5, 'decimal', 'wibble')).toBe('1,234.5');
  });

  it('shows a value that is not a number rather than NaN', () => {
    expect(draw('n/a', 'int')).toBe('n/a');
  });
});

describe('currency', () => {
  it('takes a fixed code off the column', () => {
    expect(resolveCurrency('aud', {})).toBe('AUD');
    // The symbol is the reader's locale's business, not the column's — an
    // Australian dollar is 'A$' to an American and '$' to an Australian.
    expect(draw(1234.5, 'decimal', 'C2', 'AUD')).toMatch(/^A?\$1,234\.50$/);
    expect(draw(1234.5, 'decimal', 'C0', 'JPY')).toMatch(/1,23[45]$/);
  });

  it('takes a code from the row when the column names a field', () => {
    expect(resolveCurrency('row.ccy', { ccy: 'eur' })).toBe('EUR');
    expect(resolveCurrency('row.ccy', { ccy: '' })).toBeUndefined();
    expect(resolveCurrency('row.ccy', {})).toBeUndefined();
  });

  it('draws a plain number rather than a wrong symbol when no code resolves', () => {
    expect(draw(1234.5, 'decimal', 'C2', undefined)).toBe('1,234.50');
  });
});

describe('dates and times', () => {
  const at = new Date(2026, 8, 7, 14, 5, 9).toISOString(); // 7 Sep 2026, 14:05:09 local

  it('reads ICU tokens', () => {
    expect(draw(at, 'datetime', 'dd/MM/yyyy')).toBe('07/09/2026');
    expect(draw(at, 'datetime', 'd MMM yyyy')).toBe('7 Sep 2026');
    expect(draw(at, 'datetime', 'yyyy-MM-dd HH:mm')).toBe('2026-09-07 14:05');
    expect(draw(at, 'datetime', 'h:mm a')).toBe('2:05 pm');
  });

  it('takes lowercase mm as the month when the pattern has no hour', () => {
    // Because dd/mm/yyyy is how the design doc — and everyone else — writes it.
    expect(draw(at, 'datetime', 'dd/mm/yyyy')).toBe('07/09/2026');
    expect(draw(at, 'datetime', 'dd/MM/yyyy HH:mm')).toBe('07/09/2026 14:05');
  });

  it('shows an unparseable value rather than Invalid Date', () => {
    expect(draw('sometime', 'datetime')).toBe('sometime');
  });

  it('draws a clock reading for a time', () => {
    expect(draw('14:05:09', 'time')).toBe('14:05');
    expect(draw('9:30', 'time')).toBe('09:30');
    expect(draw('14:05:09', 'time', 'h:mm a')).toBe('2:05 pm');
    expect(draw('not a time', 'time')).toBe('not a time');
  });
});

describe('booleans', () => {
  it('says Yes and No by default', () => {
    expect(draw(true, 'boolean')).toBe('Yes');
    expect(draw(false, 'boolean')).toBe('No');
    expect(draw('true', 'boolean')).toBe('Yes');
    expect(draw(1, 'boolean')).toBe('Yes');
    expect(draw('anything else', 'boolean')).toBe('No');
  });

  it('says whatever the format says', () => {
    expect(draw(true, 'boolean', 'Active/Inactive')).toBe('Active');
    expect(draw(false, 'boolean', 'Active/Inactive')).toBe('Inactive');
  });
});

describe('photos and files', () => {
  const one = { storage_key: 'k1', name: 'site-plan.pdf', mime: 'application/pdf', size: 10 };
  const two = { storage_key: 'k2', name: 'deck.jpg', mime: 'image/jpeg', size: 20 };

  it('names the file, and counts the rest of a multi value', () => {
    expect(draw(one, 'file')).toBe('site-plan.pdf');
    expect(draw([two, one], 'photo')).toBe('deck.jpg +1');
    expect(draw([], 'photo')).toBe('—');
  });
});

describe('geopoint', () => {
  it('draws the degrees, and a blank point as the blank cell', () => {
    expect(drawCell({ lat: -37.9003, lng: 144.662 }, 'geopoint', undefined, undefined)).toBe('-37.9003, 144.6620');
    expect(drawCell({ lat: 'south' }, 'geopoint', undefined, undefined)).toBe(BLANK_CELL);
    expect(drawCell(null, 'geopoint', undefined, undefined)).toBe(BLANK_CELL);
  });
});
