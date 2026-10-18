// Renders an app's published page in the Runtime app's content area via
// @fluxus/page-runtime (approved MVP slice, 2026-07-19). The stored PageDef
// supplies slot configs and context schema; the renderer's css rides a plain
// <style> tag — the Runtime app renders in the light DOM, no shadow root. The
// page sees its app as `context.app` (APPS_AND_INSTANCES §2.2).

import { useMemo } from 'react';
import { PageRenderer, pageRendererCss, type PageAppContext } from '@fluxus/page-runtime';
import type { UserApp } from '@fluxus/client';
import { historyScroll, pageRuntime, saveScroll } from '../host';

/** The app's definition is JSON as text; one that will not parse reads as empty. */
function parseDefinition(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function PageView({ app, recordId }: { app: UserApp; recordId?: string }) {
  const def = pageRuntime.getPage(app.pageId);
  const appContext = useMemo<PageAppContext>(
    () => ({ pageId: app.pageId, label: app.label, definition: parseDefinition(app.definition) }),
    [app],
  );

  // `.page-view`, not `.panel` — that class came from the workbench and is
  // scoped under `.workbench`, which this app has not mounted since M15. The
  // page area was therefore an unstyled block: no flex, no height, so a page
  // sized itself to its content and its panels were squeezed (found 2026-08-20
  // through a work order list whose action buttons had nowhere to be).
  //
  // Keyed on the app: two apps made from one page (a water and a sewer
  // scheduler) are two apps, so switching between them starts the page afresh.
  return (
    <div className="page-view">
      <style>{pageRendererCss}</style>
      {def ? (
        <PageRenderer
          key={app.id}
          runtime={pageRuntime}
          pagePath={app.pageId}
          slotConfigs={def.slotConfigs ?? {}}
          contextSchema={def.contextSchema ?? []}
          recordId={recordId}
          app={appContext}
          savedScroll={historyScroll()}
          onScroll={saveScroll}
        />
      ) : (
        <div className="page-view-message">
          Page '{app.pageId}' is not in the snapshot.
        </div>
      )}
    </div>
  );
}
