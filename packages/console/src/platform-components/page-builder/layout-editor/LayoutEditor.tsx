import { useLayoutEditorState } from './useLayoutEditorState';
import { LayoutCanvas, css as canvasCss } from './LayoutCanvas';
import { LayoutSidebar, css as sidebarCss } from './LayoutSidebar';
import { usePageEditorStore } from '../pageEditorStore';

interface Props {
  pagePath: string;
}

function LayoutEditorComponent({ pagePath }: Props) {
  const { state, actions } = useLayoutEditorState(pagePath);
  // Which panels hold a component — a Move ↓ into one would turn it into a
  // container and cut its component loose.
  const slotConfigs = usePageEditorStore(pagePath).get().slotConfigs;
  const holdsComponent = (panelId: string) => !!slotConfigs[panelId];

  return (
    <div className="le-editor">
      <LayoutSidebar
        layout={state.current}
        selectedPanelId={state.selectedPanelId}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        actions={actions}
        holdsComponent={holdsComponent}
      />
      <LayoutCanvas
        layout={state.current}
        selectedPanelId={state.selectedPanelId}
        onSelectPanel={actions.selectPanel}
        onRenamePanel={(id, name) => actions.updatePanel(id, { name: name || undefined })}
        onNavigate={actions.navigate}
      />
    </div>
  );
}

export const css = `
  ${sidebarCss}
  ${canvasCss}

  .le-editor {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }
`;

export const LayoutEditor = LayoutEditorComponent;
