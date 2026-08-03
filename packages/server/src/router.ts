// Activities as the API surface (DSL Phase 4): no GET/POST design, just
// functions called by name — pages and headless callers hit the same three
// groups. `activities.run` is the third front door on the one pipeline: the
// activity's attribute list is its parameter signature, its datasources double
// as validation (validateSubmission), and the availability gate + hooks are
// enforced inside runActivity exactly as for the browser hosts.

import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { DEMO_USER, isDescriptorType, validateSubmission, type ConfigRaw, type RunActivityResult } from '@fluxus/engine';
import type { Db } from './db/client';
import { records } from './db/schema';
import {
  ConfigValidationError,
  NotImplementedError,
  OperationNotFoundError,
  OrgNotFoundError,
  SolutionNotFoundError,
  createOperation,
  deletePage,
  findActivity,
  getOperation,
  getOrg,
  getOrgName,
  listOrgs,
  registerOrg,
  OrgExistsError,
  getSolutionName,
  getSolutionOrg,
  putOrgProfile,
  getSolutionConfig,
  listConfigVersions,
  getPageVersion,
  insertPendingAttachment,
  listSolUsers,
  listOperations,
  listPageVersions,
  listPages,
  listPublishedPages,
  addOpUser,
  getOpUser,
  getOrgUser,
  isAnySolUser,
  inviteOrgUser,
  listOpUsers,
  listOrgUsers,
  listUserRoles,
  removeOpUser,
  removeOrgUser,
  setOrgUserLevel,
  setOrgUserStatus,
  listSolutions,
  createSolution,
  updateSolution,
  deleteSolution,
  loadOperationHost,
  pageOpenable,
  publishConfig,
  publishPage,
  rollbackConfig,
  rollbackPage,
  putConfig,
  putSolUser,
  removeSolUser,
  putOperationConfig,
  putPage,
  putUserRoles,
  usedStorageBytes,
  validateOperationMenu,
  writeBack,
} from './host';
import type { NotifySink } from './services/notify';
import { consoleNotifySink } from './services/notify';
import { isPlatformAdmin, stubRolesResolver, type AuthUser, type RolesResolver } from './auth';
import { ENV_FUSE_BYTES, PLATFORM_MAX_BYTES, makeStorageKey, type BlobStore } from './services/blob';
import type { MenuItem, OperationConfig } from './db/schema';

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

/**
 * Runtime-plane identity for one call: the verified user with `roles`
 * resolved for the operation (stand-in: the scope key). What the engine sees
 * as `context.user` and entries record as `author`.
 */
async function resolveUser(ctx: AppContext, operationId: string) {
  const user = ctx.user ?? DEMO_USER;
  await requireOpUser(ctx, operationId, user);
  const roles = ctx.roles ?? stubRolesResolver;
  // Roles resolve on the EMAIL (0015), like every other grant — the auth id
  // only exists once someone has signed in, and grants precede that.
  return { ...user, roles: await roles.runtimeRoles(user.email, operationId) };
}

/**
 * The entry gate (RBAC_COMPACT "Users", ruled 2026-08-02): may this caller open
 * this operation at all? Distinct from roles — an op user with no roles enters
 * and sees nothing (valid); roles without an op_users row must never grant entry.
 * Enforced here because `resolveUser` is the one choke point every
 * operation-scoped call passes through.
 *
 * **Strict, not dormant** (ruled 2026-08-02): an operation with no op_users
 * admits nobody. Deliberately unlike the record-type/page/sol-user surfaces,
 * which are dormant-until-declared — those ask "what may you see", and an
 * un-configured model staying visible is a reasonable adoption default. This
 * asks "may you enter", and an operation with no users listed has, literally,
 * no users. An empty list is an answer, not an absence of one.
 *
 * No design-plane bypass: someone who builds the solution adds themselves like
 * anyone else. (The sol-user resolver is dormant-open today, so a bypass would
 * make this gate a no-op anyway.)
 *
 * The demo posture (auth unconfigured) is still open — with no identity to
 * check there is nothing to gate on, and local dev would be unusable.
 */
async function requireOpUser(ctx: AppContext, operationId: string, user: AuthUser): Promise<void> {
  if (!ctx.authConfigured) return;
  const email = user.email?.trim().toLowerCase();
  const row = email ? await getOpUser(ctx.db, { operationId, email }) : null;
  if (row) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `You are not a user of operation '${operationId}'`,
  });
}

/**
 * ── The admin tiers (RBAC_COMPACT "Administration", ruled 2026-08-02) ─────────
 *
 * Authority has one root — the org admin — and flows **downward only**. No tier
 * appoints its own tier, and there is no sideways delegation. Three checks, one
 * per tier, and they are deliberately NOT nested:
 *
 *   requireOrgAdmin       — org_users.level = 'admin'. Identity: who exists,
 *                           who gets in, who administers.
 *   requireOpAdmin        — op_users.level = 'admin' IN THIS OPERATION.
 *                           Authorization: what they may do once inside.
 *   requireSolUser        — sol_users. The design plane: read (look at the
 *                           model) or write (build it).
 *
 * **An org admin is not implicitly an op admin.** That is the governing split
 * (identity vs authorization) and it is intentional: an org admin who wants to
 * manage roles appoints themselves op admin first. A speed bump, not a wall —
 * the point is that the grant is explicit and auditable rather than ambient.
 * The one crossover is adding a user to an operation, which is an identity
 * question and so accepts either tier; see `users.addOp`. Appointing sol users
 * is org-admin work too — the design plane governs no people.
 *
 * Same env posture as every other check: auth unconfigured ⇒ open, because with
 * no identity there is nothing to gate on.
 */
