// The top of a page: a back arrow and the page's title, with an optional
// subtitle beneath (2026-09-23). Pages opened from pages had no way back but
// the browser's; the user asked for one on the page itself, beside its title,
// so it is placed like any component rather than drawn by the app around it.
//
// **Back is the host's history**, reached through `services` exactly as the
// Open button reaches `openPage`: in the Runtime app it is the browser's Back,
// the same step. On the first page opened there is nothing to go back to, and
// the arrow shows greyed rather than vanishing, so the header does not shift.
//
// The title and subtitle may carry `{{ }}` holes — `Shift Report {{
// context.record.report_no }}` — filled by the host before this sees them, as
// for `Text`.

import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';

interface PageHeaderProps {
  /** The page's title; `{{ expression }}` holes are filled by the host. */
  title?: string;
  /** A line under the title — optional; holes filled the same way. */
  subtitle?: string;
  /** Supplied by the host: where back comes from. */
  services?: PageServiceHandlers;
}

function PageHeaderComponent({ title = '', subtitle, services }: PageHeaderProps) {
  const canGoBack = services?.canGoBack() ?? false;
  return (
    <div className="phd-root">
      <button className="phd-back" onClick={() => services?.goBack()} disabled={!canGoBack}
        aria-label="Back" title={canGoBack ? 'Back' : 'Nothing to go back to'}>
        ←
      </button>
      <div className="phd-text">
        <div className="phd-title">{title}</div>
        {subtitle && <div className="phd-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

// The title and subtitle are Text's `title` and `subheading`, so a page that
// swaps two Text blocks for this one reads the same.
const css = `
  .phd-root { font-family: system-ui, sans-serif; display: flex; align-items: flex-start; gap: 10px; color: #1e293b; }
  .phd-back { flex: none; width: 30px; height: 30px; margin-top: 1px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-size: 1rem; line-height: 1; cursor: pointer; font-family: inherit; }
  .phd-back:hover:not(:disabled) { background: #f1f5f9; }
  .phd-back:disabled { color: #cbd5e1; border-color: #e2e8f0; cursor: default; }
  .phd-text { min-width: 0; overflow-wrap: anywhere; }
  .phd-title { font-size: 1.5rem; font-weight: 700; line-height: 1.25; }
  .phd-subtitle { font-size: 0.9rem; font-weight: 600; line-height: 1.35; color: #475569; margin-top: 2px; }
`;

const schema: PropSchema[] = [
  { name: 'title',    kind: 'static-config', type: 'string', required: false, description: 'The page title — {{ expression }} reads page data' },
  { name: 'subtitle', kind: 'static-config', type: 'string', required: false, description: 'A line under the title — {{ expression }} reads page data' },
];

export const PageHeader = Object.assign(PageHeaderComponent, { css, schema });
