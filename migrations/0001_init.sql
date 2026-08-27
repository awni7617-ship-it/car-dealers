-- Forecourt — initial schema.
--
-- GENERATED FROM src/lib/schema.js — do not edit by hand.
-- Run `npm run build:migration` after changing the schema there.
--
-- One row per dealership; every other table hangs off it and is always queried
-- with its dealership_id, so one pitch can never see another's stock.

CREATE TABLE IF NOT EXISTS dealerships (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  join_code     TEXT NOT NULL UNIQUE,
  country       TEXT NOT NULL DEFAULT 'GB',
  currency      TEXT NOT NULL DEFAULT 'GBP',
  distance_unit TEXT NOT NULL DEFAULT 'mi',
  vat_scheme    TEXT NOT NULL DEFAULT 'margin',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  password      TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE INDEX IF NOT EXISTS users_dealership_idx ON users (dealership_id);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS vehicles (
  id               TEXT PRIMARY KEY,
  dealership_id    TEXT NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  plate            TEXT NOT NULL,
  plate_key        TEXT NOT NULL,
  vin              TEXT,
  make             TEXT,
  model            TEXT,
  variant          TEXT,
  year             INTEGER,
  colour           TEXT,
  fuel             TEXT,
  transmission     TEXT,
  body             TEXT,
  engine_cc        INTEGER,
  doors            INTEGER,
  seats            INTEGER,
  co2              INTEGER,
  mileage          INTEGER,
  condition        TEXT DEFAULT 'good',
  keys_count       INTEGER,
  status           TEXT NOT NULL DEFAULT 'in_stock',
  location         TEXT,
  stock_number     TEXT,
  service_history  TEXT,
  mot_expiry       TEXT,
  tax_status       TEXT,
  tax_due          TEXT,
  first_registered TEXT,
  region           TEXT,
  purchase_price   REAL,
  asking_price     REAL,
  sold_price       REAL,
  prep_cost        REAL,
  photo            TEXT,
  notes            TEXT,
  date_in          TEXT,
  date_sold        TEXT,
  buyer_name       TEXT,
  lookup_source    TEXT,
  lookup           TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_idx ON vehicles (dealership_id, plate_key);

CREATE INDEX IF NOT EXISTS vehicles_status_idx ON vehicles (dealership_id, status);

CREATE TABLE IF NOT EXISTS activities (
  id            TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  amount        REAL,
  notes         TEXT,
  occurred_at   TEXT NOT NULL,
  user_id       TEXT,
  user_name     TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS activities_vehicle_idx ON activities (vehicle_id, occurred_at);

CREATE INDEX IF NOT EXISTS activities_dealership_idx ON activities (dealership_id, occurred_at);

CREATE TABLE IF NOT EXISTS appointments (
  id             TEXT PRIMARY KEY,
  dealership_id  TEXT NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  vehicle_id     TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'viewing',
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  scheduled_at   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled',
  deposit        REAL,
  notes          TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS appointments_vehicle_idx ON appointments (vehicle_id, scheduled_at);

CREATE INDEX IF NOT EXISTS appointments_diary_idx ON appointments (dealership_id, scheduled_at);

CREATE TABLE IF NOT EXISTS valuations (
  id            TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  trade_value   REAL,
  retail_value  REAL,
  private_value REAL,
  method        TEXT,
  notes         TEXT,
  user_name     TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS valuations_vehicle_idx ON valuations (vehicle_id, created_at);

CREATE TABLE IF NOT EXISTS plate_cache (
  plate_key  TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  source     TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  dealership_id TEXT NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  value         TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (dealership_id, name)
);
