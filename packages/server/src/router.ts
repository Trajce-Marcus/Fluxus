// Activities as the API surface (DSL Phase 4): no GET/POST design, just
// functions called by name — pages and headless callers hit the same three
// groups. `activities.run` is the third front door on the one pipeline: the
// activity's attribute list is its parameter signature, its datasources double
// as validation (validateSubmission), and the availability gate + hooks are
// enforced inside runActivity exactly as for the browser hosts.

import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, and, inArray, ne } from 'drizzle-orm';
import { FkPointer } from '@fluxus/dsl';
import { AfterHookFailedError, APPS_RECORD_TYPE, DEMO_USER, isUploadType, validateSubmission, type ActivityDef, type ActivityOption, type SolutionConfig, type QueryActivityResult, type RunActivityResult } from '@fluxus/engine';
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
  configCollections,
  deleteConfigEntity,
  putConfigEntity,
  listConfigVersions,
  getPageVersion,
  insertPendingAttachment,
  listOperations,
  listPageVersions,
  listPages,
  listPublishedPages,
  listSolutions,
  createSolution,
  updateSolution,
  deleteSolution,
  loadOperationHost,
  publishConfig,
  publishPage,
  rollbackConfig,
  rollbackPage,
  putConfig,
  putOperationConfig,
  putPage,
  usedStorageBytes,
  type ConfigCollection,
} from './host';
import {
  opAdminsRouter,
  opUsersRouter,
  orgAdminsRouter,
  solAdminsRouter,
  userRolesRouter,
  usersRouter,
} from './routers/users';
import { computeReadable, projectConfig } from './projection';
import { appDefaults, appFromRow, appListOf, appsForUser, PageNotPublishedError, getAppRecord, isAppRecord, listApps, listWorkflowOf, loadAppForCall, mayRunApp, menuSchema, putApp, readMenu, validateAppMenu, type App } from './apps';
import { perfRouter } from './routers/perf';
import { setScope, withSpan } from './perf';
import {
  hasConsoleAccess,
  isOpAdmin,
  isOrgAdmin,
  isOrgOwner,
  requireOpAdmin,
  requireOpUser,
  requireOrgAdmin,
  requirePlatformAdmin,
  requireSolAdmin,
  requireSolOrOpAdmin,
} from './gates';
import {
  DEFAULT_OPERATION,
  DEFAULT_ORG,
  DEFAULT_SOLUTION,
  operationInput,
  orgInput,
  rethrow,
  solutionInput,
  t,
  type AppContext,
} from './trpc';
import type { NotifySink } from './services/notify';

// Re-exported so `./router` stays the one import for callers that had them
// here before the trpc/gates split (app.ts, index.ts, the Lambda/Vercel entries).
export { DEFAULT_OPERATION, DEFAULT_ORG, DEFAULT_SOLUTION, type AppContext };
import { consoleNotifySink } from './services/notify';
import { isPlatformAdmin, stubRolesResolver, type AuthUser, type RolesResolver } from './auth';
import { ENV_FUSE_BYTES, PLATFORM_MAX_BYTES, makeStorageKey, type BlobStore } from './services/blob';
import type { OperationConfig } from './db/schema';

/**
 * Runtime-plane identity for one call: the verified user with `roles`
 * resolved for the operation (stand-in: the scope key). What the engine sees
 * as `context.user` and entries record as `author`.
 */
async function resolveUser(ctx: AppContext, operationId: string) {
  const user = ctx.user ?? DEMO_USER;
  // Every operation-scoped call passes through here first, so this is where
  // the perf log learns which operation the request is about — its own
  // override (PERFORMANCE_LOGGING.md §6) is looked up by it at flush time.
  setScope(operationId, user.email);
  await requireOpUser(ctx, operationId, user);
  const roles = ctx.roles ?? stubRolesResolver;
  // Roles resolve on the EMAIL (0015), like every other grant — the auth id
  // only exists once someone has signed in, and grants precede that.
  return { ...user, roles: await roles.runtimeRoles(user.email, operationId) };
}

/** The caller's resolved roles + the operation's linked-solution config. */
async function operationContext(ctx: AppContext, operationId: string): Promise<{ user: AuthUser; config: SolutionConfig }> {
  const user = await resolveUser(ctx, operationId);
  const op = await getOperation(ctx.db, operationId);
  const config = await getSolutionConfig(ctx.db, op.solutionId);
  return { user, config };
}

/**
 * A call that names no app (APPS_AND_INSTANCES §2.3) is refused unless the
 * caller is an **admin of that operation**, who then reads every record in it,
 * whatever their roles — and nothing in operations they are not admins of. It
 * governs exactly the calls on the closed list: `activities.run`,
 * `activities.query`, `page.activities`, `records.get`, `records.list`,
 * `records.partition`, `scripts.query` and `files.*` — the Console's
 * workbench, DSL Editor and page preview. With sign-in off, open, as every
 * gate is.
 */
async function requireNoAppCaller(ctx: AppContext, op: { id: string; orgId: string }): Promise<void> {
  if (!ctx.authConfigured) return;
  if (await isOpAdmin(ctx, op.id, op.orgId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: `This call names no app, so it is for admins of operation '${op.id}' only` });
}

/**
 * Who may make a call on the closed list, and which record types they read in
 * it: with an app, checks 1 and 2 and then their read rules; with none, an
 * operation admin, who reads them all (null). Answers the app, when there is one.
 */
async function callAccess(
  ctx: AppContext,
  op: { id: string; orgId: string; solutionId: string },
  appId: string | undefined,
  user: AuthUser,
  config: SolutionConfig,
): Promise<{ readable: Set<string> | null; app: App | null }> {
  if (appId === undefined) {
    await requireNoAppCaller(ctx, op);
    return { readable: null, app: null };
  }
  const app = await checkCallApp(ctx, op, appId, user);
  return { readable: computeReadable(ctx.authConfigured, config, user.roles), app };
}

