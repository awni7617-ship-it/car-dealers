# Forecourt

Stock, enquiry and diary tracking for used-car pitches. Type a number plate, the
car identifies itself, and Forecourt keeps the score from there: who came to
look, who rang, who is collecting it on Saturday, and what it is worth today.

Runs on Cloudflare Workers with a D1 database, deployed from GitHub on every
push to the default branch.

## Start here

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/awni7617-ship-it/car-dealers)

One click. Cloudflare creates the database, asks for a DVLA key if you have
one, builds and deploys. No terminal, nothing to install. Every later push
deploys itself.

**Which thing do I use?**

| I want | Use | Needs |
| --- | --- | --- |
| The real app — accounts, team, plate lookup | the button above | one click, a Cloudflare account |
| A page I can share on a link, no setup at all | `npm run artifact`, publish it | no lookup: a shared page cannot call DVLA |
| One file to open from a folder or drag onto any host | `dist-static/index.html` | data stays in that one browser |

The plate lookup only works in the first one. A key has to live on a server, or
anyone who opens the page can take it.

## What it does

- **Accounts per dealership.** Sign up once, then everyone else joins with the
  team code. Owners manage roles and settings; members get on with the work.
- **A car from a registration.** Type the plate: the age identifier, the
  registration window and the issuing DVLA office come straight off it, and the
  make, model, colour, fuel and MOT mileage history are filled in from DVLA and
  the DVSA MOT service when keys are configured.
- **Interest, counted.** Viewings, calls, enquiries, test drives and offers are
  logged against the car in two taps, so "how many people have seen it" has an
  answer.
- **A diary.** Viewings, test drives, collections and deliveries, with the
  customer and their phone number. A deposit on a collection reserves the car.
- **What it is worth.** A transparent guide valuation — make tier, body, engine,
  age, mileage, condition, fuel — that shows every adjustment it made, and takes
  the dealer's own figure over the top.
- **The numbers that matter.** Stock value and money invested, average days in
  stock, interest this week, profit this month, what is going stale and what is
  getting attention.
- **Exports.** The whole stock list as CSV, counts and guide prices included.

Every screen works on a phone, and the whole thing follows the system's light or
dark setting.

## Deploying it

### One click, nothing installed

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/awni7617-ship-it/car-dealers)

Cloudflare clones the repository, creates the database and the KV namespace,
asks for a `DVLA_API_KEY` if you have one, builds and deploys — all in the
browser, no terminal. Every later push deploys automatically.

It hands the Worker a brand-new empty database and does not run migrations, so
the Worker creates its own tables the first time it finds them missing. A fresh
deploy comes up working rather than throwing errors at whoever signs up first.

### The rest of this section is for deploying by hand

The Worker is `car-dealers`; the database is the D1 instance named `forecourt`.
Both ids are in `wrangler.jsonc` already, so a deploy needs no configuration.

**Two things decide whether a deploy does anything at all**, and both have bitten
this project already:

1. **The code has to be on the branch Cloudflare builds.** That is the
   repository's default branch unless the build was told otherwise. A branch
   with no `wrangler.jsonc` on it builds nothing and leaves the Worker showing
   Cloudflare's "Hello world" placeholder.
2. **The ids in `wrangler.jsonc` have to be real.** A placeholder `database_id`
   fails the deploy outright.

### From the Cloudflare dashboard (Workers → Git)

Connect the repository, then set:

| Setting | Value |
| --- | --- |
| Build command | `npm ci` |
| Deploy command | `npm run deploy:cf` |
| Branch | the branch you want live |

`deploy:cf` applies any new migrations before deploying, so the schema is never
behind the code.

### From GitHub Actions

Add two repository secrets (**Settings → Secrets and variables → Actions**) and
every push to the default branch deploys:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* template, with **D1: Edit** and **Workers KV: Edit** added |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard sidebar, or `npx wrangler whoami` |

`.github/workflows/deploy.yml` runs the tests, provisions D1 and KV if they are
missing, applies migrations, then deploys.

### From your own machine

```sh
npm install
npx wrangler login
npm run deploy:cf
```

Deploying into a *different* Cloudflare account? `npm run provision` (with
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set) creates the database and
namespace there and rewrites the ids in `wrangler.jsonc`.

## Running it locally

