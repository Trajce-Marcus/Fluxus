// Renders a published page in the Runtime app's content area via
// @fluxus/page-runtime (approved MVP slice, 2026-07-19). The stored PageDef
// supplies slot configs and context schema; the renderer's css rides a plain
// <style> tag — the Runtime app renders in the light DOM, no shadow root.

import { PageRenderer, pageRendererCss } from '@fluxus/page-runtime';
import { pageRuntime } from '../host';

export function PageView({ path, recordId }: { path: string; recordId?: string }) {
  const def = pageRuntime.getPage(path);

  // `.page-view`, not `.panel` — that class came from the workbench and is
  // scoped under `.workbench`, which this app has not mounted since M15. The
  // page area was therefore an unstyled block: no flex, no height, so a page
  // sized itself to its content and its panels were squeezed (found 2026-08-20
  // through a work order list whose action buttons had nowhere to be).
  return (
    <div className="page-view">
      <style>{pageRendererCss}</style>
      {def ? (
        <PageRenderer
          runtime={pageRuntime}
          pagePath={path}
          slotConfigs={def.slotConfigs ?? {}}
          contextSchema={def.contextSchema ?? []}
          recordId={recordId}
        />
      ) : (
        <div className="page-view-message">
          Page '{path}' is not in the snapshot.
        </div>
      )}
    </div>
  );
}
