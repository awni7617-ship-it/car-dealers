/**
 * Registration-plate intelligence.
 *
 * Three layers, best first, merged into one result:
 *   1. A live provider — DVLA's Vehicle Enquiry Service, or any provider wired
 *      up through LOOKUP_URL — when a key is configured.
 *   2. VIN decoding through the free NHTSA vPIC database (no key needed).
 *   3. An offline decoder that reads the plate itself: format, age identifier,
 *      first-registration window and the DVLA office that issued it.
 *
 * Every layer is optional and every failure is soft, so a lookup always returns
 * something useful and the user can correct anything.
 */

export function plateKey(plate) {
  return String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatPlate(plate) {
  const key = plateKey(plate);
  // Current UK style AA00AAA -> "AA00 AAA"
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(key)) return `${key.slice(0, 4)} ${key.slice(4)}`;
  // Prefix style A000AAA -> "A000 AAA"
  if (/^[A-Z]\d{1,3}[A-Z]{3}$/.test(key)) return `${key.slice(0, -3)} ${key.slice(-3)}`;
  // Suffix style AAA000A -> "AAA 000A"
  if (/^[A-Z]{3}\d{1,3}[A-Z]$/.test(key)) return `${key.slice(0, 3)} ${key.slice(3)}`;
  // Northern Ireland AAA0000 -> "AAA 0000"
  if (/^[A-Z]{1,3}\d{1,4}$/.test(key)) return `${key.replace(/(\d)/, ' $1')}`;
  return key;
}

/** DVLA memory tags: first letter = area, second letter = issuing office. */
const AREAS = {
  A: { area: 'Anglia', offices: [['AA', 'AN', 'Peterborough'], ['AO', 'AU', 'Norwich'], ['AV', 'AY', 'Ipswich']] },
  B: { area: 'Birmingham', offices: [['BA', 'BY', 'Birmingham']] },
  C: { area: 'Cymru', offices: [['CA', 'CO', 'Cardiff'], ['CP', 'CV', 'Swansea'], ['CW', 'CY', 'Bangor']] },
  D: { area: 'Deeside', offices: [['DA', 'DK', 'Chester'], ['DL', 'DY', 'Shrewsbury']] },
  E: { area: 'Essex', offices: [['EA', 'EY', 'Chelmsford']] },
  F: { area: 'Forest & Fens', offices: [['FA', 'FP', 'Nottingham'], ['FR', 'FY', 'Lincoln']] },
  G: { area: 'Garden of England', offices: [['GA', 'GO', 'Maidstone'], ['GP', 'GY', 'Brighton']] },
  H: { area: 'Hampshire & Dorset', offices: [['HA', 'HJ', 'Bournemouth'], ['HK', 'HY', 'Portsmouth']] },
  K: { area: 'Luton & Northampton', offices: [['KA', 'KL', 'Luton'], ['KM', 'KY', 'Northampton']] },
  L: { area: 'London', offices: [['LA', 'LJ', 'Wimbledon'], ['LK', 'LT', 'Stanmore'], ['LU', 'LY', 'Sidcup']] },
  M: { area: 'Manchester & Merseyside', offices: [['MA', 'MY', 'Manchester']] },
  N: { area: 'North', offices: [['NA', 'NO', 'Newcastle'], ['NP', 'NY', 'Stockton']] },
  O: { area: 'Oxford', offices: [['OA', 'OY', 'Oxford']] },
  P: { area: 'Preston', offices: [['PA', 'PT', 'Preston'], ['PU', 'PY', 'Carlisle']] },
  R: { area: 'Reading', offices: [['RA', 'RY', 'Reading']] },
  S: { area: 'Scotland', offices: [['SA', 'SJ', 'Glasgow'], ['SK', 'SO', 'Edinburgh'], ['SP', 'ST', 'Dundee'], ['SU', 'SW', 'Aberdeen'], ['SX', 'SY', 'Inverness']] },
  V: { area: 'Severn Valley', offices: [['VA', 'VY', 'Worcester']] },
  W: { area: 'West of England', offices: [['WA', 'WJ', 'Exeter'], ['WK', 'WL', 'Truro'], ['WM', 'WY', 'Bristol']] },
  Y: { area: 'Yorkshire', offices: [['YA', 'YK', 'Leeds'], ['YL', 'YU', 'Sheffield'], ['YV', 'YY', 'Beverley']] },
};

