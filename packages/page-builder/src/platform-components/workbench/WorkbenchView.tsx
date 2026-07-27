import { Workbench } from '@fluxus/sdm';
import { currentOperationId, currentSession, sdmClient } from '../../sdm-runtime/engine';

// The workbench, hosted in the Console (CONSOLE_RUNTIME_SPEC §4, M15). It came
// out of the Runtime app because raw record access, running any activity, CSV
// import and the schema navigator are implementer work — and because the SDM
// editor two clicks away was authoring blind against data it could not see.
// The component owns everything record-shaped; all this host does is hand over
// the design scope's client. It runs against the solution's current data
// operation (the header's Data picker, M9), so switching there switches the
// records here — the shell remounts on scopeVersion.

function WorkbenchViewComponent() {
  if (!currentOperationId) {
    return (
      <div className="workbench-host workbench-host-empty">
        <p className="workbench-host-title">No data operation</p>
        <p className="workbench-host-hint">
          The workbench reads and writes an operation's records. This solution has no
          operations yet — create one under Workspace → Operations, then reopen the solution.
        </p>
      </div>
    );
  }

  const user = currentSession
    ? { id: currentSession.id, name: currentSession.name, email: currentSession.email, roles: [] }
    : undefined;

  return (
    <div className="workbench-host">
      <Workbench client={sdmClient} user={user} />
    </div>
  );
}

export const css = `
  .workbench-host {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* The workbench brings its own (light) chrome — end-user surface, not
     Console chrome. Until branding config lands (§10) the empty state is the
     only part styled to the Console's palette. */
  .workbench-host-empty {
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
  }
  .workbench-host-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .workbench-host-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    max-width: 34em;
  }
`;

export const WorkbenchView = WorkbenchViewComponent;
