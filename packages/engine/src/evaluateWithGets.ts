// Evaluating an expression that may name a GET, from a host whose answer is a
// round trip away (DATA_THROUGH_ACTIVITIES step 2, generalised at step 4).
//
// The browser evaluates immediately; a GET is a network call. So evaluation runs in
// **rounds**: a round evaluates with an `invoke` that records the calls it is
// asked for and answers a placeholder, the round's requests are fetched
// together, and the next round evaluates again with those answers in hand. When
// a round asks for nothing new, its value is the answer.
//
// Re-evaluating is free by construction — a read runs in 'read' mode against a
// mutation-less records host, so an expression cannot do anything a second pass
// would repeat. Rounds beat walking the expression for `invoke` calls because
// an expression may reach one through a named function (DSL_SPEC §8), which no
// walk of the expression alone can see, and because a GET whose parameters come
// from another GET's answer converges instead of being a special case.
//
// This lived in the page host until 2026-08-16, written around a page's
// context. It moved here unchanged when a capture form's dropdown needed the
// same thing: two callers, one loop, and the engine is what both already
// depend on. The caller supplies how to evaluate; this supplies the waiting.

import { toComponentValue } from './bridge';

/** How a host reaches a GET activity — the client's `query`, bound by the host. */
export type GetQueryFn = (
  activityId: string,
  params: Record<string, unknown>,
  recordId?: string,
) => Promise<unknown>;

/** What the caller's round hands to the evaluator as the `invoke` built-in. */
export type RoundInvoke = (activityId: string, params: Record<string, unknown>) => unknown;

/**
 * Enough rounds for a GET fed by a GET fed by a GET, and few enough that a
 * pathological expression fails loudly instead of hammering the server.
 */
const MAX_ROUNDS = 4;

/**
 * What a round hands back for a GET it has not fetched yet.
 *
 * A **symbol**, deliberately, and not null or a placeholder object: the
 * evaluator treats an object with unknown members as a bag of nulls, which
 * would quietly turn `invoke(…).first.status` into null and send the *next*
 * GET a question nobody meant (rejected server-side for a missing required
 * parameter). A symbol has no members the evaluator will read, so reaching
 * into an unfetched answer throws, the round is abandoned, and the round that
 * has the answer asks the real question. Where the placeholder survives as a
 * parameter untouched, `isTainted` catches it directly.
 */
const UNRESOLVED = Symbol('fluxus.unresolved-get');

const isTainted = (value: unknown): boolean => {
  if (value === UNRESOLVED) return true;
  if (Array.isArray(value)) return value.some(isTainted);
  if (value !== null && typeof value === 'object') return Object.values(value).some(isTainted);
  return false;
};

const requestKey = (activityId: string, params: Record<string, unknown>): string =>
  `${activityId} ${JSON.stringify(params)}`;

export interface EvaluateWithGetsOptions {
  /** Omit and `invoke` fails loudly — a host that cannot run activities says so. */
  query?: GetQueryFn;
  /** The record the reads anchor on: where the server lands each light entry. */
  anchorId?: string;
  /** What to call the thing being evaluated, in the error a runaway produces. */
  label?: string;
}

/**
 * Run `runRound` until it stops asking for GET answers, fetching each round's
 * requests in between. `runRound` is given the `invoke` to hand the evaluator
 * and returns the expression's value; it may throw, which only counts once
 * nothing is left to fetch.
 */
export async function evaluateWithGets(
  runRound: (invoke: RoundInvoke) => unknown,
  { query, anchorId, label = 'Expression' }: EvaluateWithGetsOptions = {},
): Promise<unknown> {
  const answers = new Map<string, unknown>();

  for (let round = 0; ; round++) {
    const pending = new Map<string, { activityId: string; params: Record<string, unknown> }>();

    const invoke: RoundInvoke = (activityId, rawParams) => {
      if (!query) {
        throw new Error(`invoke('${activityId}') — this host cannot run activities`);
      }
      // Parameters built on an answer this round doesn't have yet are not a
      // question worth asking; the round that resolves them will ask it.
      if (isTainted(rawParams)) return UNRESOLVED;
      // Parameters cross the wire, so they get the same flattening the answer
      // does — a record reaches the server as its plain fields, never as a
      // DslRecord the attribute trio could not coerce.
      const params = toComponentValue(rawParams) as Record<string, unknown>;
      const key = requestKey(activityId, params);
      if (answers.has(key)) return answers.get(key);
      pending.set(key, { activityId, params });
      return UNRESOLVED;
    };

    let value: unknown;
    let failure: unknown = null;
    try {
      value = runRound(invoke);
    } catch (err) {
      // A placeholder legitimately breaks the rest of the expression
      // (`invoke(…).count`), so a round that asked for something is allowed to
      // fail — the failure only counts once nothing is left to fetch.
      failure = err;
    }

    if (pending.size === 0) {
      if (failure) throw failure;
      // Unreachable by construction — a placeholder only exists in a round that
      // asked for something — but a symbol reaching a caller would be a
      // baffling bug, so it stops here.
      if (isTainted(value)) throw new Error(`${label} resolved to an unfetched GET answer`);
      return toComponentValue(value);
    }
    if (round >= MAX_ROUNDS) {
      throw new Error(
        `${label} still asking for GET activities after ${MAX_ROUNDS} rounds — ` +
        `check for an invoke() whose parameters depend on its own answer`,
      );
    }

    await Promise.all(
      [...pending].map(async ([key, req]) => {
        answers.set(key, await query!(req.activityId, req.params, anchorId));
      }),
    );
  }
}
