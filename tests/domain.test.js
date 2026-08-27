/**
 * The parts a dealer would argue with: what the plate says, what the car is
 * worth, and what the app does with what they typed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePlate, formatPlate, plateKey } from '../src/lib/plate.js';
import { estimateValue, stockAdvice } from '../src/lib/valuation.js';
import { counts, decorate, num, vehiclePatch } from '../src/lib/model.js';
import { hashPassword, verifyPassword } from '../src/session.js';

test('a plate is read the way it is written on the car', () => {
  assert.equal(plateKey(' lt20  xyz '), 'LT20XYZ');
  assert.equal(formatPlate('LT20XYZ'), 'LT20 XYZ');
  assert.equal(formatPlate('A123BCD'), 'A123 BCD', 'a prefix plate splits after the numbers');
});

test('the age identifier gives the year and the region', () => {
  const current = decodePlate('LT20XYZ');
  assert.equal(current.scheme, 'uk-current');
  assert.equal(current.year, 2020);
  assert.equal(current.region, 'London');
  assert.equal(current.registeredFrom, '2020-03-01');
  assert.match(current.registrationPeriod, /March – August 2020/);
  assert.ok(current.issuedAt, 'the issuing office is named');

  const autumn = decodePlate('MA68KDR');
  assert.equal(autumn.year, 2018, '68 is the September 2018 plate');
  assert.equal(autumn.registeredFrom, '2018-09-01');

  const prefix = decodePlate('P123ABC');
  assert.equal(prefix.scheme, 'uk-prefix');
  assert.equal(prefix.year, 1996);

  const suffix = decodePlate('ABC123A');
  assert.equal(suffix.scheme, 'uk-suffix');
  assert.equal(suffix.year, 1963);

  const personal = decodePlate('SAM1');
  assert.ok(!personal.year, 'a private plate hides the age, and is not guessed at');
  assert.ok(personal.note, 'and it says so rather than leaving the dealer wondering');
});

test('the valuation moves the way a dealer expects', () => {
  const base = { make: 'Volkswagen', model: 'Golf', year: 2020, mileage: 34000, condition: 'good', body: 'Hatchback' };
  const guide = estimateValue(base);

  assert.ok(guide.retail > guide.trade, 'retail is above trade');
  assert.ok(guide.private > guide.trade, 'a private sale beats a trade price');
  assert.ok(guide.adjustments.length, 'every adjustment is shown, not just the total');

  const older = estimateValue({ ...base, year: 2014 });
  assert.ok(older.retail < guide.retail, 'an older car is worth less');

  const thrashed = estimateValue({ ...base, mileage: 140000 });
  assert.ok(thrashed.retail < guide.retail, 'high mileage costs money');

  const rough = estimateValue({ ...base, condition: 'poor' });
  assert.ok(rough.retail < guide.retail, 'condition is priced in');

  const premium = estimateValue({ ...base, make: 'Porsche', model: '911' });
  assert.ok(premium.retail > guide.retail, 'the badge counts');

  const nothingKnown = estimateValue({});
  assert.ok(nothingKnown.retail > 0, 'an empty car still gets a floor price, not NaN');
});

test('advice reflects how the car is actually doing', () => {
  const car = { make: 'Volkswagen', model: 'Golf', year: 2020, mileage: 34000, condition: 'good', status: 'in_stock' };
  const guide = estimateValue(car);
  const priced = { ...car, asking_price: guide.retail };
  const advice = (stats) => stockAdvice(priced, { estimate: guide, ...stats });

  assert.equal(advice({ daysInStock: 120, viewings: 0, calls: 0, enquiries: 0 }).headline, 'Stuck stock');
  assert.equal(advice({ daysInStock: 40, viewings: 4, calls: 3, enquiries: 1 }).headline, 'Plenty of looks, no buyer');
  assert.equal(advice({ daysInStock: 6, viewings: 4, calls: 2, enquiries: 0 }).headline, 'Hot car');
  assert.equal(advice({ daysInStock: 3, viewings: 0, calls: 0, enquiries: 0 }).headline, 'Fresh stock');

  // An over-ambitious price explains the silence, so it is said first.
  const optimistic = stockAdvice({ ...car, asking_price: Math.round(guide.retail * 1.4) },
    { estimate: guide, daysInStock: 90, viewings: 0, calls: 0, enquiries: 0 });
  assert.equal(optimistic.headline, 'Priced above guide');
  assert.match(optimistic.detail, /over the guide/);

  assert.equal(stockAdvice({ ...priced, status: 'reserved' }, { estimate: guide, daysInStock: 90 }).headline, 'Reserved');
  assert.equal(stockAdvice({ ...priced, status: 'sold' }, { estimate: guide, daysInStock: 90 }).headline, 'Sold');
});

test('what the dealer typed is cleaned up before it is stored', () => {
  const patch = vehiclePatch({
    mileage: '34,210 miles',
    asking_price: '£13,495',
    year: '2020',
    vin: 'wvw zzz 1kz aw123456',
    mot_expiry: '2026-03-01',
    make: '  Volkswagen  ',
  });

  assert.equal(patch.mileage, 34210);
  assert.equal(patch.asking_price, 13495);
  assert.equal(patch.year, 2020);
  assert.equal(patch.vin, 'WVWZZZ1KZAW123456');
  assert.equal(patch.mot_expiry, '2026-03-01');
  assert.equal(patch.make, 'Volkswagen');

  assert.equal(vehiclePatch({ year: '1780' }).year, null, 'a year that cannot be right is dropped');
  assert.equal(num(''), null);
  assert.equal(num('not a number'), null);
});

test('interest is counted per car, and the next appointment surfaces', () => {
  const activities = [
    { kind: 'viewing', occurred_at: '2026-01-02T10:00:00.000Z' },
    { kind: 'viewing', occurred_at: '2026-01-03T10:00:00.000Z' },
    { kind: 'call', occurred_at: '2026-01-04T10:00:00.000Z' },
    { kind: 'offer', occurred_at: '2026-01-05T10:00:00.000Z' },
    { kind: 'note', occurred_at: '2026-01-06T10:00:00.000Z' },
  ];
  const appointments = [
    { status: 'scheduled', kind: 'viewing', scheduled_at: '2026-02-02T10:00:00.000Z', customer_name: 'Later' },
    { status: 'scheduled', kind: 'collection', scheduled_at: '2026-01-20T10:00:00.000Z', customer_name: 'Sooner' },
    { status: 'cancelled', kind: 'viewing', scheduled_at: '2026-01-01T10:00:00.000Z', customer_name: 'Cancelled' },
  ];

  const c = counts(activities, appointments);
  assert.equal(c.viewings, 2);
  assert.equal(c.calls, 1);
  assert.equal(c.enquiries, 1, 'an offer is an enquiry; a note is not');
  assert.equal(c.booked, 2, 'a cancelled booking is not booked');
  assert.equal(c.next_customer, 'Sooner');
  assert.equal(c.next_kind, 'collection');

  const vehicle = {
    id: 'v1', make: 'Volkswagen', model: 'Golf', year: 2020, mileage: 34210,
    asking_price: 13495, purchase_price: 10800, prep_cost: 300,
    date_in: '2026-01-01', created_at: '2026-01-01T00:00:00.000Z', status: 'in_stock',
  };
  const view = decorate(vehicle, { activities, appointments, dealership: { currency: 'GBP', distance_unit: 'mi' } });
  assert.equal(view.stats.interest, 4);
  assert.equal(view.margin, 13495 - 10800 - 300);
  assert.equal(view.profit, null, 'there is no profit until it is sold');
  assert.ok(view.estimate.retail > 0);
});

test('passwords are salted, stretched and compared without leaking', async () => {
  const stored = await hashPassword('a-long-enough-password');
  const [scheme, iterations] = stored.split('$');
  assert.equal(scheme, 'pbkdf2');
  assert.ok(Number(iterations) >= 20000, 'weak stretching is not stretching');
  assert.ok(!stored.includes('a-long-enough-password'));

  assert.equal(await verifyPassword('a-long-enough-password', stored), true);
  assert.equal(await verifyPassword('A-long-enough-password', stored), false);
  assert.equal(await verifyPassword('', stored), false);
  assert.equal(await verifyPassword('anything', 'rubbish'), false);

  const again = await hashPassword('a-long-enough-password');
  assert.notEqual(again, stored, 'the same password hashes differently every time');
});

test('hashing a password fits inside a free Worker CPU budget', async () => {
  // The bug this guards: 210,000 rounds cost ~30ms of CPU, and a Worker on the
  // free plan is killed at 10ms — so nobody could sign in, while every test
  // passed, because neither Node nor `wrangler dev` enforces a CPU limit.
  await hashPassword('warm the key import and the JIT');

  const time = async (fn) => {
    const started = process.hrtime.bigint();
    await fn();
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  const stored = await hashPassword('a-long-enough-password');
  const hashMs = await time(() => hashPassword('a-long-enough-password'));
  const verifyMs = await time(() => verifyPassword('a-long-enough-password', stored));

  // Half the budget, so the rest of the request has somewhere to live. This
  // machine is not a Cloudflare edge node, so it is a smoke alarm rather than a
  // measurement — it catches an iteration count raised by an order of magnitude.
  assert.ok(hashMs < 5, `hashing took ${hashMs.toFixed(1)}ms; the free CPU budget is 10ms for the whole request`);
  assert.ok(verifyMs < 5, `verifying took ${verifyMs.toFixed(1)}ms; the free CPU budget is 10ms for the whole request`);
});

test('an account survives the iteration count being changed under it', async () => {
  const old = await hashPassword('a-long-enough-password', 210000);
  assert.equal(old.split('$')[1], '210000', 'the count is stored with the hash');
  assert.equal(await verifyPassword('a-long-enough-password', old), true);
  assert.equal(await verifyPassword('wrong', old), false);
});
