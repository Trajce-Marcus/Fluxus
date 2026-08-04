// The tRPC foundation every router file shares: the request context, the
// builder, the input schemas that repeat, and the error translation.
//
// Split out of router.ts on 2026-08-04 so the user/admin surface could become
// its own router module without either file importing the other.

import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Db } from './db/client';
import type { AuthUser, RolesResolver } from './auth';
import type { BlobStore } from './services/blob';
import type { NotifySink } from './services/notify';
import {
  ConfigValidationError,
  NotImplementedError,
  OperationNotFoundError,
  OrgExistsError,
  OrgNotFoundError,
  SolutionNotFoundError,
} from './host';

/** The single demo bundle keeps one id as both its solution and its operation. */
export const DEFAULT_SOLUTION = 'demo/sdm';
export const DEFAULT_OPERATION = 'demo/sdm';
/** The single implicit org (§1) until the auth tier resolves user → org. */
export const DEFAULT_ORG = 'default';

export interface AppContext {
  db: Db;
  sink?: NotifySink;
  /** The blob store (R2) for `files` presigns; unconfigured when FLUXUS_R2_* is unset. */
  blob?: BlobStore;
  /**
   * The per-request verified identity (RBAC_COMPACT "Auth") — produced by
   * Auth.authenticate in createApp's createContext. Absent (tests, direct
   * callers) ⇒ the demo stub.
   */
  user?: AuthUser;
  /** Roles-resolver seam (§0.4); absent ⇒ the stage-1/2 stubs. */
  roles?: RolesResolver;
  /**
   * Whether Neon Auth is configured. RBAC enforcement (the record-type read
   * filter) is active only when true; the env stub (tests, local dev) leaves
   * everything open, matching "no auth env ⇒ everything open".
   */
  authConfigured?: boolean;
}

export const t = initTRPC.context<AppContext>().create();

export const solutionInput = z.string().min(1).default(DEFAULT_SOLUTION);
export const operationInput = z.string().min(1).default(DEFAULT_OPERATION);
export const orgInput = z.string().min(1).default(DEFAULT_ORG);
export const emailInput = z.string().email();

export function rethrow(err: unknown): never {
  if (err instanceof SolutionNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
  if (err instanceof NotImplementedError) throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: err.message });
  if (err instanceof OperationNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
  if (err instanceof OrgNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
  if (err instanceof OrgExistsError) throw new TRPCError({ code: 'CONFLICT', message: err.message });
  if (err instanceof ConfigValidationError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  if (err instanceof TRPCError) throw err;
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: err instanceof Error ? err.message : String(err),
  });
}
