/**
 * The API, end to end: the real Worker, the real SQL, the real migration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv } from './helpers/d1.mjs';
import { client, signUp } from './helpers/client.mjs';

test('signing up creates a dealership and signs the owner in', async () => {
  const env = testEnv();
  const { client: c, res } = await signUp(env);

  assert.equal(res.status, 200);
  assert.equal(res.data.user.name, 'Sam Read');
  assert.equal(res.data.user.role, 'owner');
  assert.equal(res.data.user.dealership.name, 'Ridgeway Motors');
  assert.equal(res.data.user.dealership.currency, 'GBP');
  assert.match(res.data.user.dealership.joinCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const me = await c.get('/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'sam@ridgeway.test');
});

test('the session cookie is HttpOnly, same-site and not readable as the user id', async () => {
  const env = testEnv();
  const { client: c, res } = await signUp(env);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.ok(!cookie.includes(res.data.user.id), 'the cookie must not contain the user id');
  assert.ok(c.cookie);
});

test('signing up refuses a weak password, a bad email and a duplicate account', async () => {
  const env = testEnv();
  await signUp(env);

  const short = await client(env).post('/auth/signup', {
    name: 'Jo', dealership: 'Jo Cars', email: 'jo@cars.test', password: 'short',
  });
  assert.equal(short.status, 400);
  assert.match(short.data.error, /8 characters/);

  const bademail = await client(env).post('/auth/signup', {
    name: 'Jo', dealership: 'Jo Cars', email: 'not-an-email', password: 'a-long-enough-password',
  });
  assert.equal(bademail.status, 400);

  const dupe = await client(env).post('/auth/signup', {
    name: 'Sam', dealership: 'Other Motors', email: 'sam@ridgeway.test', password: 'a-long-enough-password',
  });
  assert.equal(dupe.status, 409);
});

test('sign in, sign out and a wrong password', async () => {
  const env = testEnv();
  await signUp(env);

  const wrong = await client(env).post('/auth/login', { email: 'sam@ridgeway.test', password: 'not-it-at-all' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, 'Email or password is wrong');

  // An account that does not exist answers exactly the same way.
  const missing = await client(env).post('/auth/login', { email: 'nobody@nowhere.test', password: 'not-it-at-all' });
  assert.equal(missing.data.error, wrong.data.error);

  const c = client(env);
  const ok = await c.post('/auth/login', { email: 'SAM@Ridgeway.test', password: 'a-long-enough-password' });
  assert.equal(ok.status, 200, 'email is not case sensitive');

  await c.post('/auth/logout');
  assert.equal((await c.get('/me')).status, 401);
});

test('everything except the auth routes needs a session', async () => {
  const env = testEnv();
  await signUp(env);
  const stranger = client(env);
  for (const path of ['/vehicles', '/dashboard', '/team', '/appointments', '/export/stock.csv']) {
    assert.equal((await stranger.get(path)).status, 401, `${path} must require a session`);
  }
});

test('a plate becomes a vehicle, decoded from the registration alone', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);

  const lookup = await c.get('/lookup?plate=lt20xyz');
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.plate, 'LT20 XYZ');
  assert.equal(lookup.data.decoded.region, 'London');
  assert.equal(lookup.data.fields.year, 2020);
  assert.equal(lookup.data.alreadyInStock, null);

  const created = await c.post('/vehicles', {
    plate: 'lt20 xyz', make: 'Volkswagen', model: 'Golf', mileage: '34,210',
    asking_price: '13495', purchase_price: 10800, colour: 'Grey', fuel: 'Petrol',
  });
  assert.equal(created.status, 200);
  const vehicle = created.data.vehicle;
  assert.equal(vehicle.plate, 'LT20 XYZ');
  assert.equal(vehicle.plate_key, 'LT20XYZ');
  assert.equal(vehicle.year, 2020, 'the year comes from the plate when it was not typed');
  assert.equal(vehicle.mileage, 34210, 'a typed comma is not a reason to fail');
  assert.equal(vehicle.status, 'in_stock');
  assert.ok(vehicle.estimate.retail > 0);
  assert.equal(vehicle.margin, 13495 - 10800);

  const again = await c.get('/lookup?plate=LT20XYZ');
  assert.equal(again.data.alreadyInStock.id, vehicle.id);

  const clash = await c.post('/vehicles', { plate: 'LT20XYZ' });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.vehicleId, vehicle.id);
});

test('viewings, calls and enquiries are counted against the car', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const { data: { vehicle } } = await c.post('/vehicles', { plate: 'MA68KDR', make: 'BMW', model: '320d', asking_price: 15995 });

  await c.post(`/vehicles/${vehicle.id}/activities`, { kind: 'viewing', contactName: 'Dave Harris' });
  await c.post(`/vehicles/${vehicle.id}/activities`, { kind: 'call', contactName: 'Priya Shah', contactPhone: '07700 900123' });
  await c.post(`/vehicles/${vehicle.id}/activities`, { kind: 'call', contactName: 'Tom Nolan' });
  const last = await c.post(`/vehicles/${vehicle.id}/activities`, { kind: 'offer', contactName: 'Grace', amount: '14500' });

  assert.equal(last.data.vehicle.viewings, 1);
  assert.equal(last.data.vehicle.calls, 2);
  assert.equal(last.data.vehicle.enquiries, 1);
  assert.equal(last.data.vehicle.stats.interest, 4);

  const detail = await c.get(`/vehicles/${vehicle.id}`);
  assert.equal(detail.data.activities.length, 4);
  assert.equal(detail.data.activities[0].user_name, 'Sam Read', 'who logged it is recorded');
  assert.equal(detail.data.activities.find((a) => a.kind === 'offer').amount, 14500);

  const bad = await c.post(`/vehicles/${vehicle.id}/activities`, { kind: 'nonsense' });
  assert.equal(bad.status, 400);

  await c.del(`/activities/${detail.data.activities[0].id}`);
  assert.equal((await c.get(`/vehicles/${vehicle.id}`)).data.activities.length, 3);
});

test('a collection with a deposit reserves the car for the buyer', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const { data: { vehicle } } = await c.post('/vehicles', { plate: 'YB21WNP', make: 'Ford', model: 'Puma', asking_price: 15750 });

  const soon = new Date(Date.now() + 26 * 3600000).toISOString();
  const booked = await c.post(`/vehicles/${vehicle.id}/appointments`, {
    kind: 'collection', customerName: 'Priya Shah', customerPhone: '07700 900123',
    scheduledAt: soon, deposit: 500,
  });
  assert.equal(booked.status, 200);
  assert.equal(booked.data.vehicle.status, 'reserved');
  assert.equal(booked.data.vehicle.buyer_name, 'Priya Shah');
  assert.equal(booked.data.vehicle.booked, 1);
  assert.equal(booked.data.vehicle.next_customer, 'Priya Shah');

  const diary = await c.get('/appointments');
  assert.equal(diary.data.appointments.length, 1);
  assert.equal(diary.data.appointments[0].plate, 'YB21 WNP', 'the diary shows the car, not just the id');

  // Completing it leaves a mark on the car's history.
  const done = await c.patch(`/appointments/${booked.data.appointment.id}`, { status: 'completed' });
  assert.equal(done.data.appointment.status, 'completed');
  const detail = await c.get(`/vehicles/${vehicle.id}`);
  assert.ok(detail.data.activities.some((a) => a.notes === 'collection completed'));

  const missingWho = await c.post(`/vehicles/${vehicle.id}/appointments`, { kind: 'viewing', scheduledAt: soon });
  assert.equal(missingWho.status, 400);
});

test('selling a car fills in the date and price, and un-selling clears them', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const { data: { vehicle } } = await c.post('/vehicles', {
    plate: 'SK17FGH', make: 'Audi', model: 'A4', asking_price: 11450, purchase_price: 8900, prep_cost: 400,
  });

  const sold = await c.patch(`/vehicles/${vehicle.id}`, { status: 'sold', buyer_name: 'Marcus Reid' });
  assert.equal(sold.data.vehicle.status, 'sold');
  assert.equal(sold.data.vehicle.sold_price, 11450);
  assert.equal(sold.data.vehicle.date_sold, new Date().toISOString().slice(0, 10));
  assert.equal(sold.data.vehicle.profit, 11450 - 8900 - 400);

  const back = await c.patch(`/vehicles/${vehicle.id}`, { status: 'in_stock' });
  assert.equal(back.data.vehicle.sold_price, null);
  assert.equal(back.data.vehicle.date_sold, null);
});

test('a price change writes itself into the car history', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const { data: { vehicle } } = await c.post('/vehicles', { plate: 'LR69TMA', make: 'Toyota', asking_price: 11250 });

  await c.patch(`/vehicles/${vehicle.id}`, { asking_price: 10750 });
  const detail = await c.get(`/vehicles/${vehicle.id}`);
  const note = detail.data.activities.find((a) => a.kind === 'note');
  assert.ok(note, 'a price change should be visible in the history');
  assert.match(note.notes, /11,250 to 10,750/);
});

test('deleting a car takes its activity, bookings and valuations with it', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const { data: { vehicle } } = await c.post('/vehicles', { plate: 'BD23OLV', make: 'Tesla', asking_price: 26950 });
  await c.post(`/vehicles/${vehicle.id}/activities`, { kind: 'viewing', contactName: 'Ellie' });
  await c.post(`/vehicles/${vehicle.id}/appointments`, {
    kind: 'viewing', customerName: 'Ellie', scheduledAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await c.post(`/vehicles/${vehicle.id}/valuations`, {});

  assert.equal((await c.del(`/vehicles/${vehicle.id}`)).status, 200);
  assert.equal((await c.get(`/vehicles/${vehicle.id}`)).status, 404);
  assert.equal((await c.get('/appointments')).data.appointments.length, 0);
  const left = env.DB._sqlite.prepare('SELECT COUNT(*) AS n FROM activities').get();
  assert.equal(left.n, 0, 'no orphaned activity rows');
});

test('the stock list filters, searches and sorts', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  await c.post('/vehicles', { plate: 'LT20XYZ', make: 'Volkswagen', model: 'Golf', asking_price: 13495 });
  await c.post('/vehicles', { plate: 'MA68KDR', make: 'BMW', model: '320d', asking_price: 15995 });
  const { data: { vehicle: third } } = await c.post('/vehicles', { plate: 'YB21WNP', make: 'Ford', model: 'Puma', asking_price: 9750 });
  await c.patch(`/vehicles/${third.id}`, { status: 'sold' });

  assert.equal((await c.get('/vehicles')).data.vehicles.length, 3);
  assert.equal((await c.get('/vehicles?status=live')).data.vehicles.length, 2);
  assert.equal((await c.get('/vehicles?status=sold')).data.vehicles.length, 1);
  assert.equal((await c.get('/vehicles?q=bmw')).data.vehicles.length, 1);
  assert.equal((await c.get('/vehicles?q=ma68')).data.vehicles[0].plate, 'MA68 KDR', 'plate search ignores the space');

  const byPrice = await c.get('/vehicles?sort=price_high&status=all');
  assert.deepEqual(byPrice.data.vehicles.map((v) => v.asking_price), [15995, 13495, 9750]);

  // Archived stock stays out of the way unless it is asked for.
  await c.patch(`/vehicles/${third.id}`, { status: 'archived' });
  assert.equal((await c.get('/vehicles')).data.vehicles.length, 2);
  assert.equal((await c.get('/vehicles?status=archived')).data.vehicles.length, 1);
});

test('the dashboard adds the week up', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  await c.post('/demo');

  const dash = (await c.get('/dashboard')).data;
  assert.equal(dash.stock.live, 6);
  assert.ok(dash.stock.value > 0);
  assert.ok(dash.stock.avgDays > 0);
  assert.ok(dash.week.viewings + dash.week.calls + dash.week.enquiries > 0);
  assert.ok(dash.hot.length > 0, 'the cars people are asking about');
  assert.ok(dash.aging.length > 0, 'the cars nobody is asking about');
  assert.equal(dash.aging[0].days >= dash.aging[dash.aging.length - 1].days, true);
  assert.ok(dash.appointments.upcoming.length > 0);
  assert.ok(dash.feed.length > 0);
  assert.ok(dash.feed[0].plate, 'the feed names the car');

  const second = await c.post('/demo');
  assert.equal(second.status, 400, 'sample stock is a one-off');
});

test('one dealership cannot see, change or delete another one\'s stock', async () => {
  const env = testEnv();
  const { client: a } = await signUp(env);
  const { data: { vehicle } } = await a.post('/vehicles', { plate: 'LT20XYZ', make: 'Volkswagen', asking_price: 13495 });
  await a.post(`/vehicles/${vehicle.id}/activities`, { kind: 'viewing', contactName: 'Dave' });

  const { client: b } = await signUp(env, {
    name: 'Alex Poole', dealership: 'Sandpit Cars', email: 'alex@sandpit.test',
  });

  assert.equal((await b.get('/vehicles')).data.vehicles.length, 0);
  assert.equal((await b.get(`/vehicles/${vehicle.id}`)).status, 404);
  assert.equal((await b.patch(`/vehicles/${vehicle.id}`, { asking_price: 1 })).status, 404);
  assert.equal((await b.del(`/vehicles/${vehicle.id}`)).status, 404);
  assert.equal((await b.post(`/vehicles/${vehicle.id}/activities`, { kind: 'call' })).status, 404);
  assert.equal((await b.get('/team')).data.team.length, 1);
  assert.equal((await b.get('/dashboard')).data.stock.live, 0);

  // And the first dealership is untouched.
  assert.equal((await a.get('/vehicles')).data.vehicles.length, 1);
});

test('a colleague joins with the team code and lands in the same stock', async () => {
  const env = testEnv();
  const { client: owner, res } = await signUp(env);
  await owner.post('/vehicles', { plate: 'LT20XYZ', make: 'Volkswagen', asking_price: 13495 });

  const mate = client(env);
  const joined = await mate.post('/auth/join', {
    name: 'Jess Ward', email: 'jess@ridgeway.test', password: 'another-long-password',
    joinCode: res.data.user.dealership.joinCode.toLowerCase(),
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.user.role, 'member');
  assert.equal(joined.data.user.dealership.id, res.data.user.dealership.id);
  assert.equal((await mate.get('/vehicles')).data.vehicles.length, 1, 'the same stock, straight away');

  const wrongCode = await client(env).post('/auth/join', {
    name: 'Nobody', email: 'no@one.test', password: 'another-long-password', joinCode: 'ZZZZ-ZZZZ',
  });
  assert.equal(wrongCode.status, 404);

  // Members can work; only the owner can change the shape of the business.
  assert.equal((await mate.patch('/settings', { name: 'Renamed' })).status, 403);
  assert.equal((await mate.post('/team/code')).status, 403);
  assert.equal((await mate.del(`/team/${res.data.user.id}`)).status, 403);

  const team = await owner.get('/team');
  assert.equal(team.data.team.length, 2);
  assert.equal((await owner.patch(`/team/${joined.data.user.id}`, { role: 'owner' })).status, 200);

  const rotated = await owner.post('/team/code');
  assert.notEqual(rotated.data.joinCode, res.data.user.dealership.joinCode);
});

test('settings change the currency the whole app prices in', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const updated = await c.patch('/settings', { name: 'Ridgeway Motor Co', currency: 'eur', distanceUnit: 'km', country: 'IE' });
  assert.equal(updated.data.user.dealership.name, 'Ridgeway Motor Co');
  assert.equal(updated.data.user.dealership.currency, 'EUR');
  assert.equal(updated.data.user.dealership.distanceUnit, 'km');
  assert.equal((await c.get('/me')).data.user.dealership.currency, 'EUR');
});

test('changing a password signs the other devices out but not this one', async () => {
  const env = testEnv();
  const { client: laptop } = await signUp(env);

  const phone = client(env);
  await phone.post('/auth/login', { email: 'sam@ridgeway.test', password: 'a-long-enough-password' });
  assert.equal((await phone.get('/me')).status, 200);

  const wrong = await laptop.post('/me/password', { currentPassword: 'nope', newPassword: 'a-brand-new-password' });
  assert.equal(wrong.status, 401);

  const changed = await laptop.post('/me/password', {
    currentPassword: 'a-long-enough-password', newPassword: 'a-brand-new-password',
  });
  assert.equal(changed.status, 200);
  assert.equal((await laptop.get('/me')).status, 200, 'the device that changed it stays signed in');
  assert.equal((await phone.get('/me')).status, 401, 'every other device is signed out');

  const again = client(env);
  assert.equal((await again.post('/auth/login', { email: 'sam@ridgeway.test', password: 'a-brand-new-password' })).status, 200);
});

test('the valuation is saved with its own history', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const { data: { vehicle } } = await c.post('/vehicles', {
    plate: 'LT20XYZ', make: 'Volkswagen', model: 'Golf', year: 2020, mileage: 34210, asking_price: 13495,
  });

  const auto = await c.post(`/vehicles/${vehicle.id}/valuations`, {});
  assert.equal(auto.data.valuations.length, 1);
  assert.ok(auto.data.valuations[0].retail_value > 0);

  const manual = await c.post(`/vehicles/${vehicle.id}/valuations`, {
    retailValue: 12750, tradeValue: 10500, notes: 'Trader quote', method: 'Manual',
  });
  assert.equal(manual.data.valuations.length, 2);
  assert.equal(manual.data.valuations[0].retail_value, 12750);
  assert.equal(manual.data.valuations[0].user_name, 'Sam Read');

  const guide = await c.post('/valuation', { make: 'BMW', model: '320d', year: 2018, mileage: 68400, condition: 'good' });
  assert.ok(guide.data.estimate.retail > guide.data.estimate.trade);
});

test('the stock export is a spreadsheet of the real numbers', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  await c.post('/vehicles', { plate: 'LT20XYZ', make: 'Volkswagen', model: 'Golf, Life', asking_price: 13495 });

  const res = await c.request('/api/export/stock.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="forecourt-stock-\d{4}-\d{2}-\d{2}\.csv"/);

  const [header, row] = res.data.split('\n');
  assert.match(header, /^plate,stock_number,make,model/);
  assert.match(header, /viewings,calls,enquiries,days_in_stock,guide_retail$/);
  assert.match(row, /^LT20 XYZ,/);
  assert.match(row, /"Golf, Life"/, 'a comma in a field is quoted, not left to break the file');
});

test('a cross-site write is refused even with a valid cookie', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);
  const res = await c.api('/vehicles', {
    method: 'POST',
    body: { plate: 'LT20XYZ' },
    headers: { origin: 'https://not-forecourt.example' },
  });
  assert.equal(res.status, 403);
});

test('malformed input is answered, not crashed on', async () => {
  const env = testEnv();
  const { client: c } = await signUp(env);

  const notJson = await worker(env, 'POST', '/api/vehicles', 'this is not json', c.cookie);
  assert.equal(notJson.status, 400);

  assert.equal((await c.post('/vehicles', { plate: '!!!' })).status, 400);
  assert.equal((await c.get('/vehicles/does-not-exist')).status, 404);
  assert.equal((await c.get('/nonsense-route')).status, 404);
  // A vehicle that is not yours is missing, whatever else is wrong with the
  // request; a real one still rejects a status that means nothing.
  assert.equal((await c.patch('/vehicles/nope', { status: 'made_up' })).status, 404);
  const { data: { vehicle } } = await c.post('/vehicles', { plate: 'LT20XYZ', make: 'Volkswagen' });
  assert.equal((await c.patch(`/vehicles/${vehicle.id}`, { status: 'made_up' })).status, 400);
});

// A raw request, for the cases the client helper is too polite to send.
async function worker(env, method, path, body, cookie) {
  const { default: app } = await import('../src/worker.js');
  return app.fetch(new Request(`https://forecourt.test${path}`, {
    method,
    body,
    headers: { 'content-type': 'application/json', origin: 'https://forecourt.test', ...(cookie ? { cookie } : {}) },
  }), env, {});
}

test('the front end is served for a deep link, and the health check answers', async () => {
  const env = testEnv();
  const shell = await client(env).request('/stock/some-id');
  assert.equal(shell.status, 200);
  assert.match(String(shell.data), /doctype html/i);

  const health = await client(env).request('/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.database, true);
});
