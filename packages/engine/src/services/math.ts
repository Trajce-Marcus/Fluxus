// services.math — the largest-remainder split the language cannot express
// (2026-09-23). Dividing a cost or a quantity across weighted shares so the
// parts sum exactly to the whole needs a sort and a running total; the DSL has
// neither. Hand-rolled once already, in the projects solution's cost
// division, and found wrong on that first attempt (§10a of
// solutions/projects/docs/SHIFT_REPORTS.md: independent rounding of each share
// drops or invents the last cent). That is what makes it capability rather
// than a recipe repeated in every hook that divides — the same reasoning
// `services.time` is built on: **operators are language, calculations are
// capability.**
//
// Pure — no store, no host state — so it sits beside `time` and `geo`.

import type { ServiceModuleDef } from '@fluxus/dsl';

/**
 * Split `total` across `weights` so the parts, rounded to `precision` decimal
 * places, sum to exactly `total`. Floors every share in scaled (precision)
 * units, then hands the leftover units — always non-negative, since floor
 * never overshoots — to the largest remainders in order, first tie winning.
 *
 * Signed totals are carried: floor still rounds toward negative infinity, so
 * a negative total distributes to negative parts that still sum to it, with
 * no separate code path. Degenerate input (weights that sum to zero, or an
 * empty list) answers zeros rather than failing, the same posture `time`
 * takes on an unparseable clock time.
 */
function distribute(weights: unknown, total: unknown, precision: unknown): number[] {
  if (!Array.isArray(weights)) throw new Error('distribute() needs a list of weights');
  if (typeof total !== 'number') throw new Error('distribute() needs a numeric total');
  if (typeof precision !== 'number') throw new Error('distribute() needs a numeric precision');

  const nums = weights.map((w) => (typeof w === 'number' ? w : Number(w)) || 0);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (nums.length === 0 || sum === 0) return nums.map(() => 0);

  const multiplier = 10 ** precision;
  const totalScaled = total * multiplier;

  // Floor(x) <= x always, so the sum of floors never exceeds totalScaled —
  // the leftover below is always units still owed, never units to claw back.
  let floorSum = 0;
  const shares = new Array<number>(nums.length).fill(0);
  const remainders = nums.map((w, i) => {
    const raw = (totalScaled * w) / sum;
    // A whisper of float dust sits just under an integer boundary (32.399999999996
    // rather than 32.4); nudge it back before flooring, or a share loses a unit
    // it earned.
    const floor = Math.floor(raw + 1e-9);
    floorSum += floor;
    shares[i] = floor;
    return { i, remainder: raw - floor };
  });

  const leftover = Math.round(totalScaled) - floorSum;
  remainders.sort((a, b) => b.remainder - a.remainder);
  for (let k = 0; k < leftover; k++) {
    shares[remainders[k].i] += 1;
  }

  return shares.map((s) => s / multiplier);
}

export function buildMathModule(): ServiceModuleDef {
  return {
    name: 'math',
    description: 'Exact division of a total across weighted shares.',
    functions: {
      distribute: {
        params: ['weights', 'total', 'precision'],
        description:
          'Splits total across weights so the parts, at precision decimal places, sum to exactly total (largest-remainder rounding). Signed totals distribute to signed parts. Weights summing to zero, or an empty list, give back zeros.',
        kind: 'read',
        fn: (weights, total, precision) => distribute(weights, total, precision),
      },
    },
  };
}
