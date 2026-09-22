// services.time — duration arithmetic the language does not have (2026-09-23).
//
// A `time` field holds 'HH:MM' as a zone-less string, and the DSL has no way to
// subtract two of them: `'17:00' - '07:00'` is an error, so is date minus date,
// and there is no substring, split or numeric cast to build one out of. A shift
// report's work_hours — the number that prices every resource — cannot be
// worked out without this.
//
// It is a service rather than a new operator because **operators are language
// and calculations are capability** (the user's rule, 2026-09-23). Subtracting
// two times is the same shape as a geography lookup: a calculation over values
// that the host performs. Adding an operator would touch the grammar, the
// validator and every host; adding a module touches none of them.
//
// Pure — no store, no host state — so it sits beside `geo` here and every host
// gets it by registering the module, exactly as `geo` is registered.
//
// No dependency. What this needs is a few lines of exact arithmetic, and a date
// library would be disproportionate. The module is itself the boundary: if this
// ever grows into parsing, formatting or time zones, a library slots in behind
// these functions and not one script changes.

import type { ServiceModuleDef } from '@fluxus/dsl';

/** 'HH:MM' (or 'HH:MM:SS') → minutes since midnight. Null when it is not a time. */
function minutesOf(raw: unknown): number | null {
  if (typeof raw === 'number') return null;
  const text = String(raw ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function buildTimeModule(): ServiceModuleDef {
  return {
    name: 'time',
    description: 'Duration arithmetic over zone-less clock times.',
    functions: {
      hoursBetween: {
        params: ['start', 'end'],
        description:
          "Hours from one 'HH:MM' to another, as a decimal. An end at or before the start is the next day, so 18:00 to 06:00 is 12 — a night shift, not an error. Blank either side gives 0.",
        kind: 'read',
        fn: (start, end) => {
          const from = minutesOf(start);
          const to = minutesOf(end);
          // A blank pair answers 0 rather than failing: a half-filled draft is
          // ordinary, and a hook that throws on one cannot be run at all.
          if (from === null || to === null) return 0;
          // Equal times are a full day, not nothing — a shift booked 06:00 to
          // 06:00 ran for 24 hours. Only the blank case above is zero.
          const span = to > from ? to - from : to - from + 24 * 60;
          // Two decimals: minutes divide into hours exactly at this precision
          // for every whole minute, and the raw division does not (10 minutes
          // is 0.16666…). Every caller of this multiplies it by a rate.
          return Math.round((span / 60) * 100) / 100;
        },
      },
    },
  };
}
