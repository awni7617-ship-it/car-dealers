/**
 * Vehicle identification.
 *
 * Everything here runs on the Worker, never in the browser: these calls carry
 * API keys, and the browser has no business holding them. The order is
 * deliberate — the registration provider first, MOT history to fill the model
 * and the real mileage, then the VIN as a last resort. Every source that
 * answered is named in the result so the dealer can see where a field came
 * from, and a plate is only paid for once a month.
 */
import { plateKey, formatPlate, decodePlate } from './plate.js';

const FUEL_MAP = {
  PETROL: 'Petrol', DIESEL: 'Diesel', ELECTRICITY: 'Electric', ELECTRIC: 'Electric',
  'HYBRID ELECTRIC': 'Hybrid', 'HYBRID ELECTRIC (CLEAN)': 'Hybrid', GAS: 'LPG',
  'GAS BI-FUEL': 'Bi-fuel', 'GAS DIESEL': 'Bi-fuel',
};

function titleCase(value) {
  if (!value) return null;
  return String(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bBmw\b/, 'BMW')
    .replace(/\bMg\b/, 'MG')
    .replace(/\bDs\b/, 'DS')
    .replace(/\bGmc\b/, 'GMC');
}

/** DVLA Vehicle Enquiry Service — needs a free API key in DVLA_API_KEY. */
async function fetchDvla(key, apiKey) {
  const res = await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ registrationNumber: key }),
  });
  if (!res.ok) {
    if (res.status === 404) return { notFound: true };
    throw new Error(`DVLA responded ${res.status}`);
  }
  const d = await res.json();
  const firstReg = d.monthOfFirstRegistration ? `${d.monthOfFirstRegistration}-01` : null;
  return {
    data: {
      make: titleCase(d.make),
      colour: titleCase(d.colour),
      fuel: FUEL_MAP[String(d.fuelType || '').toUpperCase()] || titleCase(d.fuelType),
      year: d.yearOfManufacture || null,
      engineCc: d.engineCapacity || null,
      co2: d.co2Emissions ?? null,
      motExpiry: d.motExpiryDate || null,
      motStatus: d.motStatus || null,
      taxStatus: d.taxStatus || null,
      taxDue: d.taxDueDate || null,
      firstRegistered: firstReg,
      wheelplan: titleCase(d.wheelplan),
      typeApproval: d.typeApproval || null,
      exported: d.markedForExport || false,
    },
    source: 'DVLA',
  };
}

/**
 * DVSA MOT History API. Needs MOT_CLIENT_ID / MOT_CLIENT_SECRET / MOT_API_KEY.
 * Worth having: it holds the model — which DVLA does not — and every odometer
 * reading ever recorded at an MOT, so mileage can be checked against history.
 */
const MOT_TENANT = 'a455b827-244f-4c97-b5b4-ce5d13b4d00c';
let motToken = null;

async function motAccessToken(env) {
  if (motToken && motToken.expires > Date.now() + 60_000) return motToken.value;
  const tenant = env.MOT_TENANT_ID || MOT_TENANT;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.MOT_CLIENT_ID,
      client_secret: env.MOT_CLIENT_SECRET,
      scope: 'https://tapi.dvsa.gov.uk/.default',
    }),
  });
  if (!res.ok) throw new Error(`MOT sign-in failed (${res.status})`);
  const json = await res.json();
  motToken = { value: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return motToken.value;
}

