/**
 * Forecourt on Cloudflare.
 *
 * The Worker owns two things: the JSON API under /api, and the fallback for
 * anything the static asset handler did not already serve. Assets (the HTML,
 * CSS and the front-end script) never reach this code — Cloudflare answers them
 * from the edge — so what runs here is only ever a real request for data.
 */
import { ROUTES, exportCsv } from './api.js';
import { currentUser } from './session.js';
import { ApiError } from './lib/model.js';
import { ensureSchema, isMissingTable } from './lib/schema.js';

/** Routes reachable without a session. Everything else needs one. */
const OPEN = ['/auth/signup', '/auth/join', '/auth/login', '/auth/logout'];

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

/**
 * A cookie is sent on same-site requests, so a cross-site form post could
 * otherwise act as the signed-in user. SameSite=Lax already blocks the common
 * case; this closes it for anything that does send an Origin.
 */
function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

/**
 * A Worker can meet a database nobody has migrated — the one-click deploy
 * provisions an empty D1 and never runs wrangler's migrations. So rather than
 * check on every request, assume the tables are there and only set them up
 * when something says otherwise. Costs nothing in the normal case and turns a
 * broken deploy into a working one.
 */
// Tracked against the binding rather than in a plain flag, so a Worker holding
// two databases cannot decide both are fine because one was.
const healed = new WeakSet();

async function withSchema(env, work) {
  try {
    return await work();
  } catch (err) {
    if (healed.has(env.DB) || !isMissingTable(err)) throw err;
    healed.add(env.DB);
    console.log('Database has no tables yet — creating them.');
    await ensureSchema(env);
    return work();
  }
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = request.method.toUpperCase();

  if (!['GET', 'HEAD'].includes(method) && !sameOrigin(request, url)) {
    return json({ error: 'Request blocked: unexpected origin' }, 403);
  }

  // The first query of the request, so a database with no tables is set up
  // here rather than surfacing as a failed sign-in.
  const user = await withSchema(env, () => currentUser(env, request));
  if (!user && !OPEN.includes(path)) {
    return json({ error: 'Sign in to continue' }, 401);
  }

  // The one route that answers with a file rather than JSON.
  if (method === 'GET' && path === '/export/stock.csv') {
    const csv = await exportCsv(env, user);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="forecourt-stock-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  let body = {};
  if (!['GET', 'HEAD', 'DELETE'].includes(method)) {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return json({ error: 'That request was not valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'That request was not valid JSON' }, 400);
    }
  }

  let cookie = null;
  const context = {
    env,
    request,
    url,
    user,
    body,
    query: url.searchParams,
    setCookie: (value) => { cookie = value; },
  };

  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const match = path.match(pattern);
    if (!match) continue;
    try {
      // Signing up is the first thing a new deployment does, and it reaches the
      // database here rather than above — a request with no cookie never gets
      // as far as looking a session up — so the handler needs covering too.
      const data = await withSchema(env, () => handler({ ...context, params: match.slice(1) }));
      return json(data ?? { ok: true }, 200, cookie ? { 'set-cookie': cookie } : {});
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message, ...(err.extra || {}) }, err.status);
      }
      console.error('API error', method, path, err && err.stack);
      return json({ error: 'Something went wrong at our end. Try again.' }, 500);
    }
  }

  return json({ error: `Not found: ${method} ${path}` }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.DB) return json({ error: 'No database is bound to this Worker' }, 503);
      return handleApi(request, env, url);
    }

    if (url.pathname === '/healthz') {
      return json({ ok: true, database: Boolean(env.DB), time: new Date().toISOString() });
    }

    // Anything else is a front-end route (`/`, or a deep link someone pasted):
    // hand back the app shell and let the hash router take it from there.
    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
      return new Response(asset.body, { status: asset.status, headers: asset.headers });
    }
    return new Response('Not found', { status: 404 });
  },

  /**
   * Housekeeping: expired sessions and stale plate lookups do not need to be
   * kept, and D1 rows are not free.
   */
  async scheduled(event, env) {
    if (!env.DB) return;
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()),
      env.DB.prepare('DELETE FROM plate_cache WHERE fetched_at < ?').bind(monthAgo),
    ]);
  },
};
