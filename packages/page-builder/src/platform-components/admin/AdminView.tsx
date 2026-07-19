// Content-area router for admin tabs (keys prefixed `admin/`). The shell's
// ContentArea delegates here when the active tab is an admin section; page
// tabs still render the PageEditor.

import { OperationsAdmin, css as operationsCss } from './OperationsAdmin';
import { AssignmentsAdmin } from './AssignmentsAdmin';
import { ImplementersAdmin } from './ImplementersAdmin';
import { MenuAdmin, css as menuCss } from './MenuAdmin';

export function AdminView({ tab }: { tab: string }) {
  switch (tab) {
    case 'admin/operations':
      return <OperationsAdmin />;
    case 'admin/menu':
      return <MenuAdmin />;
    case 'admin/assignments':
      return <AssignmentsAdmin />;
    case 'admin/implementers':
      return <ImplementersAdmin />;
    default:
      return <div className="admin-panel"><p className="admin-muted">Unknown admin view: {tab}</p></div>;
  }
}

// The shared admin CSS lives in OperationsAdmin; all admin panels use its
// `.admin-*` classes. MenuAdmin adds its own `.menu-*` rules.
export const css = operationsCss + menuCss;
