import { useState } from 'react';
import { Workbench } from '@fluxus/sdm';
import { currentSession, openSolution, sdmClient } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';
import { useShellState } from '../shell/useShellState';

// The workbench, hosted in the Console (CONSOLE_RUNTIME_SPEC §4, M15). It came
// out of the Runtime app because raw record access, running any activity, CSV
// import and the schema navigator are implementer work — and because the SDM
// editor two clicks away was authoring blind against data it could not see.
// The component owns everything record-shaped; this host hands over the design
// scope's client and the operation choice. **The operation picker lives in the
// workbench's own side menu** (ruled 2026-07-31 — it moved out of the header):
// the model is the solution's, the records are one operation's, and the control
// belongs next to the data it governs. The choice stays solution-wide (the page
// preview reads it too) and nothing is auto-picked — a solution opens with no
// operation until someone chooses.

function WorkbenchViewComponent() {
  const { solutionId, dataOperationId, dataOperations } = useShellState([
    'solutionId', 'dataOperationId', 'dataOperations',
  ]);
  const [error, setError] = useState<string | null>(null);

  const user = currentSession
    ? { id: currentSession.id, name: currentSession.name, email: currentSession.email, roles: [] }
    : undefined;

  // Picking an operation re-opens the solution against that partition and bumps
  // scopeVersion, so every solution-scoped view (this one, the page preview)
  // remounts on the same data. The model and draft pages are untouched — they
  // are solution-scoped. Selecting none reconnects with no partition.
  //
  // A failed switch must SAY so: the `<select>` is controlled by the committed
  // choice, so a rejected re-open silently snaps it back to the old operation
  // and reads as "the picker doesn't work".
  async function selectOperation(operationId: string | null) {
    if (!solutionId) return;
    setError(null);
    try {
      await openSolution(solutionId, operationId);
      shellStore.set((prev) => ({ ...prev, dataOperationId: operationId, scopeVersion: prev.scopeVersion + 1 }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[workbench] switching operation failed', e);
      setError(message);
    }
  }

  return (
    <div className="workbench-host">
      <Workbench
        client={sdmClient}
        user={user}
        operationId={dataOperationId}
        operations={dataOperations}
        operationError={error}
        onSelectOperation={(id) => void selectOperation(id)}
      />
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
