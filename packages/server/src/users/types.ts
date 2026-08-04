// Shared types and the one rule every table in this module obeys (USERS.md §2).

/** A person in the organisation. Identity alone — no level, no authority, no
 *  access. Everything else is a grant in one of the sibling modules. */
export interface User {
  email: string;
  name: string | null;
  /** Bound at first successful sign-in; null while the invite is outstanding. */
  authUserId: string | null;
  status: UserStatus;
  /** When the relationship ended; null unless `status` is 'expired'. */
  expiredAt: Date | null;
}

/** `suspended` is a reversible pause that keeps every grant; `expired` is the
 *  terminal state and drops them all. Neither ever deletes the row — see
 *  `expireUser`. */
export type UserStatus = 'invited' | 'active' | 'suspended' | 'expired';

/** A grant row, everywhere. Every appointment table is keyed (target, person)
 *  and carries nothing else — the row IS the assignment. */
export interface Grant {
  email: string;
}

/** Emails are compared, stored and keyed lower-cased and trimmed — the pool key
 *  must not admit `A@x.com` and `a@x.com` as two people, and every grant table
 *  joins back to it on this value. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const DEFAULT_ORG_ID = 'default';
