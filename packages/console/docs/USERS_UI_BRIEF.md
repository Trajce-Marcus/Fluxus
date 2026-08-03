# Console Users UI — design brief

Written 2026-08-02, for handing to a design agent. The server half of the users
model is built and pushed (`49acb79`); this is the only unbuilt piece. Domain
rules here are settled — see `docs/RBAC_COMPACT.md` → *Users* + *Administration*
and `packages/server/docs/SPEC.md`. Do not reopen them.

---

## 1. Product context

**Fluxus** is a model-first platform: customers describe their business as a
model (record types, workflows, activities) and the platform runs the
application from it. Two apps sit on that model — the **Console** (design +
administration plane, what you are designing for) and the **Runtime** (what end
users sign into).

| Noun | What it is |
|---|---|
| **Organisation** | The tenant. Everything hangs under it. |
| **Solution** | The *design artifact* — model, pages, default menu. Built once, reused. |
| **Operation** | A *running instance* of a solution — one business unit's live data. Links to exactly one solution, permanently. |

## 2. The domain model you are rendering

Three membership layers. Each answers a different question, and they are
deliberately **not merged**:

| Layer | Table | The question | Levels |
|---|---|---|---|
| Organisation | `org_users` | Does this person exist to us at all? | admin / user |
| Solution | `sol_users` | Who builds it? | read / write |
| Operation | `op_users` | May they enter it? | admin / user |

`admin` means the same thing on every row: *governs this layer*.

**Roles are not a fourth layer.** `user_roles` is an *attribute* of being an op
user: an op user with no row enters and sees nothing (valid); a row without an
`op_users` row grants no entry at all.

Consequences that shape the interface:

- **Email is the identity key**, not a user id. People are invited by email and
  may have **no account yet**. A user who has never signed in must render as a
  normal, complete row — not greyed out, not an error, not a second-class
  "pending" thing. This is the expected case.
- **Invite-only. No signup.**
- **Every gate is strict.** An operation with no op users admits nobody; a
  solution with no sol users admits nobody to its design plane. An empty list is
  a real, meaningful state — not "unconfigured". Empty-state copy must say what
  it *means*, not prompt setup.
- **An op user with no roles is valid.** Not broken, not incomplete.

### The admin tiers

Authority has one root and flows **downward only**. No tier appoints its own tier.

| Tier | Owns |
|---|---|
| **Org admin** | *Identity.* Invites, lifecycle, appointing admins of any tier, adding people to operations, creating solutions and operations. |
| **Op admin** | *Authorization inside one operation.* Its op-user list, its roles, its menu. |
| **Sol user (`write`)** | The design plane only — model, pages. **Zero user visibility.** Never sees these screens. |

**The escalation rule you must reflect:** an op admin can add plain users to
their operation but **can never make someone an op admin**. Only an org admin can.

## 3. Terminology — binding, do not paraphrase

Use **users**, **org users**, **sol users**, **op users**.

Never: *members*, *memberships*, *implementers*, *teammates*, *seats*,
*accounts*, *staff*, *participants*. "People" only as the existing nav section
name. This vocabulary was standardised deliberately after competing words
drifted; synonyms are a regression, including in microcopy and tooltips.

## 4. Where these surfaces live

Four-region shell:

```
┌─────────────────────────────────────────────────────────────┐
│ Header bar (40px) — org · solution … operation, identity    │
├────────┬──────────────┬─────────────────────────────────────┤
│ Side   │ Inner panel  │  Main content area                  │
│ nav    │ (list of     │  ← your surfaces render here        │
│ 200px  │  things)     │                                     │
└────────┴──────────────┴─────────────────────────────────────┘
```

**Surface 1** — *Organisation → People → Users*. "People" is a side-nav section
whose inner panel offers **Users** (yours) and **Solution users** (exists).

**Surface 2** — the **Users** tab of the operation view (`Overview · Users ·
Menu · Data · Settings`). That tab already contains a **Roles** section
(`UserRolesSection`) which must be left intact; you add a section above it.

## 5. Design system — use this, do not invent one

Dark, dense, developer-tool aesthetic (VS Code lineage). Low chrome, no decoration.

### Tokens (already defined on `.shell`)

```css
--color-bg:           #1e1e1e;   /* main content background */
--color-sidebar:      #252526;   /* panels, cards, forms, modals */
--color-activity:     #333333;
--color-header:       #3c3c3c;
--color-tab-active:   #1e1e1e;
--color-tab-inactive: #2d2d2d;
--color-text:         #cccccc;
--color-text-muted:   #858585;
--color-accent:       #0078d4;
--color-border:       #414141;
```

Base `system-ui, -apple-system, sans-serif` at `13px`; monospace
`ui-monospace, SFMono-Regular, Menlo, monospace`.

There is **no** success-green, warning-amber or wider semantic palette. If you
need a status colour, argue for it in the handback rather than adding it.

