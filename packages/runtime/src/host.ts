// The Runtime app's connection to @fluxus/server (backend stage 2). Records
// and activity runs live server-side; this module holds the connected client,
// whose snapshot the published pages render from.
//
// Since M15 the app renders published pages only — the workbench moved to the
// Console — so the engine built here exists for one job: re-reporting config
// findings at boot. Page expressions go through the PageRuntime handle, and
// the workbench builds its own engine from whichever client its host passes.
//
// Module-level singletons as before — one client, one adapter, one engine for
// the lifetime of the app — but assigned by initHost(), which main.tsx awaits
// before rendering. There is no localStorage fallback by ruling: if the
// server is down, boot fails loudly.

import { createEngine, buildGeoModule, buildTimeModule, buildMathModule } from '@fluxus/engine';
import type { ContextUser } from '@fluxus/engine';
import { FluxusClient, orgFromPath, type AuthSession, type HostAuth } from '@fluxus/client';
import { createPageRuntime, type PageRuntime, type PageScroll } from '@fluxus/page-runtime';
import { NotificationLog } from './store/NotificationLog';
import { buildNotifyModule } from './services/notify';

// Dormant while hooks run server-side (their notify goes to the server sink);
// stays wired so the manifest validates and the bell returns with the
// unified-log design.
export const notificationLog = new NotificationLog();

export let client: FluxusClient;
// The shell's user menu (M10): who is signed in, and the auth handle for
// sign-out. Both null/undefined in the demo (auth unconfigured) posture.
export let currentSession: AuthSession | null = null;
export let hostAuth: HostAuth | undefined;
// The run-a-page cluster's injected handle (@fluxus/page-runtime): renders
// published pages in the workbench — the first step of workbench → Runtime app.
export let pageRuntime: PageRuntime;

// `services.page.open` has to reach the shell's page state, but the page
// runtime is built here at boot — before React exists — so the seam lives at
// module level and RuntimeProvider fills it. Unfilled, a navigation attempt
// throws rather than doing nothing: a page that cannot navigate should say so.
let pageNavigator: ((page: string, recordId: string | null) => void) | null = null;

export function setPageNavigator(fn: ((page: string, recordId: string | null) => void) | null): void {
  pageNavigator = fn;
}

function navigate(page: string, recordId: string | null): void {
  if (!pageNavigator) throw new Error(`Cannot open '${page}' — the shell is not mounted yet`);
  pageNavigator(page, recordId);
}

// How many pages deep this tab is inside the app (2026-09-23): each page
// opened is a history entry carrying its depth, so PageHeader's back arrow can
// tell a page with somewhere to go back to from the first one opened — the
// browser will not say whether Back would leave the app.
const DEPTH = 'fluxusDepth';
export const historyDepth = (): number => Number((window.history.state as Record<string, unknown> | null)?.[DEPTH] ?? 0);
export const depthState = (depth: number): Record<string, unknown> => ({ [DEPTH]: depth });

// Where the reader was on each page (2026-09-26): the open page's panel scroll
// rides its own history entry, so Back and Forward put them back where they
// were. Written to the entry a moment after scrolling stops — browsers limit
// how often an entry may be rewritten — and at once before another page is
// opened, since after that the entry is no longer the current one.
const SCROLL = 'fluxusScroll';
const SCROLL_SAVE_MS = 200;
let pendingScroll: PageScroll | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

export const historyScroll = (): PageScroll | null =>
  ((window.history.state as Record<string, unknown> | null)?.[SCROLL] as PageScroll | undefined) ?? null;

export function saveScroll(positions: PageScroll): void {
  pendingScroll = positions;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(flushScroll, SCROLL_SAVE_MS);
}

/** Write what is waiting into the current entry, now. */
export function flushScroll(): void {
  clearTimeout(scrollTimer);
  if (!pendingScroll) return;
  window.history.replaceState({ ...(window.history.state ?? {}), [SCROLL]: pendingScroll }, '');
  pendingScroll = null;
}

/** Back or Forward has already moved the entry: what was waiting belonged to
 *  the page just left, and must not land on the one arrived at. */
export function dropScroll(): void {
  clearTimeout(scrollTimer);
  pendingScroll = null;
}

export async function initHost(auth?: HostAuth): Promise<void> {
  // The signed-in identity: bearer token on every tRPC call, and the local
  // engine's context.user for UI-side expression parity (roles stubbed []
  // until RBAC stage 1). Auth unconfigured → both stay undefined (demo stub).
  const session = auth?.configured ? await auth.session() : null;
  currentSession = session;
  hostAuth = auth;
  const user: ContextUser | undefined = session
    ? { id: session.id, name: session.name, email: session.email, roles: [] }
    : undefined;
  // Which operation this app is running (ruled 2026-07-26): `?operation=<id>`
  // in the URL — how Console's Operations list launches the app, and a plain
  // bookmarkable address for an operation. Absent ⇒ the client's default
  // operation, so existing local links keep working.
  const operationId = new URLSearchParams(window.location.search).get('operation') ?? undefined;
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  // Runtime renders PUBLISHED pages only (CONSOLE_RUNTIME_SPEC §4); drafts
  // never leave the Console. The Console's own preview keeps rendering drafts.
  // **No records at connect** (2026-08-16, DATA_THROUGH_ACTIVITIES step 5):
  // signing in used to send every record in the operation, with its full
  // activity history, to a browser that renders pages. This app is pages-only
  // — the workbench is the Console's — so it runs on what its pages ask the
  // model for (GET activities) plus the one record each page is about, fetched
  // by id. The snapshot fills as it goes; nothing arrives unasked.
  client = await FluxusClient.connect({
    url: import.meta.env.VITE_FLUXUS_API_URL,
    operationId,
    getToken: auth?.configured ? auth.getToken : undefined,
    pages: 'published',
    records: 'none',
  });
  // The org may also be named in the path — `/o/<orgId>/?operation=<id>`
  // (ruled 2026-08-03), so a Runtime link reads the same as a Console one. It
  // is NOT how the org is resolved: the operation determines that, server-side,
  // and `client.orgId` is the answer. Naming a different org in the path is a
  // broken link, and saying so beats silently ignoring half the address.
  const urlOrg = orgFromPath();
  if (urlOrg && urlOrg !== client.orgId) {
    throw new Error(
      `This link says organisation '${urlOrg}', but operation '${client.operationId}' belongs to '${client.orgId}'.`,
    );
  }
  pageRuntime = createPageRuntime({
    client,
    openPage: navigate,
    goBack: () => window.history.back(),
    canGoBack: () => historyDepth() > 0,
  });
  // The stored config was validated at config.put; re-reporting here is a
  // free safety net against server/client engine version drift.
  createEngine({
    store: client.adapter,
    config: client.config,
    services: [buildNotifyModule(notificationLog), buildGeoModule(client.adapter), buildTimeModule(), buildMathModule()],
    user,
  }).reportConfigFindings();
}
