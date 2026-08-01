// @fluxus/client — how a browser host talks to @fluxus/server (backend
// stage 2). One connect call fetches the scope's config + record partition
// (+ page definitions) into the engine's MemoryAdapter, so every UI read and FluxScript expression
// keeps evaluating synchronously against a local snapshot; every mutation is
// an `activities.run` round trip followed by a partition re-fetch. The
// adapter identity never changes — hosts wire their engine and subscriptions
// to it once and refresh flows through Store.subscribe.

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { MemoryAdapter } from '@fluxus/engine';
import type { ConfigRaw, RecordInstance, RunActivityResult } from '@fluxus/engine';
import type { AppRouter } from '@fluxus/server';
import { runUpload, type Descriptor, type PresignRequest, type Presigned, type UploadService } from './upload';

export type {
  Descriptor,
  FileDescriptor,
  PhotoDescriptor,
  PresignRequest,
  Presigned,
  UploadService,
  Exif,
} from './upload';
export { sha256Hex, readExif, dmsToDecimal, runUpload } from './upload';
export { createHostAuth } from './auth';
export type { AuthSession, HostAuth } from './auth';

function createTrpc(url: string, getToken?: () => Promise<string | null>) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url,
        // Bearer JWT on every call (RBAC_DESIGN §0.1) — resolved per request
        // because session tokens are short-lived. No token → no header; the
        // unconfigured server ignores it, the configured one rejects.
        headers: async () => {
          const token = await getToken?.();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
type Trpc = ReturnType<typeof createTrpc>;

export interface ConnectOptions {
  /** tRPC endpoint, e.g. http://localhost:8787/trpc (the dev server default). */
  url?: string;
  /**
   * The operation to run. connect() resolves it to its linked solution: config
   * + pages load by solutionId, the record partition by operationId.
   */
  operationId?: string;
  /**
   * Which page set to snapshot (CONSOLE_RUNTIME_SPEC §3): `published` (Runtime —
   * latest version per path) or `draft` (Console — editable rows). Default
   * `draft` (the page builder's preview posture).
   */
  pages?: 'draft' | 'published';
  /**
   * Session-token supplier — typically HostAuth.getToken. Called per request
   * (tokens expire in minutes); omit when auth is unconfigured.
   */
  getToken?: () => Promise<string | null>;
}

export const DEFAULT_URL = 'http://localhost:8787/trpc';
/** The demo bundle keeps one id as both its operation and its solution. */
export const DEFAULT_OPERATION = 'demo/sdm';

/** operations.config menu (server schema §5) — snapshotted at connect. */
export interface MenuItem {
  /** Stable identity, independent of the label (2026-08-01) — the Console's
   *  menu editor selects and reorders by it. Optional: older menus lack it. */
  id?: string;
  label: string;
  page?: string;
  roles?: string[];
  items?: MenuItem[];
}
export interface OperationConfig {
  menu?: MenuItem[];
}
export interface OperationRow {
  id: string;
  orgId: string;
  /** Binding and permanent — an operation is never re-pointed at another
   *  solution (ruled 2026-07-27). There is deliberately no write path. */
  solutionId: string;
  name: string;
  config: OperationConfig;
}

/** The org's profile — Console's Organisation → Settings surface (M14).
 *  `createdAt` is the registration date; `plan` is the subscribed tier. */
export interface OrgProfile {
  id: string;
  name: string;
  contactEmail: string | null;
  plan: string;
  status: string;
  createdAt: string | null;
}

/**
 * The Console-plane client (CONSOLE_RUNTIME_SPEC §8): the cross-operation
 * admin surface the page builder drives — solutions/operations CRUD and (as
 * later milestones land) publish, versions, and governance. Distinct from
 * FluxusClient, which binds to a single operation's data snapshot. Both share
 * the bearer-token transport.
 */
export class ConsoleClient {
  private constructor(private readonly trpc: Trpc) {}

  static create(options: { url?: string; getToken?: () => Promise<string | null> } = {}): ConsoleClient {
    return new ConsoleClient(createTrpc(options.url ?? DEFAULT_URL, options.getToken));
  }

  // The org tier (M14): Console's Organisation → Settings surface. Reads and
  // profile edits only — no create (registration waits on user → org
  // resolution), no plan/status writes (ours to set, not the org's).
  getOrg(orgId?: string): Promise<OrgProfile> {
    return this.trpc.orgs.get.query(orgId ? { orgId } : {}) as Promise<OrgProfile>;
  }
  putOrgProfile(input: { orgId?: string; name: string; contactEmail: string | null }): Promise<{ ok: true }> {
    return this.trpc.orgs.putProfile.mutate(input);
  }

  listSolutions(): Promise<{ id: string; name: string; origin: string }[]> {
    return this.trpc.solutions.list.query();
  }
  createSolution(input: { id: string; name: string }): Promise<{ ok: true }> {
    return this.trpc.solutions.create.mutate(input);
  }
  /** Edit a solution's profile — name only; the id is permanent. */
  updateSolution(input: { solutionId: string; name: string }): Promise<{ ok: true }> {
    return this.trpc.solutions.update.mutate(input);
  }
  /** Delete a solution and everything under it. The server side is a TODO —
   *  this currently fails with NOT_IMPLEMENTED and destroys nothing. */
  deleteSolution(solutionId: string): Promise<{ ok: true }> {
    return this.trpc.solutions.delete.mutate({ solutionId });
  }
  listOperations(): Promise<OperationRow[]> {
    return this.trpc.operations.list.query() as Promise<OperationRow[]>;
  }
  getOperation(operationId: string): Promise<OperationRow> {
    return this.trpc.operations.get.query({ operationId }) as Promise<OperationRow>;
  }
  createOperation(input: { id: string; solutionId: string; name: string }): Promise<{ ok: true }> {
    return this.trpc.operations.create.mutate(input);
  }
  putOperationConfig(operationId: string, config: OperationConfig): Promise<{ ok: true }> {
    return this.trpc.operations.putConfig.mutate({ operationId, config });
  }
  /** The solution's stored config artifact (opaque here) — MenuAdmin reads
   *  `default_menu` off it to show what an operation inherits (M10). */
  getSolutionConfig(solutionId: string): Promise<unknown> {
    return this.trpc.config.get.query({ solutionId });
  }

  // Governance (RBAC stage 1): user→role assignments per operation, implementer
  // levels per solution. All admin-gated server-side.
  operationRoles(operationId: string): Promise<{ id: string; name: string }[]> {
    return this.trpc.assignments.roles.query({ operationId });
  }
  listAssignments(operationId: string): Promise<{ userId: string; roleIds: string[] }[]> {
    return this.trpc.assignments.list.query({ operationId });
  }
  putAssignment(operationId: string, userId: string, roleIds: string[]): Promise<{ ok: true }> {
    return this.trpc.assignments.put.mutate({ operationId, userId, roleIds });
  }
  listImplementers(solutionId: string): Promise<{ userId: string; level: 'read' | 'write' | 'admin' }[]> {
    return this.trpc.implementers.list.query({ solutionId });
  }
  putImplementer(solutionId: string, userId: string, level: 'read' | 'write' | 'admin'): Promise<{ ok: true }> {
    return this.trpc.implementers.put.mutate({ solutionId, userId, level });
  }

  // Page publishing (M3): snapshot the current draft as a new version; list the
  // history; fetch a version's def (the rollback source — republish it).
  publishPage(solutionId: string, path: string, readme: string): Promise<{ version: number }> {
    return this.trpc.pages.publish.mutate({ solutionId, path, readme });
  }
  listPublishedPaths(solutionId: string): Promise<string[]> {
    return this.trpc.pages.publishedPaths.query({ solutionId });
  }
  listPageVersions(solutionId: string, path: string): Promise<{ version: number; readme: string; publishedBy: string; publishedAt: string }[]> {
    return this.trpc.pages.versions.query({ solutionId, path }) as Promise<{ version: number; readme: string; publishedBy: string; publishedAt: string }[]>;
  }
  getPageVersion(solutionId: string, path: string, version: number): Promise<{ def: unknown }> {
    return this.trpc.pages.getVersion.query({ solutionId, path, version }) as Promise<{ def: unknown }>;
  }
  rollbackPage(solutionId: string, path: string, version: number): Promise<{ version: number }> {
    return this.trpc.pages.rollback.mutate({ solutionId, path, version });
  }
}

export interface RunInput {
  activityId: string;
  /** Anchor record id — omit for CREATE activities. */
  recordId?: string;
  /**
   * Attribute payload. Scalars are strings as the capture form submits;
   * file/photo attributes carry descriptor objects and multi values arrays —
   * arbitrary JSON, typed server-side by validateSubmission.
   */
  attributes?: Record<string, unknown>;
  waived?: Record<string, string>;
  acknowledgedWarnings?: boolean;
  callbackData?: unknown;
}

export class FluxusClient {
  private constructor(
    private readonly trpc: Trpc,
    /** The operation this client runs; its record partition key. */
    readonly operationId: string,
    /** The operation's linked solution; the config + pages key. */
    readonly solutionId: string,
    readonly config: ConfigRaw,
    readonly adapter: MemoryAdapter,
    /**
     * Page definitions (path → def), snapshotted at connect like the record
     * partition. Defs are opaque here — PageDef and its validation belong to
     * the page builder. savePage/deletePage mutate this map optimistically
     * before the server round trip, so hosts keep synchronous reads.
     */
    readonly pages: Map<string, unknown>,
    /**
     * The effective runtime menu (spec §5, amended M10): the operation's
     * override when its config sets `menu`, else the solution's `default_menu`,
     * else []. Whole-menu semantics — never a per-item merge.
     */
    readonly menu: MenuItem[],
    /**
     * Display names for the Runtime header (M10, extended M13). The three
     * together are the app's identity line: the **org** is the tenant the user
     * works for, the **solution** is the app they are in (solution branding,
     * not platform branding), the **operation** is which business unit's data
     * it is running on.
     */
    readonly orgName: string,
    readonly solutionName: string,
    readonly operationName: string,
    /**
     * The caller's role ids in this operation, and whether RBAC is enforced
     * (auth configured). Hosts use these for cosmetic menu filtering; the
     * server is the real gate. When not enforced, menus show unfiltered (§7).
     */
    readonly userRoles: string[],
    readonly enforced: boolean,
  ) {}

  /**
   * Design-plane connect (CONSOLE_RUNTIME_SPEC §3): bind to a solution to author
   * its model + draft pages. `operationId` names which of the solution's
   * operations supplies the records you build against — the model and pages are
   * solution-scoped, the data is one operation's (ruled 2026-07-26).
   *
   * Passing no operation is still legal (a solution with none yet) and yields an
   * empty record set, but it is the exception, not the design: authoring a hook
   * script, a datasource filter or a list column without data is guesswork, and
   * Console showing an empty table where the workbench shows four records was
   * the platform contradicting itself.
   */
  static async connectSolution(options: {
    url?: string;
    solutionId: string;
    operationId?: string;
    getToken?: () => Promise<string | null>;
  }): Promise<FluxusClient> {
    const trpc = createTrpc(options.url ?? DEFAULT_URL, options.getToken);
    const { solutionId, operationId } = options;
    // pages.list is the reachability probe (it never throws for an existing
    // solution); config.get throws SolutionNotFoundError for a solution that
    // has no config row yet — a freshly created solution the user is opening to
    // author. Fall back to an empty model skeleton so the SDM editor starts
    // blank and the first save (config.put) creates the row.
    const [pageRows, config, partition] = await Promise.all([
      trpc.pages.list.query({ solutionId, published: false }),
      (trpc.config.get.query({ solutionId }) as Promise<ConfigRaw>).catch(
        () => ({ attributes: [], recordTypes: [], workflows: [] }) as ConfigRaw,
      ),
      operationId
        ? (trpc.records.partition.query({ operationId }) as Promise<RecordInstance[]>)
        : Promise.resolve([] as RecordInstance[]),
    ]);
    const adapter = new MemoryAdapter(config, {
      initialRecords: partition.map((r) => [r.id, r] as const),
    });
    const pages = new Map(pageRows.map((p) => [p.path, p.def]));
    // enforced=false: Console is the implementer plane, menus/roles are not
    // filtered here. With an operation bound, runActivity/refresh work exactly
    // as in the Runtime host — running an activity is how you test a workflow.
    // Display names are Runtime chrome; Console shows the solution banner it
    // already has, so the ids stand in.
    return new FluxusClient(trpc, operationId ?? solutionId, solutionId, config, adapter, pages, [], '', solutionId, operationId ?? '', [], false);
  }

  /** The operations running a given solution — Console's data picker (which
   *  operation am I building against). */
  static async operationsForSolution(options: { url?: string; solutionId: string; getToken?: () => Promise<string | null> }): Promise<{ id: string; name: string }[]> {
    const trpc = createTrpc(options.url ?? DEFAULT_URL, options.getToken);
    const rows = await trpc.operations.list.query();
    return rows.filter((o) => o.solutionId === options.solutionId).map((o) => ({ id: o.id, name: o.name }));
  }

  /** Persist the solution's SDM config (Console SDM editor → config.put). The
   *  caller reconnects afterwards to rebuild the adapter/pageRuntime. */
  async saveConfig(config: ConfigRaw): Promise<void> {
    await this.trpc.config.put.mutate({ solutionId: this.solutionId, config });
  }

  /**
   * Model history (ruled 2026-07-26) — the same publish surface pages have had
   * since M3, and what replaces git as the record of model change now that the
   * database is the source of truth. Append-only: rollback republishes.
   */
  async publishConfig(readme: string): Promise<{ version: number }> {
    return this.trpc.config.publish.mutate({ solutionId: this.solutionId, readme });
  }

  async configVersions(): Promise<{ version: number; readme: string; publishedBy: string; publishedAt: string }[]> {
    return this.trpc.config.versions.query({ solutionId: this.solutionId }) as Promise<{ version: number; readme: string; publishedBy: string; publishedAt: string }[]>;
  }

  /** Restore an older version as the draft and record it as a new version. */
  async rollbackConfig(version: number): Promise<{ version: number }> {
    return this.trpc.config.rollback.mutate({ solutionId: this.solutionId, version });
  }

  /**
   * Resolve the operation to its solution, then fetch config + page set (by
   * solution) and the record partition (by operation) and build the local
   * snapshot. Throws (with the server's message) when the server is
   * unreachable or the operation/solution is missing — hosts surface that as
   * their boot error; there is no localStorage fallback by ruling.
   */
  static async connect(options: ConnectOptions = {}): Promise<FluxusClient> {
    const trpc = createTrpc(options.url ?? DEFAULT_URL, options.getToken);
    const operationId = options.operationId ?? DEFAULT_OPERATION;
    const op = await trpc.operations.get.query({ operationId });
    const solutionId = op.solutionId;
    const published = options.pages === 'published';
    const [config, partition, pageRows, me] = await Promise.all([
      trpc.config.get.query({ solutionId }) as Promise<ConfigRaw>,
      trpc.records.partition.query({ operationId }) as Promise<RecordInstance[]>,
      // operationId lets published mode filter pages to those openable to the
      // caller (page access control, §6).
      trpc.pages.list.query({ solutionId, operationId, published }),
      trpc.me.query({ operationId }),
    ]);
    const adapter = new MemoryAdapter(config, {
      initialRecords: partition.map((r) => [r.id, r] as const),
    });
    const pages = new Map(pageRows.map((p) => [p.path, p.def]));
    // Effective menu (§5, M10): operation override ?? solution default ?? [].
    // `menu` absent on the operation means inherit; `[]` is an explicit empty
    // override. The engine is menu-blind, so default_menu is read off the raw
    // config here, not via ConfigRaw.
    const menu =
      (op.config as { menu?: MenuItem[] }).menu ??
      (config as { default_menu?: MenuItem[] }).default_menu ??
      [];
    const solutionName = (op as { solutionName?: string }).solutionName ?? solutionId;
    const orgName = (op as { orgName?: string }).orgName ?? op.orgId;
    return new FluxusClient(trpc, operationId, solutionId, config, adapter, pages, menu, orgName, solutionName, op.name, me.roles, me.authConfigured);
  }

  /**
   * The menu filtered to what the caller may see (spec §5, cosmetic): deny by
   * default — an item is visible iff the user holds ≥1 listed role; a group
   * also needs ≥1 visible child. When RBAC is not enforced (env stub) the menu
   * shows unfiltered (§7). Server-side page filtering is the real gate.
   */
  visibleMenu(): MenuItem[] {
    const held = new Set(this.userRoles);
    const filter = (items: MenuItem[]): MenuItem[] =>
      items
        .map((it) => (it.items ? { ...it, items: filter(it.items) } : it))
        .filter((it) => {
          if (!this.enforced) return true;
          const selfOk = (it.roles ?? []).some((r) => held.has(r));
          return it.items ? selfOk && it.items.length > 0 : selfOk;
        });
    return filter(this.menu);
  }

  /** Upsert a page: local snapshot first (sync readers), then the server. */
  async savePage(path: string, def: unknown): Promise<void> {
    this.pages.set(path, def);
    await this.trpc.pages.put.mutate({ solutionId: this.solutionId, path, def });
  }

  async deletePage(path: string): Promise<void> {
    this.pages.delete(path);
    await this.trpc.pages.delete.mutate({ solutionId: this.solutionId, path });
  }

  /**
   * The upload surface capture widgets inject (ATTRIBUTE_TYPES_FILES_SCALARS
   * §10): `upload` runs the full hash → EXIF → thumbnail → presign → direct-
   * to-R2 PUT flow and resolves to a stored descriptor; `resolveUrl` presigns a
   * GET for display. Scope is bound here so widgets stay scope-blind.
   */
  get uploads(): UploadService {
    const presign = (req: PresignRequest): Promise<Presigned> =>
      this.trpc.files.presignUpload.mutate({ solutionId: this.solutionId, ...req }) as Promise<Presigned>;
    return {
      upload: (attributeKey, file, onProgress) => runUpload(attributeKey, file, presign, onProgress),
      resolveUrl: async (storageKey) =>
        (await this.trpc.files.presignGet.query({ solutionId: this.solutionId, key: storageKey })).url,
    };
  }

  /** Re-fetch the partition into the same adapter; subscribers re-render. */
  async refresh(): Promise<void> {
    const partition = (await this.trpc.records.partition.query({ operationId: this.operationId })) as RecordInstance[];
    this.adapter.replaceRecords(partition.map((r) => [r.id, r] as const));
  }

  /**
   * Run an activity server-side (hooks + persistence live there only), then
   * refresh the snapshot. Refresh happens even when the run throws: a failing
   * after hook persists the entry by doctrine ("recorded, but no changes
   * applied"), so the snapshot must pick it up.
   */
  async runActivity(input: RunInput): Promise<RunActivityResult> {
    try {
      return (await this.trpc.activities.run.mutate({
        operationId: this.operationId,
        activityId: input.activityId,
        recordId: input.recordId,
        attributes: input.attributes ?? {},
        waived: input.waived,
        acknowledgedWarnings: input.acknowledgedWarnings,
        callbackData: input.callbackData,
      })) as RunActivityResult;
    } finally {
      await this.refresh();
    }
  }
}
