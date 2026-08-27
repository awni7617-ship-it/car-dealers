/**
 * Guide valuation.
 *
 * A transparent, deterministic model — no third-party data feed required, so it
 * works the moment the app is deployed. It prices from what the dealer already
 * knows: make tier, body style, engine, age, mileage, condition and fuel, then
 * shows every adjustment it made so the number can be argued with rather than
 * taken on faith. Dealers can always save their own figure over the top.
 */

const TIERS = {
  budget: 15500,
  mainstream: 25000,
  upper: 31000,
  premium: 42000,
  luxury: 78000,
  exotic: 165000,
};

const MAKE_TIER = {
  dacia: 'budget', perodua: 'budget', proton: 'budget', ssangyong: 'budget', chery: 'budget',
  fiat: 'budget', suzuki: 'budget', mg: 'budget', smart: 'budget', chevrolet: 'budget',
  ford: 'mainstream', vauxhall: 'mainstream', opel: 'mainstream', toyota: 'mainstream',
  honda: 'mainstream', hyundai: 'mainstream', kia: 'mainstream', nissan: 'mainstream',
  renault: 'mainstream', peugeot: 'mainstream', citroen: 'mainstream', seat: 'mainstream',
  mazda: 'mainstream', mitsubishi: 'mainstream', subaru: 'mainstream', dodge: 'mainstream',
  chrysler: 'mainstream', jeep: 'upper', skoda: 'upper', volkswagen: 'upper', vw: 'upper',
  mini: 'upper', cupra: 'upper', alfa: 'upper', 'alfa romeo': 'upper', abarth: 'upper',
  audi: 'premium', bmw: 'premium', mercedes: 'premium', 'mercedes-benz': 'premium',
  volvo: 'premium', lexus: 'premium', jaguar: 'premium', infiniti: 'premium', ds: 'premium',
  genesis: 'premium', tesla: 'premium', polestar: 'premium', 'land rover': 'premium',
  landrover: 'premium', range: 'premium', porsche: 'luxury', maserati: 'luxury',
  'aston martin': 'exotic', bentley: 'exotic', ferrari: 'exotic', lamborghini: 'exotic',
  'rolls-royce': 'exotic', 'rolls royce': 'exotic', mclaren: 'exotic', bugatti: 'exotic',
  lotus: 'luxury',
};

const BODY_FACTOR = {
  hatchback: 0.9, hatch: 0.9, saloon: 1.0, sedan: 1.0, estate: 1.06, wagon: 1.06,
  suv: 1.22, crossover: 1.14, coupe: 1.16, convertible: 1.22, cabriolet: 1.22,
  roadster: 1.2, mpv: 1.04, van: 0.92, panel: 0.92, pickup: 1.12, 'pick-up': 1.12,
};

/**
 * Where a named model sits against its maker's average, as a share of the tier
 * base. A recognised model beats guessing from body style and engine size, so a
 * match here replaces both. Ordered specific-first: the first match wins.
 */
