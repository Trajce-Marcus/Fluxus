// Code that runs over either store: plain answers from memory, promises from
// the database. Written once as a generator that `yield`s each store answer;
// `settle` resumes it synchronously for as long as the answers are plain, and
// continues asynchronously from the first promise. So over a MemoryAdapter the
// result is plain (the browser never sees a promise), and over the database
// store it is a promise.

export type MaybePromise<T> = T | Promise<T>;

export function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

export function settle<T>(gen: Generator<unknown, T, unknown>): MaybePromise<T> {
  let step = gen.next();
  while (!step.done) {
    if (isThenable(step.value)) return continueWaiting(gen, step.value);
    step = gen.next(step.value);
  }
  return step.value;
}

async function continueWaiting<T>(gen: Generator<unknown, T, unknown>, first: Promise<unknown>): Promise<T> {
  let pending: unknown = first;
  for (;;) {
    let value: unknown;
    let failure: { reason: unknown } | null = null;
    try {
      value = await pending;
    } catch (reason) {
      failure = { reason };
    }
    const step = failure ? gen.throw(failure.reason) : gen.next(value);
    if (step.done) return step.value;
    pending = step.value;
  }
}

/** `fn(value)`, after the value arrives if it is a promise. */
export function mapMaybe<T, U>(value: MaybePromise<T>, fn: (value: T) => U): MaybePromise<U> {
  return isThenable(value) ? (value as Promise<T>).then(fn) : fn(value as T);
}
