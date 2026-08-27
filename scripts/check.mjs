/**
 * Two files in this repository are generated, and both go stale the moment
 * someone edits a source and forgets to rebuild:
 *
 *   forecourt.html          from public/ and src/     (npm run standalone)
 *   migrations/0001_init.sql from src/lib/schema.js   (npm run build:migration)
 *
 * A stale migration is the dangerous one — the Worker would create tables from
 * schema.js that wrangler's migration never made, and the two databases would
 * quietly disagree. This rebuilds both and fails if either moved, leaving the
 * working tree exactly as it found it: CI should fail, not silently fix.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script) => promisify(execFile)(process.execPath, [join(root, script)], { cwd: root });

const GENERATED = [
  { file: 'forecourt.html', script: 'scripts/build-standalone.mjs', fix: 'npm run standalone' },
  { file: 'migrations/0001_init.sql', script: 'scripts/build-migration.mjs', fix: 'npm run build:migration' },
];

let stale = false;

for (const { file, script, fix } of GENERATED) {
  const path = join(root, file);
  const before = await readFile(path, 'utf8').catch(() => null);
  await run(script);
  const after = await readFile(path, 'utf8');

  if (before === after) {
    console.log(`${file} is up to date.`);
    continue;
  }

  stale = true;
  if (before === null) {
    console.error(`${file} was missing — it has now been built. Commit it.`);
  } else {
    await writeFile(path, before);
    console.error(`${file} is out of date with its sources. Run: ${fix}`);
  }
}

process.exit(stale ? 1 : 0);