const MODEL_HINTS = [
  // Model names that would otherwise be swallowed by a broader rule below
  [/\brange ?rover ?sport\b/, 1.9],
  [/\b(evoque|discovery ?sport)\b/, 1.0],
  [/\b(velar|defender|discovery)\b/, 1.3],
  [/\brange ?rover\b/, 2.6],
  [/\b(macan|boxster|cayman|718)\b/, 0.65],
  [/\b(cayenne|taycan)\b/, 0.92],
  [/\b(panamera|911)\b/, 1.2],
  // City cars and superminis
  [/\b(aygo|c1|108|citigo|mii|up!?|twingo|panda|ka\b|picanto|i10|micra|spark|adam)\b/, 0.58],
  [/\b(fiesta|corsa|polo|clio|yaris|jazz|swift|ibiza|fabia|i20|rio|500\b|sandero|mazda ?2|note|zoe|leaf|e-208|208|colt|logan)\b/, 0.72],
  // Family hatchbacks and small saloons
  [/\b(focus|astra|golf|leon|octavia|megane|308|civic|i30|ceed|corolla|auris|mazda ?3|a3\b|a-class|1 ?series|11[0-9]d?|1[1-2][0-9]i|cla)\b/, 0.80],
  // Compact crossovers
  [/\b(puma|captur|juke|2008|kamiq|t-cross|t-roc|arona|kona|stonic|crossland|mokka|ecosport|yeti|q2\b|x1\b|gla)\b/, 0.86],
  // Mid-size SUVs and mid saloons/estates
  [/\b(qashqai|tucson|sportage|3008|kuga|karoq|ateca|tiguan|rav ?4|cx-?5|x-?trail|c-hr|sportage|grandland|3 ?series|3[123][0-9]d?i?|c-class|a4\b|q3\b|x3\b|xc40|passat|mondeo|insignia|superb|mazda ?6|accord|camry|model ?3)\b/, 1.02],
  // Large family SUVs and people carriers
  [/\b(santa ?fe|sorento|kodiaq|tarraco|5008|edge|highlander|outlander|zafira|galaxy|s-max|sharan|alhambra)\b/, 1.55],
  // Executive saloons, estates and mid-large premium SUVs
  [/\b(5 ?series|5[23][0-9]d?i?|e-class|a6\b|q5\b|x4\b|xc60|touareg|model ?y|glc|is ?300|nx\b)\b/, 1.35],
  // Large premium SUVs
  [/\b(x5\b|q7\b|gle|xc90|model ?x|rx ?450)\b/, 1.75],
  // Flagships
  [/\b(7 ?series|s-class|a8\b|x7\b|q8\b|ls ?500|model ?s)\b/, 1.9],
  // Vans and pickups
  [/\b(transit|vivaro|transporter|sprinter|caddy|berlingo|partner|combo|ducato|hilux|ranger|navara|l200|amarok)\b/, 1.0],
];

/** Yearly retention of list price, indexed by age in years, per price band. */
const RETENTION = {
  budget:     [1, 0.82, 0.73, 0.66, 0.60, 0.55, 0.50, 0.46, 0.42, 0.36, 0.30, 0.26, 0.22, 0.19, 0.16, 0.14],
  mainstream: [1, 0.82, 0.73, 0.66, 0.60, 0.55, 0.50, 0.46, 0.42, 0.36, 0.30, 0.26, 0.22, 0.19, 0.16, 0.14],
  upper:      [1, 0.78, 0.68, 0.61, 0.55, 0.50, 0.45, 0.41, 0.37, 0.32, 0.27, 0.23, 0.20, 0.17, 0.15, 0.13],
  premium:    [1, 0.74, 0.63, 0.55, 0.49, 0.44, 0.40, 0.36, 0.33, 0.28, 0.24, 0.21, 0.18, 0.16, 0.14, 0.12],
  luxury:     [1, 0.70, 0.58, 0.50, 0.44, 0.39, 0.35, 0.32, 0.28, 0.25, 0.22, 0.19, 0.17, 0.15, 0.13, 0.12],
  exotic:     [1, 0.85, 0.78, 0.73, 0.69, 0.66, 0.64, 0.62, 0.60, 0.58, 0.57, 0.56, 0.55, 0.54, 0.53, 0.52],
};

const CONDITION_FACTOR = { excellent: 1.07, good: 1.0, fair: 0.9, poor: 0.76 };

/** Rough conversion from the GBP-based model into the dealership's currency. */
const CURRENCY_FACTOR = {
  GBP: 1, USD: 1.27, EUR: 1.17, AUD: 1.92, NZD: 2.08, CAD: 1.72, ZAR: 23.5, AED: 4.66, INR: 106,
};

const MIN_VALUE = 450;

function tierFor(make) {
  const m = String(make || '').toLowerCase().trim();
  if (!m) return 'mainstream';
  if (MAKE_TIER[m]) return MAKE_TIER[m];
  const first = m.split(/[\s-]/)[0];
  return MAKE_TIER[first] || 'mainstream';
}

function bodyFactor(body, model) {
  const b = String(body || '').toLowerCase();
  for (const [k, v] of Object.entries(BODY_FACTOR)) if (b.includes(k)) return v;
  const m = String(model || '').toLowerCase();
  if (/\b(suv|x-trail|qashqai|kuga|tucson|sportage|rav|q[357]|x[1357])\b/.test(m)) return 1.18;
  if (/estate|touring|avant|sportbrake|sw\b/.test(m)) return 1.05;
  return 1.0;
}

