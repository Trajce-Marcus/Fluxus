// The dialog a page opens when a UI activity is run from a component
// (`services.activities.run`). Until 2026-08-16 it drew its own form — every
// attribute a text box, no dropdowns, no conditions, no waivers — because
// "peer hosts can't share React components". That reason expired when
// page-runtime became a library, so this is now chrome only: the standard
// capture form (./capture) does the work, exactly as it does in the workbench.

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

export function ActivityFormModal({ activity, anchorRecord, recordTypeId, host, seed, pageRecord, onSubmit, onClose }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, minWidth: 340, maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{activity.name}</div>
        <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
          {activity.description}
          {anchorRecord ? ` — ${anchorRecord.id}` : ''}
        </div>
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
      </div>
    </div>
  );
}
