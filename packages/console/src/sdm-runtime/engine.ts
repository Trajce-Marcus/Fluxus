// The page builder's SDM bootstrap (backend stage 2; slimmed at the
// page-runtime extraction): records and activity runs live on @fluxus/server;
// connect() fetches the scope's config + partition + pages, and the whole
// runtime cluster now reaches the SDM through the PageRuntime handle rather
// than singletons of its own. Both hosts point at the same scope — one model,
// many apps, literally.
//
// Platform singletons as before — assigned by initSdmRuntime(), which
// api.ts awaits before rendering (live bindings: importers always see the
// initialized values). Components never import this; they reach the SDM only
// through the declarative wiring layer (dynamic props in, callbacks out).

import { ConsoleClient, createHostAuth, FluxusClient, orgFromPath, type AuthSession } from '@fluxus/client';
import type { SolutionConfig } from '@fluxus/engine';
import { createPageRuntime, type PageRuntime } from '@fluxus/page-runtime';
import { signInGate } from './SignIn';

// Design-scoped singletons: assigned by openSolution() when the user opens a
// solution (CONSOLE_RUNTIME_SPEC §3, two-level IA), reassigned on switch.
// Undefined in workspace mode (Solutions list) — only solution-level activities
// (Pages, SDM) read them, and those mount after openSolution.
// The FULL model, not the runtime plane's trimmed copy: this is the design
// plane, where hooks and access rules are the thing being authored
// (CLIENT_TRUST_BOUNDARY §2). `connectSolution` is sol-admin gated server-side.
export let sdmClient: FluxusClient<SolutionConfig>;
export let pageRuntime: PageRuntime;
// The Console-plane client (cross-operation admin: solutions/operations CRUD,
// publish/versions/governance). Solution-independent — created once at boot.
export let consoleClient: ConsoleClient;
// Who is signed in — null in the demo (auth unconfigured) posture. Read by the
// hosted workbench (M15) so expression evaluation there sees the same
// `ctx.user` the Runtime app would.
export let currentSession: AuthSession | null = null;
// Whether an auth server is configured at all. `currentSession` is null in two
// very different postures — demo (no auth, the server is open to everyone) and
// signed-out — and the header must not show them the same way.
export let authConfigured = false;
// The org this Console session is working in, from `/o/<orgId>/…`; undefined
// when the URL names none and the server's default org applies.
export let currentOrgId: string | undefined;

let bootUrl: string | undefined;
let bootGetToken: (() => Promise<string | null>) | undefined;
/** The solution currently opened for design, if any. */
export let currentSolutionId: string | null = null;
/** Which operation supplies the records you are building against (ruled
 *  2026-07-26). Null only when the solution has no operations yet. */
export let currentOperationId: string | null = null;
/** The open solution's operations — the header picker's options. */
export let solutionOperations: { id: string; name: string }[] = [];

/** Remembered per solution so reopening lands on the same data (local only —
 *  a preference, not model state). Renamed 2026-07-31 with the picker's move
 *  into the workbench side menu — the choice is the workbench's now. */
const dataOpKey = (solutionId: string) => `fluxus:page-builder:workbench-operation:${solutionId}`;

/** Sweep the pre-M18 key (`…:data-operation:<solutionId>`) — the choice it held
 *  is not migrated: nothing is auto-picked any more, so a stale remembered
 *  operation would reintroduce exactly the invisible binding M18 removed. */
function forgetLegacyDataOperationKeys(): void {
  const legacy = 'fluxus:page-builder:data-operation:';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(legacy)) localStorage.removeItem(key);
  }
}

export async function initSdmRuntime(): Promise<void> {
  // Auth gate (RBAC_DESIGN §0): VITE_NEON_AUTH_URL unset ⇒ demo posture, no
  // sign-in; set ⇒ a session is required before connect() — the overlay form
  // holds every pending mount until sign-in succeeds.
  const auth = createHostAuth(import.meta.env.VITE_NEON_AUTH_URL);
  if (auth.configured && !(await auth.session())) await signInGate(auth);
  currentSession = auth.configured ? await auth.session() : null;
  authConfigured = auth.configured;
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  bootUrl = import.meta.env.VITE_FLUXUS_API_URL;
  bootGetToken = auth.configured ? auth.getToken : undefined;
  // The org comes from the URL — `/o/<orgId>/…` (ruled 2026-08-03, Neon's
  // shape). Absent ⇒ the server's default org, which is every existing dev URL
  // and every single-org deployment. Read once here: the client carries it into
  // each org-scoped call so no screen has to remember to pass it.
  currentOrgId = orgFromPath();
  consoleClient = ConsoleClient.create({ url: bootUrl, orgId: currentOrgId, getToken: bootGetToken });
  forgetLegacyDataOperationKeys();
}

/**
 * Re-scope the design singletons to `solutionId`. The model and draft pages are
 * solution-scoped; the records come from one of the solution's operations, so
 * the SDM editor and page preview show the same data the Runtime host shows
 * (ruled 2026-07-26 — Console showing an empty table where the workbench showed
 * four records was the platform contradicting itself).
 *
 * `operationId` omitted ⇒ the remembered choice if it still exists; `null` ⇒
 * explicitly none. **Nothing is auto-picked** (ruled 2026-07-31): the old
 * fallback to the solution's first operation bound the Console to a partition
 * nobody chose — and "first" was whatever Postgres returned — so a solution
 * whose choice was never made, or was made against a since-deleted operation,
 * opens with no data and says so.
 */
export async function openSolution(solutionId: string, operationId?: string | null): Promise<void> {
  solutionOperations = await FluxusClient.operationsForSolution({ url: bootUrl, solutionId, getToken: bootGetToken });
  const exists = (id: string | null | undefined) => !!id && solutionOperations.some((o) => o.id === id);
  const remembered = localStorage.getItem(dataOpKey(solutionId));
  const chosen = operationId === null
    ? undefined
    : (exists(operationId) ? operationId! : exists(remembered) ? remembered! : undefined);
  sdmClient = await FluxusClient.connectSolution({ url: bootUrl, solutionId, operationId: chosen, getToken: bootGetToken });
  pageRuntime = createPageRuntime({ client: sdmClient });
  currentSolutionId = solutionId;
  currentOperationId = chosen ?? null;
  // Remember the choice, and forget one that no longer resolves (deleted
  // operation) so it cannot keep failing silently.
  if (chosen) localStorage.setItem(dataOpKey(solutionId), chosen);
  else localStorage.removeItem(dataOpKey(solutionId));
}

/** Re-read the current solution's config + pages + records (e.g. after an SDM
 *  config save rebuilds the model, or an activity run changes data). */
export async function reloadSolution(): Promise<void> {
  // Pass the current choice through as-is — null means none, and a reload must
  // not re-derive one.
  if (currentSolutionId) await openSolution(currentSolutionId, currentOperationId);
}
