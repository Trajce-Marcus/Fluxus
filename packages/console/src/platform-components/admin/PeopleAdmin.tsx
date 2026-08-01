// Organisation → People (M17). Two audiences, one section, chosen in the inner
// panel: **Members** — who belongs to the org — is not built (it needs the auth
// tier to resolve user → org, the same gap that blocks org signup, §1a); and
// **Implementer levels** — design-time access per solution — which is real and
// moves here from its own workspace nav item.
//
// Operation-scoped role assignments are deliberately *not* here: they belong to
// an operation, and live in the operation view (M11).

import { useState } from 'react';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';
import { ImplementersAdmin } from './ImplementersAdmin';
import { Placeholder } from './Placeholder';

const VIEWS = [
  { id: 'members', label: 'Members', sub: 'org users' },
  { id: 'implementers', label: 'Implementer levels', sub: 'design-time access' },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

export function PeopleAdmin() {
  const [view, setView] = useState<ViewId>('members');

  return (
    <>
      <InnerPanel title="People">
        {VIEWS.map((v) => (
          <PanelItem
            key={v.id}
            name={v.label}
            sub={v.sub}
            active={view === v.id}
            onClick={() => setView(v.id)}
          />
        ))}
      </InnerPanel>

      {view === 'members' ? (
        <Placeholder
          title="Members"
          sub="Who belongs to this organisation. Needs the auth tier to resolve user → org, which it does not do yet."
          items={[
            'Invite a user to the organisation',
            'Member list with organisation-level roles',
            'Remove / suspend a member',
            'Which operations each member is assigned to',
          ]}
        />
      ) : (
        <ImplementersAdmin />
      )}
    </>
  );
}
