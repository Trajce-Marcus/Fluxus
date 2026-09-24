// @fluxus/client — how a browser host talks to @fluxus/server (backend
// stage 2). One connect call fetches the scope's config + record partition
// (+ page definitions) into the engine's MemoryAdapter, so every UI read and FluxScript expression
// keeps evaluating synchronously against a local snapshot; every mutation is
// an `activities.run` round trip followed by a partition re-fetch. The
// adapter identity never changes — hosts wire their engine and subscriptions
// to it once and refresh flows through Store.subscribe.

import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { MemoryAdapter } from '@fluxus/engine';
import type {
  AttributeDef,
  ClientSolutionConfig,
  FunctionDef,
  QueryActivityResult,
  RecordInstance,
  RecordTypeDef,
  RoleDef,
  RunActivityResult,
  SolutionConfig,
  WorkflowRawDef,
} from '@fluxus/engine';
import type { AppRouter, ScriptQueryResult } from '@fluxus/server';
import { runUpload, type Descriptor, type PresignRequest, type Presigned, type UploadService } from './upload';
import { BrowserPerf, perfLink, type PageOpenHandle } from './perf';

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
export type { ScriptQueryResult } from '@fluxus/server';
export type { PageOpenHandle } from './perf';
export { createHostAuth } from './auth';
export type { AuthSession, HostAuth } from './auth';

// One BrowserPerf per client, kept beside it rather than on it so the client's
// inferred type stays the plain tRPC one every class here already depends on.
const perfOf = new WeakMap<object, BrowserPerf>();

function createTrpc(url: string, getToken?: () => Promise<string | null>) {
  const perf = new BrowserPerf();
  const client = createTRPCClient<AppRouter>({
    links: [
      perfLink(perf),
      httpBatchLink({
        url,
        // Bearer JWT on every call (RBAC_DESIGN §0.1) — resolved per request
        // because session tokens are short-lived. No token → no header; the
        // unconfigured server ignores it, the configured one rejects.
        //
        // The trace rides along (PERFORMANCE_LOGGING.md §5): one header per
        // HTTP request, taken from the first call in the batch that carries
        // one — a batch comes from one page, and the server's spans for every
        // procedure in it hang under that call.
        headers: async ({ opList }) => {
          const token = await getToken?.();
          const trace = opList.map((o) => o.context?.fluxusTrace).find((t): t is string => typeof t === 'string');
          return {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(trace ? { 'x-fluxus-trace': trace } : {}),
          };
        },
      }),
    ],
  });
  perf.setSender((spans) => client.perf.record.mutate({ spans }));
  perfOf.set(client, perf);
  return client;
}
type Trpc = ReturnType<typeof createTrpc>;

/** Ask the server what is switched on for this operation (PERFORMANCE_LOGGING.md
 *  §6) and tell the client's collector. Never throws. */
async function learnPerfSwitches(trpc: Trpc, operationId: string): Promise<void> {
  try {
    const { effective } = await trpc.perf.settings.query({ operationId });
    perfOf.get(trpc)?.configure(operationId, effective.enabled && effective.browser);
  } catch {
    perfOf.get(trpc)?.configure(operationId, false);
  }
}

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
   * How much of the operation's data to hold locally (2026-08-16):
   *
   * - `partition` — every record the caller may read, with its full activity
   *   history, in one round trip at connect. What the workbench needs, because
   *   it evaluates the model locally against the snapshot.
   * - `none` — nothing. The host fills the snapshot as it goes, through
   *   `fetchRecord`/`fetchRecords`, and asks the model for the rest through GET
   *   activities. What a pages-only host (the Runtime app) runs on.
   *
   * Default `partition`, which is what every host did before the option
   * existed. Sending an entire operation to a browser at sign-in is what this
   * exists to stop (DATA_THROUGH_ACTIVITIES step 5).
   */
  records?: 'partition' | 'none';
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
  /** The root of authority, and the org's contact address — `contactEmail` was
   *  dropped in migration 0018 (the two were born identical and nothing read the
   *  contact). **Read-only here**: changing it is ownership transfer, which is
   *  not org-admin work and is not built. */
  ownerEmail: string | null;
  plan: string;
  status: string;
  createdAt: string | null;
}

