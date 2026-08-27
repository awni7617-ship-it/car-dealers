/**
 * Does the plate lookup actually work with your key?
 *
 * Runs the real identify() the Worker runs — same requests, same merging, same
 * fallbacks — against whichever providers you have configured, and prints what
 * came back and who said it. Answers the question "is my key right?" without
 * deploying anything first.
 *
 * The key is read from the environment, never from a file or an argument, so it
 * does not end up in your shell history or in the repository:
 *
 *   read -rs DVLA_API_KEY && export DVLA_API_KEY
 *   npm run check:lookup -- LT20XYZ
 */
import { identify } from '../src/lib/lookup.js';

const plate = process.argv[2];
if (!plate) {
  console.error('Usage: npm run check:lookup -- <PLATE>');
  process.exit(1);
}

// identify() caches hits in D1 so a plate is only paid for once. There is no
// database out here, so hand it one that never has an answer and forgets
// everything — which exercises the uncached path every time, as intended.
const noDatabase = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      run: async () => ({ success: true }),
      all: async () => ({ results: [] }),
    }),
  }),
};

const env = { DB: noDatabase };
for (const name of ['DVLA_API_KEY', 'LOOKUP_URL', 'LOOKUP_KEY', 'LOOKUP_HEADER', 'LOOKUP_NAME',
  'MOT_CLIENT_ID', 'MOT_CLIENT_SECRET', 'MOT_API_KEY', 'MOT_TENANT_ID']) {
  if (process.env[name]) env[name] = process.env[name];
}

const configured = Object.keys(env).filter((k) => k !== 'DB');
console.log(configured.length
  ? `Configured: ${configured.join(', ')}`
  : 'Nothing configured — this will only decode the plate itself, offline.');
if (env.LOOKUP_URL && env.DVLA_API_KEY) {
  console.log('Note: LOOKUP_URL takes precedence, so DVLA_API_KEY will not be used.');
}
console.log('');

const result = await identify(env, plate);

console.log(`Plate       ${result.plate}`);
console.log(`Identified  ${result.identified ? 'yes' : 'no — nothing but the plate decode came back'}`);
console.log(`Sources     ${result.sources.length ? result.sources.join(' · ') : 'none'}`);
console.log('');

const fields = Object.entries(result.fields);
if (fields.length) {
  console.log('Fields');
  for (const [key, value] of fields) console.log(`  ${key.padEnd(18)} ${value}`);
} else {
  console.log('No fields returned.');
}

if (result.history) {
  const { tests = [], discrepancy } = result.history;
  console.log(`\nMOT history  ${tests.length} test(s)`);
  if (discrepancy) console.log(`  ⚠ ${discrepancy}`);
}

// A source that reads "unavailable" is the useful part of a failure: it names
// which provider refused and why, rather than just going quiet.
const trouble = result.sources.filter((s) => /unavailable|not held|no mot/i.test(s));
if (trouble.length) {
  console.log(`\nWorth a look: ${trouble.join(' · ')}`);
  console.log('A 401 or 403 there means the key was rejected; 404 means that provider does not hold the plate.');
}
