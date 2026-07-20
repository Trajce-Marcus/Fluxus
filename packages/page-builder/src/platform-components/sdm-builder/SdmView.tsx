// Content-area router for SDM editor tabs (keys prefixed `sdm/`). The shell's
// ContentArea delegates here when the active tab is an SDM section.

import { RecordTypesEditor } from './RecordTypesEditor';
import { AttributesEditor } from './AttributesEditor';
import { RolesEditor } from './RolesEditor';

export function SdmView({ tab }: { tab: string }) {
  switch (tab) {
    case 'sdm/record-types':
      return <RecordTypesEditor />;
    case 'sdm/attributes':
      return <AttributesEditor />;
    case 'sdm/roles':
      return <RolesEditor />;
    default:
      return <div className="admin-panel"><p className="admin-muted">Unknown SDM view: {tab}</p></div>;
  }
}

// SDM editors reuse the shared `.admin-*` classes; these add the master/detail
// split and custom-field table used by the record-type/attribute editors.
export const css = `
  .sdm-split { display: flex; gap: 16px; align-items: flex-start; }
  .sdm-list { display: flex; flex-direction: column; gap: 2px; min-width: 200px; flex-shrink: 0; }
  .sdm-list-item {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
    text-align: left; background: none; border: 1px solid transparent; cursor: pointer;
    color: var(--color-text); padding: 6px 10px; border-radius: 4px; font-size: 0.82rem;
  }
  .sdm-list-item:hover { background: rgba(255,255,255,0.04); }
  .sdm-list-item.active { background: rgba(255,255,255,0.07); border-color: var(--color-border); }
  .sdm-list-sub { font-size: 0.72rem; color: var(--color-text-muted); }
  .sdm-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .sdm-checks { display: flex; flex-wrap: wrap; gap: 12px; }
  .admin-check { display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; }
  .sdm-fields { border-top: 1px solid var(--color-border); padding-top: 10px; }
  .sdm-fields-head { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin-bottom: 6px; }
  .admin-actions { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--color-border); }
  .admin-btn-ghost { background: none; border: 1px solid var(--color-border); color: var(--color-text); }
  .admin-btn-ghost:hover { background: rgba(255,255,255,0.05); }
`;