function modelHint(make, model, variant) {
  const text = `${make || ''} ${model || ''} ${variant || ''}`.toLowerCase();
  if (!text.trim()) return null;
  for (const [pattern, factor] of MODEL_HINTS) if (pattern.test(text)) return factor;
  return null;
}

/** Retained share of the original list price at a given age, in years. */
function retention(age, tier) {
  const table = RETENTION[tier] || RETENTION.mainstream;
  if (age <= 0) return 1;
  if (age < table.length) return table[age];
  let r = table[table.length - 1];
  for (let i = table.length; i <= age; i++) r *= 0.88;
  return Math.max(r, 0.045);
}

function round(value) {
  if (value >= 20000) return Math.round(value / 250) * 250;
  if (value >= 5000) return Math.round(value / 100) * 100;
  if (value >= 1000) return Math.round(value / 50) * 50;
  return Math.round(value / 25) * 25;
}

/**
 * @param {object} v      vehicle record (year, make, model, body, engine_cc, mileage, ...)
 * @param {object} [opts] { currency, distanceUnit, now }
 */
export function estimateValue(v, opts = {}) {
  const currency = opts.currency || 'GBP';
  const fx = CURRENCY_FACTOR[currency] || 1;
  const now = opts.now ? new Date(opts.now) : new Date();
  const thisYear = now.getFullYear();
  const basis = [];
  const adjustments = [];

  const tier = tierFor(v.make);
  let base = TIERS[tier];
  basis.push(`${v.make || 'Unknown make'} priced from the ${tier} band`);

  const hint = modelHint(v.make, v.model, v.variant);
  if (hint !== null) {
    // A known model tells us more than body style and engine size together.
    base *= hint;
    basis.push(`${v.model} sits at ×${hint.toFixed(2)} of that band`);
  } else {
    const bf = bodyFactor(v.body, v.model);
    if (bf !== 1) {
      base *= bf;
      basis.push(`${v.body || 'body style'} ×${bf.toFixed(2)}`);
    }
    if (v.engine_cc) {
      const ef = Math.min(1.65, Math.max(0.85, Math.sqrt(v.engine_cc / 1600)));
      base *= ef;
      basis.push(`${(v.engine_cc / 1000).toFixed(1)}L engine ×${ef.toFixed(2)}`);
    }
  }
  basis.push(`Around ${(Math.round((base * fx) / 500) * 500).toLocaleString()} ${currency} when new`);

  const age = v.year ? Math.max(0, thisYear - Number(v.year)) : 8;
  if (!v.year) basis.push('No year on file — assumed 8 years old');
  let ret = retention(age, tier);
  basis.push(`${age} year${age === 1 ? '' : 's'} old — ${(ret * 100).toFixed(0)}% of list retained`);

  const fuel = String(v.fuel || '').toLowerCase();
  if (/electric/.test(fuel) && age >= 2) {
    ret *= 0.86;
    adjustments.push({ label: 'Used EV demand', factor: -14 });
  } else if (/hybrid/.test(fuel)) {
    ret *= 1.03;
    adjustments.push({ label: 'Hybrid demand', factor: 3 });
  } else if (/diesel/.test(fuel) && age >= 6) {
    ret *= 0.95;
    adjustments.push({ label: 'Older diesel', factor: -5 });
  }

  let value = base * ret;

  // Mileage: compare against ~8,000 miles a year.
  const miles = v.mileage ? Number(v.mileage) * (opts.distanceUnit === 'km' ? 0.621371 : 1) : null;
  if (miles !== null && Number.isFinite(miles)) {
    const expected = Math.max(4000, age * 8000);
    const delta = miles - expected;
    const perMile = Math.max(0.02, value * 0.0000048);
    let mileageAdj = -delta * perMile;
    const cap = value * 0.3;
    mileageAdj = Math.max(-cap, Math.min(cap, mileageAdj));
    value += mileageAdj;
    adjustments.push({
      label: `${Math.abs(Math.round(delta)).toLocaleString()} ${delta >= 0 ? 'above' : 'below'} average mileage`,
      amount: Math.round(mileageAdj),
    });
  } else {
    basis.push('No mileage recorded — add it for a sharper figure');
  }

  const cf = CONDITION_FACTOR[String(v.condition || 'good').toLowerCase()] || 1;
  if (cf !== 1) {
    const before = value;
    value *= cf;
    adjustments.push({ label: `${v.condition} condition`, amount: Math.round(value - before) });
  }

  if (v.mot_expiry) {
    const days = (Date.parse(v.mot_expiry) - now.getTime()) / 86400000;
    if (Number.isFinite(days) && days < 60) {
      const before = value;
      value -= Math.min(220, value * 0.02);
      adjustments.push({
        label: days < 0 ? 'MOT expired' : 'MOT due within 2 months',
        amount: Math.round(value - before),
      });
    }
  }

  if (String(v.service_history || '').toLowerCase().includes('full')) {
    const before = value;
    value *= 1.04;
    adjustments.push({ label: 'Full service history', amount: Math.round(value - before) });
  } else if (String(v.service_history || '').toLowerCase().includes('none')) {
    const before = value;
    value *= 0.93;
    adjustments.push({ label: 'No service history', amount: Math.round(value - before) });
  }

  const retail = Math.max(MIN_VALUE, value) * fx;

  // Confidence reflects how much of the spec we actually know.
  const known = ['make', 'model', 'year', 'mileage', 'body', 'engine_cc', 'fuel'].filter((k) => v[k]).length;
  const confidence = known >= 6 ? 'high' : known >= 4 ? 'medium' : 'low';

  return {
    currency,
    retail: round(retail),
    private: round(retail * 0.9),
    trade: round(retail * 0.79),
    partExchange: round(retail * 0.74),
    confidence,
    basis,
    adjustments,
    method: 'Forecourt guide model',
    generatedAt: now.toISOString(),
  };
}

