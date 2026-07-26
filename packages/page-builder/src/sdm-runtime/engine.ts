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

import { ConsoleClient, createHostAuth, FluxusClient } from '@fluxus/client';
import { createPageRuntime, type PageRuntime } from '@fluxus/page-runtime';
import { signInGate } from './SignIn';

// Design-scoped singletons: assigned by openSolution() when the user opens a
// solution (CONSOLE_RUNTIME_SPEC §3, two-level IA), reassigned on switch.
// Undefined in workspace mode (Solutions list) — only solution-level activities
// (Pages, SDM) read them, and those mount after openSolution.
export let sdmClient: FluxusClient;
export let pageRuntime: PageRuntime;
// The Console-plane client (cross-operation admin: solutions/operations CRUD,
// publish/versions/governance). Solution-independent — created once at boot.
export let consoleClient: ConsoleClient;

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
 *  a preference, not model state). */
const dataOpKey = (solutionId: string) => `fluxus:page-builder:data-operation:${solutionId}`;

export async function initSdmRuntime(): Promise<void> {
  // Auth gate (RBAC_DESIGN §0): VITE_NEON_AUTH_URL unset ⇒ demo posture, no
  // sign-in; set ⇒ a session is required before connect() — the overlay form
  // holds every pending mount until sign-in succeeds.
  const auth = createHostAuth(import.meta.env.VITE_NEON_AUTH_URL);
  if (auth.configured && !(await auth.session())) await signInGate(auth);
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  bootUrl = import.meta.env.VITE_FLUXUS_API_URL;
  bootGetToken = auth.configured ? auth.getToken : undefined;
  consoleClient = ConsoleClient.create({ url: bootUrl, getToken: bootGetToken });
}

/**
 * Re-scope the design singletons to `solutionId`. The model and draft pages are
 * solution-scoped; the records come from one of the solution's operations, so
 * the SDM editor and page preview show the same data the Runtime host shows
 * (ruled 2026-07-26 — Console showing an empty table where the workbench showed
 * four records was the platform contradicting itself).
 *
 * `operationId` omitted ⇒ the remembered choice, else the solution's first
 * operation, else none (a solution with no operations yet).
 */
export async function openSolution(solutionId: string, operationId?: string): Promise<void> {
  solutionOperations = await FluxusClient.operationsForSolution({ url: bootUrl, solutionId, getToken: bootGetToken });
  const remembered = localStorage.getItem(dataOpKey(solutionId));
  const chosen =
    [operationId, remembered].find((id) => id && solutionOperations.some((o) => o.id === id)) ??
    solutionOperations[0]?.id;
  sdmClient = await FluxusClient.connectSolution({ url: bootUrl, solutionId, operationId: chosen, getToken: bootGetToken });
  pageRuntime = createPageRuntime({ client: sdmClient });
  currentSolutionId = solutionId;
  currentOperationId = chosen ?? null;
  if (chosen) localStorage.setItem(dataOpKey(solutionId), chosen);
}

/** Re-read the current solution's config + pages + records (e.g. after an SDM
 *  config save rebuilds the model, or an activity run changes data). */
export async function reloadSolution(): Promise<void> {
  if (currentSolutionId) await openSolution(currentSolutionId, currentOperationId ?? undefined);
}
