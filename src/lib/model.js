/**
 * The rules both backends obey.
 *
 * The Worker writes to D1 and the standalone build writes to localStorage, but
 * a plate is cleaned, a price parsed and a vehicle's interest counted exactly
 * once — here — so the two can never drift apart on what the data means.
 */
import { estimateValue, stockAdvice } from './valuation.js';

export const nowIso = () => new Date().toISOString();
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const fail = (status, message, extra) => {
  throw new ApiError(status, message, extra);
};

export const str = (v, max = 500) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  // Text with no digits in it ("ask me", "n/a") cleans down to nothing, and
  // Number('') is 0 — which would quietly price a car at zero.
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

export const dayOnly = (v) => {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

export const isoDate = (v) => {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export const daysBetween = (from) => {
  const t = Date.parse(from);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : 0;
};

export const TEXT_FIELDS = [
  'vin', 'make', 'model', 'variant', 'colour', 'fuel', 'transmission', 'body', 'condition',
  'status', 'location', 'stock_number', 'service_history', 'mot_expiry', 'tax_status',
  'tax_due', 'first_registered', 'region', 'photo', 'notes', 'date_in', 'date_sold', 'buyer_name',
];
export const NUMBER_FIELDS = [
  'year', 'engine_cc', 'doors', 'seats', 'co2', 'mileage', 'keys_count',
  'purchase_price', 'asking_price', 'sold_price', 'prep_cost',
];
export const STATUSES = ['in_stock', 'prep', 'reserved', 'sold', 'archived'];
export const ACTIVITY_KINDS = ['viewing', 'call', 'enquiry', 'test_drive', 'offer', 'message', 'note'];
export const APPOINTMENT_KINDS = ['viewing', 'test_drive', 'collection', 'delivery', 'valuation'];
export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

export function vehiclePatch(body) {
  const patch = {};
  for (const k of TEXT_FIELDS) if (k in body) patch[k] = str(body[k], k === 'notes' ? 20000 : 200);
  for (const k of NUMBER_FIELDS) if (k in body) patch[k] = num(body[k]);
  if (patch.status && !STATUSES.includes(patch.status)) fail(400, 'Unknown status');
  for (const k of ['mot_expiry', 'tax_due', 'first_registered', 'date_in', 'date_sold']) {
    if (k in patch && patch[k]) patch[k] = dayOnly(patch[k]);
  }
  if (patch.vin) patch.vin = patch.vin.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (patch.year !== undefined && patch.year !== null) {
    const y = Math.round(patch.year);
    patch.year = y >= 1900 && y <= new Date().getFullYear() + 2 ? y : null;
  }
  return patch;
}

export function joinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => alphabet[b % alphabet.length]).join('').replace(/^(.{4})/, '$1-');
}

/**
 * What a vehicle's activity adds up to: how many came to look, how many rang,
 * and who is booked in next. Takes plain arrays so it works the same over a D1
 * result set as over the standalone store.
 */
export function counts(activities, appointments) {
  const acts = activities || [];
  const appts = (appointments || [])
    .filter((a) => a.status === 'scheduled')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return {
    viewings: acts.filter((a) => a.kind === 'viewing').length,
    calls: acts.filter((a) => a.kind === 'call').length,
    enquiries: acts.filter((a) => ['enquiry', 'offer', 'test_drive', 'message'].includes(a.kind)).length,
    last_activity_at: acts.length ? acts.map((a) => a.occurred_at).sort().pop() : null,
    booked: appts.length,
    next_at: appts[0] ? appts[0].scheduled_at : null,
    next_customer: appts[0] ? appts[0].customer_name : null,
    next_kind: appts[0] ? appts[0].kind : null,
  };
}

/** A stored vehicle plus everything the front end shows around it. */
export function decorate(vehicle, { activities, appointments, dealership }) {
  const c = counts(activities, appointments);
  const stats = {
    viewings: c.viewings,
    calls: c.calls,
    enquiries: c.enquiries,
    daysInStock: daysBetween(vehicle.date_in || vehicle.created_at),
  };
  const estimate = estimateValue(vehicle, {
    currency: dealership.currency,
    distanceUnit: dealership.distance_unit,
  });
  return {
    ...vehicle,
    ...c,
    stats: { ...stats, interest: stats.viewings + stats.calls + stats.enquiries },
    estimate,
    advice: stockAdvice(vehicle, { ...stats, estimate }),
    margin: vehicle.asking_price ? vehicle.asking_price - (vehicle.purchase_price || 0) - (vehicle.prep_cost || 0) : null,
    profit: vehicle.sold_price ? vehicle.sold_price - (vehicle.purchase_price || 0) - (vehicle.prep_cost || 0) : null,
  };
}

export const SORTS = {
  newest: (a, b) => b.created_at.localeCompare(a.created_at),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at),
  price_high: (a, b) => (b.asking_price || 0) - (a.asking_price || 0),
  price_low: (a, b) => (a.asking_price || 0) - (b.asking_price || 0),
  interest: (a, b) => b.stats.interest - a.stats.interest,
  age: (a, b) => (a.date_in || a.created_at).localeCompare(b.date_in || b.created_at),
  plate: (a, b) => a.plate_key.localeCompare(b.plate_key),
};

/** The columns a dealer gets when they export their stock list. */
export const CSV_COLUMNS = ['plate', 'stock_number', 'make', 'model', 'variant', 'year', 'colour', 'fuel',
  'transmission', 'mileage', 'status', 'purchase_price', 'prep_cost', 'asking_price',
  'sold_price', 'date_in', 'date_sold', 'buyer_name', 'location', 'mot_expiry', 'vin'];

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
