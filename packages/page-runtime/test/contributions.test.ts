// The arithmetic behind the Contributions grid, tested without a DOM — the
// same split `columnFormat`, `selection` and `tree` already follow.
//
// The two things worth pinning: dates are compared as TEXT (a Date object
// anywhere on this path re-introduces the UTC conversion that draws an
// Australian shift one column to the left), and a cell whose date is not a
// plain `yyyy-mm-dd` is counted rather than drawn.

import { describe, expect, it } from 'vitest';
import { dateColumns, indexCells, isPlainDate } from '../src/components/Contributions';

describe('isPlainDate', () => {
  it('accepts yyyy-mm-dd and nothing else', () => {
    expect(isPlainDate('2026-09-14')).toBe(true);
    // The defect the spec exists to avoid: a datetime off the wire.
    expect(isPlainDate('2026-09-14T00:00:00Z')).toBe(false);
    expect(isPlainDate('2026-9-14')).toBe(false);
    expect(isPlainDate('14/09/2026')).toBe(false);
    expect(isPlainDate('')).toBe(false);
    expect(isPlainDate(undefined)).toBe(false);
    expect(isPlainDate(new Date('2026-09-14'))).toBe(false);
  });
});

describe('dateColumns', () => {
  it('is inclusive of both ends, one column per date', () => {
    expect(dateColumns('2026-09-14', '2026-09-19')).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19',
    ]);
  });

  it('a single day is one column', () => {
    expect(dateColumns('2026-09-14', '2026-09-14')).toEqual(['2026-09-14']);
  });

  it('crosses a month boundary', () => {
    expect(dateColumns('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02',
    ]);
  });

  it('crosses a year boundary', () => {
    expect(dateColumns('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ]);
  });

  it('has the leap day in a leap year and not otherwise', () => {
    expect(dateColumns('2028-02-28', '2028-03-01')).toContain('2028-02-29');
    expect(dateColumns('2027-02-28', '2027-03-01')).not.toContain('2027-02-29');
    // 2100 is divisible by 4 and is not a leap year.
    expect(dateColumns('2100-02-28', '2100-03-01')).not.toContain('2100-02-29');
  });

  it('draws nothing rather than looping when the range runs backwards', () => {
    expect(dateColumns('2026-09-19', '2026-09-14')).toEqual([]);
  });

  it('draws nothing when either end is not a plain date', () => {
    expect(dateColumns('2026-09-14T00:00:00Z', '2026-09-19')).toEqual([]);
    expect(dateColumns('2026-09-14', '')).toEqual([]);
  });

  it('stops at the cap rather than running away', () => {
    expect(dateColumns('2026-01-01', '2030-01-01')).toHaveLength(400);
    expect(dateColumns('2026-01-01', '2026-01-05', 3)).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-03',
    ]);
  });
});

describe('indexCells', () => {
  it('keys a cell by its row and date', () => {
    const { at, doubled, badDates } = indexCells([
      { key: 'WG-WELD', date: '2026-09-14', state: 'approved' },
      { key: 'WG-COAT', date: '2026-09-14', state: 'submitted' },
    ]);
    expect(at.size).toBe(2);
    expect(doubled.size).toBe(0);
    expect(badDates).toBe(0);
  });

  it('counts a cell whose date is not plain, and does not index it', () => {
    const { at, badDates } = indexCells([
      { key: 'WG-WELD', date: '2026-09-14T00:00:00Z', state: 'approved' },
      { key: 'WG-COAT', date: '2026-09-14', state: 'approved' },
      { key: 'WG-TIE', state: 'approved' },
    ]);
    expect(at.size).toBe(1);
    expect(badDates).toBe(2);
  });

  it('the last of two for one row and date wins, and says so', () => {
    const { at, doubled } = indexCells([
      { key: 'WG-WELD', date: '2026-09-14', state: 'submitted' },
      { key: 'WG-WELD', date: '2026-09-14', state: 'approved' },
    ]);
    expect(at.size).toBe(1);
    expect([...at.values()][0].state).toBe('approved');
    expect(doubled.size).toBe(1);
  });

  it('keys that would collide under a naive join do not', () => {
    // 'a b' + '2026-09-14' must not land in the same slot as 'a' + 'b 2026-09-14',
    // which is why the separator is a character neither half can contain.
    const { at, doubled } = indexCells([
      { key: 'a b', date: '2026-09-14', state: 'one' },
      { key: 'a', date: '2026-09-14', state: 'two' },
    ]);
    expect(at.size).toBe(2);
    expect(doubled.size).toBe(0);
  });

  it('a missing key is its own row rather than a crash', () => {
    const { at, badDates } = indexCells([{ date: '2026-09-14', state: 'approved' }]);
    expect(at.size).toBe(1);
    expect(badDates).toBe(0);
  });
});
