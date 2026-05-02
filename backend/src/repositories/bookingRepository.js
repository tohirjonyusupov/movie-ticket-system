const { pool, withTransaction } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────────────────────────────────────
//  BookingRepository
//  DB bilan to'g'ridan-to'g'ri gaplashadigan yagona joy.
//  Service layer bu classdan foydalanadi.
// ─────────────────────────────────────────────────────────────────────────────

class BookingRepository {

  // ─── Show & Seats ──────────────────────────────────────────────────────────

  async getShowById(showId) {
    const { rows } = await pool.query(
      `SELECT s.*, m.title AS movie_title, m.duration,
              sc.name AS screen_name, sc.screen_type
         FROM shows s
         JOIN movies  m  ON m.movie_id  = s.movie_id
         JOIN screens sc ON sc.screen_id = s.screen_id
        WHERE s.show_id = $1 AND s.status = 'ACTIVE'`,
      [showId]
    );
    return rows[0] || null;
  }

  async getSeatsByIds(seatIds) {
    const placeholders = seatIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await pool.query(
      `SELECT seat_id, screen_id, row_label, seat_number,
              seat_type, price_multiplier
         FROM seats WHERE seat_id IN (${placeholders})`,
      seatIds
    );
    return rows;
  }

  /**
   * Show uchun mavjud (AVAILABLE) o'rinlarni qaytaradi.
   * LOCKED o'rinlar real-time Redis orqali tekshiriladi (service layerda).
   */
  async getAvailableSeatMap(showId) {
    const { rows } = await pool.query(
      `SELECT s.seat_id, s.row_label, s.seat_number,
              s.seat_type, s.price_multiplier,
              CASE WHEN bs.seat_id IS NOT NULL THEN 'BOOKED' ELSE 'AVAILABLE' END AS db_status
         FROM seats s
         JOIN screens sc ON sc.screen_id = s.screen_id
         JOIN shows  sh  ON sh.screen_id = sc.screen_id
         LEFT JOIN booking_seats bs
               ON bs.seat_id = s.seat_id
              AND bs.booking_id IN (
                    SELECT booking_id FROM bookings
                     WHERE show_id = $1 AND status IN ('CONFIRMED','PAYMENT_INITIATED')
                  )
        WHERE sh.show_id = $1
        ORDER BY s.row_label, s.seat_number`,
      [showId]
    );
    return rows;
  }

  // ─── Booking CRUD ──────────────────────────────────────────────────────────

  async createBookingWithSeats({ userId, showId, seats, totalAmount, idempotencyKey }) {
    return withTransaction(async (client) => {
      // Idempotency: agar allaqachon yaratilgan bo'lsa qaytaramiz
      if (idempotencyKey) {
        const existing = await client.query(
          `SELECT * FROM bookings WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        if (existing.rows[0]) return existing.rows[0];
      }

      // Booking yaratish
      const bookingId = uuidv4();
      const { rows } = await client.query(
        `INSERT INTO bookings
           (booking_id, user_id, show_id, status, total_amount, idempotency_key)
         VALUES ($1,$2,$3,'PENDING',$4,$5)
         RETURNING *`,
        [bookingId, userId, showId, totalAmount, idempotencyKey || null]
      );
      const booking = rows[0];

      // Booking seats
      for (const seat of seats) {
        const ticketNumber = `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        await client.query(
          `INSERT INTO booking_seats (booking_id, seat_id, price, ticket_number)
           VALUES ($1,$2,$3,$4)`,
          [bookingId, seat.seatId, seat.price, ticketNumber]
        );
      }

      return booking;
    });
  }

  async getBookingById(bookingId) {
    const { rows } = await pool.query(
      `SELECT b.*,
              json_agg(json_build_object(
                'seatId',        bs.seat_id,
                'rowLabel',      s.row_label,
                'seatNumber',    s.seat_number,
                'seatType',      s.seat_type,
                'price',         bs.price,
                'ticketNumber',  bs.ticket_number
              )) AS seats
         FROM bookings b
         JOIN booking_seats bs ON bs.booking_id = b.booking_id
         JOIN seats          s  ON s.seat_id     = bs.seat_id
        WHERE b.booking_id = $1
        GROUP BY b.booking_id`,
      [bookingId]
    );
    return rows[0] || null;
  }

  async getUserBookings(userId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT b.booking_id, b.status, b.total_amount, b.created_at,
              m.title AS movie_title, sh.start_time
         FROM bookings b
         JOIN shows  sh ON sh.show_id  = b.show_id
         JOIN movies m  ON m.movie_id  = sh.movie_id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  }

  // ─── Status transitions ────────────────────────────────────────────────────

  /**
   * Optimistic locking bilan status o'zgartirish.
   * version mos kelmasa — ConflictError.
   */
  async updateBookingStatus(bookingId, newStatus, expectedVersion, client = pool) {
    const { rows, rowCount } = await client.query(
      `UPDATE bookings
          SET status = $1, version = version + 1
        WHERE booking_id = $2 AND version = $3
        RETURNING *`,
      [newStatus, bookingId, expectedVersion]
    );
    if (!rowCount) throw new Error('BOOKING_VERSION_CONFLICT');
    return rows[0];
  }

  // ─── Payment ───────────────────────────────────────────────────────────────

  async createPayment({ bookingId, amount, method }) {
    const { rows } = await pool.query(
      `INSERT INTO payments (booking_id, amount, method, status)
       VALUES ($1,$2,$3,'PENDING') RETURNING *`,
      [bookingId, amount, method]
    );
    return rows[0];
  }

  async updatePayment(paymentId, { status, gatewayRef, paidAt }) {
    const { rows } = await pool.query(
      `UPDATE payments
          SET status = $1, gateway_ref = $2, paid_at = $3
        WHERE payment_id = $4 RETURNING *`,
      [status, gatewayRef || null, paidAt || null, paymentId]
    );
    return rows[0];
  }

  async getPaymentByBookingId(bookingId) {
    const { rows } = await pool.query(
      `SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [bookingId]
    );
    return rows[0] || null;
  }
}

module.exports = new BookingRepository();
