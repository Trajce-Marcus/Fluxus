// Every page's validation findings, in the panel the Console already had.
//
// `validatePage` has run on every save since the page-wiring work, but it
// reported to the browser's devtools console — somewhere nobody is looking
// while they author. A real page in a real database was found on 2026-08-11
// naming a GET while declaring no record: legal, but its reads are not logged,
// which is exactly what the warning says and nobody saw it. Nothing about the
// checking was missing; only its audience was.
//
// So this adds no validator and no rule. It runs the existing one over every
// page in the open solution — not only the one being edited, so a page that
// drifted before a check existed surfaces without anyone opening it — and puts
// the findings on screen. Cheap enough to do on render: pages are in the
// client's snapshot already, and there are tens of them, not thousands.

import type { PageDef, PageFinding } from '@fluxus/page-runtime';
import { pageRuntime } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';
import { useShellState } from '../shell/useShellState';
import { listPagePaths, loadPage } from './persistence';

export interface PageProblem extends PageFinding {
  pagePath: string;
}

/** Findings for every page in the open solution, errors first. */
export function collectPageProblems(): PageProblem[] {
  const problems: PageProblem[] = [];
  for (const pagePath of listPagePaths()) {
    const def = loadPage(pagePath);
    if (!def) continue;
    for (const finding of pageRuntime.validatePage(def as PageDef)) {
      problems.push({ ...finding, pagePath });
    }
  }
  return problems.sort((a, b) => {
    const rank = (p: PageProblem) => (p.diagnostic.severity === 'error' ? 0 : 1);
    return rank(a) - rank(b) || a.pagePath.localeCompare(b.pagePath);
  });
}

/** "2 errors, 1 warning" — or nothing at all when the pages are clean. */
export function ProblemSummary({ problems }: { problems: PageProblem[] }) {
  if (problems.length === 0) return null;
  const errors = problems.filter((p) => p.diagnostic.severity === 'error').length;
  const warnings = problems.length - errors;
  const parts = [
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : null,
    warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return <span className={errors > 0 ? 'problem-count error' : 'problem-count warning'}>{parts.join(', ')}</span>;
}

export function PageProblems({ problems }: { problems: PageProblem[] }) {
  // Read so the list re-renders when a page is written; the value itself is
  // not used, the recomputation is.
  useShellState(['pagesVersion']);

  if (problems.length === 0) {
    return <p className="problem-none">No problems in {listPagePaths().length} page(s).</p>;
  }

  return (
    <ul className="problem-list">
      {problems.map((problem, i) => (
        <li key={`${problem.pagePath}:${problem.where}:${i}`} className={`problem problem-${problem.diagnostic.severity}`}>
          <button
            className="problem-open"
            title={`Open ${problem.pagePath}`}
            onClick={() => openPage(problem.pagePath)}
          >
            {problem.pagePath}
          </button>
          <span className="problem-where">{problem.where}</span>
          <span className="problem-message">{problem.diagnostic.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Open the offending page in a tab — a problem you cannot reach is a nag. */
function openPage(path: string): void {
  shellStore.set((prev) => ({
    ...prev,
    openTabs: prev.openTabs.includes(path) ? prev.openTabs : [...prev.openTabs, path],
    activeTab: path,
  }));
}

export const css = `
  .problem-none {
    margin: 0;
    color: var(--color-text-muted);
  }
  .problem-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .problem {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0 2px 8px;
    border-left: 2px solid transparent;
    line-height: 1.5;
  }
  .problem-error { border-left-color: var(--color-danger, #dc2626); }
  .problem-warning { border-left-color: var(--color-warning, #d97706); }
  .problem-open {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    color: var(--color-accent);
    flex-shrink: 0;
    text-align: left;
  }
  .problem-open:hover { text-decoration: underline; }
  .problem-where {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .problem-message { color: var(--color-text); }
  .problem-count.error { color: var(--color-danger, #dc2626); }
  .problem-count.warning { color: var(--color-warning, #d97706); }
`;
