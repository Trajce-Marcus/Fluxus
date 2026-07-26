// Content-area router for admin tabs (keys prefixed `admin/`). The shell's
// ContentArea delegates here when the active tab is an admin section; page
// tabs still render the PageEditor.

import { SolutionsAdmin } from './SolutionsAdmin';
import { OperationsAdmin, css as operationsCss } from './OperationsAdmin';
import { ImplementersAdmin } from './ImplementersAdmin';
import { css as menuCss } from './OperationMenuSection';

export function AdminView({ tab }: { tab: string }) {
  switch (tab) {
    case 'admin/solutions':
      return <SolutionsAdmin />;
    case 'admin/operations':
      return <OperationsAdmin />;
    case 'admin/implementers':
      return <ImplementersAdmin />;
    default:
      return <div className="admin-panel"><p className="admin-muted">Unknown admin view: {tab}</p></div>;
  }
}

// The shared admin CSS lives in OperationsAdmin; all admin panels use its
// `.admin-*` classes. OperationMenuSection adds the `.menu-*` rules (shared
// with the solution-level MenuEditor via MenuItemsEditor).
export const css = operationsCss + menuCss;
