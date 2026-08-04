// Content router for the organisation (workspace) sections (registry ids,
// M16; Neon-style org set M17).

import { OrganisationAdmin, css as orgCss } from './OrganisationAdmin';
import { SolutionsAdmin } from './SolutionsAdmin';
import { css as operationsCss } from './OperationsAdmin';
import { OrgUsersSection, css as orgUsersCss } from './OrgUsersSection';
import { BillingAdmin } from './BillingAdmin';
import { Placeholder, css as placeholderCss } from './Placeholder';
import { css as menuCss } from './OperationMenuSection';
import { css as operationViewCss } from './OperationView';

export function AdminView({ tab }: { tab: string }) {
  switch (tab) {
    case 'solutions':
      return <SolutionsAdmin />;
    /* Operations left the organisation menu (M17): an operation is
       administered inside the solution it runs — `SolutionOperationsSection`. */
    /* Users (2026-08-04): the org pool, straight into the main area — no inner
       panel, no sub-views. Solution users left the organisation menu the same
       day (ruled): who builds a solution is a question about that solution. */
    case 'users':
      return <OrgUsersSection />;
    case 'billing':
      return <BillingAdmin />;
    case 'integrations':
      return (
        <Placeholder
          title="Integrations"
          sub="Connecting this organisation to the outside world. Nothing is wired yet."
          items={[
            'Outbound webhooks on activity runs',
            'Identity provider / SSO',
            'File storage (the R2 seam)',
            'Email and notification delivery',
            'API keys for machine callers',
          ]}
        />
      );
    case 'settings':
      return <OrganisationAdmin />;
    default:
      return <div className="admin-panel"><p className="admin-muted">Unknown organisation view: {tab}</p></div>;
  }
}

// The shared admin CSS lives in OperationsAdmin; all admin panels use its
// `.admin-*` classes. OperationMenuSection adds the `.menu-*` rules (shared
// with the solution-level MenuEditor via MenuItemsEditor); OperationView adds
// the `.op-*` tab strip.
export const css = operationsCss + menuCss + orgCss + placeholderCss + operationViewCss + orgUsersCss;