### Existing classes — reuse verbatim, do not restyle

```css
.admin-panel      { height:100%; overflow-y:auto; padding:20px 24px; color:var(--color-text); }
.admin-panel-head { margin-bottom:16px; }
.admin-title      { margin:0; font-size:1.1rem; font-weight:600; }
.admin-sub        { margin:4px 0 0; color:var(--color-text-muted); font-size:0.8rem; }
.admin-muted      { color:var(--color-text-muted); font-size:0.85rem; }
.admin-mono       { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:0.78rem; }

.admin-error {
  background:#5a1d1d; color:#f4d0d0; border:1px solid #7a2a2a;
  padding:8px 12px; border-radius:4px; font-size:0.8rem;
  margin-bottom:14px; white-space:pre-wrap;
}

.admin-section       { margin-bottom:24px; }
.admin-section-title { margin:0 0 2px; font-size:0.95rem; font-weight:600;
                       padding-top:14px; border-top:1px solid var(--color-border); }

.admin-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
.admin-table th, .admin-table td { text-align:left; padding:7px 10px;
                                   border-bottom:1px solid var(--color-border); }
.admin-table th { color:var(--color-text-muted); font-weight:600; font-size:0.72rem;
                  text-transform:uppercase; letter-spacing:0.05em; }

.admin-form       { max-width:420px; display:flex; flex-direction:column; gap:10px;
                    background:var(--color-sidebar); border:1px solid var(--color-border);
                    border-radius:6px; padding:16px; }
.admin-form-title { margin:0 0 4px; font-size:0.9rem; font-weight:600; }
.admin-field      { display:flex; flex-direction:column; gap:4px;
                    font-size:0.78rem; color:var(--color-text-muted); }
.admin-field input, .admin-field select {
  background:var(--color-bg); border:1px solid var(--color-border); border-radius:4px;
  color:var(--color-text); padding:6px 8px; font-size:0.85rem; font-family:inherit;
}
.admin-field input:focus, .admin-field select:focus {
  outline:1px solid var(--color-accent); border-color:var(--color-accent);
}

.admin-btn  { align-self:flex-start; margin-top:4px; background:var(--color-accent);
              color:#fff; border:none; border-radius:4px; padding:7px 14px;
              font-size:0.82rem; cursor:pointer; }
.admin-btn:disabled { opacity:0.5; cursor:default; }
.admin-link { background:none; border:none; color:var(--color-accent);
              cursor:pointer; font-size:0.78rem; padding:0; }

.admin-checks { display:flex; flex-direction:column; gap:6px; margin:2px 0; }
.admin-check  { display:flex; align-items:center; gap:8px; font-size:0.82rem;
                color:var(--color-text); cursor:pointer; }
.admin-check input { width:14px; height:14px; }
.admin-hint   { margin:2px 0 0; font-size:0.72rem; color:var(--color-text-muted); }

.admin-head-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.admin-head-row .admin-btn { margin-top:0; }

.admin-overlay      { position:fixed; inset:0; background:rgba(0,0,0,0.5);
                      display:flex; align-items:center; justify-content:center; z-index:1000; }
.admin-modal        { background:var(--color-sidebar); border:1px solid var(--color-border);
                      border-radius:6px; padding:18px 20px; width:420px; max-width:90vw;
                      max-height:80vh; overflow-y:auto; color:var(--color-text); }
.admin-modal-title  { margin:0 0 4px; font-size:0.95rem; }
.admin-modal-form   { display:flex; flex-direction:column; gap:10px; margin-top:14px; }
.admin-modal-actions{ margin-top:4px; }
```

**Missing and likely needed:** a status chip/badge, a destructive-button
variant, possibly a confirm-dialog body. Design them, name them `admin-*`, and
list each in the handback with rationale.

### Technical constraints

- The Console mounts in a **shadow root**. CSS is exported **as a template
  string** per component (`export const css = \`...\``) and concatenated upward.
  **No stylesheet imports, no document-level styles, no CSS-in-JS, no Tailwind.**
- No new dependencies. No icon library — the UI uses text labels.
- React function components with hooks, TypeScript.

## 6. Reference implementation

`UserRolesSection.tsx` is the closest analogue and sits directly below Surface 2:
load in `useEffect`, local `error`/`busy` state, `admin-error` band, a table,
then an `admin-form`. Match its structure, density and copy voice.

**Copy voice:** plain, declarative, explains *why* not just *what*. Never
exclamatory, never apologetic, no emoji. Compare: *"This operation's solution
declares no roles yet — add them in the solution's SDM → Roles."*

## 7. Surface 1 — Organisation → People → Users

Org admins only. Fills the main area, so a full `admin-panel` with
`admin-panel-head`.

