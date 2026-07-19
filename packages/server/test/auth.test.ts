// Auth posture (RBAC_COMPACT "Auth"): env-driven — unconfigured ⇒ the demo
// stub and everything open; configured ⇒ a valid bearer JWT is required, no
// anonymous mode. Signature verification itself is jose + the live JWKS; what
// is ours to test is the posture switch, header parsing, and the roles seam.

import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { DEMO_USER } from '@fluxus/engine';
import { createAuth, stubRolesResolver } from '../src/auth';

describe('createAuth — unconfigured (demo posture)', () => {
  const auth = createAuth({});

  it('reports unconfigured', () => {
    expect(auth.configured).toBe(false);
  });

  it('answers the demo stub for any header, including none', async () => {
    expect(await auth.authenticate(null)).toEqual(DEMO_USER);
    expect(await auth.authenticate('Bearer whatever')).toEqual(DEMO_USER);
  });
});

describe('createAuth — configured (session required)', () => {
  const auth = createAuth({ NEON_AUTH_URL: 'https://auth.example.com' });

  it('reports configured', () => {
    expect(auth.configured).toBe(true);
  });

  it('rejects a missing/non-bearer header with UNAUTHORIZED', async () => {
    for (const header of [null, undefined, '', 'Basic abc']) {
      const err = await auth.authenticate(header).catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('UNAUTHORIZED');
    }
  });

  it('rejects a malformed token with UNAUTHORIZED (no anonymous fallback)', async () => {
    const err = await auth.authenticate('Bearer not-a-jwt').catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe('UNAUTHORIZED');
  });

  it('accepts NEON_AUTH_BASE_URL as the alternate env name', () => {
    expect(createAuth({ NEON_AUTH_BASE_URL: 'https://auth.example.com' }).configured).toBe(true);
  });
});

describe('roles resolver stubs (filled by RBAC stages 1–2)', () => {
  it('runtime plane: no roles', async () => {
    expect(await stubRolesResolver.runtimeRoles('u1', 'demo/sdm')).toEqual([]);
  });

  it('console plane: open (admin)', async () => {
    expect(await stubRolesResolver.implementerLevel('u1', 'demo/sdm')).toBe('admin');
  });
});
