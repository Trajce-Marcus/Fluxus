// The dialog a page opens when a UI activity is run from a component
// (`services.activities.run`). Until 2026-08-16 it drew its own form — every
// attribute a text box, no dropdowns, no conditions, no waivers — because
// "peer hosts can't share React components". That reason expired when
// page-runtime became a library, so this is now chrome only: the standard
// capture form (./capture) does the work, exactly as it does in the workbench.

import { useEffect } from 'react';
import type { ActivityDef, RecordInstance, RunActivityResult } from '@fluxus/engine';
import { AttributesForm } from './capture/AttributesForm';
import { CaptureHostProvider, type CaptureHost } from './capture/host';
import type { AttributeSeed } from './pageHost';

interface Props {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  /** The record type the activity belongs to — resolves reference labels. */
  recordTypeId: string;
  /** What the form runs against; the PageRuntime's `captureHost`. */
  host: CaptureHost;
  /** Records the control was about, filling one named attribute. */
  seed?: AttributeSeed;
  /** The record the page is about — `context.page.record` in capture expressions. */
  pageRecord?: RecordInstance | null;
  /**
   * The anchor record has not arrived yet. The dialog opens on the click and
   * shows the wait here rather than leaving the click with no visible effect
   * until the round trip lands (2026-09-21, the user's call: the indicator
   * belongs in the dialog, not on the button). The form is not rendered while
   * this is true — an UPDATE prefills from the anchor, so a form built without
   * one would start empty and then have to be rebuilt.
   */
  loading?: boolean;
  /**
   * Runs the activity. The form owns the outcome: 'needs-confirmation' becomes
   * its Continue/Cancel decision, a failure its error banner — so the page
   * host no longer confirms warnings with `window.confirm` for form activities.
   */
  onSubmit: (
    captured: Record<string, unknown>,
    options?: { acknowledgedWarnings?: boolean; waived?: Record<string, string> }
  ) => Promise<RunActivityResult>;
  onClose: () => void;
}

export function ActivityFormModal({ activity, anchorRecord, recordTypeId, host, seed, pageRecord, loading, onSubmit, onClose }: Props) {
  // Escape closes it (2026-09-21). Cancelling capture is free — nothing has run
  // and nothing is staged — so the cheap way out should be the obvious one,
  // including while the anchor is still loading, which is exactly when someone
  // decides they clicked the wrong row.
  //
  // Listening on the document rather than the dialog: focus may sit in an input,
  // on the backdrop, or nowhere at all after the dialog opens on a click.
  // `keydown`, not `keyup` — a browser dialog closes on the press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activity.name}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, minWidth: 340, maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{activity.name}</div>
        <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
          {activity.description}
          {anchorRecord ? ` — ${anchorRecord.id}` : ''}
        </div>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 2px 6px', color: '#64748b', fontSize: 13 }}>
            <span className="afm-spinner" aria-hidden="true" />
            <span role="status">Loading…</span>
          </div>
        ) : (
          <CaptureHostProvider host={host}>
            <AttributesForm
              activity={activity}
              anchorRecord={anchorRecord}
              pageRecord={pageRecord}
              recordTypeId={recordTypeId}
              seed={seed}
              onSubmit={onSubmit}
              onClose={onClose}
            />
          </CaptureHostProvider>
        )}
      </div>
    </div>
  );
}
