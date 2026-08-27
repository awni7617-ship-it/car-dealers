/**
 * Makes sure this account has the resources wrangler.jsonc refers to, and
 * writes their real ids into it.
 *
 * The config is committed with placeholder ids so that `wrangler dev` works on
 * a fresh clone with no Cloudflare account at all. Before a real deploy — in CI
 * or on your own machine — this fills them in, creating the D1 database and the
 * rate-limit KV namespace the first time.
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 * Run: npm run provision
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';
const DB_NAME = process.env.FORECOURT_DB_NAME || 'forecourt';
const KV_TITLE = process.env.FORECOURT_KV_TITLE || 'forecourt-rate-limit';

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first.');
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}/accounts/${account}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const detail = (body.errors || []).map((e) => `${e.code} ${e.message}`).join('; ');
    throw new Error(`${init.method || 'GET'} ${path} failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return body.result;
}

/** Find it by name, create it if this is the first deploy. */
async function ensureDatabase() {
  const existing = await api(`/d1/database?name=${encodeURIComponent(DB_NAME)}&per_page=50`);
  const match = (existing || []).find((d) => d.name === DB_NAME);
  if (match) {
    console.log(`D1 database "${DB_NAME}" — ${match.uuid}`);
    return match.uuid;
  }
  const created = await api('/d1/database', { method: 'POST', body: JSON.stringify({ name: DB_NAME }) });
  console.log(`D1 database "${DB_NAME}" created — ${created.uuid}`);
  return created.uuid;
}

/** The limiter is a nicety, not a dependency: if this fails, carry on without. */
async function ensureNamespace() {
  try {
    const existing = await api('/storage/kv/namespaces?per_page=100');
    const match = (existing || []).find((n) => n.title === KV_TITLE);
    if (match) {
      console.log(`KV namespace "${KV_TITLE}" — ${match.id}`);
      return match.id;
    }
    const created = await api('/storage/kv/namespaces', {
      method: 'POST',
      body: JSON.stringify({ title: KV_TITLE }),
    });
    console.log(`KV namespace "${KV_TITLE}" created — ${created.id}`);
    return created.id;
  } catch (err) {
    console.warn(`KV namespace unavailable (${err.message}) — deploying without rate limiting.`);
    return null;
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'wrangler.jsonc');
let config = await readFile(configPath, 'utf8');

const databaseId = await ensureDatabase();
const namespaceId = await ensureNamespace();

config = config.replace(/("database_id":\s*")[^"]*(")/, () => `"database_id": "${databaseId}"`);
if (namespaceId) {
  config = config.replace(/("binding":\s*"RATE_LIMIT",\s*"id":\s*")[^"]*(")/,
    () => `"binding": "RATE_LIMIT",\n      "id": "${namespaceId}"`);
} else {
  // Drop the binding rather than deploy one pointing at a namespace that is
  // not there — an unresolvable id fails the deploy outright.
  config = config.replace(/\n\s*"kv_namespaces":\s*\[[\s\S]*?\],\n/, '\n');
}

await writeFile(configPath, config);
console.log('wrangler.jsonc updated.');
