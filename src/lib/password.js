/**
 * Password hashing, shared by every build.
 *
 * PBKDF2-SHA256 with a per-user salt, through WebCrypto — the same code runs on
 * the Worker and in the browser. It matters most in the shared build, where the
 * stored hash sits in a document anyone with the link can read: a fast digest
 * there would be a list of passwords waiting to be cracked.
 *
 * On the iteration count. A password hash is supposed to be slow, and OWASP
 * asks for 600,000 rounds — but a Worker on the free plan gets 10ms of CPU per
 * request, and 210,000 rounds alone costs about 30ms. Set that high and nobody
 * can sign in at all: the request is killed before it answers. 25,000 rounds
 * lands near 4ms and leaves the rest of the request room to breathe.
 *
 * That is a real reduction in cost-to-crack, made deliberately, because a
 * login that always fails protects nothing. Raise it with the PBKDF2_ITERATIONS
 * variable on a paid plan, where the CPU ceiling is minutes rather than
 * milliseconds. Existing accounts keep working either way: the count is stored
 * in each hash and read back from there when verifying.
 */

const DEFAULT_ITERATIONS = 25000;

export const bytesToHex = (bytes) => [...new Uint8Array(bytes)]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex) => new Uint8Array((hex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));

async function derive(password, salt, iterations = DEFAULT_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const rounds = Number(iterations) > 0 ? Math.floor(Number(iterations)) : DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, rounds);
  return `pbkdf2$${rounds}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

/**
 * Compared byte by byte in constant time: a fast reject on the first wrong
 * character would leak the hash one character at a time.
 */
export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  // The count comes from the stored hash, so raising or lowering the default
  // never locks anyone out of an account created under the old one.
  const candidate = await derive(String(password || ''), hexToBytes(salt), Number(iterations) || DEFAULT_ITERATIONS);
  const expected = hexToBytes(hash);
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ expected[i];
  return diff === 0;
}
