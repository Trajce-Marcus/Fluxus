import { useShellState } from './useShellState';
import { PageEditor } from '../page-builder/PageEditor';
import { AdminView } from '../admin/AdminView';
import { SdmView } from '../sdm-builder/SdmView';

function ContentAreaComponent() {
  const { activeTab } = useShellState(['activeTab']);

  if (!activeTab) {
    return (
      <div className="content-area content-area-empty">
        <p className="content-empty-hint">Select an item from the sidebar to open it</p>
      </div>
    );
  }

  return (
    <div className="content-area">
      {activeTab.startsWith('admin/') ? (
        <AdminView tab={activeTab} />
      ) : activeTab.startsWith('sdm/') ? (
        <SdmView tab={activeTab} />
      ) : (
        <PageEditor pagePath={activeTab} />
      )}
    </div>
  );
}

export const css = `
  .content-area {
    flex: 1;
    overflow: hidden;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
  }
  .content-area-empty {
    align-items: center;
    justify-content: center;
  }
  .content-empty-hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }
`;

export const ContentArea = ContentAreaComponent;
