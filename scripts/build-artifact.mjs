/**
 * Builds the shared build: the whole app as one page that saves new versions of
 * itself, so everyone with the link sees the same stock.
 *
 * Same sources as every other build. The only substitution is the store —
 * store-artifact.js instead of store.js — because the routes above it neither
 * know nor care where the data ends up.
 *
 * The ids matter: the store reads the app's own source and the page's markup
 * back out of the document to rebuild it around new data, so #forecourt-app,
 * #forecourt-style and #forecourt-state have to be exactly where it expects.
 *
 * Run: npm run artifact
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

const MODULES = [
  ['valuation model', 'src/lib/valuation.js'],
  ['plate decoding', 'src/lib/plate.js'],
  ['shared rules', 'src/lib/model.js'],
  ['passwords', 'src/lib/password.js'],
  ['sample stock', 'src/lib/demo.js'],
  ['shared storage', 'src/standalone/store-artifact.js'],
  ['backend', 'src/standalone/local-api.js'],
  ['makes and models', 'public/models.js'],
  ['front end', 'public/app.js'],
  ['shared extras', 'src/standalone/shared-extras.js'],
];

const flatten = (source) => source
  .replace(/^import\s+[\s\S]*?from\s+'[^']+';\n/gm, '')
  .replace(/^export\s+(?=(const|function|async|class|let))/gm, '')
  .replace(/^export\s*\{[^}]*\};\n/gm, '')
  .trim();

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

// The body markup, lifted out of the served page so the store can rebuild the
// document around it. Everything between <body> and the script tag.
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('<script type="module"'));

// Published as body content: the host wraps this first version in its own
// document skeleton. Later versions come from the page itself, which emits a
// complete document — so the stylesheet lives in the body, where it is part of
// the markup the store captures and carries into every version it publishes.
const page = `<title>Forecourt</title>
<style id="forecourt-style">
${css.trim()}
</style>
${body.trimEnd()}
<script type="application/json" id="forecourt-state">{}</script>
<script type="module" id="forecourt-app">
${script}
</script>
`;

await mkdir(join(root, 'dist-shared'), { recursive: true });
await writeFile(join(root, 'dist-shared/forecourt.html'), page);

console.log(`dist-shared/forecourt.html — ${(page.length / 1024).toFixed(0)} KB, ${MODULES.length} modules inlined`);
