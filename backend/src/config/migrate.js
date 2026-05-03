require('dotenv').config();
const { pool } = require('./db');

const SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE seat_type    AS ENUM ('STANDARD','PREMIUM','VIP','WHEELCHAIR');
  CREATE TYPE seat_status  AS ENUM ('AVAILABLE','LOCKED','BOOKED');
  CREATE TYPE booking_status AS ENUM (
    'PENDING','PAYMENT_INITIATED','CONFIRMED','PAYMENT_FAILED','CANCELLED','USED'
  );
  CREATE TYPE payment_method AS ENUM (
    'CREDIT_CARD','DEBIT_CARD','UPI','WALLET','NET_BANKING'
  );
  CREATE TYPE payment_status AS ENUM ('PENDING','SUCCESS','FAILED','REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Cinema / Screen / Seat ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cinemas (
  cinema_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  address     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS screens (
  screen_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cinema_id   UUID NOT NULL REFERENCES cinemas(cinema_id),
  name        TEXT NOT NULL,
  total_seats INT  NOT NULL,
  screen_type TEXT NOT NULL DEFAULT 'STANDARD',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seats (
  seat_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id        UUID NOT NULL REFERENCES screens(screen_id),
  row_label        CHAR(2) NOT NULL,
  seat_number      INT  NOT NULL,
  seat_type        seat_type NOT NULL DEFAULT 'STANDARD',
  price_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  UNIQUE (screen_id, row_label, seat_number)
);

-- ─── Movie / Show ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movies (
  movie_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  genre       TEXT NOT NULL,
  duration    INT  NOT NULL,  -- daqiqada
  language    TEXT NOT NULL DEFAULT 'Uzbek',
  rating      NUMERIC(3,1),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shows (
  show_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id    UUID NOT NULL REFERENCES movies(movie_id),
  screen_id   UUID NOT NULL REFERENCES screens(screen_id),
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  base_price  NUMERIC(10,2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Booking ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  booking_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  show_id          UUID NOT NULL REFERENCES shows(show_id),
  status           booking_status NOT NULL DEFAULT 'PENDING',
  total_amount     NUMERIC(10,2),
  idempotency_key  TEXT UNIQUE,          -- double-submit protection
  version          INT NOT NULL DEFAULT 1, -- optimistic locking
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_seats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  seat_id        UUID NOT NULL REFERENCES seats(seat_id),
  price          NUMERIC(10,2) NOT NULL,
  ticket_number  TEXT UNIQUE,
  UNIQUE (booking_id, seat_id)
);

-- ─── Payment ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  payment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(booking_id),
  amount          NUMERIC(10,2) NOT NULL,
  method          payment_method NOT NULL,
  status          payment_status NOT NULL DEFAULT 'PENDING',
  gateway_ref     TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_user_id   ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_show_id   ON bookings(show_id);
CREATE INDEX IF NOT EXISTS idx_booking_seats_booking ON booking_seats(booking_id);
CREATE INDEX IF NOT EXISTS idx_shows_movie_id     ON shows(movie_id);
CREATE INDEX IF NOT EXISTS idx_seats_screen_id    ON seats(screen_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_booking_updated_at ON bookings;
CREATE TRIGGER set_booking_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
`;

(async () => {
  try {
    await pool.query(SQL);
    console.log('✅  Migration muvaffaqiyatli bajarildi');
    process.exit(0);
  } catch (err) {
    console.error('❌  Migration xatoligi:', err.message);
    if (err.code === '28P01') {
      console.error('PostgreSQL login/parol xato. .env faylidagi SUPABASE_DB_URL yoki DB_USER/DB_PASSWORD qiymatlarini tekshiring.');
    }
    process.exit(1);
  }
})();
