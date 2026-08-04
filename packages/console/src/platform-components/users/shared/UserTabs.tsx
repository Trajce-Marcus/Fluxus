// The tab strip every Users screen wears, and the pieces its tables share.
//
// One pattern, three screens (USERS.md §6 → *The screens this implies*): the
// tier above read-only, the list this screen governs editable, and Invite. The
// strip is presentational — which tabs exist is each screen's business.

import type { JSX, ReactNode } from 'react';

export interface UserTab {
  id: string;
  label: string;
  render: () => JSX.Element;
}

export function UserTabs({ tabs, active, onSelect }: {
  tabs: UserTab[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="users-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`users-tab${t.id === active ? ' active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A list's heading, its one-line explanation, and its action — or, for a
 *  read-only tab, a note saying where the list IS edited. A tab that shows the
 *  tier above must always say where it comes from, or it reads as broken. */
export function ListHead({ title, sub, action }: { title: string; sub: ReactNode; action?: ReactNode }) {
  return (
    <div className="admin-head-row users-list-head">
      <div>
        <h3 className="users-list-title">{title}</h3>
        <p className="admin-sub">{sub}</p>
      </div>
      {action}
    </div>
  );
}

/** An empty list is a real answer, never "unconfigured" — say what the emptiness
 *  MEANS, because "nobody may enter this operation" is a fact worth reading. */
export function EmptyList({ children }: { children: ReactNode }) {
  return <p className="admin-muted users-empty">{children}</p>;
}

/** Someone in the pool who has never signed in is the expected case, not a
 *  degraded one: email is the key, and the auth id binds on first sign-in.
 *  *expired* is an ending rather than a fault, and is styled as one. */
export function StatusPill({ status, title }: { status: string; title?: string }) {
  return <span className={`admin-chip is-${status}`} title={title}>{status}</span>;
}

// Shared `admin-*` rules that arrived with the first Users screen (2026-08-04)
// and outlived it — they are generic, so they live with the shared pieces:
//   .admin-row   — a row of controls (SolutionsAdmin relies on it too).
//   .admin-chip  — a status word as a chip; status is scanned, not read.
//   .is-danger   — destructive variant, reusing the .admin-error reds.
export const css = `
  .admin-row { display: flex; align-items: center; gap: 12px; }

  .admin-chip {
    display: inline-block;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 0.72rem;
    color: var(--color-text-muted);
    text-transform: lowercase;
  }
  .admin-chip.is-active { color: var(--color-text); }
  .admin-chip.is-suspended { border-color: #7a2a2a; background: #5a1d1d; color: #f4d0d0; }
  /* Expired is an ending, not an alarm — the row recedes rather than shouting. */
  .admin-chip.is-expired { border-style: dashed; }

  .admin-btn.is-danger { background: #7a2a2a; }
  .admin-link.is-danger { color: #e08585; }
  .admin-link:disabled { opacity: 0.5; cursor: default; }

  .users-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-border); margin: 0 0 20px; }
  .users-tab {
    background: none; border: none; border-bottom: 2px solid transparent;
    padding: 8px 14px; margin-bottom: -1px;
    color: var(--color-text-muted); font: inherit; font-size: 0.86rem; cursor: pointer;
  }
  .users-tab:hover { color: var(--color-text); }
  .users-tab.active { color: var(--color-text); border-bottom-color: var(--color-accent, #6ea8fe); }

  .users-list-head { align-items: flex-start; margin-bottom: 14px; }
  .users-list-title { margin: 0 0 4px; font-size: 0.95rem; font-weight: 600; }
  .users-empty { max-width: 62ch; }
  .users-row-expired td { opacity: 0.55; }
  .users-since { font-size: 0.75rem; }
  .users-note { margin-top: 14px; font-size: 0.8rem; color: var(--color-text-muted); max-width: 68ch; }
  .users-stack > * + * { margin-top: 28px; }
`;
