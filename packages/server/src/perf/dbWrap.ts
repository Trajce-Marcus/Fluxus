// Database timing on real Postgres only (docs/PERFORMANCE_LOGGING.md §5,
// §10a): node-postgres's pool is wrapped so a request's queries are counted
// and timed (never a span per query — totals only), and a new physical
// connection is its own `db_connect` span, which is what shows Neon waking
// up. PGlite (tests, no DATABASE_URL) has neither, so those counts are simply
// absent there.

import type pg from 'pg';
import { currentCtx, pushDbConnectSpan, recordDbQuery } from './context';

type AnyFn = (...args: unknown[]) => unknown;

let connectPatched = false;

/** Time `Client.connect` once per process. Patched on the prototype rather
 *  than via the pool's `Client` option because the callback/promise overloads
 *  make a subclass override untypeable without a cast that hides real errors. */
export function timeClientConnects(client: typeof pg.Client): void {
  if (connectPatched) return;
  connectPatched = true;
  const proto = client.prototype as unknown as { connect: AnyFn };
  const original = proto.connect;
  proto.connect = function (this: unknown, ...args: unknown[]): unknown {
    // Captured now, while still inside the request that needs the connection —
    // the callback fires from the socket, where the context is not guaranteed.
    const ctx = currentCtx();
    const started = performance.now();
    const done = () => pushDbConnectSpan(Math.round(performance.now() - started), ctx);
    if (typeof args[0] === 'function') {
      const callback = args[0] as AnyFn;
      return original.call(this, (...cbArgs: unknown[]) => {
        done();
        return callback(...cbArgs);
      });
    }
    const result = original.apply(this, args) as Promise<unknown>;
    result.then(done, done);
    return result;
  };
}

/** Count and time every query a pool client runs. Wrapped once per physical
 *  client, at the moment it connects, so pool queries and transaction
 *  checkouts (which bypass `pool.query`) are both counted exactly once. */
export function countClientQueries(client: { query: AnyFn }): void {
  const original = client.query.bind(client) as AnyFn;
  client.query = (...args: unknown[]): unknown => {
    if (typeof args[args.length - 1] === 'function') return original(...args); // callback style: untimed
    const ctx = currentCtx();
    const started = performance.now();
    const result = original(...args) as { then?: AnyFn } | undefined;
    if (result && typeof result.then === 'function') {
      const done = () => recordDbQuery(performance.now() - started, ctx);
      (result as Promise<unknown>).then(done, done);
    }
    return result;
  };
}
