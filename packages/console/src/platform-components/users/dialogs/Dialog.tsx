// The dialog shell. Data entry goes in a popup over the screen, never an inline
// form on it (ruled 2026-08-04) — the list stays visible, and the screen stays a
// list rather than turning into a form.

import type { ReactNode } from 'react';

export function Dialog({ title, sub, error, onClose, children }: {
  title: string;
  sub?: ReactNode;
  /** Shown inside the dialog, where the input that caused it still is — the
   *  panel's error band would sit behind the overlay. */
  error?: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="admin-modal-title">{title}</h3>
        {sub && <p className="admin-sub">{sub}</p>}
        {error && <div className="admin-error" style={{ marginTop: 12 }}>{error}</div>}
        {children}
      </div>
    </div>
  );
}
