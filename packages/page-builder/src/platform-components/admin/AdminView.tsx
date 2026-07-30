// Content router for the workspace admin sections (registry ids, M16).

import { OrganisationAdmin, css as orgCss } from './OrganisationAdmin';
import { SolutionsAdmin } from './SolutionsAdmin';
import { OperationsAdmin, css as operationsCss } from './OperationsAdmin';
import { ImplementersAdmin } from './ImplementersAdmin';
import { css as menuCss } from './OperationMenuSection';

export function AdminView({ tab }: { tab: string }) {
  switch (tab) {
    case 'organisation':
      return <OrganisationAdmin />;
    case 'solutions':
      return <SolutionsAdmin />;
    case 'operations':
      return <OperationsAdmin />;
    case 'implementers':
      return <ImplementersAdmin />;
    default:
      return <div className="admin-panel"><p className="admin-muted">Unknown admin view: {tab}</p></div>;
  }
}

// The shared admin CSS lives in OperationsAdmin; all admin panels use its
// `.admin-*` classes. OperationMenuSection adds the `.menu-*` rules (shared
// with the solution-level MenuEditor via MenuItemsEditor).
export const css = operationsCss + menuCss + orgCss;