async function fetchMot(key, env) {
  const token = await motAccessToken(env);
  const res = await fetch(
    `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(key)}`,
    { headers: { authorization: `Bearer ${token}`, 'x-api-key': env.MOT_API_KEY, accept: 'application/json+v6' } },
  );
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`MOT history responded ${res.status}`);
  const v = await res.json();

  const tests = (v.motTests || [])
    .map((t) => ({
      date: t.completedDate || '',
      result: t.testResult || '',
      expiry: t.expiryDate || '',
      odometer: Number(t.odometerValue) || null,
      unit: (t.odometerUnit || 'mi').toLowerCase().startsWith('k') ? 'km' : 'mi',
      advisories: (t.defects || []).filter((d) => /advisory|minor/i.test(d.type || '')).length,
      failures: (t.defects || []).filter((d) => /fail|major|dangerous/i.test(d.type || '')).length,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const withReading = tests.filter((t) => t.odometer);
  const latest = withReading[0] || null;
  // A reading lower than an older one is the clocking check a dealer wants.
  let discrepancy = null;
  for (let i = 0; i < withReading.length - 1; i++) {
    if (withReading[i].odometer < withReading[i + 1].odometer) {
      discrepancy = `Recorded mileage drops from ${withReading[i + 1].odometer.toLocaleString()} (${withReading[i + 1].date.slice(0, 10)}) to ${withReading[i].odometer.toLocaleString()} (${withReading[i].date.slice(0, 10)})`;
      break;
    }
  }

  return {
    data: {
      make: titleCase(v.make),
      model: titleCase(v.model),
      fuel: FUEL_MAP[String(v.fuelType || '').toUpperCase()] || titleCase(v.fuelType),
      colour: titleCase(v.primaryColour),
      engineCc: Number(v.engineSize) || null,
      firstRegistered: (v.firstUsedDate || v.registrationDate || '').slice(0, 10) || null,
      motExpiry: tests[0] ? tests[0].expiry : null,
      mileage: latest ? latest.odometer : null,
    },
    history: {
      lastReading: latest,
      readings: withReading.slice(0, 6).map(({ date, odometer, unit }) => ({ date: date.slice(0, 10), odometer, unit })),
      tests: tests.length,
      passRate: tests.length
        ? Math.round((tests.filter((t) => /pass/i.test(t.result)).length / tests.length) * 100)
        : null,
      discrepancy,
    },
    source: 'DVSA MOT history',
  };
}

/** Any other provider: LOOKUP_URL with {plate}, key sent in LOOKUP_HEADER. */
async function fetchGeneric(key, env) {
  const url = env.LOOKUP_URL.replace('{plate}', encodeURIComponent(key));
  const headers = { accept: 'application/json' };
  if (env.LOOKUP_KEY) headers[env.LOOKUP_HEADER || 'x-api-key'] = env.LOOKUP_KEY;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Lookup provider responded ${res.status}`);
  const raw = await res.json();
  // Providers nest their payload differently; look one level down too.
  const d = raw.vehicle || raw.data || raw.Response || raw.result || raw;
  const pick = (...names) => {
    for (const n of names) {
      for (const candidate of [n, n.toLowerCase(), n.toUpperCase()]) {
        if (d && d[candidate] !== undefined && d[candidate] !== null && d[candidate] !== '') return d[candidate];
      }
    }
    return null;
  };
  return {
    data: {
      make: titleCase(pick('make', 'Make', 'manufacturer')),
      model: titleCase(pick('model', 'Model', 'range')),
      variant: titleCase(pick('variant', 'trim', 'derivative')),
      year: Number(pick('year', 'yearOfManufacture', 'manufactureYear')) || null,
      colour: titleCase(pick('colour', 'color')),
      fuel: titleCase(pick('fuel', 'fuelType')),
      transmission: titleCase(pick('transmission', 'transmissionType')),
      body: titleCase(pick('body', 'bodyStyle', 'bodyType')),
      engineCc: Number(pick('engineCc', 'engineCapacity', 'engineSize')) || null,
      doors: Number(pick('doors', 'numberOfDoors')) || null,
      seats: Number(pick('seats', 'numberOfSeats')) || null,
      co2: Number(pick('co2', 'co2Emissions')) ?? null,
      vin: pick('vin', 'VIN', 'chassisNumber'),
      motExpiry: pick('motExpiry', 'motExpiryDate'),
      taxDue: pick('taxDue', 'taxDueDate'),
    },
    source: env.LOOKUP_NAME || 'Provider',
  };
}

/** NHTSA vPIC — free, keyless, worldwide VIN decoding. */
async function decodeVin(vin) {
  const clean = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 17) return null;
  const res = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${clean}?format=json`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`VIN service responded ${res.status}`);
  const json = await res.json();
  const r = (json.Results && json.Results[0]) || {};
  if (!r.Make && !r.Model) return null;
  const trans = r.TransmissionStyle || '';
  return {
    vin: clean,
    make: titleCase(r.Make),
    model: titleCase(r.Model),
    variant: titleCase(r.Trim || r.Series || null),
    year: Number(r.ModelYear) || null,
    body: titleCase(r.BodyClass),
    fuel: titleCase(r.FuelTypePrimary),
    transmission: /manual/i.test(trans) ? 'Manual' : /auto|cvt|dct/i.test(trans) ? 'Automatic' : titleCase(trans) || null,
    engineCc: r.DisplayCC ? Math.round(Number(r.DisplayCC)) : null,
    doors: Number(r.Doors) || null,
    seats: Number(r.Seats) || null,
    plant: [r.PlantCity, r.PlantCountry].filter(Boolean).join(', ') || null,
  };
}

const CACHE_DAYS = 30;

/**
 * Identify a vehicle from its plate (and optionally a VIN).
 * Returns { plate, fields, decoded, source, sources[], cached }.
 */
export async function identify(env, plateInput, vinInput) {
  const key = plateKey(plateInput);
  const decoded = decodePlate(key);
  const fields = {};
  const sources = [];
  let cached = false;

  if (decoded.year) fields.year = decoded.year;
  if (decoded.registeredFrom) fields.firstRegistered = decoded.registeredFrom;
  if (decoded.region) fields.region = decoded.issuedAt ? `${decoded.region} (${decoded.issuedAt})` : decoded.region;
  if (decoded.scheme.startsWith('uk')) sources.push('Plate decoder');

  // A cached hit avoids paying for the same plate twice.
  let live = null;
  if (key) {
    try {
      const row = await env.DB.prepare(
        'SELECT payload, fetched_at FROM plate_cache WHERE plate_key = ?',
      ).bind(key).first();
      if (row && (Date.now() - Date.parse(row.fetched_at)) / 86400000 < CACHE_DAYS) {
        live = JSON.parse(row.payload);
        cached = true;
      }
    } catch { /* cache is best-effort */ }
  }

  if (!live && key) {
    live = { fields: {}, history: null, sources: [] };

    // 1. The registration provider: DVLA, or whatever LOOKUP_URL points at.
    try {
      const provider = env.LOOKUP_URL
        ? await fetchGeneric(key, env)
        : env.DVLA_API_KEY
          ? await fetchDvla(key, env.DVLA_API_KEY)
          : null;
      if (provider && provider.data) {
        Object.assign(live.fields, clean(provider.data));
        live.sources.push(provider.source);
      } else if (provider && provider.notFound) {
        live.sources.push('Not held by DVLA');
      }
    } catch (err) {
      live.sources.push(`Lookup unavailable (${err.message})`);
    }

    // 2. MOT history fills what DVLA cannot: the model, and real mileage.
    if (env.MOT_CLIENT_ID && env.MOT_CLIENT_SECRET && env.MOT_API_KEY) {
      try {
        const mot = await fetchMot(key, env);
        if (mot && mot.data) {
          for (const [k, v] of Object.entries(clean(mot.data))) {
            if (live.fields[k] === undefined || live.fields[k] === null || live.fields[k] === '') {
              live.fields[k] = v;
            }
          }
          live.history = mot.history;
          live.sources.push(mot.source);
        } else if (mot && mot.notFound) {
          live.sources.push('No MOT history');
        }
      } catch (err) {
        live.sources.push(`MOT history unavailable (${err.message})`);
      }
    }

    if (live.sources.length) {
      try {
        await env.DB.prepare(
          `INSERT INTO plate_cache (plate_key, payload, source, fetched_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(plate_key) DO UPDATE SET payload = excluded.payload, source = excluded.source, fetched_at = excluded.fetched_at`,
        ).bind(key, JSON.stringify(live), live.sources[0], new Date().toISOString()).run();
      } catch { /* cache is best-effort */ }
    }
  }

  if (live) {
    Object.assign(fields, live.fields || {});
    for (const s of live.sources || []) sources.push(cached ? `${s} (cached)` : s);
  }

  const vin = vinInput || fields.vin;
  if (vin) {
    try {
      const vinData = await decodeVin(vin);
      if (vinData) {
        // VIN fills the gaps — notably model and trim, which DVLA does not hold.
        for (const [k, v] of Object.entries(clean(vinData))) {
          if (fields[k] === undefined || fields[k] === null || fields[k] === '') fields[k] = v;
        }
        sources.push('NHTSA VIN database');
      }
    } catch (err) {
      sources.push(`VIN decode unavailable (${err.message})`);
    }
  }

  return {
    plate: formatPlate(key),
    plateKey: key,
    fields,
    decoded,
    history: (live && live.history) || null,
    sources,
    cached,
    identified: Boolean(fields.make || fields.model),
  };
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== null && v !== undefined && v !== '' && !Number.isNaN(v)) out[k] = v;
  }
  return out;
}