/** A person in the organisation (USERS.md §2) — identity, and nothing else.
 *  There is no level here: being one of these grants nothing at all, and every
 *  capability is a separate grant. `authUserId` is null until their first
 *  sign-in binds it, which is what flips `status` 'invited' → 'active'. */
export interface User {
  email: string;
  name: string | null;
  authUserId: string | null;
  status: UserStatus;
  /** When the relationship ended; null unless `status` is 'expired'. */
  expiredAt: string | null;
}

/** `suspended` is a reversible pause that keeps every grant; `expired` is the
 *  terminal state and drops them all. **Neither deletes the row** — record
 *  history names its author by auth id, and the person's row is the only thing
 *  that can turn that id back into a name. */
export type UserStatus = 'invited' | 'active' | 'suspended' | 'expired';

/** A grant row, at every tier: the row IS the appointment, so it carries the
 *  person and nothing more. */
export interface Grant {
  email: string;
}

/** What `me` answers. `opAdmin` is false when no operation was named — it is
 *  not a question about no operation in particular. */
export interface Me {
  id: string;
  name: string;
  email?: string | null;
  roles: string[];
  authConfigured: boolean;
  /** The root of authority — appoints org admins, and nothing else by itself.
   *  Not implicitly an org admin. */
  orgOwner: boolean;
  orgAdmin: boolean;
  opAdmin: boolean;
  /** May use the Console at all: owner, org admin, or sol admin of any
   *  solution. Derived, never a stored flag — a bit could contradict the
   *  grants it summarises. */
  console: boolean;
}

/** Who builds a solution, joined across the org — the Organisation → Users
 *  *Sol admins* tab, which is where the appointments are made. */
export interface SolAdminRow {
  solutionId: string;
  email: string;
}

/** Who administers an operation, joined across a solution's operations — the
 *  Solution → Users *Op admins* tab. */
export interface OpAdminRow {
  operationId: string;
  email: string;
}

/**
 * The Console-plane client (CONSOLE_RUNTIME_SPEC §8): the cross-operation
 * admin surface the page builder drives — solutions/operations CRUD and (as
 * later milestones land) publish, versions, and governance. Distinct from
 * FluxusClient, which binds to a single operation's data snapshot. Both share
 * the bearer-token transport.
 */
export class ConsoleClient {
  private constructor(private readonly trpc: Trpc, private readonly orgId: string | undefined) {}

  /**
   * `orgId` is the org this Console session is working in — the host reads it
   * from the URL (`/o/<orgId>/…`) and passes it once here, rather than
   * threading it through every call site. Omitted ⇒ the server's default org,
   * which is what a single-org deployment and the demo posture want.
   */
  static create(options: { url?: string; orgId?: string; getToken?: () => Promise<string | null> } = {}): ConsoleClient {
    return new ConsoleClient(createTrpc(options.url ?? DEFAULT_URL, options.getToken), options.orgId);
  }

  /** The session's org, or undefined when the server's default is in force. */
  get org(): string | undefined {
    return this.orgId;
  }

  /** Per-call override wins; otherwise the session's org; otherwise nothing,
   *  and the server fills in its default. */
  private scoped(orgId?: string): { orgId: string } | Record<string, never> {
    const id = orgId ?? this.orgId;
    return id ? { orgId: id } : {};
  }

  // The org tier (M14): Console's Organisation → Settings surface. Reads and
  // profile edits only — registering an org is the platform plane's
  // (`PlatformClient`), and plan/status are ours to set, not the org's.
  getOrg(orgId?: string): Promise<OrgProfile> {
    return this.trpc.orgs.get.query(this.scoped(orgId)) as Promise<OrgProfile>;
  }
  /** The name, and nothing else — see `OrgProfile.ownerEmail`. */
  putOrgProfile(input: { orgId?: string; name: string }): Promise<{ ok: true }> {
    return this.trpc.orgs.putProfile.mutate({ ...input, ...this.scoped(input.orgId) });
  }

