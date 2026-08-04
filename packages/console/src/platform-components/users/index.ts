// The Console's user surface (USERS.md → *The screens this implies*).
//
// One pattern at three tiers: each screen shows the tier above it read-only, the
// list it governs editable, and Invite — which only ever adds a person to the
// organisation and carries no admin connotation anywhere it appears.
//
//   OrgUsersScreen        All users · Org admins · Sol admins
//   SolutionUsersScreen   Sol admins (read-only) · Op admins
//   OperationUsersScreen  Op users + roles · Op admins (read-only)
//
// Screens compose; they hold no table markup of their own. `tables/` renders one
// list each and is reused across screens (a read-only flag is the only
// difference between the two places a list appears), `dialogs/` holds every data
// entry — a popup, never an inline form — and `shared/` has the tab strip and
// the load/act cycle.

export { OrgUsersScreen } from './OrgUsersScreen';
export { SolutionUsersScreen } from './SolutionUsersScreen';
export { OperationUsersScreen } from './OperationUsersScreen';

import { css as tabsCss } from './shared/UserTabs';
import { css as solAdminsCss } from './tables/SolAdminsTable';

/** UI packages export css as a STRING — the Console mounts its shell in a shadow
 *  root that a document-level stylesheet never reaches. */
export const css = tabsCss + solAdminsCss;
