/**
 * The API, over D1.
 *
 * Answers exactly the routes the front end calls, in exactly the shapes the
 * standalone build answers them in — the browser code cannot tell the two
 * apart. Every query is scoped by the signed-in user's dealership_id: that is
 * the only thing standing between one pitch's stock and another's, so it is
 * never left to the caller to pass in.
 */
import { identify } from './lib/lookup.js';
import { decodePlate, formatPlate, plateKey } from './lib/plate.js';
import { estimateValue } from './lib/valuation.js';
import { buildDemo, DEMO_SIZE } from './lib/demo.js';
import {
  ACTIVITY_KINDS, APPOINTMENT_KINDS, APPOINTMENT_STATUSES, CSV_COLUMNS, SORTS,
  csvCell, daysBetween, decorate, fail, isoDate, joinCode, nowIso, num, str, uid,
  vehiclePatch,
} from './lib/model.js';
import {
  cookieHeader, createSession, hashPassword, publicUser, rateLimit, verifyPassword,
} from './session.js';

/* ---------------------------------------------------------------- D1 helpers */

const bindable = (v) => (v === undefined ? null : v);

const all = async (env, sql, ...binds) => {
  const res = await env.DB.prepare(sql).bind(...binds.map(bindable)).all();
  return res.results || [];
};

const first = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds.map(bindable)).first();

const run = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds.map(bindable)).run();

/** An INSERT built from an object, skipping keys that were never set. */
function insert(env, table, row) {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return env.DB.prepare(sql).bind(...keys.map((k) => bindable(row[k])));
}

