import { describe, expect, it } from 'vitest';
import { buildTimeModule } from '../src/services/time';

const hoursBetween = (start: unknown, end: unknown) =>
  buildTimeModule().functions.hoursBetween.fn(start, end);

describe('services.time.hoursBetween', () => {
  it('measures an ordinary day shift', () => {
    expect(hoursBetween('07:00', '17:00')).toBe(10);
    expect(hoursBetween('06:30', '15:00')).toBe(8.5);
  });

  // The reason the function exists in this shape: a night shift ends before it
  // starts, which is the normal case on a pipeline, not an error.
  it('crosses midnight', () => {
    expect(hoursBetween('18:00', '06:00')).toBe(12);
    expect(hoursBetween('22:15', '06:45')).toBe(8.5);
  });

  it('reads equal times as a full day, since the shift did run', () => {
    expect(hoursBetween('06:00', '06:00')).toBe(24);
  });

  // A half-filled draft is ordinary. A hook that threw on one could not be run
  // at all, so blank answers zero and the hours check catches it downstream.
  it('answers zero for anything that is not a time', () => {
    expect(hoursBetween('', '17:00')).toBe(0);
    expect(hoursBetween('07:00', '')).toBe(0);
    expect(hoursBetween(null, undefined)).toBe(0);
    expect(hoursBetween('half past seven', '17:00')).toBe(0);
    expect(hoursBetween('25:00', '17:00')).toBe(0);
    expect(hoursBetween('07:60', '17:00')).toBe(0);
    expect(hoursBetween(7, 17)).toBe(0);
  });

  it('accepts seconds and a single-digit hour, and ignores surrounding space', () => {
    expect(hoursBetween('7:00', '17:00')).toBe(10);
    expect(hoursBetween('07:00:00', '17:00:00')).toBe(10);
    expect(hoursBetween(' 07:00 ', ' 17:00 ')).toBe(10);
  });

  // Every caller multiplies this by a rate, so a repeating fraction would carry
  // float residue into money. Ten minutes is 0.17, not 0.16666…
  it('rounds to two decimals rather than repeating', () => {
    expect(hoursBetween('07:00', '07:10')).toBe(0.17);
    expect(hoursBetween('07:00', '07:20')).toBe(0.33);
    expect(hoursBetween('07:00', '07:01')).toBe(0.02);
  });

  it('declares itself readable from any tier', () => {
    const module = buildTimeModule();
    expect(module.name).toBe('time');
    expect(module.functions.hoursBetween.kind).toBe('read');
    expect(module.functions.hoursBetween.params).toEqual(['start', 'end']);
  });
});
