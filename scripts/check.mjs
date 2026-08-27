/**
 * forecourt.html is generated, so it can go stale the moment someone edits a
 * source file and forgets to rebuild. This rebuilds it in memory and compares,
 * which is what CI runs — the fix is always `npm run standalone`.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'forecourt.html');

const before = await readFile(target, 'utf8').catch(() => null);
await promisify(execFile)(process.execPath, [join(root, 'scripts/build-standalone.mjs')], { cwd: root });
const after = await readFile(target, 'utf8');

if (before === after) {
  console.log('forecourt.html is up to date.');
  process.exit(0);
}

if (before === null) {
  console.error('forecourt.html was missing — it has now been built. Commit it.');
  process.exit(1);
}

// Leave the working tree as it was found; CI should fail, not silently fix.
await writeFile(target, before);
console.error('forecourt.html is out of date with the sources. Run: npm run standalone');
process.exit(1);
