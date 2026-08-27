# Working on this project

## The standing rule

**Every project ships ready to run on Cloudflare with no setup work by the
owner.** They do not use a terminal. Assume the only tools available are a
browser and a mouse, and that anything requiring a command line will not
happen.

Concretely, before calling a project done:

- `wrangler.jsonc` is committed and complete. Never leave a placeholder
  resource id in it — a placeholder does not defer a decision, it guarantees a
  failed deploy. Either put a real id in, or let the deploy flow provision one.
- A **Deploy to Cloudflare** button sits at the top of the README, pointing at
  this repository. That button is the whole install process.
- Secrets are declared in `.dev.vars.example`. That file is what makes the
  deploy page *ask* for a key, which is the only way a key gets in without a
  terminal.
- The app creates its own database tables when it finds them missing. The
  one-click flow provisions an empty database and never runs migrations, so a
  Worker that assumes a migrated schema arrives broken.
- The deploy path applies migrations before deploying (`npm run deploy:cf`), so
  new code never meets an old schema.

If a project genuinely cannot work as a Worker, ship it as a single HTML file
that runs from a folder, and say plainly what it gives up.

## The CPU budget is real, and only production enforces it

A Worker on the free plan gets **10ms of CPU per request**. Neither Node nor
`wrangler dev` enforces this, so a passing test suite proves nothing about it.

This has already cost a day once: password hashing at 210,000 PBKDF2 rounds
costs ~30ms, so every sign-in was killed while every test passed. Anything
loop-heavy or crypto-heavy needs measuring against 10ms before it ships, and
`tests/domain.test.js` holds that line for hashing.

## What is generated, and from what

Three files are built, never hand-edited. `npm run check` rebuilds them and
fails if the committed copy has drifted; CI runs it.

| Generated | Built from | Command |
| --- | --- | --- |
| `forecourt.html` | `public/` + `src/` | `npm run standalone` |
| `migrations/0001_init.sql` | `src/lib/schema.js` | `npm run build:migration` |
| `dist-shared/forecourt.html` | same sources, artifact store | `npm run artifact` |

A stale migration is the dangerous one: the Worker would create tables from
`schema.js` that wrangler's migration never made.

## The three builds share one backend

The front end never knows what it is talking to. Three stores expose the same
six functions and the routes above them cannot tell which they got:

- **Worker + D1** (`src/api.js`) — the real service, with accounts and plate
  lookup. Only this one can call DVLA: it holds the key server-side.
- **Standalone** (`src/standalone/store.js`) — localStorage, one browser.
- **Shared artifact** (`src/standalone/store-artifact.js`) — state embedded in
  the published page, republished on every change, so everyone on the link sees
  the same stock.

Anything that decides what the data *means* — cleaning a plate, counting
interest, valuing a car — belongs in `src/lib/` and is used by all three. Adding
a route means adding it to `src/api.js` *and* `src/standalone/local-api.js`,
with identical JSON shapes.

## A published artifact cannot call anything external

Strict CSP: no fetch to any outside host. So the shared build has no plate
lookup and there is no key to add to it — do not build a key field there, it
would only look like it worked. Offline plate decoding and the make/model
suggestions are the substitute.

## Testing

`npm test` runs the API end to end through the real Worker against the real
schema, over an in-memory SQLite standing in for D1. Prefer that to mocking.

`FORECOURT_SCHEMA=<file> npm test` runs it against a schema dumped from a live
database — the way to prove what is *deployed* still satisfies the app.

Before saying a change works in the deployed app, check it against the running
thing, not just the suite. The CPU limit, the CSP and an unmigrated database are
all invisible locally.
