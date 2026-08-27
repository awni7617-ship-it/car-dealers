/**
 * Accounts and sessions.
 *
 * Passwords are stretched with PBKDF2-SHA256 and a per-user salt, and the
 * session itself is an opaque random id in an HttpOnly cookie with the row in
 * D1 — so a stolen cookie can be revoked, and nothing about the user travels in
 * it. Both are plain WebCrypto: no dependencies, and it runs anywhere Workers
 * run.
 */
import { fail, nowIso, uid } from './lib/model.js';

const ITERATIONS = 210000;
const SESSION_DAYS = 30;
export const COOKIE = 'fc_session';

const bytesToHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => new Uint8Array((hex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));

async function derive(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return `pbkdf2$${ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

/**
 * Compared byte by byte in constant time: a fast reject on the first wrong
 * character would leak the hash one character at a time.
 */
export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  const candidate = await derive(String(password || ''), hexToBytes(salt), Number(iterations) || ITERATIONS);
  const expected = hexToBytes(hash);
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ expected[i];
  return diff === 0;
}

export async function createSession(env, user, request) {
  const id = `${uid()}.${bytesToHex(crypto.getRandomValues(new Uint8Array(24)))}`;
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, user.id, nowIso(), expires, (request.headers.get('user-agent') || '').slice(0, 200)).run();
  return id;
}

export function cookieHeader(id, url) {
  const secure = url.protocol === 'https:' ? ' Secure;' : '';
  return id
    ? `${COOKIE}=${id}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
    : `${COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

export function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

/** The signed-in user and their dealership, or null. Expired sessions are swept. */
export async function currentUser(env, request) {
  const id = readCookie(request);
  if (!id) return null;
  const row = await env.DB.prepare(
    `SELECT u.*, s.expires_at AS session_expires, d.id AS d_id, d.name AS d_name, d.join_code, d.country,
            d.currency, d.distance_unit, d.vat_scheme
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN dealerships d ON d.id = u.dealership_id
      WHERE s.id = ?`,
  ).bind(id).first();
  if (!row) return null;
  if (Date.parse(row.session_expires) < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    name: row.name,
    email: row.email,
    role: row.role,
    password: row.password,
    session_id: id,
    dealership: {
      id: row.d_id,
      name: row.d_name,
      join_code: row.join_code,
      country: row.country,
      currency: row.currency,
      distance_unit: row.distance_unit,
      vat_scheme: row.vat_scheme,
    },
  };
}

/** The user as the front end sees them — never the password hash. */
export function publicUser(user) {
  const d = user.dealership;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    dealership: {
      id: d.id,
      name: d.name,
      joinCode: d.join_code,
      currency: d.currency,
      distanceUnit: d.distance_unit,
      country: d.country,
      vatScheme: d.vat_scheme || 'margin',
    },
  };
}

/**
 * Signing up and signing in are the two doors into the service, so they are
 * rate limited per IP. Without a KV binding the limiter is a no-op — the app
 * still runs, it just does not throttle.
 */
export async function rateLimit(env, request, bucket, { limit = 10, windowSeconds = 300 } = {}) {
  if (!env.RATE_LIMIT) return;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `rl:${bucket}:${ip}`;
  let count = 0;
  try {
    count = Number(await env.RATE_LIMIT.get(key)) || 0;
  } catch {
    return; // A limiter that is down must not lock everyone out.
  }
  if (count >= limit) fail(429, 'Too many attempts — wait a few minutes and try again');
  try {
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: windowSeconds });
  } catch { /* best effort */ }
}
