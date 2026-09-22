// Read-only. Assembles every stored solution's model and runs the current
// engine's validator over it, so drift is measured rather than remembered.
// SELECTs only — nothing is written.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { getSolutionConfig, listOrgs, listSolutions } from '../src/host';
import { createEngine, MemoryAdapter, buildGeoModule, buildTimeModule } from '@fluxus/engine';
import { buildNotifyModule, consoleNotifySink } from '../src/services/notify';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

const orgs = await listOrgs(db);
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}`);
console.log(`orgs: ${orgs.map((o) => o.id).join(', ') || '(none)'}\n`);

const seen = new Set<string>();
for (const org of orgs) {
  for (const sol of await listSolutions(db, org.id)) {
    if (seen.has(sol.id)) continue;
    seen.add(sol.id);
    const config = await getSolutionConfig(db, sol.id);
    const counts = `${config.recordTypes.length} record types, ${config.workflows.length} workflows, ${config.attributes.length} attributes`;
    console.log(`── ${sol.id} (${sol.name}) — ${counts}`);
    try {
      const adapter = new MemoryAdapter(config);
      for (const rt of config.recordTypes) adapter.getRecordTypeDef(rt.id);
      const engine = createEngine({ store: adapter, config, services: [buildNotifyModule(consoleNotifySink), buildGeoModule(adapter), buildTimeModule()] });
      const findings = engine.validateConfig();
      const errors = findings.filter((f) => f.diagnostic.severity === 'error');
      const warnings = findings.filter((f) => f.diagnostic.severity !== 'error');
      if (findings.length === 0) console.log('   clean\n');
      else {
        for (const f of errors) console.log(`   ERROR   ${f.where}: ${f.diagnostic.message}`);
        for (const f of warnings) console.log(`   warning ${f.where}: ${f.diagnostic.message}`);
        console.log();
      }
    } catch (err) {
      console.log(`   STRUCTURAL: ${(err as Error).message}\n`);
    }
  }
}

await closeDb(db);
process.exit(0);