/** Year letters used by the pre-2001 prefix and suffix schemes. */
const PREFIX_YEARS = {
  A: '1983-84', B: '1984-85', C: '1985-86', D: '1986-87', E: '1987-88', F: '1988-89',
  G: '1989-90', H: '1990-91', J: '1991-92', K: '1992-93', L: '1993-94', M: '1994-95',
  N: '1995-96', P: '1996-97', R: '1997-98', S: '1998-99', T: '1999', V: '1999-2000',
  W: '2000', X: '2000-01', Y: '2001',
};
const SUFFIX_YEARS = {
  A: '1963-64', B: '1964-65', C: '1965-66', D: '1966-67', E: '1967', F: '1967-68',
  G: '1968-69', H: '1969-70', J: '1970-71', K: '1971-72', L: '1972-73', M: '1973-74',
  N: '1974-75', P: '1975-76', R: '1976-77', S: '1977-78', T: '1978-79', V: '1979-80',
  W: '1980-81', X: '1981-82', Y: '1982-83',
};

function officeFor(tag) {
  const entry = AREAS[tag[0]];
  if (!entry) return null;
  const office = entry.offices.find(([from, to]) => tag >= from && tag <= to);
  return { area: entry.area, office: office ? office[2] : entry.offices[0][2] };
}

/**
 * Read everything the plate itself can tell us — no network required.
 */
export function decodePlate(plate) {
  const key = plateKey(plate);
  const out = { plate: formatPlate(key), plateKey: key, valid: key.length >= 2 && key.length <= 8 };
  if (!out.valid) {
    out.scheme = 'unknown';
    out.note = 'Not a recognised registration format — enter the details by hand.';
    return out;
  }

  let m;
  if ((m = key.match(/^([A-Z]{2})(\d{2})([A-Z]{3})$/))) {
    const [, tag, ageStr] = m;
    const age = Number(ageStr);
    const half = age >= 50;
    const year = 2000 + (half ? age - 50 : age);
    out.scheme = 'uk-current';
    out.ageIdentifier = ageStr;
    out.year = year;
    out.registeredFrom = half ? `${year}-09-01` : `${year}-03-01`;
    out.registeredTo = half ? `${year + 1}-02-28` : `${year}-08-31`;
    out.registrationPeriod = half
      ? `September ${year} – February ${year + 1}`
      : `March – August ${year}`;
    const office = officeFor(tag);
    if (office) {
      out.region = office.area;
      out.issuedAt = office.office;
    }
    out.note = `${out.registrationPeriod} plate${office ? `, issued in ${office.office}` : ''}.`;
    return out;
  }

  if ((m = key.match(/^([A-Z])(\d{1,3})([A-Z]{3})$/)) && PREFIX_YEARS[m[1]]) {
    out.scheme = 'uk-prefix';
    out.registrationPeriod = PREFIX_YEARS[m[1]];
    out.year = Number(String(PREFIX_YEARS[m[1]]).slice(0, 4));
    out.note = `Prefix plate — first registered ${out.registrationPeriod}.`;
    return out;
  }

  if ((m = key.match(/^([A-Z]{3})(\d{1,3})([A-Z])$/)) && SUFFIX_YEARS[m[3]]) {
    out.scheme = 'uk-suffix';
    out.registrationPeriod = SUFFIX_YEARS[m[3]];
    out.year = Number(String(SUFFIX_YEARS[m[3]]).slice(0, 4));
    out.note = `Suffix plate — first registered ${out.registrationPeriod}. Classic-era vehicle.`;
    return out;
  }

  if (/^[A-Z]{1,3}\d{1,4}$/.test(key) || /^\d{1,4}[A-Z]{1,3}$/.test(key)) {
    out.scheme = /[IZ]/.test(key) ? 'northern-ireland' : 'dateless';
    out.note = out.scheme === 'northern-ireland'
      ? 'Northern Ireland style plate — these carry no age identifier.'
      : 'Dateless or private plate — the year cannot be read from the registration.';
    return out;
  }

  out.scheme = 'other';
  out.note = 'Non-UK or personalised plate — add the details manually and they will be saved.';
  return out;
}
