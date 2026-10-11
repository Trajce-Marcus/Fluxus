// Errors a host raises that callers outside the engine tell apart.

/**
 * A record exists but the caller may not read it (2026-10-12, reversing
 * "denied reads as not found"). Thrown by a host that knows the record was
 * withheld from this caller; a page shows its message where the record would
 * have been, instead of a blank that reads as "there is none".
 */
export class RecordAccessDeniedError extends Error {
  constructor(readonly recordId: string) {
    super('Record access denied');
    this.name = 'RecordAccessDeniedError';
  }
}
