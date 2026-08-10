// Renders a published page in the Runtime app's content area via
// @fluxus/page-runtime (approved MVP slice, 2026-07-19). The stored PageDef
// supplies slot configs and context schema; the renderer's css rides a plain
// <style> tag — the Runtime app renders in the light DOM, no shadow root.

import { PageRenderer, pageRendererCss } from '@fluxus/page-runtime';
import { pageRuntime } from '../host';

export function PageView({ path, recordId }: { path: string; recordId?: string }) {
  const def = pageRuntime.getPage(path);

  return (
    <div className="panel" style={{ position: 'relative' }}>
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
        <div className="panel-body" style={{ color: '#64748b' }}>
          Page '{path}' is not in the snapshot.
        </div>
      )}
    </div>
  );
}
