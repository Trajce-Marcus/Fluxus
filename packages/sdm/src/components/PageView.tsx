// Renders a published page in the workbench content area via
// @fluxus/page-runtime (approved MVP slice, 2026-07-19). The stored PageDef
// supplies slot configs and context schema; the renderer's css rides a plain
// <style> tag — the workbench renders in the light DOM, no shadow root.

import { PageRenderer, pageRendererCss } from '@fluxus/page-runtime';
import { pageRuntime } from '../host';
import { ComponentLabel } from '../context/UatLabels';

export function PageView({ path }: { path: string }) {
  const def = pageRuntime.getPage(path);

  return (
    <div className="panel" style={{ position: 'relative' }}>
      <ComponentLabel name="PageView" />
      <style>{pageRendererCss}</style>
      {def ? (
        <PageRenderer
          runtime={pageRuntime}
          pagePath={path}
          slotConfigs={def.slotConfigs ?? {}}
          contextSchema={def.contextSchema ?? []}
        />
      ) : (
        <div className="panel-body" style={{ color: '#64748b' }}>
          Page '{path}' is not in the snapshot.
        </div>
      )}
    </div>
  );
}
