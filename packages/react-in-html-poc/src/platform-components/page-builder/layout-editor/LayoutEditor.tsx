import { useLayoutEditorState } from './useLayoutEditorState';
import { LayoutCanvas, css as canvasCss } from './LayoutCanvas';
import { LayoutSidebar, css as sidebarCss } from './LayoutSidebar';

interface Props {
  pagePath: string;
}

function LayoutEditorComponent({ pagePath }: Props) {
  const { state, actions } = useLayoutEditorState(pagePath);

  return (
    <div className="le-editor">
      <LayoutSidebar
        layout={state.current}
        selectedPanelId={state.selectedPanelId}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        actions={actions}
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
