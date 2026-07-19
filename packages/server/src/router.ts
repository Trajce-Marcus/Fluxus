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
  ScopeNotFoundError,
  deletePage,
  findActivity,
  getScopeConfig,
  insertPendingAttachment,
  listPages,
  loadScopeHost,
  putConfig,
  putPage,
  usedStorageBytes,
  writeBack,
} from './host';
import type { NotifySink } from './services/notify';
import { consoleNotifySink } from './services/notify';
import { stubRolesResolver, type AuthUser, type RolesResolver } from './auth';
import { ENV_FUSE_BYTES, PLATFORM_MAX_BYTES, makeStorageKey, type BlobStore } from './services/blob';

/** Scope is an opaque path string — org-defined levels arrive as data later. */
export const DEFAULT_SCOPE = 'demo/sdm';

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
}

/**
 * Runtime-plane identity for one call: the verified user with `roles`
 * resolved for the operation (stand-in: the scope key). What the engine sees
 * as `context.user` and entries record as `author`.
 */
async function resolveUser(ctx: AppContext, operation: string) {
  const user = ctx.user ?? DEMO_USER;
  const roles = ctx.roles ?? stubRolesResolver;
  return { ...user, roles: await roles.runtimeRoles(user.id, operation) };
}

/**
 * Console-plane check (implementer level) for config/page writes. The stub
 * resolver answers 'admin' — open until RBAC stage 2 fills the seam.
 */
async function requireImplementer(ctx: AppContext, operation: string, level: 'write' | 'admin'): Promise<void> {
  const user = ctx.user ?? DEMO_USER;
  const roles = ctx.roles ?? stubRolesResolver;
  const held = await roles.implementerLevel(user.id, operation);
  const ok = held === 'admin' || (level === 'write' && held === 'write');
  if (!ok) throw new TRPCError({ code: 'FORBIDDEN', message: `Requires implementer '${level}' on this solution` });
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

const scopeInput = z.string().min(1).default(DEFAULT_SCOPE);

/** Arbitrary JSON — the activity payload's transport; the engine types it. */
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

function rethrow(err: unknown): never {
  if (err instanceof ScopeNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
  if (err instanceof ConfigValidationError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  if (err instanceof TRPCError) throw err;
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: err instanceof Error ? err.message : String(err),
  });
}

export const appRouter = t.router({
  config: t.router({
    get: t.procedure
      .input(z.object({ scope: scopeInput }).default({}))
      .query(async ({ ctx, input }) => {
        try {
          return await getScopeConfig(ctx.db, input.scope);
        } catch (err) {
          rethrow(err);
        }
      }),
    put: t.procedure
      .input(z.object({ scope: scopeInput, config: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await requireImplementer(ctx, input.scope, 'write');
          await putConfig(ctx.db, input.scope, input.config as ConfigRaw, ctx.sink);
          return { ok: true as const };
        } catch (err) {
          rethrow(err);
        }
      }),
  }),

  // Page definitions on the config pipeline: defs are opaque jsonb (PageDef +
  // validatePage live in the page builder), list returns the scope's full set
  // (a host snapshots pages at connect exactly like the record partition).
  pages: t.router({
    list: t.procedure
      .input(z.object({ scope: scopeInput }).default({}))
      .query(async ({ ctx, input }) => listPages(ctx.db, input.scope)),
    put: t.procedure
      .input(z.object({ scope: scopeInput, path: z.string().min(1), def: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        await requireImplementer(ctx, input.scope, 'write');
        await putPage(ctx.db, input.scope, input.path, input.def ?? {});
        return { ok: true as const };
      }),
    delete: t.procedure
      .input(z.object({ scope: scopeInput, path: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requireImplementer(ctx, input.scope, 'write');
        await deletePage(ctx.db, input.scope, input.path);
        return { ok: true as const };
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
          scope: scopeInput,
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
          const config = await getScopeConfig(ctx.db, input.scope);
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
      .input(z.object({ scope: scopeInput, key: z.string().min(1) }))
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
      .input(z.object({ scope: scopeInput }).default({}))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db.select().from(records).where(eq(records.scope, input.scope));
        return rows.map((r) => ({
          id: r.id,
          typeRef: r.typeRef,
          customFields: r.customFields,
          activityHistory: r.activityHistory,
        }));
      }),
    list: t.procedure
      .input(z.object({ scope: scopeInput, typeId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(records)
          .where(and(eq(records.scope, input.scope), eq(records.typeRef, input.typeId)));
        return rows.map((r) => ({
          id: r.id,
          typeRef: r.typeRef,
          customFields: r.customFields,
          activityHistory: r.activityHistory,
        }));
      }),
    get: t.procedure
      .input(z.object({ scope: scopeInput, recordId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(records)
          .where(and(eq(records.scope, input.scope), eq(records.id, input.recordId)));
        if (rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Record not found: ${input.recordId}` });
        }
        const r = rows[0];
        return { id: r.id, typeRef: r.typeRef, customFields: r.customFields, activityHistory: r.activityHistory };
      }),
  }),

  activities: t.router({
    run: t.procedure
      .input(
        z.object({
          scope: scopeInput,
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
          const user = await resolveUser(ctx, input.scope);
          const host = await loadScopeHost(ctx.db, input.scope, ctx.sink ?? consoleNotifySink, user);

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