/**
 * Turn stock age and enquiry volume into one clear next action.
 * @param {object} v vehicle
 * @param {object} stats { viewings, calls, enquiries, daysInStock, estimate }
 */
export function stockAdvice(v, stats) {
  const days = stats.daysInStock ?? 0;
  const interest = (stats.viewings || 0) + (stats.calls || 0) + (stats.enquiries || 0);
  const asking = Number(v.asking_price) || 0;
  const guide = stats.estimate ? stats.estimate.retail : 0;

  if (v.status === 'sold') {
    return { tone: 'good', headline: 'Sold', detail: 'Nothing left to do on this one.' };
  }
  if (v.status === 'reserved') {
    return { tone: 'good', headline: 'Reserved', detail: 'Hold it off the forecourt and confirm the collection slot.' };
  }
  if (asking && guide && asking > guide * 1.12) {
    return {
      tone: 'warn',
      headline: 'Priced above guide',
      detail: `Asking is ${Math.round(((asking / guide) - 1) * 100)}% over the guide retail figure. Expect slow interest.`,
    };
  }
  if (days >= 60 && interest < 3) {
    return {
      tone: 'bad',
      headline: 'Stuck stock',
      detail: `${days} days on site with ${interest} enquir${interest === 1 ? 'y' : 'ies'}. Re-photograph, re-advertise or move the price.`,
    };
  }
  if (days >= 30 && interest >= 6) {
    return {
      tone: 'warn',
      headline: 'Plenty of looks, no buyer',
      detail: `${interest} enquiries and still here after ${days} days — the car sells itself, so it is the price or the pitch.`,
    };
  }
  if (interest >= 5 && days < 21) {
    return { tone: 'good', headline: 'Hot car', detail: `${interest} enquiries in ${days} days. Hold firm on price.` };
  }
  if (days < 14) {
    return { tone: 'neutral', headline: 'Fresh stock', detail: 'Still inside the first fortnight — give it time.' };
  }
  return {
    tone: 'neutral',
    headline: 'Ticking along',
    detail: `${days} days in stock, ${interest} enquir${interest === 1 ? 'y' : 'ies'} so far.`,
  };
}