/** An UPDATE built from a patch. Returns null when the patch is empty. */
function updateStmt(env, table, id, dealershipId, patch) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) return null;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND dealership_id = ?`;
  return env.DB.prepare(sql).bind(...keys.map((k) => bindable(patch[k])), id, dealershipId);
}

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    const bucket = map.get(row[key]);
    if (bucket) bucket.push(row);
    else map.set(row[key], [row]);
  }
  return map;
};

/* ---------------------------------------------------------------- loaders */

async function loadVehicle(env, user, id) {
  const vehicle = await first(env, 'SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?', id, user.dealership_id);
  if (!vehicle) fail(404, 'Vehicle not found');
  return vehicle;
}

async function vehicleView(env, user, vehicle) {
  const [activities, appointments] = await Promise.all([
    all(env, 'SELECT * FROM activities WHERE vehicle_id = ? ORDER BY occurred_at DESC', vehicle.id),
    all(env, 'SELECT * FROM appointments WHERE vehicle_id = ? ORDER BY scheduled_at DESC', vehicle.id),
  ]);
  return decorate(vehicle, { activities, appointments, dealership: user.dealership });
}

/** Every vehicle in the dealership, decorated, in three queries rather than 3n. */
async function stockList(env, user) {
  const [vehicles, activities, appointments] = await Promise.all([
    all(env, 'SELECT * FROM vehicles WHERE dealership_id = ?', user.dealership_id),
    all(env, 'SELECT vehicle_id, kind, occurred_at FROM activities WHERE dealership_id = ?', user.dealership_id),
    all(env, `SELECT vehicle_id, kind, status, scheduled_at, customer_name FROM appointments
               WHERE dealership_id = ? AND status = 'scheduled'`, user.dealership_id),
  ]);
  const byVehicleActivity = groupBy(activities, 'vehicle_id');
  const byVehicleAppointment = groupBy(appointments, 'vehicle_id');
  return vehicles.map((v) => decorate(v, {
    activities: byVehicleActivity.get(v.id) || [],
    appointments: byVehicleAppointment.get(v.id) || [],
    dealership: user.dealership,
  }));
}

const emailOf = (body) => str(body.email, 160)?.toLowerCase() || null;

async function emailTaken(env, email, exceptId) {
  const row = await first(env, 'SELECT id FROM users WHERE email = ?', email);
  return Boolean(row) && row.id !== exceptId;
}

/* ---------------------------------------------------------------- routes */

/**
 * Each handler is given one context object: the request's env, the signed-in
 * user (null on the open routes), the parsed body, path captures and query.
 * Returning a value sends it as JSON; cookies go through ctx.setCookie.
 */
export const ROUTES = [
  /* ---- accounts ---- */

  ['POST', /^\/auth\/signup$/, async ({ env, request, body, setCookie, url }) => {
    // Generous enough for a street of dealers behind one office IP, tight
    // enough that nobody is filling the database from a script.
    await rateLimit(env, request, 'signup', { limit: 10, windowSeconds: 3600 });
    const name = str(body.name, 80);
    const dealership = str(body.dealership, 120);
    const email = emailOf(body);
    if (!dealership) fail(400, 'Add your dealership name');
    if (!name) fail(400, 'Add your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) fail(400, 'That email address does not look right');
    if (String(body.password || '').length < 8) fail(400, 'Use a password of at least 8 characters');
    if (await emailTaken(env, email)) fail(409, 'There is already an account with that email — sign in instead');

    const country = (str(body.country, 4) || 'GB').toUpperCase();
    const dealershipRow = {
      id: uid(),
      name: dealership,
      join_code: joinCode(),
      country,
      currency: (str(body.currency, 4) || (country === 'US' ? 'USD' : country === 'GB' ? 'GBP' : 'EUR')).toUpperCase(),
      distance_unit: country === 'GB' || country === 'US' ? 'mi' : 'km',
      vat_scheme: 'margin',
      created_at: nowIso(),
    };
    const userRow = {
      id: uid(),
      dealership_id: dealershipRow.id,
      name,
      email,
      role: 'owner',
      password: await hashPassword(body.password),
      created_at: nowIso(),
      last_seen_at: nowIso(),
    };
    await env.DB.batch([insert(env, 'dealerships', dealershipRow), insert(env, 'users', userRow)]);

    const account = { ...userRow, dealership: dealershipRow };
    setCookie(cookieHeader(await createSession(env, account, request), url));
    return { user: publicUser(account) };
  }],

  ['POST', /^\/auth\/join$/, async ({ env, request, body, setCookie, url }) => {
    await rateLimit(env, request, 'join', { limit: 20, windowSeconds: 3600 });
    const code = str(body.joinCode, 20)?.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) fail(400, 'Enter the team code your dealership gave you');
    // Codes are stored with a dash for readability; match on either form.
    const dealership = await first(env,
      "SELECT * FROM dealerships WHERE REPLACE(join_code, '-', '') = ?", code);
    if (!dealership) fail(404, 'That team code was not recognised');

    const name = str(body.name, 80);
    const email = emailOf(body);
    if (!name) fail(400, 'Add your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) fail(400, 'That email address does not look right');
    if (String(body.password || '').length < 8) fail(400, 'Use a password of at least 8 characters');
    if (await emailTaken(env, email)) fail(409, 'There is already an account with that email — sign in instead');

    const userRow = {
      id: uid(),
      dealership_id: dealership.id,
      name,
      email,
      role: 'member',
      password: await hashPassword(body.password),
      created_at: nowIso(),
      last_seen_at: nowIso(),
    };
    await insert(env, 'users', userRow).run();
    const account = { ...userRow, dealership };
    setCookie(cookieHeader(await createSession(env, account, request), url));
    return { user: publicUser(account) };
  }],

  ['POST', /^\/auth\/login$/, async ({ env, request, body, setCookie, url }) => {
    await rateLimit(env, request, 'login', { limit: 12, windowSeconds: 900 });
    const email = emailOf(body);
    if (!email || !body.password) fail(400, 'Enter your email and password');
    const row = await first(env,
      `SELECT u.*, d.id AS d_id, d.name AS d_name, d.join_code, d.country, d.currency,
              d.distance_unit, d.vat_scheme
         FROM users u JOIN dealerships d ON d.id = u.dealership_id
        WHERE u.email = ?`, email);
    // Both misses answer the same way: whether an email has an account here is
    // not something a stranger gets to find out.
    if (!row || !(await verifyPassword(body.password, row.password))) fail(401, 'Email or password is wrong');

    await run(env, 'UPDATE users SET last_seen_at = ? WHERE id = ?', nowIso(), row.id);
    const account = {
      ...row,
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
    setCookie(cookieHeader(await createSession(env, account, request), url));
    return { user: publicUser(account) };
  }],

  ['POST', /^\/auth\/logout$/, async ({ env, user, setCookie, url }) => {
    if (user) await run(env, 'DELETE FROM sessions WHERE id = ?', user.session_id);
    setCookie(cookieHeader(null, url));
    return { ok: true };
  }],

  ['GET', /^\/me$/, async ({ user }) => ({ user: publicUser(user) })],

  ['PATCH', /^\/me$/, async ({ env, user, body }) => {
    const patch = {};
    if (body.name) patch.name = str(body.name, 80);
    if (body.email) {
      const email = emailOf(body);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) fail(400, 'That email address does not look right');
      if (await emailTaken(env, email, user.id)) fail(409, 'Another account already uses that email');
      patch.email = email;
    }
    if (Object.keys(patch).length) {
      const keys = Object.keys(patch);
      await run(env, `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        ...keys.map((k) => patch[k]), user.id);
    }
    return { user: publicUser({ ...user, ...patch }) };
  }],

  ['POST', /^\/me\/password$/, async ({ env, user, body }) => {
    if (String(body.newPassword || '').length < 8) fail(400, 'Use a password of at least 8 characters');
    if (!(await verifyPassword(body.currentPassword || '', user.password))) fail(401, 'Current password is wrong');
    await run(env, 'UPDATE users SET password = ? WHERE id = ?', await hashPassword(body.newPassword), user.id);
    // Changing a password signs every other device out; this one stays in.
    await run(env, 'DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, user.session_id);
    return { ok: true };
  }],

  /* ---- identification and pricing ---- */

  ['GET', /^\/lookup$/, async ({ env, user, query }) => {
    const result = await identify(env, query.get('plate') || '', query.get('vin') || '');
    const existing = result.plateKey
      ? await first(env,
        'SELECT id, plate, make, model, year, status FROM vehicles WHERE dealership_id = ? AND plate_key = ?',
        user.dealership_id, result.plateKey)
      : null;
    return { ...result, alreadyInStock: existing || null };
  }],

  ['POST', /^\/valuation$/, async ({ user, body }) => ({
    estimate: estimateValue(vehiclePatch(body), {
      currency: user.dealership.currency,
      distanceUnit: user.dealership.distance_unit,
    }),
  })],

  /* ---- stock ---- */

  ['GET', /^\/vehicles$/, async ({ env, user, query }) => {
    const status = query.get('status');
    const q = (query.get('q') || '').trim().toUpperCase();
    let list = await stockList(env, user);
    if (status && status !== 'all') {
      list = status === 'live'
        ? list.filter((v) => ['in_stock', 'prep', 'reserved'].includes(v.status))
        : list.filter((v) => v.status === status);
    } else {
      list = list.filter((v) => v.status !== 'archived');
    }
    if (q) {
      const plain = q.replace(/[^A-Z0-9]/g, '');
      list = list.filter((v) => [v.make, v.model, v.stock_number, v.colour, v.vin]
        .some((f) => String(f || '').toUpperCase().includes(q)) || (plain && v.plate_key.includes(plain)));
    }
    list.sort(SORTS[query.get('sort')] || SORTS.newest);
    return { vehicles: list };
  }],

  ['POST', /^\/vehicles$/, async ({ env, user, body }) => {
    const key = plateKey(body.plate || '');
    if (!key) fail(400, 'A registration is needed to add a vehicle');
    const clash = await first(env, 'SELECT id FROM vehicles WHERE dealership_id = ? AND plate_key = ?',
      user.dealership_id, key);
    if (clash) fail(409, 'That registration is already in your stock', { vehicleId: clash.id });

    const patch = vehiclePatch(body);
    const decoded = decodePlate(key);
    const created = nowIso();
    const row = {
      id: uid(),
      dealership_id: user.dealership_id,
      plate: formatPlate(key),
      plate_key: key,
      ...patch,
      status: patch.status || 'in_stock',
      condition: patch.condition || 'good',
      date_in: patch.date_in || created.slice(0, 10),
      year: patch.year ?? decoded.year ?? null,
      first_registered: patch.first_registered || decoded.registeredFrom || null,
      region: patch.region || (decoded.region ? `${decoded.region}${decoded.issuedAt ? ` (${decoded.issuedAt})` : ''}` : null),
      lookup_source: str(body.lookupSource, 60),
      lookup: body.lookup ? JSON.stringify(body.lookup).slice(0, 20000) : null,
      created_by: user.id,
      created_at: created,
      updated_at: created,
    };
    await insert(env, 'vehicles', row).run();
    return { vehicle: decorate(row, { activities: [], appointments: [], dealership: user.dealership }) };
  }],

  ['GET', /^\/vehicles\/([^/]+)$/, async ({ env, user, params }) => {
    const vehicle = await loadVehicle(env, user, params[0]);
    const [activities, appointments, valuations] = await Promise.all([
      all(env, 'SELECT * FROM activities WHERE vehicle_id = ? ORDER BY occurred_at DESC', vehicle.id),
      all(env, 'SELECT * FROM appointments WHERE vehicle_id = ? ORDER BY scheduled_at DESC', vehicle.id),
      all(env, 'SELECT * FROM valuations WHERE vehicle_id = ? ORDER BY created_at DESC', vehicle.id),
    ]);
    return {
      vehicle: decorate(vehicle, { activities, appointments, dealership: user.dealership }),
      activities,
      appointments,
      valuations,
    };
  }],

  ['PATCH', /^\/vehicles\/([^/]+)$/, async ({ env, user, params, body }) => {
    const vehicle = await loadVehicle(env, user, params[0]);
    const patch = vehiclePatch(body);

    if ('plate' in body) {
      const key = plateKey(body.plate);
      if (!key) fail(400, 'That registration does not look right');
      if (key !== vehicle.plate_key) {
        const clash = await first(env,
          'SELECT id FROM vehicles WHERE dealership_id = ? AND plate_key = ? AND id != ?',
          user.dealership_id, key, vehicle.id);
        if (clash) fail(409, 'Another vehicle in your stock already has that registration');
      }
      patch.plate = formatPlate(key);
      patch.plate_key = key;
    }
    // Marking a car sold fills in the date and the price the dealer would
    // otherwise have to type twice; un-selling it clears both again.
    if (patch.status === 'sold' && vehicle.status !== 'sold') {
      if (!patch.date_sold && !vehicle.date_sold) patch.date_sold = nowIso().slice(0, 10);
      if (patch.sold_price === undefined && (vehicle.sold_price === null || vehicle.sold_price === undefined)) {
        patch.sold_price = vehicle.asking_price ?? null;
      }
    }
    if (patch.status && patch.status !== 'sold' && vehicle.status === 'sold') {
      patch.date_sold = null;
      patch.sold_price = null;
    }

    const statements = [];
    if (patch.asking_price !== undefined && vehicle.asking_price && patch.asking_price !== vehicle.asking_price) {
      statements.push(insert(env, 'activities', {
        id: uid(),
        dealership_id: user.dealership_id,
        vehicle_id: vehicle.id,
        kind: 'note',
        notes: `Price changed from ${Math.round(vehicle.asking_price).toLocaleString()} to ${Math.round(patch.asking_price || 0).toLocaleString()}`,
        occurred_at: nowIso(),
        user_id: user.id,
        user_name: user.name,
        created_at: nowIso(),
      }));
    }
    patch.updated_at = nowIso();
    const update = updateStmt(env, 'vehicles', vehicle.id, user.dealership_id, patch);
    if (update) statements.push(update);
    if (statements.length) await env.DB.batch(statements);

    return { vehicle: await vehicleView(env, user, { ...vehicle, ...patch }) };
  }],

  ['DELETE', /^\/vehicles\/([^/]+)$/, async ({ env, user, params }) => {
    const vehicle = await loadVehicle(env, user, params[0]);
    // D1 does not enforce ON DELETE CASCADE unless foreign keys are on for the
    // connection, so the children go explicitly.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM activities WHERE vehicle_id = ?').bind(vehicle.id),
      env.DB.prepare('DELETE FROM appointments WHERE vehicle_id = ?').bind(vehicle.id),
      env.DB.prepare('DELETE FROM valuations WHERE vehicle_id = ?').bind(vehicle.id),
      env.DB.prepare('DELETE FROM vehicles WHERE id = ? AND dealership_id = ?').bind(vehicle.id, user.dealership_id),
    ]);
    return { ok: true };
  }],

  /* ---- who came, who rang ---- */

  ['POST', /^\/vehicles\/([^/]+)\/activities$/, async ({ env, user, params, body }) => {
    const vehicle = await loadVehicle(env, user, params[0]);
    if (!ACTIVITY_KINDS.includes(body.kind)) fail(400, 'Unknown activity type');
    const activity = {
      id: uid(),
      dealership_id: user.dealership_id,
      vehicle_id: vehicle.id,
      kind: body.kind,
      contact_name: str(body.contactName, 120),
      contact_phone: str(body.contactPhone, 40),
      contact_email: str(body.contactEmail, 160),
      amount: num(body.amount),
      notes: str(body.notes, 2000),
      occurred_at: isoDate(body.occurredAt) || nowIso(),
      user_id: user.id,
      user_name: user.name,
      created_at: nowIso(),
    };
    await insert(env, 'activities', activity).run();
    return { activity, vehicle: await vehicleView(env, user, vehicle) };
  }],

  ['DELETE', /^\/activities\/([^/]+)$/, async ({ env, user, params }) => {
    const res = await run(env, 'DELETE FROM activities WHERE id = ? AND dealership_id = ?',
      params[0], user.dealership_id);
    if (!res.meta.changes) fail(404, 'Activity not found');
    return { ok: true };
  }],

  /* ---- the diary ---- */

  ['POST', /^\/vehicles\/([^/]+)\/appointments$/, async ({ env, user, params, body }) => {
    const vehicle = await loadVehicle(env, user, params[0]);
    const kind = str(body.kind, 20) || 'viewing';
    if (!APPOINTMENT_KINDS.includes(kind)) fail(400, 'Unknown appointment type');
    const customer = str(body.customerName, 120);
    const scheduled = isoDate(body.scheduledAt);
    if (!customer) fail(400, 'Who is coming in?');
    if (!scheduled) fail(400, 'Pick a date and time');

    const appointment = {
      id: uid(),
      dealership_id: user.dealership_id,
      vehicle_id: vehicle.id,
      kind,
      customer_name: customer,
      customer_phone: str(body.customerPhone, 40),
      customer_email: str(body.customerEmail, 160),
      scheduled_at: scheduled,
      status: 'scheduled',
      deposit: num(body.deposit),
      notes: str(body.notes, 2000),
      created_by: user.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const statements = [insert(env, 'appointments', appointment)];

    // Money down on a collection means the car is spoken for.
    const patch = {};
    if ((kind === 'collection' || kind === 'delivery') && num(body.deposit)
      && ['in_stock', 'prep'].includes(vehicle.status)) {
      patch.status = 'reserved';
      patch.buyer_name = customer;
      patch.updated_at = nowIso();
      statements.push(updateStmt(env, 'vehicles', vehicle.id, user.dealership_id, patch));
    }
    await env.DB.batch(statements);
    return { appointment, vehicle: await vehicleView(env, user, { ...vehicle, ...patch }) };
  }],

  ['PATCH', /^\/appointments\/([^/]+)$/, async ({ env, user, params, body }) => {
    const appointment = await first(env, 'SELECT * FROM appointments WHERE id = ? AND dealership_id = ?',
      params[0], user.dealership_id);
    if (!appointment) fail(404, 'Appointment not found');

    const patch = {};
    if ('status' in body) {
      if (!APPOINTMENT_STATUSES.includes(body.status)) fail(400, 'Unknown appointment status');
      patch.status = body.status;
    }
    if ('kind' in body && APPOINTMENT_KINDS.includes(body.kind)) patch.kind = body.kind;
    if ('customerName' in body) patch.customer_name = str(body.customerName, 120) || appointment.customer_name;
    if ('customerPhone' in body) patch.customer_phone = str(body.customerPhone, 40);
    if ('customerEmail' in body) patch.customer_email = str(body.customerEmail, 160);
    if ('scheduledAt' in body) patch.scheduled_at = isoDate(body.scheduledAt) || appointment.scheduled_at;
    if ('deposit' in body) patch.deposit = num(body.deposit);
    if ('notes' in body) patch.notes = str(body.notes, 2000);
    patch.updated_at = nowIso();

    const statements = [updateStmt(env, 'appointments', appointment.id, user.dealership_id, patch)];
    // A booking that happened is also a thing that happened to the car.
    if (patch.status === 'completed' && appointment.status !== 'completed') {
      const map = { viewing: 'viewing', test_drive: 'test_drive', valuation: 'note', collection: 'note', delivery: 'note' };
      statements.push(insert(env, 'activities', {
        id: uid(),
        dealership_id: user.dealership_id,
        vehicle_id: appointment.vehicle_id,
        kind: map[patch.kind || appointment.kind] || 'note',
        contact_name: patch.customer_name || appointment.customer_name,
        contact_phone: patch.customer_phone ?? appointment.customer_phone,
        contact_email: patch.customer_email ?? appointment.customer_email,
        notes: `${(patch.kind || appointment.kind).replace('_', ' ')} completed`,
        occurred_at: nowIso(),
        user_id: user.id,
        user_name: user.name,
        created_at: nowIso(),
      }));
    }
    await env.DB.batch(statements.filter(Boolean));

    const vehicle = await first(env, 'SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?',
      appointment.vehicle_id, user.dealership_id);
    return {
      appointment: { ...appointment, ...patch },
      vehicle: vehicle ? await vehicleView(env, user, vehicle) : null,
    };
  }],

  ['DELETE', /^\/appointments\/([^/]+)$/, async ({ env, user, params }) => {
    const res = await run(env, 'DELETE FROM appointments WHERE id = ? AND dealership_id = ?',
      params[0], user.dealership_id);
    if (!res.meta.changes) fail(404, 'Appointment not found');
    return { ok: true };
  }],

  ['GET', /^\/appointments$/, async ({ env, user }) => {
    const from = new Date(Date.now() - 86400000).toISOString();
    const to = new Date(Date.now() + 60 * 86400000).toISOString();
    const appointments = await all(env,
      `SELECT a.*, v.plate, v.make, v.model, v.year, v.asking_price
         FROM appointments a LEFT JOIN vehicles v ON v.id = a.vehicle_id
        WHERE a.dealership_id = ? AND a.scheduled_at >= ? AND a.scheduled_at <= ?
        ORDER BY a.scheduled_at ASC`, user.dealership_id, from, to);
    return { appointments };
  }],

  /* ---- what it is worth ---- */

  ['POST', /^\/vehicles\/([^/]+)\/valuations$/, async ({ env, user, params, body }) => {
    const vehicle = await loadVehicle(env, user, params[0]);
    const estimate = estimateValue(vehicle, {
      currency: user.dealership.currency,
      distanceUnit: user.dealership.distance_unit,
    });
    await insert(env, 'valuations', {
      id: uid(),
      dealership_id: user.dealership_id,
      vehicle_id: vehicle.id,
      trade_value: num(body.tradeValue) ?? estimate.trade,
      retail_value: num(body.retailValue) ?? estimate.retail,
      private_value: num(body.privateValue) ?? estimate.private,
      method: str(body.method, 60) || (body.retailValue ? 'Manual' : estimate.method),
      notes: str(body.notes, 1000),
      user_name: user.name,
      created_at: nowIso(),
    }).run();
    return {
      valuations: await all(env, 'SELECT * FROM valuations WHERE vehicle_id = ? ORDER BY created_at DESC', vehicle.id),
    };
  }],

  /* ---- the morning view ---- */

  ['GET', /^\/dashboard$/, async ({ env, user }) => {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * 86400000).toISOString();
    const fortnightAgo = new Date(now - 14 * 86400000).toISOString();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const dayEnd = new Date(Date.parse(dayStart) + 86400000).toISOString();
    const id = user.dealership_id;

    const [vehicles, activityCounts, weekKinds, feed, upcoming, todayRow] = await Promise.all([
      all(env, `SELECT id, plate, make, model, year, status, asking_price, purchase_price, prep_cost,
                       sold_price, date_in, date_sold, created_at, updated_at
                  FROM vehicles WHERE dealership_id = ?`, id),
      all(env, `SELECT vehicle_id, COUNT(*) AS total,
                       SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS recent
                  FROM activities WHERE dealership_id = ? GROUP BY vehicle_id`, fortnightAgo, id),
      all(env, `SELECT kind, COUNT(*) AS n FROM activities
                 WHERE dealership_id = ? AND occurred_at >= ? GROUP BY kind`, id, weekAgo),
      all(env, `SELECT a.*, v.plate, v.make, v.model
                  FROM activities a LEFT JOIN vehicles v ON v.id = a.vehicle_id
                 WHERE a.dealership_id = ? ORDER BY a.occurred_at DESC LIMIT 15`, id),
      all(env, `SELECT a.*, v.plate, v.make, v.model, v.year
                  FROM appointments a LEFT JOIN vehicles v ON v.id = a.vehicle_id
                 WHERE a.dealership_id = ? AND a.status = 'scheduled' AND a.scheduled_at >= ?
                 ORDER BY a.scheduled_at ASC LIMIT 12`, id, dayStart),
      first(env, `SELECT COUNT(*) AS n FROM appointments
                   WHERE dealership_id = ? AND status = 'scheduled'
                     AND scheduled_at >= ? AND scheduled_at < ?`, id, dayStart, dayEnd),
    ]);

    const interest = new Map(activityCounts.map((r) => [r.vehicle_id, r]));
    const byStatus = {};
    let live = 0; let value = 0; let invested = 0; let ageSum = 0;
    for (const v of vehicles) {
      const entry = byStatus[v.status] || (byStatus[v.status] = { count: 0, asking: 0, invested: 0 });
      entry.count++;
      entry.asking += v.asking_price || 0;
      entry.invested += (v.purchase_price || 0) + (v.prep_cost || 0);
      if (['in_stock', 'prep', 'reserved'].includes(v.status)) {
        live++;
        value += v.asking_price || 0;
        invested += (v.purchase_price || 0) + (v.prep_cost || 0);
        ageSum += daysBetween(v.date_in || v.created_at);
      }
    }

    const kindTotal = (...kinds) => weekKinds
      .filter((r) => kinds.includes(r.kind))
      .reduce((sum, r) => sum + r.n, 0);

    const sold = vehicles.filter((v) => v.status === 'sold' && (v.date_sold || v.updated_at) >= monthStart);

    const hot = vehicles
      .filter((v) => ['in_stock', 'prep', 'reserved'].includes(v.status))
      .map((v) => ({
        id: v.id, plate: v.plate, make: v.make, model: v.model, year: v.year,
        asking_price: v.asking_price, status: v.status,
        interest: (interest.get(v.id) || {}).recent || 0,
      }))
      .filter((v) => v.interest > 0)
      .sort((a, b) => b.interest - a.interest)
      .slice(0, 5);

    const aging = vehicles
      .filter((v) => ['in_stock', 'prep'].includes(v.status))
      .map((v) => ({
        id: v.id, plate: v.plate, make: v.make, model: v.model, year: v.year,
        asking_price: v.asking_price,
        days: daysBetween(v.date_in || v.created_at),
        interest: (interest.get(v.id) || {}).total || 0,
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);

    return {
      stock: {
        live,
        byStatus,
        value: Math.round(value),
        invested: Math.round(invested),
        avgDays: live ? Math.round(ageSum / live) : 0,
      },
      week: {
        viewings: kindTotal('viewing'),
        calls: kindTotal('call'),
        enquiries: kindTotal('enquiry', 'message'),
        testDrives: kindTotal('test_drive'),
        offers: kindTotal('offer'),
      },
      month: {
        sold: sold.length,
        revenue: Math.round(sold.reduce((s, v) => s + (v.sold_price || 0), 0)),
        profit: Math.round(sold.reduce((s, v) => s + (v.sold_price || 0) - (v.purchase_price || 0) - (v.prep_cost || 0), 0)),
      },
      appointments: { today: todayRow ? todayRow.n : 0, upcoming },
      hot,
      aging,
      feed,
    };
  }],

  /* ---- the team ---- */

  ['GET', /^\/team$/, async ({ env, user }) => {
    const team = await all(env,
      `SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_seen_at,
              (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS logged
         FROM users u WHERE u.dealership_id = ? ORDER BY u.created_at ASC`, user.dealership_id);
    return { team, joinCode: user.dealership.join_code };
  }],

  ['PATCH', /^\/team\/([^/]+)$/, async ({ env, user, params, body }) => {
    if (user.role !== 'owner') fail(403, 'Only the account owner can change roles');
    const res = await run(env, 'UPDATE users SET role = ? WHERE id = ? AND dealership_id = ?',
      body.role === 'owner' ? 'owner' : 'member', params[0], user.dealership_id);
    if (!res.meta.changes) fail(404, 'Team member not found');
    return { ok: true };
  }],

  ['DELETE', /^\/team\/([^/]+)$/, async ({ env, user, params }) => {
    if (user.role !== 'owner') fail(403, 'Only the account owner can remove people');
    if (params[0] === user.id) fail(400, 'You cannot remove yourself');
    const res = await run(env, 'DELETE FROM users WHERE id = ? AND dealership_id = ?', params[0], user.dealership_id);
    if (!res.meta.changes) fail(404, 'Team member not found');
    await run(env, 'DELETE FROM sessions WHERE user_id = ?', params[0]);
    return { ok: true };
  }],

  ['POST', /^\/team\/code$/, async ({ env, user }) => {
    if (user.role !== 'owner') fail(403, 'Only the account owner can reset the team code');
    const code = joinCode();
    await run(env, 'UPDATE dealerships SET join_code = ? WHERE id = ?', code, user.dealership_id);
    return { joinCode: code };
  }],

  ['PATCH', /^\/settings$/, async ({ env, user, body }) => {
    if (user.role !== 'owner') fail(403, 'Only the account owner can change these settings');
    const patch = {};
    if (body.name) patch.name = str(body.name, 120);
    if (body.currency) patch.currency = str(body.currency, 4).toUpperCase();
    if (body.country) patch.country = str(body.country, 4).toUpperCase();
    if (body.distanceUnit) patch.distance_unit = body.distanceUnit === 'km' ? 'km' : 'mi';
    const keys = Object.keys(patch);
    if (keys.length) {
      await run(env, `UPDATE dealerships SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        ...keys.map((k) => patch[k]), user.dealership_id);
    }
    return { user: publicUser({ ...user, dealership: { ...user.dealership, ...patch } }) };
  }],

  ['POST', /^\/demo$/, async ({ env, user }) => {
    const existing = await first(env, 'SELECT COUNT(*) AS n FROM vehicles WHERE dealership_id = ?', user.dealership_id);
    if (existing && existing.n) fail(400, 'Sample stock can only be added to an empty account');
    const demo = buildDemo(user);
    const withTenant = (row) => ({ ...row, dealership_id: user.dealership_id });
    await env.DB.batch([
      ...demo.vehicles.map((v) => insert(env, 'vehicles', withTenant(v))),
      ...demo.activities.map((a) => insert(env, 'activities', withTenant(a))),
      ...demo.appointments.map((a) => insert(env, 'appointments', withTenant(a))),
    ]);
    return { ok: true, added: DEMO_SIZE };
  }],
];

/* ---------------------------------------------------------------- CSV export */

/** The stock list as a spreadsheet, counts and guide price included. */
export async function exportCsv(env, user) {
  const list = await stockList(env, user);
  const header = [...CSV_COLUMNS, 'viewings', 'calls', 'enquiries', 'days_in_stock', 'guide_retail'];
  const lines = [header.join(',')];
  for (const v of list) {
    lines.push([
      ...CSV_COLUMNS.map((k) => csvCell(v[k])),
      v.viewings, v.calls, v.enquiries, v.stats.daysInStock, v.estimate.retail,
    ].join(','));
  }
  return lines.join('\n');
}
