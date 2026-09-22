// What `scripts.query` puts on the wire (DSL_EDITOR_SPEC §10).
//
// The case that matters: a date field read by a script becomes a Date parsed at
// LOCAL midnight (bridge.ts coercion, evaluator's date()), and JSON.stringify
// would send it as a UTC instant — so on any server ahead of UTC the tool would
// report the day before the one the record holds. What persists in a record is
// the wall-clock string, so that is what goes back.

import { describe, it, expect } from 'vitest';
import { FkPointer } from '@fluxus/dsl';
import { forWire } from '../src/router';

describe('forWire', () => {
  it('sends a local-midnight date as its own day, not the UTC instant', () => {
    const d = new Date('2026-07-01T00:00:00'); // local, as date() builds it
    expect(forWire(d)).toBe('2026-07-01');
    // The bug this guards: JSON would have shifted it.
    if (d.getTimezoneOffset() < 0) {
      expect(JSON.stringify(d)).toContain('2026-06-30');
    }
  });

  it('keeps the time when there is one', () => {
    expect(forWire(new Date('2026-07-01T09:30:00'))).toBe('2026-07-01T09:30:00');
  });

  it('reduces an FkPointer to its id', () => {
    expect(forWire(new FkPointer('rt_assets', 'a-1'))).toBe('a-1');
  });

  it('walks rows and nested record fields', () => {
    const rows = [
      { id: 'r1', type: 'assets', fields: { due: new Date('2026-07-01T00:00:00'), owner: new FkPointer('rt_people', 'p-9') } },
      { id: 'r2', type: 'assets', fields: { due: null, owner: null } },
    ];
    expect(forWire(rows)).toEqual([
      { id: 'r1', type: 'assets', fields: { due: '2026-07-01', owner: 'p-9' } },
      { id: 'r2', type: 'assets', fields: { due: null, owner: null } },
    ]);
  });

  it('leaves scalars, null and empty string alone', () => {
    expect(forWire(null)).toBe(null);
    expect(forWire('')).toBe('');
    expect(forWire(0)).toBe(0);
    expect(forWire(false)).toBe(false);
  });

  it('does not hang on a cycle', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => forWire(a)).not.toThrow();
  });
});
