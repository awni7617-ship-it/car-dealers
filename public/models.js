/**
 * Makes and models seen on UK pitches.
 *
 * Not a substitute for a registration lookup — it knows nothing about a
 * particular car. What it does is turn the two worst fields to type into two
 * fields you pick from, which is most of the benefit of a lookup on the builds
 * that cannot make one (a published page is sandboxed from outside services).
 *
 * Deliberately the common stock of a small pitch rather than an exhaustive
 * catalogue: a list of forty is a menu, a list of four hundred is a search
 * problem. Anything missing is still free text — these are suggestions, never
 * a constraint.
 */

export const MODELS = {
  Abarth: ['500', '595', '695'],
  'Alfa Romeo': ['Giulietta', 'Giulia', 'Stelvio', 'MiTo', 'Tonale'],
  'Aston Martin': ['DB11', 'Vantage', 'DBX'],
  Audi: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'e-tron', 'RS3', 'S3'],
  Bentley: ['Continental GT', 'Bentayga', 'Flying Spur'],
  BMW: ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', '8 Series',
    'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4', 'i3', 'i4', 'iX', 'M2', 'M3', 'M4'],
  Citroen: ['C1', 'C3', 'C3 Aircross', 'C4', 'C4 Cactus', 'C5 Aircross', 'Berlingo', 'DS3'],
  Cupra: ['Formentor', 'Leon', 'Born', 'Ateca'],
  Dacia: ['Sandero', 'Duster', 'Jogger', 'Spring'],
  DS: ['DS 3', 'DS 4', 'DS 7'],
  Fiat: ['500', '500X', '500L', 'Panda', 'Tipo', 'Ducato'],
  Ford: ['Fiesta', 'Focus', 'Puma', 'Kuga', 'EcoSport', 'Mondeo', 'Mustang', 'Mustang Mach-E',
    'Transit', 'Transit Custom', 'Ranger', 'S-Max', 'Galaxy', 'Ka'],
  Honda: ['Jazz', 'Civic', 'CR-V', 'HR-V', 'e'],
  Hyundai: ['i10', 'i20', 'i30', 'Tucson', 'Kona', 'Santa Fe', 'Ioniq', 'Ioniq 5', 'Bayon'],
  Jaguar: ['XE', 'XF', 'F-Pace', 'E-Pace', 'I-Pace', 'F-Type'],
  Jeep: ['Renegade', 'Compass', 'Wrangler', 'Avenger'],
  Kia: ['Picanto', 'Rio', 'Ceed', 'Sportage', 'Niro', 'Sorento', 'EV6', 'Stonic', 'Soul'],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport',
    'Range Rover Evoque', 'Range Rover Velar', 'Freelander'],
  Lexus: ['CT', 'IS', 'NX', 'RX', 'UX', 'ES'],
  Mazda: ['2', '3', '6', 'CX-3', 'CX-30', 'CX-5', 'MX-5', 'MX-30'],
  Mercedes: ['A-Class', 'B-Class', 'C-Class', 'E-Class', 'S-Class', 'CLA', 'CLS', 'GLA', 'GLB', 'GLC',
    'GLE', 'GLS', 'V-Class', 'Sprinter', 'Vito', 'EQA', 'EQC'],
  MG: ['3', 'ZS', 'HS', 'MG4', 'MG5'],
  Mini: ['Hatch', 'Clubman', 'Countryman', 'Convertible', 'Electric'],
  Mitsubishi: ['Outlander', 'ASX', 'Eclipse Cross', 'L200', 'Shogun'],
  Nissan: ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Leaf', 'Ariya', 'Note', 'Navara'],
  Peugeot: ['108', '208', '308', '508', '2008', '3008', '5008', 'Partner', 'Boxer', 'Rifter'],
  Polestar: ['2', '3'],
  Porsche: ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan', 'Boxster', 'Cayman'],
  Renault: ['Clio', 'Captur', 'Megane', 'Kadjar', 'Zoe', 'Scenic', 'Trafic', 'Austral'],
  Seat: ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco', 'Mii'],
  Skoda: ['Citigo', 'Fabia', 'Scala', 'Octavia', 'Superb', 'Kamiq', 'Karoq', 'Kodiaq', 'Enyaq'],
  Smart: ['ForTwo', 'ForFour'],
  Subaru: ['Forester', 'Outback', 'XV', 'Impreza'],
  Suzuki: ['Swift', 'Vitara', 'S-Cross', 'Ignis', 'Jimny'],
  Tesla: ['Model 3', 'Model Y', 'Model S', 'Model X'],
  Toyota: ['Aygo', 'Yaris', 'Yaris Cross', 'Corolla', 'C-HR', 'RAV4', 'Prius', 'Hilux', 'Proace', 'Auris'],
  Vauxhall: ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Zafira', 'Vivaro',
    'Combo', 'Adam', 'Viva'],
  Volkswagen: ['up!', 'Polo', 'Golf', 'Passat', 'Arteon', 'T-Cross', 'T-Roc', 'Tiguan', 'Touareg',
    'Touran', 'Sharan', 'Caddy', 'Transporter', 'ID.3', 'ID.4', 'Scirocco', 'Beetle'],
  Volvo: ['V40', 'V60', 'V90', 'S60', 'S90', 'XC40', 'XC60', 'XC90'],
};

export const MAKES = Object.keys(MODELS).sort();

/**
 * Models for a make, matched however the dealer typed it — "vw", "merc" and
 * "landrover" all find the right list, because nobody types "Volkswagen".
 */
const ALIASES = {
  vw: 'Volkswagen',
  merc: 'Mercedes',
  'mercedes-benz': 'Mercedes',
  benz: 'Mercedes',
  landrover: 'Land Rover',
  rangerover: 'Land Rover',
  alfa: 'Alfa Romeo',
  astonmartin: 'Aston Martin',
  vauxhal: 'Vauxhall',
};

export function modelsFor(make) {
  const typed = String(make || '').trim();
  if (!typed) return [];
  const key = typed.toLowerCase().replace(/[^a-z]/g, '');
  const alias = ALIASES[key];
  if (alias) return MODELS[alias] || [];

  const exact = MAKES.find((m) => m.toLowerCase() === typed.toLowerCase());
  if (exact) return MODELS[exact];

  // A make half-typed still narrows the models — "volk" is enough.
  const partial = MAKES.find((m) => m.toLowerCase().replace(/[^a-z]/g, '').startsWith(key));
  return partial ? MODELS[partial] : [];
}
