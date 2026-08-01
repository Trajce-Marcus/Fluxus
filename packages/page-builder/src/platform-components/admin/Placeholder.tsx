// Placeholder surface (M17) — an organisation section that exists in the nav
// because the IA has it, with nothing behind it yet. It says so plainly and
// lists what will live here, rather than pretending to be empty data.

export function Placeholder({ title, sub, items }: {
  title: string;
  sub: string;
  /** What this surface will hold once it is built. */
  items: string[];
}) {
  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">{title}</h2>
        <p className="admin-sub">{sub}</p>
      </div>
      <PlaceholderCard items={items} />
    </div>
  );
}

/** The card alone — for a *part* of a built surface that isn't built yet (a
 *  tab in the operation view), where the section already has its own heading. */
export function PlaceholderCard({ items }: { items: string[] }) {
  return (
    <div className="placeholder-card">
      <div className="placeholder-badge">Not built yet</div>
      <ul className="placeholder-list">
        {items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    </div>
  );
}

export const css = `
  .placeholder-card {
    max-width: 520px;
    background: var(--color-sidebar);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 16px;
  }
  .placeholder-badge {
    display: inline-block;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 1px 8px;
    margin-bottom: 10px;
  }
  .placeholder-list { margin: 0; padding-left: 18px; color: var(--color-text-muted); font-size: 0.82rem; line-height: 1.7; }
`;
