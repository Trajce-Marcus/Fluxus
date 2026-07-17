// Activities as the API surface (DSL Phase 4): no GET/POST design, just
// functions called by name — pages and headless callers hit the same three
// groups. `activities.run` is the third front door on the one pipeline: the
// activity's attribute list is its parameter signature, its datasources double
// as validation (validateSubmission), and the availability gate + hooks are
// enforced inside runActivity exactly as for the browser hosts.

import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { validateSubmission, type ConfigRaw, type RunActivityResult } from '@fluxus/engine';
import type { Db } from './db/client';
import { records } from './db/schema';
import {
  ConfigValidationError,
  ScopeNotFoundError,
  deletePage,
  findActivity,
  getScopeConfig,
  listPages,
  loadScopeHost,
  putConfig,
  putPage,
  writeBack,
} from './host';
import type { NotifySink } from './services/notify';
import { consoleNotifySink } from './services/notify';

/** Scope is an opaque path string — org-defined levels arrive as data later. */
export const DEFAULT_SCOPE = 'demo/sdm';

export interface AppContext {
  db: Db;
  sink?: NotifySink;
}

const t = initTRPC.context<AppContext>().create();

const scopeInput = z.string().min(1).default(DEFAULT_SCOPE);

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
        await putPage(ctx.db, input.scope, input.path, input.def ?? {});
        return { ok: true as const };
      }),
    delete: t.procedure
      .input(z.object({ scope: scopeInput, path: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await deletePage(ctx.db, input.scope, input.path);
        return { ok: true as const };
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
          /** Attribute payload — string values, exactly as the capture form
           *  submits. A composite attribute's cells may come flat under dotted
           *  keys ('access_permission.ok') or nested (attr → sub). */
          attributes: z
            .record(z.string(), z.union([z.string(), z.record(z.string(), z.string())]))
            .default({}),
          waived: z.record(z.string(), z.string()).optional(),
          acknowledgedWarnings: z.boolean().optional(),
          callbackData: z.unknown().optional(),
        }),
      )
      .mutation(async ({ ctx, input }): Promise<RunActivityResult> => {
        try {
          const host = await loadScopeHost(ctx.db, input.scope, ctx.sink ?? consoleNotifySink);

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
