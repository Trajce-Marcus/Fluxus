// One-off, 2026-09-23. Every page of the projects solution that opens with a
// Text title and a Text subtitle gets a PageHeader in their place — the back
// arrow, the title and the subtitle in one slot. Applied to the drafts in place
// (the Console may hold edits no script knows); shift-reports-pages.ts builds
// PageHeader from now on. Any other Text on a page — the project page's caption
// line, its budget total — is left as it is.
//
// Writes drafts only — publish each page in the Console. `--dry` reports and
// writes nothing.

import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

type Slot = { componentName: string; staticConfig: Record<string, unknown>; dynamicProps: Record<string, string>; callbacks: Record<string, string> };
type Panel = { id: string; children?: Panel[] };
type Def = { layout: { root: Panel }; slotConfigs: Record<string, Slot>; componentDependencies: { name: string; version: string }[] };

const without = (panel: Panel, id: string): Panel => ({
  ...panel,
  children: (panel.children ?? []).filter((c) => c.id !== id).map((c) => without(c, id)),
});

for (const row of await db.select().from(pages).where(eq(pages.solutionId, SOLUTION))) {
  const def = row.def as Def;
  const title = def.slotConfigs?.['slot-title'];
  const subtitle = def.slotConfigs?.['slot-subtitle'];
  if (title?.componentName !== 'Text' || title.staticConfig.style !== 'title') continue;

  def.slotConfigs['slot-title'] = {
    componentName: 'PageHeader',
    staticConfig: {
      title: title.staticConfig.text ?? '',
      ...(subtitle?.componentName === 'Text' ? { subtitle: subtitle.staticConfig.text ?? '' } : {}),
    },
    dynamicProps: {},
    callbacks: {},
  };
  if (subtitle?.componentName === 'Text') {
    delete def.slotConfigs['slot-subtitle'];
    def.layout.root = without(def.layout.root, 'slot-subtitle');
  }

  const stillText = Object.values(def.slotConfigs).some((c) => c.componentName === 'Text');
  def.componentDependencies = def.componentDependencies.filter((d) => stillText || d.name !== 'Text');
  if (!def.componentDependencies.some((d) => d.name === 'PageHeader')) def.componentDependencies.push({ name: 'PageHeader', version: '1.0.0' });

  console.log(`${row.path.padEnd(30)} ${def.slotConfigs['slot-title'].staticConfig.title}  /  ${def.slotConfigs['slot-title'].staticConfig.subtitle ?? '—'}`);
  if (!dry) {
    await db.update(pages).set({ def, updatedAt: new Date() })
      .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, row.path)));
  }
}

await closeDb(db);
