/**
 * Password hashing, shared by every build.
 *
 * PBKDF2-SHA256 with a per-user salt, through WebCrypto — the same code runs on
 * the Worker and in the browser. It matters most in the shared build, where the
 * stored hash sits in a document anyone with the link can read: a fast digest
 * there would be a list of passwords waiting to be cracked.
 */

const ITERATIONS = 210000;

export const bytesToHex = (bytes) => [...new Uint8Array(bytes)]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

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
