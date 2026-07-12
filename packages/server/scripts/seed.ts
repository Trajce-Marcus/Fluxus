// Dev-time seeding: load the sdm workbench's demo SDM into the server's
// database through the same putConfig path the API uses (validation
// included). The cross-package import is deliberate dev tooling — the server
// RUNTIME never depends on a peer host; config distribution stays an open
// thread (root ROADMAP) and this script is its stopgap.

import { createDb } from '../src/db/client';
import { putConfig } from '../src/host';
import { DEFAULT_SCOPE } from '../src/router';
import { config } from '../../sdm/src/config';

const scope = process.argv[2] ?? DEFAULT_SCOPE;
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

await putConfig(db, scope, config);
console.log(`Seeded SDM config (+ seed records for empty types) into scope '${scope}'.`);
process.exit(0);