```ts
type AdminLevel = 'admin' | 'user';

interface OrgUser {
  email: string;
  name: string | null;
  authUserId: string | null;          // null until first sign-in
  status: 'invited' | 'active' | 'suspended';
  level: AdminLevel;                  // 'admin' = ORG admin
}

consoleClient.listOrgUsers(): Promise<OrgUser[]>
consoleClient.inviteOrgUser({ email, name?, level? }): Promise<{ ok: true }>
consoleClient.setOrgUserStatus(email, status): Promise<{ ok: true }>
consoleClient.setOrgUserLevel(email, level): Promise<{ ok: true }>
consoleClient.removeOrgUser(email): Promise<{ ok: true }>
```

Build:

1. **Pool table** — Email · Name · Status · Org admin · Actions.
   `status` needs a visual treatment: *invited* = outstanding, never signed in;
   *active* = has; *suspended* = every grant survives but they are locked out
   everywhere. "Org admin" is a per-row toggle → `setOrgUserLevel`.
   Actions: **Suspend** / **Reinstate**, and **Remove**.
2. **Invite user** — primary action in the panel head, opening a modal:
   email (required), name (optional), "Make org admin" checkbox.
3. **Empty state.**
4. **Error band** showing the server's message verbatim.

**Remove is destructive and irreversible** — it deletes them from the pool,
every operation, and every solution grant. Confirm, and make the consequence
legible in the confirm copy. **Suspend is reversible**; no confirmation. Design
the pair so the reversible one is the obvious default.

## 8. Surface 2 — Operation → Users tab → "Op users"

Op admins **and** org admins. An `admin-section` stacked **above** the untouched
`UserRolesSection`.

```ts
interface OpUser { email: string; level: AdminLevel; }   // 'admin' = OP admin

consoleClient.listOpUsers(operationId): Promise<OpUser[]>
consoleClient.addOpUser(operationId, email, level?): Promise<{ ok: true }>
consoleClient.removeOpUser(operationId, email): Promise<{ ok: true }>
```

Build:

1. **Section header** "Op users" + an `admin-sub` line explaining this controls
   who may enter the operation at all — a separate question from what their
   roles let them see.
2. **Table** — Email · Op admin · Actions (Remove).
3. **Add user**, two variants because the tiers have different data access:
   - **Org admin**: a picker of pool users not already in this operation.
   - **Op admin**: a plain email input — they cannot read the pool; the server
     validates against it and returns a clear message.
   Design both and the transition between them; it is one control with
   different affordances, not two widgets.
4. **Empty state** conveying that an operation with no users admits nobody.

**Keep op users and roles as two separate tables.** Do not merge into one
row-per-user grid — the two gates are independent by design and the UI must not
imply otherwise.

## 9. Permission gating (render-level only)

```ts
consoleClient.me(operationId?): Promise<Me>
// → { orgAdmin, opAdmin, console, id, name, email, roles, authConfigured }
// Omit operationId for the org-level answer (opAdmin is false unscoped).
```

- Hide controls the caller cannot use rather than disabling them.
- **The "Op admin" control renders only for org admins** — an op admin may never
  promote someone, and offering a click the server rejects teaches the wrong
  mental model.
- Cosmetic only. Every call is re-checked server-side; never treat these as
  security.

## 10. States to cover, both surfaces

Loading · Empty (meaningful, per above) · Populated (assume a few hundred rows) ·
Error (server message verbatim) · Busy (what is disabled, what the label says) ·
Permission-hidden.

## 11. SCOPE LOCK

Build **only** sections 7 and 8. Do not add: search, filtering, sorting,
pagination, bulk selection, avatars, presence dots, profile pages, detail
drawers, activity feeds, last-seen columns, audit trails, CSV import/export,
resend-invite, email previews, toasts, animations, skeleton loaders, icon sets,
role management in Surface 1, or any new table, column, procedure or client
method. The data listed above is the complete set that exists.

If something you need genuinely does not exist, **stop and say so** rather than
inventing it. If an addition would help, describe it in one sentence at the end —
do not build it.

## 12. What to hand back

1. **Layout rationale** — 3–5 sentences per surface, including how the design
   keeps the three layers legible as separate questions.
2. **Component inventory** — one line each, with file paths. Assume
   `admin/OrgUsersSection.tsx` and `admin/OpUsersSection.tsx`; say if you would
   split differently.
3. **Complete JSX** — real compiling TypeScript React using the exact class
   names from §5, covering all six states. Gate on two boolean props,
   `orgAdmin` and `opAdmin`.
4. **New CSS** as `export const css = \`...\`` per component, **only** classes
   that did not already exist, each with a rationale.
5. **Full copy deck** — every string, including the escalation-rule and
   entry-gate explanations. Check it against §3 before sending; this is where
   retired terminology creeps back.
6. **Interaction spec** — per action: what fires, refetch or optimistic, what is
   disabled in flight, how failure surfaces.
7. **Anything you needed and did not have**, plus additions considered and left
   out per the scope lock.
