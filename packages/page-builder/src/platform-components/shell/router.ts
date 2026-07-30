// Hash routing for the Console shell (CONSOLE_RUNTIME_SPEC §3, M16): the
// location answers "where am I" — `#/<section>` in workspace scope,
// `#/s/<solutionId>/<section>` in solution scope. State→hash flows one way via
// a store subscription; hash→state on boot and `hashchange` (browser back).
// Every navigation path runs the leaving section's `canLeave` guard.

import { consoleClient, currentOperationId, openSolution, solutionOperations } from '../../sdm-runtime/engine';
import { enterSolutionScope, exitSolutionScope, shellStore } from './store';
import { sectionsForScope } from './sections';

interface Route {
  solutionId: string | null;
  section: string;
}

function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 's' && parts[1]) {
    return { solutionId: parts[1], section: parts[2] ?? 'overview' };
  }
  return { solutionId: null, section: parts[0] || 'solutions' };
}

function hashFor(route: Route): string {
  return route.solutionId ? `#/s/${route.solutionId}/${route.section}` : `#/${route.section}`;
}

function currentRoute(): Route {
  const s = shellStore.get();
  return { solutionId: s.solutionId, section: s.activeSection };
}

/** The leaving section's veto (dirty-draft confirm). */
function canLeaveCurrent(): boolean {
  const s = shellStore.get();
  const section = sectionsForScope(s.solutionId !== null).find((x) => x.id === s.activeSection);
  return section?.canLeave?.() ?? true;
}

/** Nav click within the current scope. */
export function navigateSection(id: string): void {
  if (shellStore.get().activeSection === id) return;
  if (!canLeaveCurrent()) return;
  shellStore.set((prev) => ({ ...prev, activeSection: id }));
}

/** Open a solution's design scope from anywhere (Solutions list, breadcrumb,
 *  route). Resolves the display name from `solutions.list` when not supplied. */
export async function openSolutionScoped(solutionId: string, name?: string, section = 'overview'): Promise<void> {
  if (!canLeaveCurrent()) return;
  let solutionName = name;
  if (!solutionName) {
    const sols = await consoleClient.listSolutions();
    solutionName = sols.find((s) => s.id === solutionId)?.name ?? solutionId;
  }
  await openSolution(solutionId);
  enterSolutionScope(
    solutionId,
    solutionName,
    { operationId: currentOperationId, operations: solutionOperations },
    section,
  );
}

/** Breadcrumb "All solutions" / any return to workspace scope. */
export function exitToWorkspace(section = 'solutions'): void {
  if (!canLeaveCurrent()) return;
  exitSolutionScope(section);
}

/** Make the shell state match a route (used at boot and on hashchange). */
async function applyRoute(route: Route): Promise<void> {
  const cur = currentRoute();
  if (route.solutionId === cur.solutionId && route.section === cur.section) return;
  const valid = sectionsForScope(route.solutionId !== null).some((s) => s.id === route.section);
  const section = valid ? route.section : route.solutionId ? 'overview' : 'solutions';
  if (route.solutionId === cur.solutionId) {
    navigateSection(section);
  } else if (route.solutionId) {
    await openSolutionScoped(route.solutionId, undefined, section);
  } else {
    exitToWorkspace(section);
  }
}

/** Boot: apply the landing hash, then keep hash and state in step. */
export function initRouter(): void {
  void applyRoute(parseHash(window.location.hash))
    .catch(() => {
      // A dead solution route (deleted id, cold cache) falls back to workspace.
      exitSolutionScope();
    })
    .finally(() => {
      // Make the landing URL legible even when the default state already matched.
      window.location.hash = hashFor(currentRoute());
    });

  shellStore.subscribe(() => {
    const expected = hashFor(currentRoute());
    if (window.location.hash !== expected) window.location.hash = expected;
  });

  window.addEventListener('hashchange', () => {
    const target = parseHash(window.location.hash);
    const cur = currentRoute();
    if (target.solutionId === cur.solutionId && target.section === cur.section) return;
    void applyRoute(target).then(() => {
      // A vetoed or failed navigation leaves state put — rewrite the hash to it.
      const expected = hashFor(currentRoute());
      if (window.location.hash !== expected) window.location.hash = expected;
    });
  });
}