```sh
npm install
npm run migrate:local   # sets up the local D1 file
npm run dev             # http://localhost:8787
```

`wrangler dev` runs the real Worker against a local SQLite database, so what you
see locally is what deploys.

## Number plate lookup

Out of the box, the plate itself is decoded offline — year, registration window,
region and issuing office — and everything else is typed in. Add API keys and
the rest fills itself in:

```sh
npx wrangler secret put DVLA_API_KEY        # dvla.gov.uk vehicle enquiry service (free)
npx wrangler secret put MOT_CLIENT_ID       # DVSA MOT history API (free)
npx wrangler secret put MOT_CLIENT_SECRET
npx wrangler secret put MOT_API_KEY
```

Each prompts for the value and stores it encrypted against the Worker. The key
never touches the repository, the config, or your shell history — so never put
one in `wrangler.jsonc`, and never commit one. Secrets survive redeploys, and
can also be set in the dashboard under **Workers → the Worker → Settings →
Variables and Secrets**, as type *Secret*.

### Checking a key before you deploy

```sh
read -rs DVLA_API_KEY && export DVLA_API_KEY   # typed, not echoed, not in history
npm run check:lookup -- LT20XYZ
```

This runs the same `identify()` the Worker runs and prints what came back and
which provider said it. A rejected key shows up as `DVLA responded 403` rather
than as an empty form after a deploy.

### A provider other than DVLA

`LOOKUP_URL` points the same code at anything that answers with JSON — put
`{plate}` where the registration goes:

| Secret | Meaning |
| --- | --- |
| `LOOKUP_URL` | e.g. `https://api.example.com/vehicle?reg={plate}` |
| `LOOKUP_KEY` | your key, sent as a header |
| `LOOKUP_HEADER` | the header name, if it is not `x-api-key` |
| `LOOKUP_NAME` | what to call it on screen, e.g. `UK Vehicle Data` |

The response is read loosely — `make`/`Make`/`manufacturer`, `engineCc`/
`engineCapacity`/`engineSize` and so on all land in the right field, whether the
payload is at the top level or nested under `vehicle`, `data`, `result` or
`Response`.

**`LOOKUP_URL` wins over `DVLA_API_KEY`.** If both are set, DVLA is not called
at all — `check:lookup` warns you about this.

DVLA gives colour, fuel, engine size, tax and MOT status. The MOT history gives
what DVLA does not: the model, and every odometer reading ever recorded — so the
app can flag a mileage that goes backwards. A VIN is decoded through the free
NHTSA database with no key at all. Every source is named on the vehicle, and a
plate is only paid for once a month.

`LOOKUP_URL` points the same code at any other provider that answers with JSON.

## The single-file build

`forecourt.html` is the whole app in one file — same source, no server, data in
`localStorage`. Useful for a demo on a laptop with no internet, or for seeing
the thing work before setting up an account.

```sh
npm run standalone      # rebuilds it from the sources
open forecourt.html
```

It is generated, so `npm run check` (and CI) fails if it has drifted from the
sources it came from.

## Layout

```
public/           the front end — index.html, app.css, app.js, served from the edge
src/worker.js     the Worker: /api routing, the app shell, the nightly sweep
src/api.js        every API route, over D1
src/session.js    PBKDF2 passwords, opaque session cookies, rate limiting
src/lib/          plate decoding, valuation, lookup, the rules both backends share
src/standalone/   the localStorage backend the single-file build uses
migrations/       D1 schema
tests/            the API end to end, plus the domain rules
```

The front end never knows which backend it is talking to: the Worker and the
standalone build answer the same routes with the same shapes, and the rules that
decide what the data *means* — how a plate is cleaned, how interest is counted,
what a car is worth — live in `src/lib/` and are used by both.

## Tests

```sh
npm test
```

29 tests: the whole API driven through the real Worker against the real schema
(sign-up, stock, activity, diary, selling, team, exports), including that one
dealership cannot see another's cars, plus the plate decoder, the valuation
model and password hashing.

## Notes on the data

Every table is scoped by `dealership_id` and every query filters on it. Passwords
are PBKDF2-SHA256 with a per-user salt; sessions are opaque random ids in
HttpOnly, SameSite cookies with a row in D1, so they can be revoked — changing a
password signs out every other device. Writes require a same-origin request, and
sign-in and sign-up are rate limited per IP.
