/**
 * Where the standalone build keeps its data: this browser, and nowhere else.
 *
 * The backend above this only ever calls load/save and the three session
 * helpers, so swapping this file for another store changes where the data
 * lives without touching a line of the routes — which is how the shared build
 * keeps the same app on a different foundation.
 */

const STORE_KEY = 'forecourt-store-v1';
const SESSION_KEY = 'forecourt-session-v1';

export function blank() {
  return { dealership: null, users: [], vehicles: [], activities: [], appointments: [], valuations: [] };
}

/**
 * Private browsing, blocked site data or a full quota all make localStorage
 * throw. Rather than dying, fall back to memory for the session and raise a
 * flag so the page can warn that nothing is being kept.
 */
const memory = new Map();
let ephemeral = false;

function getItem(key) {
  if (!ephemeral) {
    try {
      return localStorage.getItem(key);
    } catch {
      ephemeral = true;
      globalThis.FORECOURT_EPHEMERAL = true;
    }
  }
  return memory.has(key) ? memory.get(key) : null;
}

function setItem(key, value) {
  if (!ephemeral) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch {
      ephemeral = true;
      globalThis.FORECOURT_EPHEMERAL = true;
    }
  }
  memory.set(key, value);
}

function removeItem(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch { /* nothing to do */ }
}

export function load() {
  try {
    const raw = getItem(STORE_KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return blank();
  }
}

export function save(db) {
  setItem(STORE_KEY, JSON.stringify(db));
}

export const readSession = () => getItem(SESSION_KEY);
export const writeSession = (id) => setItem(SESSION_KEY, id);
export const clearSession = () => removeItem(SESSION_KEY);
