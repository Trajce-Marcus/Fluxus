import { describe, expect, it } from 'vitest';
import { buildMathModule } from '../src/services/math';

const distribute = (weights: unknown, total: unknown, precision: unknown) =>
  buildMathModule().functions.distribute.fn(weights, total, precision) as number[];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('services.math.distribute', () => {
  it('whole units that still add up (SHIFT_REPORTS §10a)', () => {
    expect(distribute([3.5, 4.0, 2.5], 81, 0)).toEqual([28, 33, 20]);
  });

  it('a repeating fraction, largest remainder wins the leftover cent', () => {
    expect(distribute([1, 1, 1], 100, 2)).toEqual([33.34, 33.33, 33.33]);
  });

  it('the worked cost-split example: 6h/4h of $11,900', () => {
    expect(distribute([6, 4], 11_900, 2)).toEqual([7140, 4760]);
  });

  it('a negative total distributes to negative parts that still sum to it', () => {
    const shares = distribute([1, 1, 1], -100, 2);
    expect(Math.abs(sum(shares) - -100) < 1e-9).toBe(true);
    expect(shares.every((s) => s <= 0)).toBe(true);
  });

  it('weights summing to zero answer zeros rather than dividing by zero', () => {
    expect(distribute([0, 0, 0], 500, 2)).toEqual([0, 0, 0]);
  });

  it('an empty list answers an empty list', () => {
    expect(distribute([], 500, 2)).toEqual([]);
  });

  it('parts always sum to exactly the whole, at precision, across uneven weights', () => {
    const shares = distribute([0.1, 8.2, 1.7], 5837.42, 2);
    const total = Math.round(sum(shares) * 100) / 100;
    expect(total).toBe(5837.42);
  });

  it('precision 0 is an ordinary case: whole units that still add up', () => {
    const shares = distribute([1, 1, 1, 1, 1, 1, 1], 100, 0);
    expect(sum(shares)).toBe(100);
    expect(shares.every((s) => Number.isInteger(s))).toBe(true);
  });

  it('declares itself readable from any tier', () => {
    const module = buildMathModule();
    expect(module.name).toBe('math');
    expect(module.functions.distribute.kind).toBe('read');
    expect(module.functions.distribute.params).toEqual(['weights', 'total', 'precision']);
  });
});