/** The record types whose workflow lists an activity — where it runs (§2.2). */
function typesListing(config: SolutionConfig, activityId: string): string[] {
  return config.recordTypes
    .filter((rt) => config.workflows.find((w) => w.id === rt.workflow_ref)?.activities.some((u) => u.activity_ref === activityId))
    .map((rt) => rt.id);
}

/**
 * Check 4 for an activity of the app's own (§2.3): it runs only through its
 * app, and names neither a record type nor a record — the server puts it on
 * the app's record.
 */
function assertAppsOwnCall(activityId: string, app: App | null, input: { typeId?: string; recordId?: string }): asserts app is App {
  if (!app) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `'${activityId}' is in no record type's workflow — an app's own activity runs only through its app` });
  }
  if (input.typeId !== undefined || input.recordId !== undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `'${activityId}' is an activity of '${app.label}' itself — it names no record type and no record, and runs on the app` });
  }
}

/** How far `records.get` follows references: two levels covers a page that
 *  reads `context.record.area_inspection.job.job_no`. */
const REFERENCE_DEPTH = 2;

type RecordRow = typeof records.$inferSelect;

/**
 * The records `roots` point at, following reference fields up to
 * REFERENCE_DEPTH levels — sent with a record so a page that holds only its own
 * record can still show `context.record.area.name`, and a form can name what a
 * reference holds (2026-10-12). Only records the caller may read, by the same
 * readable-types answer as the record itself; one that exists but may not be
 * read is **withheld** — named, so the page can say access is denied rather
 * than show a blank — and not followed further. A reference to a missing
 * record is skipped. The roots themselves are never repeated.
 */
async function referencedRecords(
  db: AppContext['db'],
  operationId: string,
  config: SolutionConfig,
  readable: Set<string> | null,
  roots: RecordRow[],
): Promise<{ found: RecordRow[]; withheld: string[] }> {
  const refFields = new Map(config.recordTypes.map((rt) => [
    rt.id,
    rt.custom_fields.filter((cf) => cf.type === 'fk_ref').map((cf) => cf.key),
  ]));
  const seen = new Set(roots.map((r) => r.id));
  const found: RecordRow[] = [];
  const withheld: string[] = [];
  let level = roots;
  for (let depth = 0; depth < REFERENCE_DEPTH && level.length > 0; depth++) {
    const ids = new Set<string>();
    for (const row of level) {
      for (const key of refFields.get(row.typeRef) ?? []) {
        const value = row.customFields[key];
        if (typeof value === 'string' && value !== '' && !seen.has(value)) ids.add(value);
      }
    }
    if (ids.size === 0) break;
    const rows = await db.select().from(records)
      .where(and(eq(records.operationId, operationId), inArray(records.id, [...ids])));
    for (const r of rows) seen.add(r.id);
    // An operation's app is never handed out as a record (APPS_AND_INSTANCES
    // §2.3); a reference naming one is withheld like an unreadable record.
    level = rows.filter((r) => !isAppRecord(r) && (readable === null || readable.has(r.typeRef)));
    found.push(...level);
    withheld.push(...rows.filter((r) => !level.includes(r)).map((r) => r.id));
  }
  return { found, withheld };
}

/** A record that exists but may not be read (2026-10-12, the user's ruling,
 *  reversing "denied reads as not found"): showing nothing misleads more than
 *  saying access is denied. A record that does not exist is still not found. */
const accessDenied = () => new TRPCError({ code: 'FORBIDDEN', message: 'Record access denied' });

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

// The operation's app menu (APPS_AND_INSTANCES §2.5) — validated on
// operations.putConfig against the operation's apps list.
const operationConfigSchema: z.ZodType<OperationConfig> = z.object({
  menu: menuSchema.optional(),
});

/** An operation as `operations.list` / `operations.get` answer it: without its
 *  menu (§2.3), which the Runtime gets from `apps.user`, built for each caller,
 *  and the Console from `apps.list`. */
function withoutMenu<T extends { config: OperationConfig }>(op: T): T {
  const { menu: _menu, ...config } = op.config;
  return { ...op, config };
}

/**
 * Checks 1 and 2 (APPS_AND_INSTANCES §2.3) for a call that names its app: the
 * app is in the call's operation's apps list with its page published, and the
 * caller holds one of its roles (with sign-in off, open). Run before anything
 * the call asks for.
 */
async function checkCallApp(ctx: AppContext, op: { id: string; solutionId: string }, appId: string, user: AuthUser): Promise<App> {
  const app = await loadAppForCall(ctx.db, op.id, op.solutionId, appId);
  if (!mayRunApp(app, ctx.authConfigured, user.roles)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `You may not run '${app.label}'` });
  }
  return app;
}

/** `files.*` (§2.3): the operation's entry gate, the operation running the
 *  solution named, and checks 1–2 — or, naming no app, an operation admin. */
