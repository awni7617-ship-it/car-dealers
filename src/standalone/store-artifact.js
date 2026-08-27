/**
 * Where the shared build keeps its data: in the page itself.
 *
 * A published Artifact has no server, but it can save new versions of itself.
 * So the stock lives as JSON embedded in the document, and every change
 * republishes the page with the new JSON in it. Everyone with the link is
 * looking at the same version, so everyone sees the same stock — which is the
 * whole point of a pitch where more than one person answers the phone.
 *
 * Interface is identical to store.js on purpose: the routes above call load,
 * save and the session helpers and cannot tell which store they got.
 *
 * Two things follow from republishing rather than writing to a database:
 *   - Simultaneous edits do not merge. The platform keeps whichever landed
 *     first and reloads everyone to it; the loser is told, rather than left
 *     believing a change stuck.
 *   - Who is signed in is *not* shared. That belongs to the browser, so it
 *     stays in localStorage and never goes into the published document.
 */

const SESSION_KEY = 'forecourt-session-v1';
const STATE_ID = 'forecourt-state';
const APP_ID = 'forecourt-app';
const STYLE_ID = 'forecourt-style';

// How long to let edits pile up before publishing. Long enough that filling in
// a form is one version rather than eight, short enough to feel immediate.
const PUBLISH_DEBOUNCE_MS = 700;

export function blank() {
  return { dealership: null, users: [], vehicles: [], activities: [], appointments: [], valuations: [] };
}

/* ---------------------------------------------------------------- the page */

// Captured before the app renders anything, so what gets republished is the
// document as authored — never the mutated DOM.
const shell = (() => {
  const head = document.head.innerHTML;
  const body = document.body.cloneNode(true);
  for (const id of [STATE_ID, APP_ID]) {
    const node = body.querySelector(`#${id}`);
    if (node) node.remove();
  }
  return { head, body: body.innerHTML };
})();

const appSource = document.getElementById(APP_ID)?.textContent || '';

function readEmbedded() {
  try {
    const raw = document.getElementById(STATE_ID)?.textContent?.trim();
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return blank();
  }
}

let stock = readEmbedded();

/**
 * The whole document, with this state baked into it.
 *
 * Every closing script tag here is written `<\/script>`. This function lives
 * *inside* a script element, so a literal one would close that element early
 * and truncate the app — the page would load to a blank screen with a syntax
 * error. The escape is invisible to JavaScript and invisible to the parser.
 */
function documentWith(db) {
  // And the same hazard in the data: a car's notes could contain the sequence.
  const json = JSON.stringify(db).replace(/<\//g, '<\\/');
  return `<!doctype html>
<html lang="en">
<head>${shell.head}</head>
<body>${shell.body}
<script type="application/json" id="${STATE_ID}">${json}<\/script>
<script type="module" id="${APP_ID}">${appSource}<\/script>
</body>
</html>`;
}

/* ---------------------------------------------------------------- saving */

let namespace;
let pending = null;
let publishing = false;

const announce = (message, kind) => globalThis.FORECOURT_SAVE_STATUS?.(message, kind);

async function connect() {
  if (namespace === undefined) {
    namespace = (await globalThis.claude?.use?.('artifact')) || null;
  }
  return namespace;
}

async function flush() {
  if (publishing || !pending) return;
  const db = pending;
  pending = null;
  publishing = true;
  try {
    const artifact = await connect();
    if (!artifact) {
      announce('Not connected — changes are only on this device', 'bad');
      return;
    }
    await artifact.publish(documentWith(db));
    announce('Saved for everyone', 'good');
  } catch (err) {
    const code = err && err.code;
    if (code === 'conflict') {
      // Someone else published first. Every view reloads to their version, so
      // retrying would only overwrite a change that is already live.
      announce('Someone else saved first — reloading to their version', 'bad');
    } else if (code === 'not_granted' || code === 'not_writer') {
      announce('You have view-only access, so that was not saved', 'bad');
    } else {
      announce('Could not save that change', 'bad');
    }
  } finally {
    publishing = false;
    // An edit that arrived mid-publish still needs writing.
    if (pending) setTimeout(flush, 0);
  }
}

let timer = null;

export function load() {
  return stock;
}

export function save(db) {
  stock = db;
  pending = db;
  clearTimeout(timer);
  timer = setTimeout(flush, PUBLISH_DEBOUNCE_MS);
}

/* ---------------------------------------------------------------- session */

// Per-browser, never published: the document is shared, so who is signed in
// on this laptop has no business travelling with it.
export const readSession = () => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};

export const writeSession = (id) => {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch { /* the sign-in just will not outlast the tab */ }
};

export const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* nothing to do */ }
};

/** Lets the page say whether it is the shared build, and whether it can save. */
globalThis.FORECOURT_SHARED = true;
connect().then((artifact) => {
  globalThis.FORECOURT_CAN_SAVE = Boolean(artifact);
});
