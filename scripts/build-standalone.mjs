/**
 * Builds forecourt.html: the whole app in one file, no server.
 *
 * It is the same source the Worker build serves — the modules are concatenated
 * in dependency order with their import/export plumbing removed, and the
 * localStorage backend is dropped in where the Worker would be. Nothing is
 * minified or transformed, so the file stays readable and diffable.
 *
 * Run: npm run standalone
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

/** Modules, in the order a single script scope needs them. */
const MODULES = [
  ['valuation model', 'src/lib/valuation.js'],
  ['plate decoding', 'src/lib/plate.js'],
  ['shared rules', 'src/lib/model.js'],
  ['sample stock', 'src/lib/demo.js'],
  ['local backend', 'src/standalone/local-api.js'],
  ['front end', 'public/app.js'],
  ['standalone extras', 'src/standalone/extras.js'],
];

/** Strip the module plumbing: nothing is imported once it is all one scope. */
function flatten(source) {
  return source
    .replace(/^import\s+[\s\S]*?from\s+'[^']+';\n/gm, '')
    .replace(/^export\s+(?=(const|function|async|class|let))/gm, '')
    .replace(/^export\s*\{[^}]*\};\n/gm, '')
    .trim();
}

/**
 * Two modules declaring the same top-level name is a syntax error only once the
 * file is opened in a browser, which is a poor place to find out. Catch it here
 * instead, naming both sides.
 */
function assertNoClashes(parts) {
  const seen = new Map();
  const clashes = [];
  const declaration = /^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const { label, code } of parts) {
    for (const [, name] of code.matchAll(declaration)) {
      if (seen.has(name) && seen.get(name) !== label) {
        clashes.push(`  ${name} — declared in both ${seen.get(name)} and ${label}`);
      } else {
        seen.set(name, label);
      }
    }
  }
  if (clashes.length) {
    throw new Error(`Two modules declare the same name, so they cannot share one scope:\n${clashes.join('\n')}`);
  }
}

const [html, css, ...sources] = await Promise.all([
  read('public/index.html'),
  read('public/app.css'),
  ...MODULES.map(([, path]) => read(path)),
]);

const parts = MODULES.map(([label], i) => ({ label, code: flatten(sources[i]) }));
assertNoClashes(parts);

const script = parts.map(({ label, code }) => `/* ---- ${label} ---- */\n\n${code}\n`).join('\n\n');

// Replacements go through a function: a literal `$$` in app.js is an escape
// sequence to String.replace, and would quietly become a single `$`.
const page = html
  .replace('<link rel="stylesheet" href="/app.css">', () => `<style>\n${css.trim()}\n</style>`)
  // A file opened from disk has no server to fetch a manifest or icon from.
  .replace(/^<link rel="icon"[^>]*>\n/m, '')
  .replace(/^<link rel="manifest"[^>]*>\n/m, '')
  .replace(
    '<script type="module" src="/app.js"></script>',
    () => `<script type="module">\n${script}\n</script>`,
  );

await writeFile(join(root, 'forecourt.html'), page);

const kb = (page.length / 1024).toFixed(0);
console.log(`forecourt.html — ${kb} KB, ${page.split('\n').length} lines, ${MODULES.length} modules inlined`);
