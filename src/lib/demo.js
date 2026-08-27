/**
 * Sample stock.
 *
 * A brand-new account is an empty grid, which tells a dealer nothing about what
 * the app does. This builds a believable week on a small pitch — six cars, the
 * viewings and calls they attracted, and a collection booked for this
 * afternoon — so the dashboard, diary and enquiry list all have something to
 * show. It is offered once, and it is deletable.
 */
import { formatPlate, plateKey } from './plate.js';
import { nowIso, uid } from './model.js';

const SAMPLES = [
  ['LT20XYZ', 'Volkswagen', 'Golf', 'Life TSI 1.5', 2020, 'Grey', 'Petrol', 'Manual', 'Hatchback', 1498, 34210, 13495, 10800, 'in_stock', 96],
  ['MA68KDR', 'BMW', '320d', 'M Sport Touring', 2018, 'Black', 'Diesel', 'Automatic', 'Estate', 1995, 68400, 15995, 12750, 'in_stock', 41],
  ['YB21WNP', 'Ford', 'Puma', 'ST-Line X', 2021, 'Blue', 'Petrol', 'Manual', 'SUV', 999, 22980, 15750, 13200, 'reserved', 18],
  ['SK17FGH', 'Audi', 'A4', 'S Line TDI', 2017, 'White', 'Diesel', 'Automatic', 'Saloon', 1968, 89250, 11450, 8900, 'in_stock', 74],
  ['LR69TMA', 'Toyota', 'Yaris', 'Icon Hybrid', 2019, 'Red', 'Hybrid', 'Automatic', 'Hatchback', 1490, 41100, 11250, 9100, 'in_stock', 9],
  ['BD23OLV', 'Tesla', 'Model 3', 'Long Range', 2023, 'White', 'Electric', 'Automatic', 'Saloon', null, 18400, 26950, 23500, 'prep', 4],
];

const NAMES = ['Dave Harris', 'Priya Shah', 'Tom Nolan', 'Grace Bennett', 'Marcus Reid', 'Ellie Fry'];
const KINDS = ['viewing', 'call', 'enquiry', 'call', 'viewing', 'test_drive', 'offer'];

const BOOKINGS = [
  [2, 'collection', 'Priya Shah', '07700 900123', 26, 500, 'Paying balance on collection'],
  [1, 'viewing', 'Tom Nolan', '07700 900456', 5, null, 'Coming after work'],
  [0, 'test_drive', 'Grace Bennett', '07700 900789', 51, null, 'Bringing licence'],
];

export const DEMO_SIZE = SAMPLES.length;

/** Rows ready to store, in whichever backend asked for them. */
export function buildDemo(user) {
  const now = Date.now();
  const vehicles = [];
  const activities = [];
  const appointments = [];

  SAMPLES.forEach((sample, i) => {
    const [plate, make, model, variant, year, colour, fuel, transmission, body,
      cc, mileage, asking, purchase, status, days] = sample;
    const created = new Date(now - days * 86400000).toISOString();
    const id = uid();
    vehicles.push({
      id,
      plate: formatPlate(plate),
      plate_key: plateKey(plate),
      make, model, variant, year, colour, fuel, transmission, body,
      engine_cc: cc,
      mileage,
      condition: 'good',
      purchase_price: purchase,
      asking_price: asking,
      status,
      date_in: created.slice(0, 10),
      stock_number: `S${1001 + i}`,
      location: 'Main forecourt',
      service_history: 'Full service history',
      created_by: user.id,
      created_at: created,
      updated_at: created,
    });

    const events = Math.min(9, 2 + ((i * 3) % 8));
    for (let e = 0; e < events; e++) {
      const at = new Date(now - Math.max(1, days - e * 2) * 86400000 + e * 3600000).toISOString();
      const kind = KINDS[(i + e) % KINDS.length];
      activities.push({
        id: uid(),
        vehicle_id: id,
        kind,
        contact_name: NAMES[(i + e) % NAMES.length],
        contact_phone: `07${700 + ((i * 7 + e) % 99)} ${100000 + ((i * 13 + e * 7) % 899999)}`,
        contact_email: null,
        amount: kind === 'offer' ? 11800 + i * 250 : null,
        notes: kind === 'call' ? 'Asked about the service history'
          : kind === 'offer' ? 'Cash today, no part-ex' : null,
        occurred_at: at,
        user_id: user.id,
        user_name: user.name,
        created_at: at,
      });
    }
  });

  for (const [index, kind, customer, phone, hours, deposit, notes] of BOOKINGS) {
    appointments.push({
      id: uid(),
      vehicle_id: vehicles[index].id,
      kind,
      customer_name: customer,
      customer_phone: phone,
      customer_email: null,
      scheduled_at: new Date(now + hours * 3600000).toISOString(),
      status: 'scheduled',
      deposit,
      notes,
      created_by: user.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  return { vehicles, activities, appointments };
}