async function isOrgAdmin(ctx: AppContext, orgId: string): Promise<boolean> {
  const email = (ctx.user ?? DEMO_USER).email?.trim().toLowerCase();
  if (!email) return false;
  const row = await getOrgUser(ctx.db, { email, orgId });
  // A suspended admin is not an admin — lifecycle has to bite the tier too, or
  // suspending an org admin would leave their grants fully live.
  return row?.level === 'admin' && row.status !== 'suspended';
}

async function isOpAdmin(ctx: AppContext, operationId: string, orgId: string): Promise<boolean> {
  const email = (ctx.user ?? DEMO_USER).email?.trim().toLowerCase();
  if (!email) return false;
  const row = await getOpUser(ctx.db, { operationId, email, orgId });
  if (row?.level !== 'admin') return false;
  // The op grant rides on the pool row, so a suspended/removed pool user loses
  // it even while the op_users row survives.
  const pool = await getOrgUser(ctx.db, { email, orgId });
  return pool !== null && pool.status !== 'suspended';
}

async function requireOrgAdmin(ctx: AppContext, orgId: string = DEFAULT_ORG): Promise<void> {
  if (!ctx.authConfigured) return;
  if (await isOrgAdmin(ctx, orgId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires organisation admin' });
}

/**
 * The platform tier (ruled 2026-08-03) — above every org, and the only caller
 * that may read across them or register a new one. Backed by an env allowlist
 * (`isPlatformAdmin`), not a table; the reasoning is on that function.
 *
 * Note what this check does NOT do: fall open when auth is unconfigured. Every
 * other gate here guards one org's data from that org's own people, so with no
 * identity there is genuinely nothing to gate on. This one guards every org
 * from everyone, and an unconfigured dev machine must not be a machine where
 * anyone can register orgs. Demo posture therefore has no platform plane at
 * all, which is correct — there is nothing to administer.
 */
async function requirePlatformAdmin(ctx: AppContext): Promise<void> {
  const email = ctx.user?.email;
  if (isPlatformAdmin(email)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires platform admin' });
}

async function requireOpAdmin(ctx: AppContext, operationId: string, orgId: string = DEFAULT_ORG): Promise<void> {
  if (!ctx.authConfigured) return;
  if (await isOpAdmin(ctx, operationId, orgId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: `Requires admin of operation '${operationId}'` });
}

/**
 * Design-plane check (`sol_users`) for config/page writes — keyed on the
 * solution, because the design plane attaches to the design artifact. The stub
 * resolver answers 'write', so this is open until RBAC stage 2 fills the seam.
 *
 * Two grades: `read` looks at the model, `write` builds it. There is no third —
 * 'admin' collapsed into 'write' (2026-08-02) once the admin tiers took over
 * everything it guarded. Appointing sol users is org-admin work, not something
 * a sol user can do, so no tier appoints its own tier here either.
 */
const SOL_RANK = { none: 0, read: 1, write: 2 } as const;
async function requireSolUser(ctx: AppContext, solutionId: string, level: 'read' | 'write'): Promise<void> {
  // Env stub (no auth) ⇒ design plane open, matching "no auth ⇒ everything
  // open" (§7). Enforced only when auth is configured (RBAC stage 2 / M5).
  if (!ctx.authConfigured) return;
  const user = ctx.user ?? DEMO_USER;
  const roles = ctx.roles ?? stubRolesResolver;
  // Email, not id — sol users are appointed from the org pool, whose users may
  // never have signed in (rekeyed 2026-08-02).
  const held = await roles.solUserLevel(user.email, solutionId);
  if (SOL_RANK[held] < SOL_RANK[level]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires solution '${level}' on this solution` });
  }
}

/**
 * The record-type read surface (RBAC_COMPACT: role list, default deny, server
 * partition filter). Returns the set of type ids readable to the caller in the
 * operation, or `null` when RBAC is dormant/off (everything readable):
 *   - auth unconfigured (env stub) ⇒ null (open), OR
 *   - the solution declares no `access.roles` ⇒ null (adoption posture).
 * Otherwise **default deny**: a type is readable only if its `access.read`
 * lists a role the user holds. A held role set comes from `runtimeRoles`.
 */
function computeReadable(authConfigured: boolean | undefined, config: ConfigRaw, roles: string[] | undefined): Set<string> | null {
  if (!authConfigured) return null; // env stub ⇒ everything open
  if (!config.access?.roles?.length) return null; // solution opted out ⇒ open (adoption)
  const held = new Set(roles ?? []);
  const readable = new Set<string>();
  for (const rt of config.recordTypes) {
    if ((rt.access?.read ?? []).some((r) => held.has(r))) readable.add(rt.id); // default deny
  }
  return readable;
}

/** The caller's resolved roles + the operation's linked-solution config. */
async function operationContext(ctx: AppContext, operationId: string): Promise<{ user: AuthUser; config: ConfigRaw }> {
  const user = await resolveUser(ctx, operationId);
  const op = await getOperation(ctx.db, operationId);
  const config = await getSolutionConfig(ctx.db, op.solutionId);
  return { user, config };
}

async function readableTypeIds(ctx: AppContext, operationId: string): Promise<{ user: AuthUser; readable: Set<string> | null }> {
  const user = await resolveUser(ctx, operationId);
  if (!ctx.authConfigured) return { user, readable: null };
  const op = await getOperation(ctx.db, operationId);
  const config = await getSolutionConfig(ctx.db, op.solutionId);
  return { user, readable: computeReadable(ctx.authConfigured, config, user.roles) };
}

/** Whether a file's mime/extension satisfies a `file` attribute's `accept` list. */
function matchesAccept(accept: string[], mime: string, name: string): boolean {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  const m = mime.toLowerCase();
  return accept.some((entry) => {
    const t = entry.trim().toLowerCase();
    if (t.startsWith('.')) return t === ext;
    if (t.endsWith('/*')) return m.startsWith(t.slice(0, -1));
    return t === m;
  });
}

const t = initTRPC.context<AppContext>().create();

const solutionInput = z.string().min(1).default(DEFAULT_SOLUTION);
const operationInput = z.string().min(1).default(DEFAULT_OPERATION);
const orgInput = z.string().min(1).default(DEFAULT_ORG);

// Menu shape (schema §5) — validated on operations.putConfig. Deeper validation
// (page paths resolve to published versions; role ids exist) lands with M4.
const menuItemSchema: z.ZodType<MenuItem> = z.lazy(() =>
  z.object({
    // Zod strips unknown keys, so the stable id has to be declared here or a
    // saved override would come back without ids.
    id: z.string().min(1).optional(),
    label: z.string().min(1),
    page: z.string().min(1).optional(),
    roles: z.array(z.string().min(1)).optional(),
    items: z.array(menuItemSchema).optional(),
  }),
);
const operationConfigSchema: z.ZodType<OperationConfig> = z.object({
  menu: z.array(menuItemSchema).optional(),
});

/** Arbitrary JSON — the activity payload's transport; the engine types it. */
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

function rethrow(err: unknown): never {
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

export const appRouter = t.router({
  // Solutions + operations (CONSOLE_RUNTIME_SPEC §2–3): plain auth-tier CRUD,
  // no SDM/activities. operations.get is the Runtime's resolution door —
  // operation → { solution, runtime config } — that connect() calls first.
  // The caller's identity + roles resolved for an operation, and whether RBAC
  // is enforced (auth configured). The Runtime host uses this for cosmetic
  // menu filtering; server-side page/record filtering is the real gate.
  // `operationId` is OPTIONAL (2026-08-02). With one, this resolves the caller
  // inside that operation — roles, op-admin tier — and so passes the entry
  // gate like every other operation-scoped call. Without one it answers the
  // org-level question only: "am I an org admin, may I use the Console". The
  // Console's Organisation → Users screen needs exactly that and has no
  // operation in hand, and routing it through an arbitrary operation's gate
  // would make org administration depend on op membership, which is precisely
  // the coupling the identity/authorization split exists to prevent.
  me: t.procedure
    .input(z.object({ operationId: z.string().min(1).optional(), orgId: orgInput }).default({}))
    .query(async ({ ctx, input }) => {
      const scoped = input.operationId !== undefined;
      const u = scoped ? await resolveUser(ctx, input.operationId!) : (ctx.user ?? DEMO_USER);
      const orgId = scoped ? (await getOperation(ctx.db, input.operationId!)).orgId : input.orgId;
      // The admin tiers ride along so the Console can gate what it RENDERS on
      // the same two columns the server enforces on. Cosmetic only — every
      // admin call is checked again server-side; this just avoids showing a
      // user buttons that would refuse them.
      //
      // Demo posture (auth unconfigured) reports both true, matching the checks
      // themselves, which are open when there is no identity to gate on.
      const orgAdmin = ctx.authConfigured ? await isOrgAdmin(ctx, orgId) : true;
      const opAdmin = !scoped ? false : ctx.authConfigured ? await isOpAdmin(ctx, input.operationId!, orgId) : true;
      // "May use the Console" is DERIVED, never a stored flag: org admin, or a
      // sol user on any solution. A separate bit could contradict the
      // grants it summarises, so there isn't one.
      const console = ctx.authConfigured
        ? orgAdmin || (u.email ? await isAnySolUser(ctx.db, u.email) : false)
        : true;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        roles: u.roles ?? [],
        authConfigured: ctx.authConfigured === true,
        orgAdmin,
        opAdmin,
        console,
      };
    }),

  // The org tier (§1a, M14): the tenant everything hangs under. Profile reads
  // and edits only — no create (registration needs user → org resolution, which
  // the auth tier does not do yet) and no plan/status writes (ours to set).
  orgs: t.router({
    get: t.procedure
      .input(z.object({ orgId: orgInput }).default({}))
      .query(async ({ ctx, input }) => getOrg(ctx.db, input.orgId)),
    putProfile: t.procedure
      .input(z.object({
        orgId: orgInput,
        name: z.string().min(1),
        contactEmail: z.string().email().nullable().default(null),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          await putOrgProfile(ctx.db, input.orgId, { name: input.name, contactEmail: input.contactEmail });
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // The platform plane (ruled 2026-08-03) — `@fluxus/platform`'s door, and the
  // only place orgs are created or read across. Bare bones by intent: list and
  // register. Usage and billing belong here eventually, but usage falls out of
  // the log rather than a counter table, so neither is invented early.
  platform: t.router({
    /** Every org. The one cross-org read in the API. */
    listOrgs: t.procedure.query(async ({ ctx }) => {
      try {
        await requirePlatformAdmin(ctx);
        return await listOrgs(ctx.db);
      } catch (err) {
        rethrow(err);
      }
    }),
    /**
     * Register an org and its owner in one act — see `registerOrg` for why
     * they cannot be two. This is what makes `npm run bootstrap` recovery-only:
     * every org after the first gets its first admin from here.
     *
     * The id is a URL slug because it IS the URL — the Console and Runtime read
     * their org from `/o/<orgId>/…` (ruled 2026-08-03, Neon's shape), so
     * anything that would need escaping there cannot be an org id.
     */
    registerOrg: t.procedure
      .input(z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Lower-case letters, digits and hyphens only').max(63),
        name: z.string().min(1),
        ownerEmail: z.string().email(),
        ownerName: z.string().nullish(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requirePlatformAdmin(ctx);
          await registerOrg(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  solutions: t.router({
    // Scoped to the org (2026-08-02): `solutions.org_id` decides whose list
    // this is. Ids stay globally unique — a solution is a distributable
    // package — so the column filters the catalogue and nothing else.
    list: t.procedure
      .input(z.object({ orgId: orgInput }).default({}))
      .query(async ({ ctx, input }) => listSolutions(ctx.db, input.orgId)),
    create: t.procedure
      .input(z.object({ id: z.string().min(1), name: z.string().min(1), orgId: orgInput }))
      .mutation(async ({ ctx, input }) => {
        try {
          // Org admin OF THE TARGET ORG (2026-08-03) — the gate has to name the
          // org being written to, or an admin of 'default' could create
          // solutions in anyone's workspace. Latent until orgs could be
          // registered; a hole the moment they can.
          await requireOrgAdmin(ctx, input.orgId);
          // The creator is enrolled as a `write` user of it — the design plane
          // is strict, so a solution with an empty user list is one nobody can
          // build, including whoever just made it.
          await createSolution(ctx.db, { ...input, createdBy: (ctx.user ?? DEMO_USER).email });
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    // Editing an existing solution is ORG-admin work (ruled 2026-08-02, was
    // design-plane 'admin'): the org admin creates solutions, so renaming and
    // destroying one are the inverse of a call they already own. Moving these
    // two is what let the design plane's third grade collapse — 'admin' on a
    // solution had nothing else left to guard. `update` rather than `rename`
    // because the profile will grow beyond the name.
    update: t.procedure
      .input(z.object({ solutionId: z.string().min(1), name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
          await updateSolution(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    delete: t.procedure
      .input(z.object({ solutionId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
          await deleteSolution(ctx.db, input.solutionId);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  operations: t.router({
    list: t.procedure.query(async ({ ctx }) => listOperations(ctx.db)),
    get: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          // Display names ride along for the Runtime header (M10, M13): the
          // org is the tenant the user works for, the solution is the app they
          // are in, the operation is which business unit's data it runs on.
          const [solutionName, orgName] = await Promise.all([
            getSolutionName(ctx.db, op.solutionId),
            getOrgName(ctx.db, op.orgId),
          ]);
          return { ...op, solutionName, orgName };
        } catch (err) {
          rethrow(err);
        }
      }),
    create: t.procedure
      .input(z.object({ id: z.string().min(1), solutionId: z.string().min(1), name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          // Org admin: "create operations and assign each a solution" is
          // explicitly the root tier's. Previously gated on the linked
          // solution's design plane, which let anyone who could build a
          // solution mint operations — now closed.
          // The operation inherits the solution's org, so the gate asks about
          // that org — not the default one (2026-08-03).
          await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
          await createOperation(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    putConfig: t.procedure
      .input(z.object({ operationId: operationInput, config: operationConfigSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          // Op admin (ruled 2026-08-02, was design-plane 'write'). Menus stay
          // split: `default_menu` is design-plane and belongs to the solution
          // admin; THIS is the per-operation override, runtime-plane, and
          // belongs to whoever runs the operation.
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          // Menu references validated at save (§5): pages resolve to published
          // versions; role ids exist; one nesting level max.
          await validateOperationMenu(ctx.db, op.solutionId, input.config.menu ?? []);
          await putOperationConfig(ctx.db, input.operationId, input.config);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // User roles, per operation (CONSOLE_RUNTIME_SPEC §2a/§3, RBAC_COMPACT).
  // **Op admin** (ruled 2026-08-02, was design-plane 'admin' — sol users lose
  // this): roles answer "what may they do once inside", which is the op admin's
  // half of the split. Notably an ORG admin is refused here too, deliberately —
  // they may appoint themselves op admin, and that grant is then explicit.
  // `roles` reads the linked solution's declared role defs for the picker and
  // exposes no user data, so it is open.
  userRoles: t.router({
    roles: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          const config = await getSolutionConfig(ctx.db, op.solutionId);
          return config.access?.roles ?? [];
        } catch (err) {
          rethrow(err);
        }
      }),
    list: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          return await listUserRoles(ctx.db, input.operationId);
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ operationId: operationInput, email: z.string().email(), roleIds: z.array(z.string().min(1)) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          await putUserRoles(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // Users (RBAC_COMPACT "Users" + "Administration", ruled 2026-08-02): the org
  // pool and each operation's user list. Email is the key at both layers — an
  // invited user has no auth id until first sign-in.
  //
  // The grant split follows identity vs authorization. The **org admin** owns
  // the pool: invite, lifecycle, removal, and appointing admins of any tier. The
  // **op admin** owns their operation's user list. Solution admins appear
  // nowhere here — they get no user visibility at all.
  users: t.router({
    listOrg: t.procedure
      .input(z.object({ orgId: z.string().min(1).default(DEFAULT_ORG) }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          // The whole pool is the org admin's view; nobody else sees it.
          await requireOrgAdmin(ctx, input.orgId);
          return await listOrgUsers(ctx.db, input.orgId);
        } catch (err) {
          rethrow(err);
        }
      }),
    invite: t.procedure
      .input(z.object({
        email: z.string().email(),
        name: z.string().nullish(),
        // Appointing an org admin at invite time. Omitted ⇒ plain user, and a
        // re-invite never demotes an existing admin (see inviteOrgUser).
        level: z.enum(['admin', 'user']).optional(),
        orgId: z.string().min(1).default(DEFAULT_ORG),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, input.orgId);
          await inviteOrgUser(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    removeOrg: t.procedure
      .input(z.object({ email: z.string().email(), orgId: z.string().min(1).default(DEFAULT_ORG) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, input.orgId);
          await removeOrgUser(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    /** Lifecycle: suspend/reinstate. The reversible half of removeOrg — every
     *  grant survives, but the entry gate and both admin tiers refuse them. */
    setStatus: t.procedure
      .input(z.object({
        email: z.string().email(),
        status: z.enum(['invited', 'active', 'suspended']),
        orgId: z.string().min(1).default(DEFAULT_ORG),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, input.orgId);
          await setOrgUserStatus(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    /** Appoint or demote an org admin. No tier appoints its own tier, so this
     *  is a deliberate exception to that rule and the only one: the org tier is
     *  the root of authority, and something has to be able to add a second
     *  person to it. Bootstrapping the FIRST one is the seed's job. */
    setOrgLevel: t.procedure
      .input(z.object({
        email: z.string().email(),
        level: z.enum(['admin', 'user']),
        orgId: z.string().min(1).default(DEFAULT_ORG),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, input.orgId);
          await setOrgUserLevel(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    listOp: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          // Either tier: the op admin runs this list, and the org admin has to
          // see it to put the first person in it.
          if (ctx.authConfigured && !(await isOpAdmin(ctx, input.operationId, op.orgId)) && !(await isOrgAdmin(ctx, op.orgId))) {
            throw new TRPCError({ code: 'FORBIDDEN', message: `Requires admin of operation '${input.operationId}'` });
          }
          return await listOpUsers(ctx.db, input.operationId);
        } catch (err) {
          rethrow(err);
        }
      }),
    /**
     * **The escalation rule, in one place.** Adding someone to an operation is
     * an identity question ("may they enter"), so either admin tier may do it —
     * but the LEVEL being written decides who:
     *
     *   level 'user'  → op admin or org admin
     *   level 'admin' → org admin only
     *
     * So an op admin can staff their operation but can never mint another op
     * admin, which is the downward-only rule. Every other appointment path
     * funnels through here, which is why the branch lives at this one call
     * rather than being spread across the procedures.
     */
    addOp: t.procedure
      .input(z.object({ operationId: operationInput, email: z.string().email(), level: z.enum(['admin', 'user']).default('user') }))
      .mutation(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          if (input.level === 'admin') {
            await requireOrgAdmin(ctx, op.orgId);
          } else if (ctx.authConfigured && !(await isOpAdmin(ctx, input.operationId, op.orgId)) && !(await isOrgAdmin(ctx, op.orgId))) {
            throw new TRPCError({ code: 'FORBIDDEN', message: `Requires admin of operation '${input.operationId}'` });
          }
          await addOpUser(ctx.db, { ...input, orgId: op.orgId });
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    removeOp: t.procedure
      .input(z.object({ operationId: operationInput, email: z.string().email() }))
      .mutation(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          await removeOpUser(ctx.db, { ...input, orgId: op.orgId });
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // Sol users: who builds a solution, at `read` or `write`. The design-plane
  // layer of the three (org_users → sol_users → op_users), renamed from
  // `implementers` 2026-08-02 so one word serves each layer.
  //
  // **Org admin** on every procedure: "create solutions and appoint who builds
  // them" is the root tier's, and the design plane governs no people — a sol
  // user cannot appoint another, and since the email rekey these rows carry
  // real identities they have no business seeing.
  solUsers: t.router({
    list: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
          return await listSolUsers(ctx.db, input.solutionId);
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ solutionId: solutionInput, email: z.string().email(), level: z.enum(['read', 'write']) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
          await putSolUser(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    remove: t.procedure
      .input(z.object({ solutionId: solutionInput, email: z.string().email() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
          await removeSolUser(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  config: t.router({
    get: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          return await getSolutionConfig(ctx.db, input.solutionId);
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ solutionId: solutionInput, config: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolUser(ctx, input.solutionId, 'write');
          // The solution's default runtime menu (§5, amended 2026-07-26) rides
          // in the config artifact; the engine stays menu-blind, so its shape
          // and references are validated here — same §5 rules as the operation
          // override, with roles read from the config being saved.
          const defaultMenu = (input.config as { default_menu?: unknown }).default_menu;
          if (defaultMenu !== undefined) {
            const parsed = z.array(menuItemSchema).safeParse(defaultMenu);
            if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: `default_menu is not a menu: ${parsed.error.message}` });
            await validateOperationMenu(ctx.db, input.solutionId, parsed.data, input.config as ConfigRaw);
          }
          await putConfig(ctx.db, input.solutionId, input.config as ConfigRaw, ctx.sink);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
    // Model history (ruled 2026-07-26) — the same publish surface pages have.
    // Readme required: a version without release notes is a diff nobody can
    // read later, which is the whole point of keeping the history.
    publish: t.procedure
      .input(z.object({ solutionId: solutionInput, readme: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolUser(ctx, input.solutionId, 'write');
          const publishedBy = ctx.user?.id ?? DEMO_USER.id;
          return await publishConfig(ctx.db, input.solutionId, input.readme, publishedBy);
        } catch (err) {
          rethrow(err);
        }
      }),
    versions: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => listConfigVersions(ctx.db, input.solutionId)),
    // Rollback republishes an older version as a new one AND restores it as the
    // draft — the config draft is what hosts evaluate, so nothing else would
    // make the rollback observable.
    rollback: t.procedure
      .input(z.object({ solutionId: solutionInput, version: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolUser(ctx, input.solutionId, 'write');
          const publishedBy = ctx.user?.id ?? DEMO_USER.id;
          return await rollbackConfig(ctx.db, input.solutionId, input.version, `Rollback to v${input.version}`, publishedBy);
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // Page definitions on the config pipeline: defs are opaque jsonb (PageDef +
  // validatePage live in the page builder), list returns the solution's full
  // set (a host snapshots pages at connect exactly like the record partition).
  pages: t.router({
    // Two read modes (CONSOLE_RUNTIME_SPEC §3): draft (Console — the editable
    // `pages` rows) vs published (Runtime — the latest `page_versions` per path).
    list: t.procedure
      .input(z.object({ solutionId: solutionInput, operationId: operationInput.optional(), published: z.boolean().default(false) }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          if (!input.published) return await listPages(ctx.db, input.solutionId);
          const pubs = await listPublishedPages(ctx.db, input.solutionId);
          // Env stub ⇒ everything open; skip the operation lookup entirely.
          if (!ctx.authConfigured) return pubs;
          // Published mode (Runtime): filter to pages openable to the caller in
          // the operation (RBAC_COMPACT page surface, §6 — server upgrades the
          // client interim). operationId resolves the caller's roles + solution.
          const { user, config } = await operationContext(ctx, input.operationId ?? input.solutionId);
          return pubs.filter((p) => pageOpenable(ctx.authConfigured, config, user.roles, p.def));
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1), def: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        await requireSolUser(ctx, input.solutionId, 'write');
        await putPage(ctx.db, input.solutionId, input.path, input.def ?? {});
        return { ok: true as const };
      }),
    delete: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requireSolUser(ctx, input.solutionId, 'write');
        await deletePage(ctx.db, input.solutionId, input.path);
        return { ok: true as const };
      }),
    // Publish snapshots the current draft def at max(version)+1 with release
    // notes. Append-only — rollback republishes an older def as a new version.
    publish: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1), readme: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolUser(ctx, input.solutionId, 'write');
          const publishedBy = ctx.user?.id ?? DEMO_USER.id;
          return await publishPage(ctx.db, input.solutionId, input.path, input.readme, publishedBy);
        } catch (err) {
          rethrow(err);
        }
      }),
    // Every published page path (unfiltered) — the design/authoring plane
    // (menu editor, §5). Console preview is access-exempt (§6). Sol-user read.
    publishedPaths: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          await requireSolUser(ctx, input.solutionId, 'read');
          return (await listPublishedPages(ctx.db, input.solutionId)).map((p) => p.path).sort();
        } catch (err) {
          rethrow(err);
        }
      }),
    versions: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1) }))
      .query(async ({ ctx, input }) => listPageVersions(ctx.db, input.solutionId, input.path)),
    // Rollback = republish an older version's def as a NEW version; the draft
    // is untouched (append-only, never delete/edit).
    rollback: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1), version: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolUser(ctx, input.solutionId, 'write');
          const publishedBy = ctx.user?.id ?? DEMO_USER.id;
          return await rollbackPage(ctx.db, input.solutionId, input.path, input.version, `Rollback to v${input.version}`, publishedBy);
        } catch (err) {
          rethrow(err);
        }
      }),
    // A specific version's def — the rollback source (republish it as a new
    // version). Diffing is a non-goal.
    getVersion: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1), version: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const def = await getPageVersion(ctx.db, input.solutionId, input.path, input.version);
        if (def === null) throw new TRPCError({ code: 'NOT_FOUND', message: `No version ${input.version} of '${input.path}'` });
        return { def };
      }),
  }),

  // Blob uploads (ATTRIBUTE_TYPES_FILES_SCALARS §6): the presign chokepoint.
  // Bytes never transit here — the browser PUTs straight to R2 with the URL
  // this returns. presignUpload is where every cost safeguard is enforced
  // BEFORE any bytes move (§7): the platform ceiling, the per-attribute
  // max_size_mb, the file `accept` filter, and the environment storage fuse.
  files: t.router({
    presignUpload: t.procedure
      .input(
        z.object({
          solutionId: solutionInput,
          /** The pool attribute this upload is for — its type_config gates the presign. */
          attributeKey: z.string().min(1),
          name: z.string().min(1),
          mime: z.string().min(1),
          size: z.number().int().nonnegative(),
          hash: z.string().optional(),
          // Photo metadata the client computed pre-upload — ledgered for the
          // integrity/duplicate story (§8); the descriptor carries them too.
          width: z.number().int().optional(),
          height: z.number().int().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          taken_at: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const blob = ctx.blob;
          if (!blob?.configured) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Blob storage is not configured (FLUXUS_R2_*)' });
          }
          const config = await getSolutionConfig(ctx.db, input.solutionId);
          const attr = config.attributes.find((a) => a.key === input.attributeKey);
          if (!attr) throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown attribute '${input.attributeKey}'` });
          if (!isDescriptorType(attr.type)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `'${input.attributeKey}' is not a file/photo attribute` });
          }
          const cfg = attr.type_config ?? {};

          // Size: platform ceiling first (a config typo can't open the door),
          // then the per-attribute cap.
          if (input.size > PLATFORM_MAX_BYTES) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `File exceeds the ${PLATFORM_MAX_BYTES / (1024 * 1024)} MB platform limit` });
          }
          if (typeof cfg.max_size_mb === 'number' && input.size > cfg.max_size_mb * 1024 * 1024) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `File exceeds the ${cfg.max_size_mb} MB limit for '${attr.label}'` });
          }
          // MIME: photos are images; files honour the accept filter.
          if (attr.type === 'photo' && !input.mime.toLowerCase().startsWith('image/')) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `'${attr.label}' takes images only` });
          }
          if (attr.type === 'file' && cfg.accept && cfg.accept.length > 0 && !matchesAccept(cfg.accept, input.mime, input.name)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `'${input.name}' is not an accepted type for '${attr.label}'` });
          }
          // Environment fuse: refuse once the ledger footprint would pass the
          // threshold — a "storage limit reached", not a surprise bill (§7 #3).
          if ((await usedStorageBytes(ctx.db)) + input.size > ENV_FUSE_BYTES) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Storage limit reached — uploads are temporarily disabled' });
          }

          const { storageKey, thumbKey } = makeStorageKey(input.name);
          await insertPendingAttachment(ctx.db, {
            storageKey,
            size: input.size,
            mime: input.mime,
            hash: input.hash,
            width: input.width,
            height: input.height,
            lat: input.lat,
            lng: input.lng,
            takenAt: input.taken_at ? new Date(input.taken_at) : null,
          });
          const uploadUrl = await blob.presignUpload(storageKey, input.mime);
          // Photos carry a thumbnail object (§6): a second presigned PUT the
          // client fills with the canvas thumb. thumb_key is derived, not
          // separately ledgered (small, GC'd with its folder).
          if (attr.type === 'photo') {
            const thumbUploadUrl = await blob.presignUpload(thumbKey, 'image/jpeg');
            return { storageKey, uploadUrl, thumbKey, thumbUploadUrl };
          }
          return { storageKey, uploadUrl };
        } catch (err) {
          rethrow(err);
        }
      }),
    presignGet: t.procedure
      .input(z.object({ solutionId: solutionInput, key: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const blob = ctx.blob;
        if (!blob?.configured) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Blob storage is not configured (FLUXUS_R2_*)' });
        }
        return { url: await blob.presignGet(input.key) };
      }),
  }),

  records: t.router({
    // The whole scope partition in one round trip — what a browser host loads
    // into its MemoryAdapter snapshot at bootstrap (and re-fetches after runs).
    partition: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          const { readable } = await readableTypeIds(ctx, input.operationId);
          const rows = await ctx.db.select().from(records).where(eq(records.operationId, input.operationId));
          return rows
            .filter((r) => readable === null || readable.has(r.typeRef))
            .map((r) => ({
              id: r.id,
              typeRef: r.typeRef,
              customFields: r.customFields,
              activityHistory: r.activityHistory,
            }));
        } catch (err) {
          rethrow(err);
        }
      }),
    list: t.procedure
      .input(z.object({ operationId: operationInput, typeId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          const { readable } = await readableTypeIds(ctx, input.operationId);
          if (readable !== null && !readable.has(input.typeId)) return [];
          const rows = await ctx.db
            .select()
            .from(records)
            .where(and(eq(records.operationId, input.operationId), eq(records.typeRef, input.typeId)));
          return rows.map((r) => ({
            id: r.id,
            typeRef: r.typeRef,
            customFields: r.customFields,
            activityHistory: r.activityHistory,
          }));
        } catch (err) {
          rethrow(err);
        }
      }),
    get: t.procedure
      .input(z.object({ operationId: operationInput, recordId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          const { readable } = await readableTypeIds(ctx, input.operationId);
          const rows = await ctx.db
            .select()
            .from(records)
            .where(and(eq(records.operationId, input.operationId), eq(records.id, input.recordId)));
          // Deny reads as not-found (RBAC_COMPACT): a hidden record and a
          // missing one are indistinguishable to the caller.
          if (rows.length === 0 || (readable !== null && !readable.has(rows[0].typeRef))) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `Record not found: ${input.recordId}` });
          }
          const r = rows[0];
          return { id: r.id, typeRef: r.typeRef, customFields: r.customFields, activityHistory: r.activityHistory };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  activities: t.router({
    run: t.procedure
      .input(
        z.object({
          operationId: operationInput,
          activityId: z.string().min(1),
          recordId: z.string().min(1).optional(),
          /** Attribute payload. Scalars are strings, as the capture form
           *  submits; composite cells come flat under dotted keys
           *  ('access_permission.ok') or nested (attr → sub); file/photo
           *  descriptors are objects and multi values are arrays. Transport is
           *  arbitrary JSON — validateSubmission does the authoritative shape
           *  check per the attribute's type. */
          attributes: z.record(z.string(), jsonValue).default({}),
          waived: z.record(z.string(), z.string()).optional(),
          acknowledgedWarnings: z.boolean().optional(),
          callbackData: z.unknown().optional(),
        }),
      )
      .mutation(async ({ ctx, input }): Promise<RunActivityResult> => {
        try {
          // Roles resolve per operation before the engine exists — the
          // availability gate may read context.user.roles.
          const user = await resolveUser(ctx, input.operationId);
          const host = await loadOperationHost(ctx.db, input.operationId, ctx.sink ?? consoleNotifySink, user);

          const activity = findActivity(host, input.activityId);
          if (!activity) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `Activity not found: ${input.activityId}` });
          }

          let anchorRecord = null;
          if (activity.record_map === 'CREATE') {
            if (input.recordId) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `'${input.activityId}' is a CREATE activity — recordId must not be supplied` });
            }
          } else {
            if (!input.recordId) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `'${input.activityId}' needs a recordId to anchor on` });
            }
            anchorRecord = host.adapter.getRecord(input.recordId); // throws → BAD_REQUEST via rethrow
            // Unreadable anchor ⇒ not-found, checked BEFORE the run gate
            // (RBAC_COMPACT): the caller can't tell a hidden record from a
            // missing one. Reuses the already-loaded config + resolved roles.
            const readable = computeReadable(ctx.authConfigured, host.config, user.roles);
            if (readable !== null && !readable.has(anchorRecord.typeRef)) {
              throw new TRPCError({ code: 'NOT_FOUND', message: `Record not found: ${input.recordId}` });
            }
          }

          const issues = validateSubmission(host.engine, activity, input.attributes, anchorRecord, input.waived ?? {});
          if (issues.length > 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: issues.map((i) => i.message).join(' · ') });
          }

          try {
            const result = host.engine.runActivity(activity, input.attributes, anchorRecord, {
              acknowledgedWarnings: input.acknowledgedWarnings,
              waived: input.waived,
              callbackData: input.callbackData,
            });
            // needs-confirmation persists nothing by doctrine — the diff is
            // empty and write-back is a no-op, but skip it explicitly.
            if (result.status === 'done') await writeBack(ctx.db, host);
            return result;
          } catch (err) {
            // A failing after hook throws AFTER the entry was appended and the
            // record_map change applied ("recorded, but no changes applied") —
            // those must persist, so write the diff back even on error. A
            // failing before hook / availability gate left the store untouched
            // and this is a no-op.
            await writeBack(ctx.db, host);
            throw err;
          }
        } catch (err) {
          rethrow(err);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