  listSolutions(): Promise<{ id: string; name: string; origin: string }[]> {
    return this.trpc.solutions.list.query(this.scoped());
  }
  createSolution(input: { id: string; name: string }): Promise<{ ok: true }> {
    return this.trpc.solutions.create.mutate({ ...input, ...this.scoped() });
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

  // Governance (RBAC stage 1): user roles per operation, sol users per
  // solution. All admin-gated server-side.
  operationRoles(operationId: string): Promise<{ id: string; name: string }[]> {
    return this.trpc.userRoles.roles.query({ operationId });
  }
  /** Who holds which roles in an operation. Keyed on **email** (2026-08-02), so
   *  roles can be granted to an invited user who has never signed in. */
  listUserRoles(operationId: string): Promise<{ email: string; roleIds: string[] }[]> {
    return this.trpc.userRoles.list.query({ operationId });
  }
  putUserRoles(operationId: string, email: string, roleIds: string[]): Promise<{ ok: true }> {
    return this.trpc.userRoles.put.mutate({ operationId, email, roleIds });
  }
  /** Who the caller is and what they may do. Omit `operationId` for the
   *  org-level answer — the Organisation → Users screen has no operation in
   *  hand, and asking through an arbitrary one would make org administration
   *  depend on op membership. Cosmetic: every call is re-checked server-side. */
  me(operationId?: string): Promise<Me> {
    // With an operation the server reads the org off it; without one the answer
    // is about THIS session's org, so it has to be named or `orgAdmin` would
    // report on the default org instead.
    return this.trpc.me.query(operationId ? { operationId } : this.scoped());
  }

  // ── Users, admins and roles (USERS.md) ──────────────────────────────────────
  // One population of people, then grants. Each method below belongs to exactly
  // one list, and each list is governed by one tier — read them together and the
  // model reads back out: the owner appoints org admins, org admins appoint sol
  // and op admins, op admins staff their operation and assign its roles.
  //
  // Every call is re-checked server-side. `me().orgOwner`/`.orgAdmin`/`.opAdmin`
  // are for deciding what to RENDER, never for deciding what is allowed.

  /** The organisation's people. Org-admin gated: an op admin cannot browse it,
   *  which is why `addOpUser` validates an address against it for them. */
  listUsers(orgId?: string): Promise<User[]> {
    return this.trpc.users.list.query(this.scoped(orgId));
  }
  /** Invite someone into the organisation — the only way in, and it grants
   *  nothing anywhere. Pass `operationId` when the caller is an op admin: they
   *  have no org-wide standing, so the server checks the operation they name. */
  inviteUser(input: { email: string; name?: string | null; operationId?: string; orgId?: string }): Promise<{ ok: true }> {
    return this.trpc.users.invite.mutate({ ...input, ...this.scoped(input.orgId) });
  }
  /** Suspend and reinstate — the reversible pause. Grants survive, entry stops,
   *  and the person is no admin anywhere while it lasts. `expired` is not
   *  settable here; it drops grants, so it has its own call. */
  setUserStatus(email: string, status: Exclude<UserStatus, 'expired'>, orgId?: string): Promise<{ ok: true }> {
    return this.trpc.users.setStatus.mutate({ email, status, ...this.scoped(orgId) });
  }
  /** End the relationship: drops every grant at every tier and stamps
   *  `expiredAt`, but keeps the person, so their record history stays
   *  attributable. There is no hard delete. */
  expireUser(email: string, orgId?: string): Promise<{ ok: true }> {
    return this.trpc.users.expire.mutate({ email, ...this.scoped(orgId) });
  }
  /** Bring an expired person back — as a plain member with **no grants**.
   *  Expiry kept nothing to restore, so they are appointed again from scratch. */
  unexpireUser(email: string, orgId?: string): Promise<{ ok: true }> {
    return this.trpc.users.unexpire.mutate({ email, ...this.scoped(orgId) });
  }

  /** Who administers the organisation. Visible to any org admin, **appointed by
   *  the owner alone** — no tier appoints its own tier. */
  listOrgAdmins(orgId?: string): Promise<Grant[]> {
    return this.trpc.orgAdmins.list.query(this.scoped(orgId));
  }
  orgOwner(orgId?: string): Promise<{ email: string | null }> {
    return this.trpc.orgAdmins.owner.query(this.scoped(orgId));
  }
  appointOrgAdmin(email: string, orgId?: string): Promise<{ ok: true }> {
    return this.trpc.orgAdmins.appoint.mutate({ email, ...this.scoped(orgId) });
  }
  removeOrgAdmin(email: string, orgId?: string): Promise<{ ok: true }> {
    return this.trpc.orgAdmins.remove.mutate({ email, ...this.scoped(orgId) });
  }

  /** Who builds a solution. One grade — you build it or you do not. Org-admin
   *  gated on every call, including the read: the design plane governs no
   *  people, and these rows carry real identities. */
  listSolAdmins(solutionId: string): Promise<Grant[]> {
    return this.trpc.solAdmins.list.query({ solutionId });
  }
  /** Every solution's admins at once — the organisation's *Sol admins* tab. */
  listSolAdminsByOrg(orgId?: string): Promise<SolAdminRow[]> {
    return this.trpc.solAdmins.listByOrg.query(this.scoped(orgId));
  }
  appointSolAdmin(solutionId: string, email: string): Promise<{ ok: true }> {
    return this.trpc.solAdmins.appoint.mutate({ solutionId, email });
  }
  removeSolAdmin(solutionId: string, email: string): Promise<{ ok: true }> {
    return this.trpc.solAdmins.remove.mutate({ solutionId, email });
  }

  /** Who runs an operation. Appointed by an **org admin**, never by another op
   *  admin. An admin row implies entry — no separate op-user row is needed. */
  listOpAdmins(operationId: string): Promise<Grant[]> {
    return this.trpc.opAdmins.list.query({ operationId });
  }
  /** The op admins of every operation running one solution — the solution's
   *  *Op admins* tab. */
  listOpAdminsBySolution(solutionId: string): Promise<OpAdminRow[]> {
    return this.trpc.opAdmins.listBySolution.query({ solutionId });
  }
  appointOpAdmin(operationId: string, email: string): Promise<{ ok: true }> {
    return this.trpc.opAdmins.appoint.mutate({ operationId, email });
  }
  removeOpAdmin(operationId: string, email: string): Promise<{ ok: true }> {
    return this.trpc.opAdmins.remove.mutate({ operationId, email });
  }

  /** Who may enter an operation — the op admin's list. */
  listOpUsers(operationId: string): Promise<Grant[]> {
    return this.trpc.opUsers.list.query({ operationId });
  }
  /** Refuses an address that is not in the organisation: the pool is the only
   *  way in, so this list can never be the wider set. */
  addOpUser(operationId: string, email: string): Promise<{ ok: true }> {
    return this.trpc.opUsers.add.mutate({ operationId, email });
  }
  removeOpUser(operationId: string, email: string): Promise<{ ok: true }> {
    return this.trpc.opUsers.remove.mutate({ operationId, email });
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

/** An org as the platform plane sees it — the same row `getOrg` returns, but
 *  listed across orgs rather than read within one. */
export interface PlatformOrg extends OrgProfile {}

/**
 * The platform-plane client — `@fluxus/platform`'s door (ruled 2026-08-03).
 * Deliberately its own class rather than methods on ConsoleClient: this is the
 * one client that is NOT scoped to an org, and the tier that may use it is a
 * different tier. Keeping them apart means no Console screen can reach a
 * cross-org call by accident.
 *
 * Bare bones by intent: list orgs, register one. Usage and billing land here
 * eventually, but usage should fall out of the log rather than a counter table,
 * so neither is invented ahead of the need.
 */
export class PlatformClient {
  private constructor(private readonly trpc: Trpc) {}

  static create(options: { url?: string; getToken?: () => Promise<string | null> } = {}): PlatformClient {
    return new PlatformClient(createTrpc(options.url ?? DEFAULT_URL, options.getToken));
  }

  listOrgs(): Promise<PlatformOrg[]> {
    return this.trpc.platform.listOrgs.query() as Promise<PlatformOrg[]>;
  }

  /**
   * Register an org and its owner — one act, because an org whose first admin
   * is a second step is an org nobody can enter. The owner becomes its org
   * admin (status `invited`) and is told out of band: nothing is emailed, as
   * there is no mail sender yet.
   *
   * `id` is a URL slug because it IS the URL — both apps read their org from
   * `/o/<orgId>/…`.
   */
  registerOrg(input: { id: string; name: string; ownerEmail: string; ownerName?: string | null }): Promise<{ ok: true }> {
    return this.trpc.platform.registerOrg.mutate(input);
  }

  /** Every operation, for the Switches panel — each can override the platform's. */
  listOperations(): Promise<OperationRow[]> {
    return this.trpc.operations.list.query() as Promise<OperationRow[]>;
  }

  // Performance logging (docs/PERFORMANCE_LOGGING.md §8) — the dashboard's
  // three calls. Platform admins only, server-side.

  /** The platform-wide switches and every operation's override, raw — what the
   *  Switches panel edits. */
  async perfSwitches(): Promise<PerfSwitches> {
    const r = await this.trpc.perf.settings.query();
    // The raw rows come back to platform admins only; anyone else gets the
    // resolved answer, which is no use to an editor.
    if (!('platform' in r)) throw new Error('The switches are for platform admins');
    return { platform: r.platform, operations: r.operations };
  }
  /** Change only the switches named. `scope` is `'platform'` or an operation id. */
  setPerfSwitches(input: { scope: string; enabled?: SwitchValue; server?: SwitchValue; browser?: SwitchValue; dbCounts?: SwitchValue }): Promise<{ ok: true }> {
    return this.trpc.perf.setSettings.mutate(input);
  }
  /** The dashboard's panels for a time range. */
  perfReport(range: PerfRange): Promise<PerfReport> {
    return this.trpc.perf.report.query({ range }) as Promise<PerfReport>;
  }
  /** One trace's spans, for the drill-in from a slow action. */
  async perfTrace(traceId: string, range: PerfRange = '7d'): Promise<PerfSpan[]> {
    const r = (await this.trpc.perf.report.query({ range, traceId })) as { traceSpans?: PerfSpan[] };
    return r.traceSpans ?? [];
  }
}

export type SwitchValue = 'on' | 'off' | 'follow';
export type PerfRange = '1h' | '24h' | '7d';
/** One scope's switches — 'platform', or an operation id. The platform row's
 *  are on/off only. */
export interface PerfSwitchRow {
  scope: string;
  enabled: SwitchValue;
  server: SwitchValue;
  browser: SwitchValue;
  dbCounts: SwitchValue;
}
export interface PerfSwitches {
  platform: PerfSwitchRow;
  /** Only operations with an override — any other follows the platform. */
  operations: PerfSwitchRow[];
}
export interface PerfSpan {
  spanId: string;
  parentId: string | null;
  side: 'server' | 'browser';
  kind: string;
  name: string;
  startedAt: string;
  durationMs: number;
  outcome: 'ok' | 'refused' | 'error';
  message: string | null;
  counts: Record<string, number> | null;
}
export interface PerfReport {
  slowest: { kind: string; name: string; count: number; medianMs: number; p95Ms: number; maxMs: number }[];
  pageOpens: { name: string; count: number; medianMs: number; p95Ms: number }[];
  dbWakeups: { count: number; medianMs: number; maxMs: number } | null;
  recentSlowTraces: { traceId: string; startedAt: string; durationMs: number }[];
}

/**
 * The org this browser session is working in, read from `/o/<orgId>/…`
 * (ruled 2026-08-03 — Neon's shape). The URL is the only place org identity
 * lives client-side: no picker, no localStorage, so a link is a complete
 * address and two orgs can be open in two tabs without fighting.
 *
 * Absent ⇒ undefined, and the server's default org applies — which is what a
 * single-org deployment and every existing dev URL want.
 */
export function orgFromPath(pathname: string = window.location.pathname): string | undefined {
  const m = /^\/o\/([a-z0-9][a-z0-9-]*)(\/|$)/.exec(pathname);
  return m?.[1];
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
}

/** What a GET activity is asked (DSL_SPEC §5a) — its parameters are its attributes. */
export interface QueryInput {
  activityId: string;
  /** Anchor record, where the entry will land once GETs are logged (step 3). */
  recordId?: string;
  attributes?: Record<string, unknown>;
}

/**
 * The connected client for one operation's snapshot.
 *
 * Generic in the **grade of model it holds** (CLIENT_TRUST_BOUNDARY §2):
 * `connect` (the runtime plane) yields a `ClientSolutionConfig` — hooks, access
 * rules and the storage gate never left the server — while `connectSolution`
 * (the design plane, sol admin) yields the full `SolutionConfig`, because
 * authoring hooks is the job. Hosts that only render and run take
 * `FluxusClient` unparameterised and get the narrow grade, which is what makes
 * a stray `config.workflows[0].activities[0].before_hook` a compile error there
 * rather than a runtime `undefined`.
 */
export class FluxusClient<C extends ClientSolutionConfig = ClientSolutionConfig> {
  private constructor(
    private readonly trpc: Trpc,
    /** The operation this client runs; its record partition key. */
    readonly operationId: string,
    /** The operation's linked solution; the config + pages key. */
    readonly solutionId: string,
    readonly config: C,
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
    /** The org that owns this operation — authoritative, because the SERVER
     *  derives it from the operation. A host that also reads an org from its
     *  URL checks against this rather than trusting the address. */
    readonly orgId: string,
    /**
     * The caller's role ids in this operation, and whether RBAC is enforced
     * (auth configured). Hosts use these for cosmetic menu filtering; the
     * server is the real gate. When not enforced, menus show unfiltered (§7).
     */
    readonly userRoles: string[],
    readonly enforced: boolean,
  ) {}

  /**
   * How much data this client holds (`ConnectOptions.records`, 2026-08-16).
   * Set by `connect` right after construction rather than threaded through a
   * fifteenth positional parameter. It decides one thing: whether `refresh`
   * re-fetches the whole partition or only the records already in hand.
   */
  private recordsMode: 'partition' | 'none' = 'partition';

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
  }): Promise<FluxusClient<SolutionConfig>> {
    const trpc = createTrpc(options.url ?? DEFAULT_URL, options.getToken);
    const { solutionId, operationId } = options;
    // pages.list is the reachability probe (it never throws for an existing
    // solution). The catch is now belt-and-braces: since the model moved into
    // tables (2026-08-09) a solution with nothing authored yet simply assembles
    // to the empty model, and `config.get` throws only for a solution that does
    // not exist — which this call has no way to recover from anyway. Kept so an
    // older server still opens the editor blank rather than failing boot.
    //
    // A refusal is NOT swallowed: `config.get` is sol-admin gated since the
    // client trim (CLIENT_TRUST_BOUNDARY §2), and a Console user who may open
    // the org but does not build this solution must be told that, not shown an
    // empty model they will then fail to save into.
    const [pageRows, config, partition] = await Promise.all([
      trpc.pages.list.query({ solutionId, published: false }),
      (trpc.config.get.query({ solutionId }) as Promise<SolutionConfig>).catch((err) => {
        if (err instanceof TRPCClientError && err.data?.code === 'FORBIDDEN') throw err;
        return { attributes: [], recordTypes: [], workflows: [] } as SolutionConfig;
      }),
      operationId
        ? (trpc.records.partition.query({ operationId }) as Promise<RecordInstance[]>)
        : Promise.resolve([] as RecordInstance[]),
      operationId ? learnPerfSwitches(trpc, operationId) : Promise.resolve(),
    ]);
    const adapter = new MemoryAdapter(config, {
      initialRecords: partition.map((r) => [r.id, r] as const),
    });
    const pages = new Map(pageRows.map((p) => [p.path, p.def]));
    // enforced=false: Console is the design plane, menus/roles are not
    // filtered here. With an operation bound, runActivity/refresh work exactly
    // as in the Runtime host — running an activity is how you test a workflow.
    // Display names are Runtime chrome; Console shows the solution banner it
    // already has, so the ids stand in.
    return new FluxusClient(trpc, operationId ?? solutionId, solutionId, config, adapter, pages, [], '', solutionId, operationId ?? '', '', [], false);
  }

  /** The operations running a given solution — Console's data picker (which
   *  operation am I building against). */
  static async operationsForSolution(options: { url?: string; solutionId: string; getToken?: () => Promise<string | null> }): Promise<{ id: string; name: string }[]> {
    const trpc = createTrpc(options.url ?? DEFAULT_URL, options.getToken);
    const rows = await trpc.operations.list.query();
    return rows.filter((o) => o.solutionId === options.solutionId).map((o) => ({ id: o.id, name: o.name }));
  }

  /** Replace the solution's whole SDM config — the **import** path (installing a
   *  config, rolling one back), not the editing path. Editors save one entity at
   *  a time; see the per-entity writes below. */
  async saveConfig(config: SolutionConfig): Promise<void> {
    await this.trpc.config.put.mutate({ solutionId: this.solutionId, config });
  }

  // ── Per-entity model writes ────────────────────────────────────────────────
  // The change unit is one entity, so the write unit is too: an editor saves the
  // attribute it touched, not the graph it happens to hold. The server still
  // validates the whole graph under a per-solution lock, so two people editing
  // two different entities no longer overwrite each other. The caller reloads
  // afterwards to rebuild the adapter/pageRuntime, as with saveConfig.

  async putAttribute(def: AttributeDef): Promise<void> {
    await this.trpc.config.putAttribute.mutate({ solutionId: this.solutionId, def });
  }
  async deleteAttribute(key: string): Promise<void> {
    await this.trpc.config.deleteAttribute.mutate({ solutionId: this.solutionId, key });
  }

  async putRecordType(def: RecordTypeDef): Promise<void> {
    await this.trpc.config.putRecordType.mutate({ solutionId: this.solutionId, def });
  }
  async deleteRecordType(id: string): Promise<void> {
    await this.trpc.config.deleteRecordType.mutate({ solutionId: this.solutionId, id });
  }

  /** Activities ride inside their workflow — the workflow is the change unit. */
  async putWorkflow(def: WorkflowRawDef): Promise<void> {
    await this.trpc.config.putWorkflow.mutate({ solutionId: this.solutionId, def });
  }
  async deleteWorkflow(id: string): Promise<void> {
    await this.trpc.config.deleteWorkflow.mutate({ solutionId: this.solutionId, id });
  }

  async putFunction(def: FunctionDef): Promise<void> {
    await this.trpc.config.putFunction.mutate({ solutionId: this.solutionId, def });
  }
  async deleteFunction(id: string): Promise<void> {
    await this.trpc.config.deleteFunction.mutate({ solutionId: this.solutionId, id });
  }

  async putRole(def: RoleDef): Promise<void> {
    await this.trpc.config.putRole.mutate({ solutionId: this.solutionId, def });
  }
  async deleteRole(id: string): Promise<void> {
    await this.trpc.config.deleteRole.mutate({ solutionId: this.solutionId, id });
  }

  /** The solution's default runtime menu. No delete — `[]` is the empty menu. */
  async putDefaultMenu(menu: MenuItem[]): Promise<void> {
    await this.trpc.config.putDefaultMenu.mutate({ solutionId: this.solutionId, menu });
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
   * Resolve the operation to its solution, then fetch config + page set and the
   * record partition (both by operation) and build the local snapshot. Throws
   * (with the server's message) when the server is unreachable or the
   * operation/solution is missing — hosts surface that as their boot error;
   * there is no localStorage fallback by ruling.
   *
   * The model arrives **trimmed to this caller's roles** (`getForOperation`,
   * CLIENT_TRUST_BOUNDARY §2): no hooks, no access rules, no record type they
   * cannot read. The data was always filtered this way; since 2026-08-09 the
   * model is too.
   */
  static async connect(options: ConnectOptions = {}): Promise<FluxusClient> {
    const trpc = createTrpc(options.url ?? DEFAULT_URL, options.getToken);
    const operationId = options.operationId ?? DEFAULT_OPERATION;
    const op = await trpc.operations.get.query({ operationId });
    const solutionId = op.solutionId;
    const published = options.pages === 'published';
    const recordsMode = options.records ?? 'partition';
    const [config, partition, pageRows, me] = await Promise.all([
      trpc.config.getForOperation.query({ operationId }) as Promise<ClientSolutionConfig>,
      recordsMode === 'none'
        ? Promise.resolve([] as RecordInstance[])
        : (trpc.records.partition.query({ operationId }) as Promise<RecordInstance[]>),
      // operationId lets published mode filter pages to those openable to the
      // caller (page access control, §6).
      trpc.pages.list.query({ solutionId, operationId, published }),
      trpc.me.query({ operationId }),
      // Rides the same HTTP batch. A server that predates the switches (or a
      // failure) leaves browser logging off — never an error at connect.
      learnPerfSwitches(trpc, operationId),
    ]);
    const adapter = new MemoryAdapter(config, {
      initialRecords: partition.map((r) => [r.id, r] as const),
    });
    const pages = new Map(pageRows.map((p) => [p.path, p.def]));
    // Effective menu (§5, M10): operation override ?? solution default ?? [].
    // `menu` absent on the operation means inherit; `[]` is an explicit empty
    // override. The engine is menu-blind, so default_menu is read off the raw
    // config here, not via SolutionConfig.
    const menu =
      (op.config as { menu?: MenuItem[] }).menu ??
      (config as { default_menu?: MenuItem[] }).default_menu ??
      [];
    const solutionName = (op as { solutionName?: string }).solutionName ?? solutionId;
    const orgName = (op as { orgName?: string }).orgName ?? op.orgId;
    const client = new FluxusClient(trpc, operationId, solutionId, config, adapter, pages, menu, orgName, solutionName, op.name, op.orgId, me.roles, me.authConfigured);
    client.recordsMode = recordsMode;
    return client;
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

  /**
   * A page is being asked for (PERFORMANCE_LOGGING.md §3): times it until the
   * page says every component on it has finished loading, and makes the calls
   * it makes in the meantime part of that one trace. Null when browser logging
   * is off for this operation — callers just skip the timing.
   */
  pageOpen(pagePath: string): PageOpenHandle | null {
    return perfOf.get(this.trpc)?.beginPage(pagePath) ?? null;
  }

  /**
   * One record into the snapshot, by id — how a host that was not handed the
   * partition reaches the record it is about (a page's anchor, the record a
   * component's callback named). Merges rather than replaces, so a host may
   * hold several at once. A record the caller may not read comes back as
   * not-found, deliberately indistinguishable from a missing one.
   */
  async fetchRecord(recordId: string): Promise<RecordInstance> {
    const record = (await this.trpc.records.get.query({ operationId: this.operationId, recordId })) as RecordInstance;
    this.adapter.mergeRecords([[record.id, record] as const]);
    return record;
  }

  /**
   * One record type into the snapshot. The seam a grid loads through, and how
   * a one-instance page finds whether its record exists yet. Still every row of
   * that type — narrowing further is a query, which is what a GET activity is
   * for.
   */
  async fetchRecords(typeId: string): Promise<RecordInstance[]> {
    const rows = (await this.trpc.records.list.query({ operationId: this.operationId, typeId })) as RecordInstance[];
    this.adapter.mergeRecords(rows.map((r) => [r.id, r] as const));
    return rows;
  }

  /**
   * Bring the snapshot back in line with the server after a run; subscribers
   * re-render.
   *
   * With the partition, that is one re-fetch of the lot. With `records: 'none'`
   * there is no partition to re-fetch, so it refreshes exactly what the host
   * has already been given — typically the one record the page is about — and
   * drops any that no longer read back (deleted, or no longer readable).
   */
  async refresh(): Promise<void> {
    if (this.recordsMode === 'partition') {
      const partition = (await this.trpc.records.partition.query({ operationId: this.operationId })) as RecordInstance[];
      this.adapter.replaceRecords(partition.map((r) => [r.id, r] as const));
      return;
    }
    const held = this.adapter.allRecords().map((r) => r.id);
    if (held.length === 0) return;
    const rows = await Promise.all(
      held.map((recordId) =>
        (this.trpc.records.get.query({ operationId: this.operationId, recordId }) as Promise<RecordInstance>)
          .catch(() => null),
      ),
    );
    this.adapter.replaceRecords(rows.filter((r): r is RecordInstance => r !== null).map((r) => [r.id, r] as const));
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
      })) as RunActivityResult;
    } finally {
      await this.refresh();
    }
  }

  /**
   * Ask a GET activity its question (DSL_SPEC §5a). The counterpart to
   * `runActivity`: the app names an activity in the model and the server
   * answers, instead of the app carrying its own query.
   *
   * `recordId` is the anchor the read is logged against (step 3) — a page
   * passes its own record. No record data changes, and the light entry the
   * server records is of no interest to the browser that caused it, so there
   * is deliberately no snapshot refresh: it would double the round trips of
   * every page that reads.
   */
  async query(input: QueryInput): Promise<QueryActivityResult> {
    return (await this.trpc.activities.query.query({
      operationId: this.operationId,
      activityId: input.activityId,
      recordId: input.recordId,
      attributes: input.attributes ?? {},
    })) as QueryActivityResult;
  }

  /**
   * Ad-hoc FluxScript, read-only, against this operation's records — the
   * Console's DSL Editor. Not an application data path: see the reasoning on
   * `scripts.query` in the server router.
   *
   * A failed script comes back as a result carrying `error`, not as a thrown
   * TRPCClientError — the editor needs the message and its position to show
   * against the source. Transport and gate failures still throw.
   */
  async runScript(input: { source: string; recordId?: string }): Promise<ScriptQueryResult> {
    return (await this.trpc.scripts.query.query({
      operationId: this.operationId,
      source: input.source,
      recordId: input.recordId,
    })) as ScriptQueryResult;
  }
}