async function fileCallAccess(ctx: AppContext, input: { solutionId: string; operationId: string; appId?: string }): Promise<void> {
  const user = await resolveUser(ctx, input.operationId);
  const op = await getOperation(ctx.db, input.operationId);
  if (op.solutionId !== input.solutionId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Operation '${op.id}' does not run solution '${input.solutionId}'` });
  }
  if (input.appId === undefined) await requireNoAppCaller(ctx, op);
  else await checkCallApp(ctx, op, input.appId, user);
}

/** The app a Runtime call names: the id of an app in the operation's apps list. */
const appIdInput = z.string().min(1).optional();

/**
 * The put half of one collection's per-entity mutations. `def` is opaque on the
 * wire exactly as `config.put`'s whole config is — the entity's shape is the
 * graph validation's business, not the transport's; all this layer insists on is
 * that a def is an object carrying its own identity.
 */
function entityPut<T>(collection: ConfigCollection<T>) {
  return t.procedure
    .input(z.object({ solutionId: solutionInput, def: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireSolAdmin(ctx, input.solutionId);
        await putConfigEntity(ctx.db, input.solutionId, collection, input.def, ctx.sink, ctx.user?.email ?? null);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    });
}

/** The delete half — its input names the entity's own identity field, so each
 *  procedure asks for a `key` or an `id` as the model spells it. */
async function entityDelete<T>(ctx: AppContext, solutionId: string, collection: ConfigCollection<T>, id: string) {
  try {
    await requireSolAdmin(ctx, solutionId);
    await deleteConfigEntity(ctx.db, solutionId, collection, id, ctx.sink);
    return { ok: true as const };
  } catch (err) {
    rethrow(err);
  }
}

/** Arbitrary JSON — the activity payload's transport; the engine types it. */
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

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
      // The owner rides along too: they alone appoint org admins, so the
      // Org admins tab renders its controls off this and nothing else.
      const orgOwner = ctx.authConfigured ? await isOrgOwner(ctx, orgId) : true;
      // "May use the Console" is DERIVED, never a stored flag — owner, org
      // admin, or sol admin of any solution. A separate bit could contradict
      // the grants it summarises, so there isn't one.
      const console = await hasConsoleAccess(ctx, orgId);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        roles: u.roles ?? [],
        authConfigured: ctx.authConfigured === true,
        orgOwner,
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
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          await putOrgProfile(ctx.db, input.orgId, { name: input.name });
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
    list: t.procedure.query(async ({ ctx }) => (await listOperations(ctx.db)).map(withoutMenu)),
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
          return { ...withoutMenu(op), solutionName, orgName };
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
          // Op admin (ruled 2026-08-02, was design-plane 'write'): the app menu
          // belongs to whoever runs the operation.
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          // Checked at save (§2.5): every leaf points at an app of this
          // operation, at most once.
          validateAppMenu(input.config.menu ?? [], await listApps(ctx.db, input.operationId));
          await putOperationConfig(ctx.db, input.operationId, input.config);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // An operation's apps list (APPS_AND_INSTANCES Part 2 §2.4–§2.6): the apps it
  // uses, each a record of the platform's `rt_sys_apps`. Set up by the
  // operation's admins, in the Console only; written directly, never through
  // activities, and every change leaves a `sys_console_edit` history entry.
  apps: t.router({
    /** The operation's apps, without their history (the dialog asks `get`). */
    list: t.procedure
      .input(z.object({ operationId: operationInput }))
      .query(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          return { apps: await listApps(ctx.db, input.operationId), menu: readMenu(op.config) };
        } catch (err) {
          rethrow(err);
        }
      }),
    /** One app, with its history — for the dialog that edits it. */
    get: t.procedure
      .input(z.object({ operationId: operationInput, appId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          const row = await getAppRecord(ctx.db, input.operationId, input.appId);
          if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `This app is not set up for this operation (${input.appId})` });
          return { ...appFromRow(row), activityHistory: row.activityHistory };
        } catch (err) {
          rethrow(err);
        }
      }),
    /**
     * What the Runtime receives at sign-in (§2.7): the apps the caller may run,
     * their pages' published definitions, the menu built from them, and — until
     * step 6 — the id of each page's only app. Open to the operation's users,
     * like the other calls a Runtime makes to connect.
     */
    user: t.procedure
      .input(z.object({ operationId: operationInput }))
      .query(async ({ ctx, input }) => {
        try {
          const user = await resolveUser(ctx, input.operationId);
          const op = await getOperation(ctx.db, input.operationId);
          return await appsForUser(ctx.db, op, ctx.authConfigured, user.roles);
        } catch (err) {
          rethrow(err);
        }
      }),
    /** Add an app (no `id`) or change one. No removing in Part 2. */
    put: t.procedure
      .input(z.object({
        operationId: operationInput,
        id: z.string().min(1).optional(),
        pageId: z.string().min(1),
        label: z.string(),
        roleIds: z.array(z.string().min(1)),
        definition: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          await requireOpAdmin(ctx, input.operationId, op.orgId);
          const [published, config] = await Promise.all([
            listPublishedPages(ctx.db, op.solutionId),
            getSolutionConfig(ctx.db, op.solutionId),
          ]);
          const { operationId, ...app } = input;
          return await putApp(ctx.db, operationId, app, { publishedPages: new Set(published.map((p) => p.path)), config }, (ctx.user ?? DEMO_USER).id);
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // Users, admins and roles (USERS.md) — one router per list, each governed by
  // one tier. The whole surface lives in ./routers/users.ts; the gates it reads
  // are in ./gates.ts.
  users: usersRouter,
  orgAdmins: orgAdminsRouter,
  solAdmins: solAdminsRouter,
  opAdmins: opAdminsRouter,
  opUsers: opUsersRouter,
  userRoles: userRolesRouter,

  config: t.router({
    // Two doors, not one filter (CLIENT_TRUST_BOUNDARY §2). This is the design
    // plane's: the whole model, hooks and access rules included, because
    // authoring them is the job. **Sol admin, or an admin of one of the
    // solution's operations** (APPS_AND_INSTANCES §2.6, 2026-10-18): operation
    // admins use the Console's workbench on their records, which runs on this
    // model. Writing it (`config.put` and the per-entity writes) stays sol admin.
    get: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          await requireSolOrOpAdmin(ctx, input.solutionId);
          return await getSolutionConfig(ctx.db, input.solutionId);
        } catch (err) {
          rethrow(err);
        }
      }),
    /**
     * The runtime plane's door: the model trimmed to what this caller may see.
     * Keyed on the **operation**, not the solution, because what survives the
     * trim is decided by the caller's roles *in that operation* — and entry to
     * the operation is itself the first check (`resolveUser` → `requireOpUser`).
     */
    getForOperation: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          const { user, config } = await operationContext(ctx, input.operationId);
          // The lists of the apps this caller may run, so the browser gets
          // their own activities (step 5).
          const op = await getOperation(ctx.db, input.operationId);
          const appLists = new Set<string>();
          for (const pageId of new Set((await listApps(ctx.db, op.id)).filter((a) => mayRunApp(a, ctx.authConfigured, user.roles)).map((a) => a.pageId))) {
            const list = await listWorkflowOf(ctx.db, op.solutionId, pageId, config);
            if (list) appLists.add(list.id);
          }
          return projectConfig(config, { roles: user.roles, enforced: ctx.authConfigured, appLists });
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ solutionId: solutionInput, config: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolAdmin(ctx, input.solutionId);
          // An imported model's `default_menu` is dropped (apps Part 2 step 3):
          // each operation sets up its own apps and menu.
          await putConfig(ctx.db, input.solutionId, input.config as SolutionConfig, ctx.sink, ctx.user?.email ?? null);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),

    // Per-entity model writes (model storage split, step 1). Same tier as
    // config.put — sol admin — and the same validation: the consistency unit is
    // the whole graph, only the *write* unit narrows to one entity. That is what
    // ends the lost update two admins editing two different record types used to
    // suffer. `def` is the entity verbatim, carrying its own key/id.
    putAttribute: entityPut(configCollections.attributes),
    deleteAttribute: t.procedure
      .input(z.object({ solutionId: solutionInput, key: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => entityDelete(ctx, input.solutionId, configCollections.attributes, input.key)),

    putRecordType: entityPut(configCollections.recordTypes),
    deleteRecordType: t.procedure
      .input(z.object({ solutionId: solutionInput, id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => entityDelete(ctx, input.solutionId, configCollections.recordTypes, input.id)),

    // The activity pool (APPS_AND_INSTANCES §1.6). Deleting one a workflow
    // still lists fails validation, naming each such workflow.
    putActivity: entityPut(configCollections.activities),
    deleteActivity: t.procedure
      .input(z.object({ solutionId: solutionInput, id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => entityDelete(ctx, input.solutionId, configCollections.activities, input.id)),

    putWorkflow: entityPut(configCollections.workflows),
    deleteWorkflow: t.procedure
      .input(z.object({ solutionId: solutionInput, id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => entityDelete(ctx, input.solutionId, configCollections.workflows, input.id)),

    putFunction: entityPut(configCollections.functions),
    deleteFunction: t.procedure
      .input(z.object({ solutionId: solutionInput, id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => entityDelete(ctx, input.solutionId, configCollections.functions, input.id)),

    putRole: entityPut(configCollections.roles),
    deleteRole: t.procedure
      .input(z.object({ solutionId: solutionInput, id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => entityDelete(ctx, input.solutionId, configCollections.roles, input.id)),

    // Model history (ruled 2026-07-26) — the same publish surface pages have.
    // Readme required: a version without release notes is a diff nobody can
    // read later, which is the whole point of keeping the history.
    publish: t.procedure
      .input(z.object({ solutionId: solutionInput, readme: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolAdmin(ctx, input.solutionId);
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
          await requireSolAdmin(ctx, input.solutionId);
          const publishedBy = ctx.user?.id ?? DEMO_USER.id;
          return await rollbackConfig(ctx.db, input.solutionId, input.version, `Rollback to v${input.version}`, publishedBy);
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // What the server prepares for a page (ACTIONS_OFFERED_BY_SERVER) — apart
  // from `pages`, which holds page definitions. The Console workbench asks it
  // too, although it is not a page.
  page: t.router({
    /**
     * Which actions each item offers the caller, decided here with the real
     * user, by the engine's own gate (`offeredActivities`). The browser draws
     * what comes back; it no longer has the conditions.
     *
     * An item is a record (its actions) or a record type (its CREATEs, with no
     * record — a create button). A record the caller may not read answers an
     * empty list, exactly as a missing one does — the check `activities.run`
     * applies to its record. A record type has no read check, as a CREATE's
     * run has none. An empty `{}` asks for the app's own activities (step 5):
     * those on its list that no record type's workflow lists, offered on the
     * app's record; with no app, none.
     */
    activities: t.procedure
      .input(
        z.object({
          operationId: operationInput,
          appId: appIdInput,
          items: z.array(z.union([
            z.object({ recordId: z.string().min(1) }),
            z.object({ typeId: z.string().min(1) }),
            z.object({}).strict(),
          ])),
        }),
      )
      .query(async ({ ctx, input }): Promise<ActivityOption[][]> => {
        try {
          const user = await resolveUser(ctx, input.operationId);
          const host = await loadOperationHost(ctx.db, input.operationId, ctx.sink ?? consoleNotifySink, user);
          // Failing check 1 or 2 answers empty, not an error (§2.3): the
          // question is what this caller may do here. Naming no app is the
          // no-app rule's, and refused for anyone but an operation admin.
          const op = { id: input.operationId, orgId: host.orgId, solutionId: host.solutionId };
          let access: Awaited<ReturnType<typeof callAccess>>;
          if (input.appId === undefined) {
            access = await callAccess(ctx, op, undefined, user, host.config);
          } else {
            try {
              access = await callAccess(ctx, op, input.appId, user, host.config);
            } catch {
              return input.items.map(() => []);
            }
          }
          const { readable, app } = access;
          if (app) host.useApp(app);
          // Through an app, only what its list holds (check 3), each with the
          // app's condition beside the activity's own (check 6, §2.3).
          const list = app ? await appListOf(ctx.db, host.solutionId, app.pageId, host.config) : null;
          const workflowOf = (typeId: string): ActivityDef[] | null => {
            let activities: ActivityDef[];
            try { activities = host.store.getRecordTypeDef(typeId).workflow.activities; } catch { return null; }
            return list ? activities.filter((a) => list.ids.has(a.id)) : activities;
          };
          // One item after another: they share the request's record cache.
          const answers: ActivityOption[][] = [];
          for (const item of input.items) {
            if ('recordId' in item) {
              const record = await host.store.findRecord(item.recordId);
              const activities = record && !isAppRecord(record) && (readable === null || readable.has(record.typeRef)) ? workflowOf(record.typeRef) : null;
              answers.push(activities ? await host.engine.offeredActivities(activities, record, list?.conditions) : []);
            } else if ('typeId' in item) {
              const activities = workflowOf(item.typeId);
              answers.push(activities ? await host.engine.offeredActivities(activities, null, list?.conditions) : []);
            } else if (app && list) {
              const own = [...list.ids]
                .filter((id) => typesListing(host.config, id).length === 0)
                .map((id) => findActivity(host, id))
                .filter((a): a is ActivityDef => a !== null);
              answers.push(own.length > 0 ? await host.engine.offeredActivities(own, await host.store.getRecord(app.id), list.conditions) : []);
            } else {
              answers.push([]);
            }
          }
          return answers;
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // Page definitions on the config pipeline: defs are opaque jsonb (PageDef +
  // validatePage live in the page builder), list returns the solution's full
  // set (a host snapshots pages at connect exactly like the record partition).
  pages: t.router({
    // The editable drafts (the `pages` rows) — the design plane (APPS_AND_INSTANCES
    // §2.3), called by the Console's connect with no operation: solution admins
    // only. A refusal is how the Console learns the caller cannot design here.
    // Published definitions reach the Runtime through `apps.user`.
    list: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          await requireSolAdmin(ctx, input.solutionId);
          return await listPages(ctx.db, input.solutionId);
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1), def: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        await requireSolAdmin(ctx, input.solutionId);
        await putPage(ctx.db, input.solutionId, input.path, input.def ?? {});
        return { ok: true as const };
      }),
    delete: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requireSolAdmin(ctx, input.solutionId);
        await deletePage(ctx.db, input.solutionId, input.path);
        return { ok: true as const };
      }),
    // Publish snapshots the current draft def at max(version)+1 with release
    // notes. Append-only — rollback republishes an older def as a new version.
    publish: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1), readme: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireSolAdmin(ctx, input.solutionId);
          const publishedBy = ctx.user?.id ?? DEMO_USER.id;
          return await publishPage(ctx.db, input.solutionId, input.path, input.readme, publishedBy);
        } catch (err) {
          rethrow(err);
        }
      }),
    // Every published page path (unfiltered) — what an app in an operation's
    // apps list can be made from (APPS_AND_INSTANCES §2.6). Sol admins, and the
    // admins of the solution's operations, who set up those operations' apps.
    publishedPaths: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          await requireSolOrOpAdmin(ctx, input.solutionId);
          return (await listPublishedPages(ctx.db, input.solutionId)).map((p) => p.path).sort();
        } catch (err) {
          rethrow(err);
        }
      }),
    // A new app's starting values from its page's latest published version —
    // the example definition and the default roles (APPS_AND_INSTANCES §3.1,
    // §3.3). Gated like publishedPaths: the new-app dialog reads it.
    appDefaults: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          await requireSolOrOpAdmin(ctx, input.solutionId);
          return await appDefaults(ctx.db, input.solutionId, input.path, await getSolutionConfig(ctx.db, input.solutionId));
        } catch (err) {
          if (err instanceof PageNotPublishedError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
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
          await requireSolAdmin(ctx, input.solutionId);
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
          /** The operation the upload is for, and the app it comes through
           *  (APPS_AND_INSTANCES §2.3): checks 1–2 apply. */
          operationId: operationInput,
          appId: appIdInput,
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
          await fileCallAccess(ctx, input);
          const blob = ctx.blob;
          if (!blob?.configured) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Blob storage is not configured (FLUXUS_R2_*)' });
          }
          const config = await getSolutionConfig(ctx.db, input.solutionId);
          const attr = config.attributes.find((a) => a.key === input.attributeKey);
          if (!attr) throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown attribute '${input.attributeKey}'` });
          if (!isUploadType(attr.type)) {
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
      .input(z.object({ solutionId: solutionInput, operationId: operationInput, appId: appIdInput, key: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          await fileCallAccess(ctx, input);
          const blob = ctx.blob;
          if (!blob?.configured) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Blob storage is not configured (FLUXUS_R2_*)' });
          }
          return { url: await blob.presignGet(input.key) };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  records: t.router({
    // The whole scope partition in one round trip — what a browser host loads
    // into its MemoryAdapter snapshot at bootstrap (and re-fetches after runs).
    partition: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          // A call with no app (§2.3): an operation admin, who reads every
          // record type — but never the operation's apps (§2.4).
          await resolveUser(ctx, input.operationId);
          await requireNoAppCaller(ctx, await getOperation(ctx.db, input.operationId));
          const rows = await ctx.db.select().from(records)
            .where(and(eq(records.operationId, input.operationId), ne(records.typeRef, APPS_RECORD_TYPE)));
          return rows
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
          // A call with no app (§2.3): an operation admin, who reads every type.
          await resolveUser(ctx, input.operationId);
          await requireNoAppCaller(ctx, await getOperation(ctx.db, input.operationId));
          if (input.typeId === APPS_RECORD_TYPE) return [];
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
      .input(z.object({ operationId: operationInput, appId: appIdInput, recordId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          const user = await resolveUser(ctx, input.operationId);
          const op = await getOperation(ctx.db, input.operationId);
          const config = await getSolutionConfig(ctx.db, op.solutionId);
          const { readable } = await callAccess(ctx, op, input.appId, user, config);
          const rows = await ctx.db
            .select()
            .from(records)
            .where(and(eq(records.operationId, input.operationId), eq(records.id, input.recordId)));
          if (rows.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `Record not found: ${input.recordId}` });
          }
          if (isAppRecord(rows[0]) || (readable !== null && !readable.has(rows[0].typeRef))) throw accessDenied();
          const r = rows[0];
          const { found, withheld } = await referencedRecords(ctx.db, input.operationId, config, readable, [r]);
          return {
            id: r.id, typeRef: r.typeRef, customFields: r.customFields, activityHistory: r.activityHistory,
            // What it points at, so the browser can follow a reference without
            // a round trip per field, and what it points at that this caller
            // may not read (see referencedRecords).
            references: found.map((x) => ({ id: x.id, typeRef: x.typeRef, customFields: x.customFields, activityHistory: x.activityHistory })),
            withheld,
          };
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
          appId: appIdInput,
          activityId: z.string().min(1),
          /** The record type the run is about (§2.3): the type whose workflow
           *  lists the activity — the record's, or the one a CREATE makes.
           *  Required through an app; checked when given otherwise. */
          typeId: z.string().min(1).optional(),
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
        }),
      )
      .mutation(async ({ ctx, input }): Promise<RunActivityResult> => {
        try {
          // Roles resolve per operation before the engine exists — the
          // availability gate may read context.user.roles.
          const user = await resolveUser(ctx, input.operationId);
          const host = await loadOperationHost(ctx.db, input.operationId, ctx.sink ?? consoleNotifySink, user);
          const { readable, app } = await callAccess(ctx, { id: input.operationId, orgId: host.orgId, solutionId: host.solutionId }, input.appId, user, host.config);
          if (app) host.useApp(app);

          const activity = findActivity(host, input.activityId);
          if (!activity) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `Activity not found: ${input.activityId}` });
          }
          // Check 3 (§2.3): through an app, the activity is on its list — and
          // its item may carry the app's own condition (check 6, below).
          let condition: string | undefined;
          if (app) {
            const list = await appListOf(ctx.db, host.solutionId, app.pageId, host.config);
            if (!list.ids.has(activity.id)) {
              throw new TRPCError({ code: 'FORBIDDEN', message: `'${activity.id}' is not on the list of '${app.label}'` });
            }
            condition = list.conditions.get(activity.id);
          }
          // Check 4: the call matches the model. Where an activity runs is the
          // model's to say — a record type whose workflow lists it, or, for one
          // no record type lists, the app's own record (step 5).
          const owners = typesListing(host.config, activity.id);
          const appsOwn = owners.length === 0;
          if (appsOwn) {
            assertAppsOwnCall(activity.id, app, input);
            // Its list allows only log-only activities and GETs (checked at
            // model save); an app never changes through a run (§2.4).
            if (activity.record_map !== undefined) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `'${activity.id}' is an app's own ${activity.record_map} — an app's own activities only log or read` });
            }
          } else {
            if (app && input.typeId === undefined) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `A run through an app names the record type it is about (typeId)` });
            }
            if (input.typeId !== undefined && !owners.includes(input.typeId)) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `'${activity.id}' is not in ${input.typeId}'s workflow` });
            }
            if (activity.record_map === 'CREATE' && input.recordId) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `'${input.activityId}' is a CREATE activity — recordId must not be supplied` });
            }
            if (activity.record_map !== 'CREATE' && !input.recordId) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `'${input.activityId}' needs a recordId to anchor on` });
            }
          }

          // One transaction for the run, open before its first read
          // (SERVER_DATA_LOADING §4.3): every write lands as it happens, and
          // every later read sees it. What commits is §4.2's list.
          await host.store.begin();
          let result: RunActivityResult;
          try {
            // An app's own activity runs on its app's record because the
            // server puts it there, never because the caller named it (§2.3).
            let anchorRecord = appsOwn ? await host.store.getRecord(app!.id) : null;
            if (input.recordId) {
              anchorRecord = await host.store.getRecord(input.recordId); // throws → BAD_REQUEST via rethrow
              // Unreadable anchor ⇒ access denied, checked BEFORE the run gate
              // (2026-10-12; not-found before). Reuses the already-loaded
              // config + resolved roles. An operation's app is never a run's
              // record (APPS_AND_INSTANCES §2.3).
              if (isAppRecord(anchorRecord) || (readable !== null && !readable.has(anchorRecord.typeRef))) throw accessDenied();
              // Check 4: the record is the type the call names — its stored
              // type, never the caller's word for it.
              if (input.typeId !== undefined && anchorRecord.typeRef !== input.typeId) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `The record is a ${anchorRecord.typeRef}, not a ${input.typeId}` });
              }
              // Only an activity that belongs to the record may run on it
              // (APPS_AND_INSTANCES §1.5, Part 2 step 1): the record's type's
              // workflow must list it. A shared activity runs on any type that
              // lists it. CREATE has no record here; a GET is a question, not an
              // act on its record. The DSL Editor runs through here too.
              if (activity.record_map !== 'GET') {
                const listed = host.store.getRecordTypeDef(anchorRecord.typeRef).workflow.activities;
                if (!listed.some((a) => a.id === activity.id)) {
                  throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `'${activity.id}' is not in ${anchorRecord.typeRef}'s workflow, so it cannot run on this record`,
                  });
                }
              }
            }

            // Check 5 (§2.3) covers what the run's reference fields send back:
            // a record the caller may not read is refused, as its anchor is.
            const canRead = (r: { typeRef: string }) => !isAppRecord(r) && (readable === null || readable.has(r.typeRef));
            const issues = await withSpan('validate', activity.id, () =>
              validateSubmission(host.engine, activity, input.attributes, anchorRecord, input.waived ?? {}, canRead));
            if (issues.length > 0) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: issues.map((i) => i.message).join(' · ') });
            }

            result = await withSpan('engine', activity.id, () =>
              host.engine.runActivity(activity, input.attributes, anchorRecord, {
                acknowledgedWarnings: input.acknowledgedWarnings,
                waived: input.waived,
                condition,
              }));
          } catch (err) {
            // A failing after hook has already rolled back to its savepoint;
            // the record map's change and the entry stand and commit
            // ("recorded, but no changes applied"). Anything else — the gate,
            // the before hook, a record deleted meanwhile, a database error —
            // leaves nothing written.
            if (err instanceof AfterHookFailedError && !host.store.fault) {
              await withSpan('write_back', activity.id, () => host.store.commit(), (counts) => ({ ...counts }));
              throw err;
            }
            await host.store.rollback();
            throw host.store.fault ?? err;
          }
          // needs-confirmation has written nothing, by doctrine — and a DELETE
          // awaiting its confirmation has deleted nothing.
          if (result.status !== 'done') {
            await host.store.rollback();
            return result;
          }
          await withSpan('write_back', activity.id, () => host.store.commit(), (counts) => ({ ...counts }));
          return result;
        } catch (err) {
          rethrow(err);
        }
      }),

    /**
     * The read path (DSL_SPEC §5a, DATA_THROUGH_ACTIVITIES step 1). A `query`,
     * not a mutation, because it is one: no record changes, so there is no
     * transaction and no confirmation round-trip. An app names a GET activity
     * and the model answers — the query itself never leaves the server.
     *
     * Authorisation is the activity's own gate, exactly as for a write: an
     * activity is the unit of access, and `show_condition` decides who may run
     * this one. Through an app (APPS_AND_INSTANCES step 4) the GET must also be
     * on the app's list or called by a listed activity's form, and the item's
     * condition must pass too. There is deliberately no second read filter
     * over the answer — a GET returns what its author declared it to return,
     * and its parameters are not read-checked.
     *
     * It is a query that writes one thing: the light entry the engine records
     * on the anchor (step 3), appended in one statement, including on the way
     * out of a failure — the read happened either way.
     */
    query: t.procedure
      .input(
        z.object({
          operationId: operationInput,
          appId: appIdInput,
          activityId: z.string().min(1),
          /** Anchor record — where the run's entry will land once GETs are
           *  logged. Optional until app records exist (step 3). */
          recordId: z.string().min(1).optional(),
          /** The GET's parameters, which are its attributes. Same transport
           *  and the same `validateSubmission` check as a write's payload. */
          attributes: z.record(z.string(), jsonValue).default({}),
        }),
      )
      .query(async ({ ctx, input }): Promise<QueryActivityResult> => {
        try {
          const user = await resolveUser(ctx, input.operationId);
          const host = await loadOperationHost(ctx.db, input.operationId, ctx.sink ?? consoleNotifySink, user);
          const { readable, app } = await callAccess(ctx, { id: input.operationId, orgId: host.orgId, solutionId: host.solutionId }, input.appId, user, host.config);
          if (app) host.useApp(app);

          const activity = findActivity(host, input.activityId);
          if (!activity) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `Activity not found: ${input.activityId}` });
          }
          if (activity.record_map !== 'GET') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `'${input.activityId}' is not a GET activity — run it through activities.run` });
          }
          // Through an app (§2.3, step 4). Check 3: the GET is on its list, or
          // a listed activity's form calls it. Check 6: an item's condition,
          // which applies whenever the GET is on the list, since the server
          // cannot tell a form's call from the page's.
          let condition: string | undefined;
          if (app) {
            const list = await appListOf(ctx.db, host.solutionId, app.pageId, host.config);
            if (!list.ids.has(activity.id) && !list.formGets.has(activity.id)) {
              throw new TRPCError({ code: 'FORBIDDEN', message: `'${activity.id}' is not on the list of '${app.label}'` });
            }
            condition = list.conditions.get(activity.id);
          }
          // Check 4: a GET in some record type's workflow names no type — with
          // no record, any type that lists it will do; the record it sends is
          // only where its entry lands. One in none is the app's own (step 5):
          // only through its app, naming no record, on the app's record, and
          // leaving no entry there (§2.4).
          const appsOwn = typesListing(host.config, activity.id).length === 0;
          if (appsOwn) assertAppsOwnCall(activity.id, app, input);

          // No transaction: a GET only reads, and its one write — the light
          // entry on its anchor — is a single statement at the end
          // (SERVER_DATA_LOADING §4.3), written whether the answer came or the
          // `returns` threw.
          let anchorRecord = appsOwn ? await host.store.getRecord(app!.id) : null;
          if (input.recordId) {
            anchorRecord = await host.store.getRecord(input.recordId);
            if (isAppRecord(anchorRecord) || (readable !== null && !readable.has(anchorRecord.typeRef))) throw accessDenied();
          }

          const issues = await withSpan('validate', activity.id, () =>
            validateSubmission(host.engine, activity, input.attributes, anchorRecord, {}));
          if (issues.length > 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: issues.map((i) => i.message).join(' · ') });
          }

          return await withSpan(
            'engine',
            activity.id,
            () => host.engine.runQuery(activity, input.attributes, anchorRecord, { condition, log: !appsOwn }),
            (r) => (Array.isArray(r.data) ? { rows: r.data.length } : undefined),
          );
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  /**
   * Ad-hoc FluxScript over an operation's records, read-only — the Console's
   * DSL Editor (packages/console/docs/DSL_EDITOR_SPEC.md).
   *
   * Why this is not a hole in the read rule: DATA_THROUGH_ACTIVITIES governs
   * the APPLICATION read path, where a query belongs in the model as a GET so
   * it can be authorised and logged. This is workbench-class admin inspection,
   * and the workbench is already outside that — the Console takes the whole
   * partition at connect to evaluate locally against it. Running the query
   * here is NARROWER: the browser gets the filtered subset instead of every
   * record. It is not logged (an ad-hoc query has no record to anchor an entry
   * to); that is accepted and recorded as debt against the unified log.
   *
   * Read-only is structural, not a validation pass: `readonlyRecords` removes
   * `records.mutate` from the host, so the capability is not on the object.
   * Static checking would not do — a model function's body is validated
   * separately, so a mutating function passes at the call site.
   */
  scripts: t.router({
    query: t.procedure
      .input(
        z.object({
          operationId: operationInput,
          /**
           * FluxScript: an expression or a query. Arbitrary text, deliberately.
           *
           * 4KB, not more: this is a tRPC **query**, so the input travels in the
           * URL (`?input=…`), and Node's default 16KB max header size counts
           * the request line. A longer script would die as an opaque transport
           * failure rather than a script error. Raising this means POSTing —
           * `methodOverride` on the client link — which changes transport for
           * every query in the app and is not worth it for a scratchpad.
           */
          source: z.string().min(1).max(4_000),
          /** Optional anchor, so `context.record` resolves. */
          recordId: z.string().min(1).optional(),
        }),
      )
      .query(async ({ ctx, input }): Promise<ScriptQueryResult> => {
        try {
          // A call with no app (APPS_AND_INSTANCES §2.3): an admin of the
          // operation, who reads every record in it — so a script reading every
          // type is theirs to run. Until 2026-10-18 the entry gate alone let any
          // user of the operation do it (DSL_EDITOR_SPEC §10, reversed).
          const user = await resolveUser(ctx, input.operationId);
          const host = await loadOperationHost(ctx.db, input.operationId, ctx.sink ?? consoleNotifySink, user);
          await requireNoAppCaller(ctx, { id: input.operationId, orgId: host.orgId });

          const started = Date.now();
          try {
            // Inside the try: a bad anchor id is the caller's typo, not a
            // transport failure, so it answers as a result like any other
            // script error rather than a thrown BAD_REQUEST.
            const anchorRecord = input.recordId ? await host.store.getRecord(input.recordId) : null;
            if (isAppRecord(anchorRecord)) {
              return { value: null, elapsedMs: Date.now() - started, error: { kind: 'runtime', message: 'Record access denied' } };
            }

            // No transaction: the script cannot write, and a GET reached
            // through `invoke` logs nothing of its own.
            const value = await host.engine.evaluateAsync(input.source, {
              anchorRecord,
              readonlyRecords: true,
              // The SDM answerable as `model.*` (docs/QUERYING_THE_MODEL.md).
              // Only here: no hook, page binding or datasource passes this, so
              // naming a model collection anywhere else fails as unknown.
              modelTypes: true,
              // `invoke` reaches GET activities only, so it stays read-only by
              // construction. Without it the built-in fails loudly, which would
              // make a documented capability silently absent.
              invoke: (activityId, params) => host.engine.invoke(activityId, params, anchorRecord),
              // Raised: an inspection tool, where 1s is too short to be
              // interactive and a script may pull back more than a hook
              // would. Hooks keep DEFAULT_QUOTAS.
              quotas: { maxRows: 100_000, maxSteps: 2_000_000, timeoutMs: 15_000 },
            });
            return {
              value: forWire(value),
              rowCount: Array.isArray(value) ? value.length : undefined,
              elapsedMs: Date.now() - started,
            };
          } catch (err) {
            return {
              value: null,
              elapsedMs: Date.now() - started,
              error: scriptError(err),
            };
          }
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // Performance logging (docs/PERFORMANCE_LOGGING.md) — the browser's span
  // intake, the switches, and the Platform app's dashboard queries.
  perf: perfRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Render a script's result for the wire.
 *
 * `JSON.stringify` turns a Date into a **UTC instant**, which is the wrong
 * representation for these values: what persists in a record is the raw ISO
 * string the user typed, and `date('2026-07-01')` parses at *local* midnight
 * (`evaluator.ts`, `bridge.ts`). On a server ahead of UTC that round-trips as
 * `2026-06-30T14:00:00.000Z` — the tool reporting the day before the one the
 * record holds, which is how a wrong conclusion gets drawn off a result set.
 *
 * So Dates go back as wall-clock text, the form they are stored and displayed
 * in everywhere else. A tRPC transformer would not have fixed this: it
 * preserves the Date and the browser then renders it in the *browser's* zone,
 * which moves the shift rather than removing it.
 *
 * `FkPointer` is a class, so it would serialise as a bare
 * `{ targetType, id }` and draw as raw JSON in a cell. Only the id is of use.
 */
export function forWire(value: unknown, depth = 0): unknown {
  // Records nest a couple of levels at most ({ id, type, fields }); the guard
  // is against a cycle a host value could carry, not against depth itself.
  if (depth > 12) return value;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return wallClock(value);
  if (value instanceof FkPointer) return value.id;
  if (Array.isArray(value)) return value.map((v) => forWire(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = forWire(v, depth + 1);
  }
  return out;
}

/** `YYYY-MM-DD` when the time is midnight, otherwise with the time — local
 *  fields, matching how the value was parsed. */
function wallClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return date;
  return `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Classify a thrown script failure for the editor.
 *
 * `engine.evaluate` PARSES as well as evaluates, so a syntax error lands here
 * too — the two must stay distinguishable, or a typo reads as "failed to run".
 * Both DSL error classes carry `line`/`col` as own fields (there is no
 * `position` object on either).
 *
 * Messages cross with their position suffix removed: the editor puts the error
 * on the line itself, so "(line 3, col 12)" repeated in the text is noise. Any
 * error that is neither DSL class is something internal — its text is not
 * forwarded, only that the script failed.
 */
function scriptError(err: unknown): NonNullable<ScriptQueryResult['error']> {
  const e = err as { name?: string; message?: string; line?: number; col?: number };
  const dsl = e?.name === 'FluxSyntaxError' || e?.name === 'FluxRuntimeError' || e?.name === 'FluxFailError';
  if (!dsl) {
    return { kind: 'runtime', message: 'The script could not be run.' };
  }
  return {
    kind: e.name === 'FluxSyntaxError' ? 'compile' : 'runtime',
    message: (e.message ?? 'Script failed').replace(/\s*\(line \d+, col \d+\)$/, ''),
    line: e.line,
    col: e.col,
  };
}

/**
 * What `scripts.query` answers with. A failed script is a RESULT, not a thrown
 * error: the editor shows the message against the source, and a tRPC error
 * would lose the position and read as a transport failure.
 */
export interface ScriptQueryResult {
  /** The expression's value, as JSON. Null when the script failed. Dates are
   *  wall-clock text and FkPointers are their ids — see `forWire`. */
  value: unknown;
  /** Present when the value is a list. */
  rowCount?: number;
  elapsedMs: number;
  error?: {
    /** `engine.evaluate` parses as well as evaluates, so both kinds arise
     *  here: 'compile' is a FluxSyntaxError, 'runtime' anything after it. */
    kind: 'compile' | 'runtime';
    message: string;
    line?: number;
    col?: number;
  };
}
