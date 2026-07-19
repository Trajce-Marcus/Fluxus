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
  OperationNotFoundError,
  SolutionNotFoundError,
  createOperation,
  deletePage,
  findActivity,
  getOperation,
  getSolutionConfig,
  getPageVersion,
  insertPendingAttachment,
  listImplementerLevels,
  listOperations,
  listPageVersions,
  listPages,
  listPublishedPages,
  listRoleAssignments,
  listSolutions,
  loadOperationHost,
  pageOpenable,
  publishPage,
  rollbackPage,
  putConfig,
  putImplementerLevel,
  putOperationConfig,
  putPage,
  putRoleAssignment,
  usedStorageBytes,
  validateOperationMenu,
  writeBack,
} from './host';
import type { NotifySink } from './services/notify';
import { consoleNotifySink } from './services/notify';
import { stubRolesResolver, type AuthUser, type RolesResolver } from './auth';
import { ENV_FUSE_BYTES, PLATFORM_MAX_BYTES, makeStorageKey, type BlobStore } from './services/blob';
import type { MenuItem, OperationConfig } from './db/schema';

/** The single demo bundle keeps one id as both its solution and its operation. */
export const DEFAULT_SOLUTION = 'demo/sdm';
export const DEFAULT_OPERATION = 'demo/sdm';

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
  const roles = ctx.roles ?? stubRolesResolver;
  return { ...user, roles: await roles.runtimeRoles(user.id, operationId) };
}

/**
 * Console-plane check (implementer level) for config/page writes — keyed on the
 * solution (the implementer plane attaches to the design artifact). The stub
 * resolver answers 'admin', so this is open until RBAC stage 2 fills the seam.
 */
const IMPLEMENTER_RANK = { none: 0, read: 1, write: 2, admin: 3 } as const;
async function requireImplementer(ctx: AppContext, solutionId: string, level: 'read' | 'write' | 'admin'): Promise<void> {
  // Env stub (no auth) ⇒ implementer plane open, matching "no auth ⇒ everything
  // open" (§7). Enforced only when auth is configured (RBAC stage 2 / M5).
  if (!ctx.authConfigured) return;
  const user = ctx.user ?? DEMO_USER;
  const roles = ctx.roles ?? stubRolesResolver;
  const held = await roles.implementerLevel(user.id, solutionId);
  if (IMPLEMENTER_RANK[held] < IMPLEMENTER_RANK[level]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires implementer '${level}' on this solution` });
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

// Menu shape (schema §5) — validated on operations.putConfig. Deeper validation
// (page paths resolve to published versions; role ids exist) lands with M4.
const menuItemSchema: z.ZodType<MenuItem> = z.lazy(() =>
  z.object({
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
  if (err instanceof OperationNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
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
  me: t.procedure
    .input(z.object({ operationId: operationInput }).default({}))
    .query(async ({ ctx, input }) => {
      const u = await resolveUser(ctx, input.operationId);
      return { id: u.id, name: u.name, email: u.email, roles: u.roles ?? [], authConfigured: ctx.authConfigured === true };
    }),

  solutions: t.router({
    list: t.procedure.query(async ({ ctx }) => listSolutions(ctx.db)),
  }),

  operations: t.router({
    list: t.procedure.query(async ({ ctx }) => listOperations(ctx.db)),
    get: t.procedure
      .input(z.object({ operationId: operationInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          return await getOperation(ctx.db, input.operationId);
        } catch (err) {
          rethrow(err);
        }
      }),
    create: t.procedure
      .input(z.object({ id: z.string().min(1), solutionId: z.string().min(1), name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          // Creating an operation is org-admin work; gate on the linked
          // solution's implementer plane (stub-open until stage 2).
          await requireImplementer(ctx, input.solutionId, 'admin');
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
          // Menu/runtime-config editing = implementer write on the solution
          // (spec §3, ruled 2026-07-20).
          await requireImplementer(ctx, op.solutionId, 'write');
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

  // Governance admin (CONSOLE_RUNTIME_SPEC §2a/§3, RBAC_COMPACT): user→role
  // assignments (per operation) and implementer levels (per solution). Both
  // require implementer `admin`, checked on the solution. `roles` reads the
  // linked solution's declared role defs, for the assignment picker.
  assignments: t.router({
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
          await requireImplementer(ctx, op.solutionId, 'admin');
          return await listRoleAssignments(ctx.db, input.operationId);
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ operationId: operationInput, userId: z.string().min(1), roleIds: z.array(z.string().min(1)) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const op = await getOperation(ctx.db, input.operationId);
          await requireImplementer(ctx, op.solutionId, 'admin');
          await putRoleAssignment(ctx.db, input);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  implementers: t.router({
    list: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          await requireImplementer(ctx, input.solutionId, 'admin');
          return await listImplementerLevels(ctx.db, input.solutionId);
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ solutionId: solutionInput, userId: z.string().min(1), level: z.enum(['read', 'write', 'admin']) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireImplementer(ctx, input.solutionId, 'admin');
          await putImplementerLevel(ctx.db, input);
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
          await requireImplementer(ctx, input.solutionId, 'write');
          await putConfig(ctx.db, input.solutionId, input.config as ConfigRaw, ctx.sink);
          return { ok: true as const };
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
        await requireImplementer(ctx, input.solutionId, 'write');
        await putPage(ctx.db, input.solutionId, input.path, input.def ?? {});
        return { ok: true as const };
      }),
    delete: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requireImplementer(ctx, input.solutionId, 'write');
        await deletePage(ctx.db, input.solutionId, input.path);
        return { ok: true as const };
      }),
    // Publish snapshots the current draft def at max(version)+1 with release
    // notes. Append-only — rollback republishes an older def as a new version.
    publish: t.procedure
      .input(z.object({ solutionId: solutionInput, path: z.string().min(1), readme: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireImplementer(ctx, input.solutionId, 'write');
          const publishedBy = ctx.user?.id ?? DEMO_USER.id;
          return await publishPage(ctx.db, input.solutionId, input.path, input.readme, publishedBy);
        } catch (err) {
          rethrow(err);
        }
      }),
    // Every published page path (unfiltered) — the implementer/authoring plane
    // (menu editor, §5). Console preview is access-exempt (§6). Implementer read.
    publishedPaths: t.procedure
      .input(z.object({ solutionId: solutionInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          await requireImplementer(ctx, input.solutionId, 'read');
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
          await requireImplementer(ctx, input.solutionId, 'write');
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
