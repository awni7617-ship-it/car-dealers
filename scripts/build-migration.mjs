/**
 * Writes migrations/0001_init.sql from src/lib/schema.js.
 *
 * The Worker needs the schema as runnable statements; wrangler needs it as a
 * .sql file. Rather than maintain both and hope they agree, one is generated
 * from the other, and `npm run check` fails if the file on disk has drifted.
 *
 * Run: npm run build:migration
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCHEMA } from '../src/lib/schema.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const header = `-- Forecourt — initial schema.
--
-- GENERATED FROM src/lib/schema.js — do not edit by hand.
-- Run \`npm run build:migration\` after changing the schema there.
--
-- One row per dealership; every other table hangs off it and is always queried
-- with its dealership_id, so one pitch can never see another's stock.
`;

// Strip the leading indentation the statements carry as JS template literals,
// so the .sql file reads like something a person wrote.
const tidy = (sql) => sql
  .split('\n')
  .map((line) => line.replace(/^ {3}/, ''))
  .join('\n')
  .trim();

const body = SCHEMA.map((sql) => `${tidy(sql)};`).join('\n\n');

await writeFile(join(root, 'migrations/0001_init.sql'), `${header}\n${body}\n`);
console.log(`migrations/0001_init.sql — ${SCHEMA.length} statements`);
