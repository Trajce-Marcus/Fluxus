import type { ContextUser } from '@fluxus/engine';
import type { FluxusClient } from '@fluxus/client';
import { WorkbenchProvider } from './WorkbenchContext';
import { RecordTypeList } from './components/RecordTypeList';
import { RecordsGrid } from './components/RecordsGrid';
import { RecordView } from './components/RecordView';

// The workbench, as one component (CONSOLE_RUNTIME_SPEC §4, M15). Raw record
// access, running any activity, CSV import and the schema navigator are
// implementer work, so this mounts in the **Console**; the Runtime app renders
// published pages only. Self-contained by design: record types, grid and
// record view are its three panes and its own context holds all of it — a host
// hands over a connected client and knows nothing else.

export interface WorkbenchProps {
  /** A connected client: the model, the record partition and the run door. */
  client: FluxusClient;
  /** Signed-in identity, for `ctx.user` parity in expression evaluation.
   *  Omitted in the demo (auth unconfigured) posture. */
  user?: ContextUser;
}

export function Workbench({ client, user }: WorkbenchProps) {
  return (
    <WorkbenchProvider client={client} user={user}>
      {/* The chrome rides in the tree, not in a stylesheet import: the Console
          mounts its shell in a **shadow root**, which a bundler-injected
          document-level stylesheet never reaches. A <style> element inside the
          subtree applies in both a shadow root and the light DOM — same
          reasoning as PageView's <style>{pageRendererCss}</style>. `css` is
          exported too, for a host that would rather pipe it through its own
          injection channel. */}
      <style>{css}</style>
      <div className="workbench">
        <div className="workbench-types">
          <RecordTypeList />
        </div>
        <div className="workbench-panes">
          <div className="panel">
            <RecordsGrid />
          </div>
          <div className="panel">
            <RecordView />
          </div>
        </div>
      </div>
    </WorkbenchProvider>
  );
}

// Scoped under .workbench so it cannot collide with a host's own CSS. The
// record-shaped components inside are inline-styled — these classes are the
// layout frame only. Light palette, matching the Runtime shell it came from; a
// themed workbench waits on the branding config (§10).
export const css = `
  .workbench {
    display: flex;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: #fff;
    color: #0f172a;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    text-align: left;
  }
  .workbench *, .workbench *::before, .workbench *::after {
    box-sizing: border-box;
  }

  /* The record-type list — the workbench's own nav since M15 retired it from
     the Runtime shell. It belongs to the workbench, not to whatever hosts it. */
  .workbench .workbench-types {
    width: 220px;
    flex-shrink: 0;
    background: #f8fafc;
    border-right: 1px solid #e2e8f0;
    overflow-y: auto;
  }

  .workbench .workbench-panes {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  /* Each panel is a fixed header strip over a scrolling body, so grid toolbars
     and record headers stay pinned while the content below them scrolls. */
  .workbench .panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .workbench .panel + .panel {
    border-left: 1px solid #e2e8f0;
  }

  .workbench .panel-header {
    flex-shrink: 0;
    padding: 16px 20px 12px;
    border-bottom: 1px solid #e2e8f0;
    background: #fff;
    position: relative; /* anchors the UAT component label */
  }

  .workbench .panel-body {
    flex: 1;
    overflow: auto;
    padding: 16px 20px 20px;
  }
`;
