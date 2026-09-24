// `ok` / `refused` / `error` (docs/PERFORMANCE_LOGGING.md §2): a refusal is
// the pipeline working as designed (a bad submission, a gate closing a door);
// an error is something going wrong. Both are worth timing, but conflating
// them would make "how often does this activity fail" unanswerable.

import { TRPCError } from '@trpc/server';
import type { Outcome } from './context';

const REFUSED_CODES = new Set([
  'BAD_REQUEST',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'NOT_IMPLEMENTED',
  'UNPROCESSABLE_CONTENT',
  'PAYLOAD_TOO_LARGE',
]);

export function classifyOutcome(err: unknown): { outcome: Outcome; message: string } {
  if (err instanceof TRPCError) {
    return { outcome: REFUSED_CODES.has(err.code) ? 'refused' : 'error', message: err.message };
  }
  return { outcome: 'error', message: err instanceof Error ? err.message : String(err) };
}
