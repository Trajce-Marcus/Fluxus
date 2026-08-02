// Organisation → People (M17). Two audiences, one section, chosen in the inner
// panel: **Users** — the org pool, who exists to us at all — and **Solution
// users** — who builds each solution, at read or write.
//
// "Members" was drift and is retired (ruled 2026-08-02): the binding terms are
// users / org users / op users, one word per layer.
//
// Operation-scoped role assignments are deliberately *not* here: they belong to
// an operation, and live in the operation view (M11).

import { useState } from 'react';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';
import { SolUsersAdmin } from './SolUsersAdmin';
import { Placeholder } from './Placeholder';

const VIEWS = [
  { id: 'users', label: 'Users', sub: 'the org pool' },
  { id: 'solusers', label: 'Solution users', sub: 'who builds each solution' },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

export function PeopleAdmin() {
  const [view, setView] = useState<ViewId>('users');

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

      {view === 'users' ? (
        <Placeholder
          title="Users"
          sub="The org pool — who exists to this organisation at all. Invite-only; email is the key, and the auth id binds on first sign-in."
          items={[
            'Invite a user into the organisation',
            'The pool, with each user\u2019s status and org-admin level',
            'Suspend, reinstate or remove a user',
            'Which operations each user has been added to',
          ]}
        />
      ) : (
        <SolUsersAdmin />
      )}
    </>
  );
}
