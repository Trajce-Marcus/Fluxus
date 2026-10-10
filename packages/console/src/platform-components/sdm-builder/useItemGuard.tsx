// One model entity at a time (2026-10-10, the user's rule). Moving off the item
// being edited — selecting another in the list, or starting a New one — while
// it has unsaved changes asks first: Save, Discard, or Cancel. So a save always
// writes the one entity you were working on, never edits spread across several
// that land together and can half-succeed.
//
// Shared by every SDM editor with a list (record types, attributes, activities,
// workflows). Leaving the editor altogether is the shell's `canLeave` guard,
// unchanged.

import { useState, type ReactNode } from 'react';

/** Where to land after a Save, which remounts the editor (refreshSolutionViews)
 *  and so loses its selection. Keyed by editor; read once on mount. */
const landOn = new Map<string, string>();

/** The index an editor should open on: the item a guarded Save was moving to,
 *  else the first. */
export function initialSelection<T>(editor: string, items: T[], idOf: (item: T) => string): number {
  const id = landOn.get(editor);
  landOn.delete(editor);
  if (id === undefined) return 0;
  return Math.max(0, items.findIndex((item) => idOf(item) === id));
}

interface GuardOptions {
  dirty: boolean;
  /** Whether Save is possible right now (e.g. no id problems). */
  canSave: boolean;
  /** Persist the draft; resolves true when it saved. A successful save
   *  remounts the editor. */
  save: () => Promise<boolean>;
  /** Throw the draft away, back to what is stored. */
  discard: () => void;
}

interface Pending {
  /** The item being moved to, by id; null for New. */
  targetId: string | null;
  /** Carry on once the draft is clean; `discarded` says the draft was reset. */
  proceed: (discarded: boolean) => void;
}

export function useItemGuard(editor: string, options: GuardOptions): {
  guard: (targetId: string | null, proceed: (discarded: boolean) => void) => void;
  prompt: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);

  function guard(targetId: string | null, proceed: (discarded: boolean) => void) {
    if (!options.dirty) proceed(false);
    else setPending({ targetId, proceed });
  }

  async function saveThenGo() {
    if (!pending) return;
    setSaving(true);
    // A Save remounts the editor, so the move is finished by the next mount.
    // New has no item to land on: after the save, New is pressed again.
    if (pending.targetId !== null) landOn.set(editor, pending.targetId);
    const ok = await options.save();
    setSaving(false);
    if (!ok) landOn.delete(editor); // stay put; the editor shows the error
    setPending(null);
  }

  function discardThenGo() {
    if (!pending) return;
    options.discard();
    pending.proceed(true);
    setPending(null);
  }

  const prompt = pending && (
    <div className="admin-overlay" onClick={() => !saving && setPending(null)}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="admin-modal-title">Unsaved changes</h3>
        <p className="admin-sub">This item has changes that are not saved. Save them before moving on, or discard them.</p>
        {!options.canSave && <div className="admin-error">It cannot be saved as it stands — fix the error shown, or discard.</div>}
        <div className="admin-row admin-modal-actions">
          <button className="admin-btn" onClick={saveThenGo} disabled={saving || !options.canSave}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="admin-btn admin-btn-ghost" onClick={discardThenGo} disabled={saving}>Discard</button>
          <button className="admin-link" onClick={() => setPending(null)} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );

  return { guard, prompt };
}
