# Forecourt

Stock, enquiry and diary tracking for used-car pitches. Type a number plate, the
car identifies itself, and Forecourt keeps the score from there: who came to
look, who rang, who is collecting it on Saturday, and what it is worth today.

Runs on Cloudflare Workers with a D1 database, deployed from GitHub on every
push to `main`.

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

Two secrets in the GitHub repository (**Settings → Secrets and variables →
Actions**) and every push to `main` deploys:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* template, with **D1: Edit** and **Workers KV: Edit** added |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard sidebar, or `npx wrangler whoami` |

The workflow in `.github/workflows/deploy.yml` runs the tests, creates the D1
database and KV namespace if this is the first deploy, applies any new
migrations, then deploys. Nothing else to set up: the app is live at
`https://forecourt.<your-subdomain>.workers.dev`.

To deploy from your own machine instead:

```sh
npm install
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
npm run provision                              # creates D1/KV, fills in the ids
npx wrangler d1 migrations apply forecourt --remote
npm run deploy
```

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
