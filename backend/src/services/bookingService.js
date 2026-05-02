const bookingRepo    = require('../repositories/bookingRepository');
const { lockSeats, releaseSeats } = require('../config/redis');
const { publish, EVENTS }         = require('../events/publisher');
const AppError  = require('../utils/AppError');
const logger    = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
//  BookingService
//  Tizimning "miya" si — biznes qoidalar, seat locking, status transitions.
// ─────────────────────────────────────────────────────────────────────────────

class BookingService {

  // ─── 1. Seat Map ────────────────────────────────────────────────────────────

  /**
   * Foydalanuvchiga interaktiv o'rin xaritasini qaytaradi.
   * DB dan BOOKED o'rinlarni, Redis dan LOCKED o'rinlarni olamiz.
   */
  async getSeatMap(showId) {
    const show = await bookingRepo.getShowById(showId);
    if (!show) throw AppError.notFound('Show topilmadi');

    const seats = await bookingRepo.getAvailableSeatMap(showId);

    // Redis lock ma'lumotini qo'shamiz (parallel tekshirish)
    const { redis } = require('../config/redis');
    const lockKeys  = seats.map((s) => `seat_lock:${showId}:${s.seat_id}`);
    const lockValues = lockKeys.length
      ? await redis.mget(...lockKeys)
      : [];

    const enriched = seats.map((seat, i) => ({
      seatId:          seat.seat_id,
      rowLabel:        seat.row_label,
      seatNumber:      seat.seat_number,
      seatType:        seat.seat_type,
      priceMultiplier: parseFloat(seat.price_multiplier),
      price:           parseFloat(show.base_price) * parseFloat(seat.price_multiplier),
      status: seat.db_status === 'BOOKED'
        ? 'BOOKED'
        : lockValues[i] ? 'LOCKED' : 'AVAILABLE',
    }));

    return { show, seats: enriched };
  }

  // ─── 2. Booking yaratish ────────────────────────────────────────────────────

  /**
   * Asosiy booking oqimi:
   *  1. Show & seat validatsiya
   *  2. Redis bilan atomic seat lock
   *  3. DB ga PENDING booking yozish
   *  4. Event publish
   */
  async createBooking({ userId, showId, seatIds, paymentMethod, idempotencyKey }) {
    // ── Show mavjudligini tekshirish
    const show = await bookingRepo.getShowById(showId);
    if (!show) throw AppError.notFound('Show topilmadi');

    if (new Date(show.start_time) < new Date()) {
      throw AppError.badRequest('Show allaqachon boshlanib ketgan', 'SHOW_STARTED');
    }

    // ── Seat validatsiya: hamma seat shu show ning screeni ga tegishlimi?
    const seats = await bookingRepo.getSeatsByIds(seatIds);
    if (seats.length !== seatIds.length) {
      throw AppError.badRequest('Ba\'zi seat ID lar noto\'g\'ri', 'INVALID_SEATS');
    }
    const wrongScreen = seats.find((s) => s.screen_id !== show.screen_id);
    if (wrongScreen) {
      throw AppError.badRequest('Seat bu show ga tegishli emas', 'SEAT_SCREEN_MISMATCH');
    }

    // ── Narxlarni hisoblash
    const basePrice = parseFloat(show.base_price);
    const seatDetails = seats.map((s) => ({
      seatId: s.seat_id,
      price:  +(basePrice * parseFloat(s.price_multiplier)).toFixed(2),
    }));
    const totalAmount = +seatDetails.reduce((sum, s) => sum + s.price, 0).toFixed(2);

    // ── Redis: atomic seat lock (agar birontasi band bo'lsa — xato)
    try {
      await lockSeats(showId, seatIds, userId);
    } catch (err) {
      throw AppError.conflict(
        'Tanlangan o\'rinlardan biri band. Boshqa o\'rin tanlang.',
        'SEAT_ALREADY_LOCKED'
      );
    }

    // ── DB: booking yozish
    let booking;
    try {
      booking = await bookingRepo.createBookingWithSeats({
        userId, showId,
        seats: seatDetails,
        totalAmount,
        idempotencyKey,
      });
    } catch (err) {
      // DB xato bo'lsa lock ni qaytaramiz
      await releaseSeats(showId, seatIds).catch(() => {});
      throw err;
    }

    // ── Event
    await publish(EVENTS.BOOKING_CREATED, {
      bookingId:   booking.booking_id,
      userId, showId, seatIds, totalAmount,
    });

    logger.info('Booking yaratildi', { bookingId: booking.booking_id, userId });
    return booking;
  }

  // ─── 3. To'lovni boshlash ───────────────────────────────────────────────────

  async initiatePayment({ bookingId, userId, method }) {
    const booking = await this._getAndVerifyOwner(bookingId, userId);

    if (booking.status !== 'PENDING') {
      throw AppError.conflict(
        `Booking holati: ${booking.status}. To'lov faqat PENDING holatda boshlanadi.`,
        'INVALID_STATUS_TRANSITION'
      );
    }

    // Status o'zgartirish (optimistic locking)
    const updated = await bookingRepo.updateBookingStatus(
      bookingId, 'PAYMENT_INITIATED', booking.version
    );

    // Payment yozuvi
    const payment = await bookingRepo.createPayment({
      bookingId, amount: booking.total_amount, method,
    });

    await publish(EVENTS.PAYMENT_INITIATED, {
      bookingId, paymentId: payment.payment_id, amount: payment.amount, method,
    });

    return { booking: updated, payment };
  }

  // ─── 4. To'lov callback (payment gateway dan) ──────────────────────────────

  async handlePaymentCallback({ bookingId, paymentId, gatewayRef, success }) {
    const booking = await bookingRepo.getBookingById(bookingId);
    if (!booking) throw AppError.notFound('Booking topilmadi');

    if (booking.status !== 'PAYMENT_INITIATED') {
      logger.warn('Kutilmagan payment callback', { bookingId, status: booking.status });
      return;
    }

    const seatIds = booking.seats.map((s) => s.seatId);

    if (success) {
      // Muvaffaqiyatli — CONFIRMED
      await bookingRepo.updateBookingStatus(bookingId, 'CONFIRMED', booking.version);
      await bookingRepo.updatePayment(paymentId, {
        status: 'SUCCESS', gatewayRef, paidAt: new Date(),
      });
      // Redis lock ni qoldiramiz — o'rin hali ham egallanganini ko'rsatadi
      // (show tugaganida tozalanadi)

      await publish(EVENTS.BOOKING_CONFIRMED, {
        bookingId, userId: booking.user_id,
        movieTitle: booking.movie_title,
        tickets: booking.seats.map((s) => s.ticketNumber),
      });

      logger.info('Booking tasdiqlandi', { bookingId });
    } else {
      // Xato — PAYMENT_FAILED, seat lock ozod
      await bookingRepo.updateBookingStatus(bookingId, 'PAYMENT_FAILED', booking.version);
      await bookingRepo.updatePayment(paymentId, {
        status: 'FAILED', gatewayRef, paidAt: null,
      });
      await releaseSeats(booking.show_id, seatIds);

      await publish(EVENTS.BOOKING_FAILED, { bookingId, userId: booking.user_id });
      logger.info('Booking rad etildi', { bookingId });
    }
  }

  // ─── 5. Bekor qilish ────────────────────────────────────────────────────────

  async cancelBooking({ bookingId, userId }) {
    const booking = await this._getAndVerifyOwner(bookingId, userId);

    const cancellable = ['PENDING', 'CONFIRMED'];
    if (!cancellable.includes(booking.status)) {
      throw AppError.conflict(
        `${booking.status} holatdagi booking bekor qilib bo'lmaydi`,
        'NON_CANCELLABLE'
      );
    }

    // Show ga 30 daqiqa qolsa bekor qilib bo'lmaydi
    const showDetail = await bookingRepo.getShowById(booking.show_id);
    const minsLeft = (new Date(showDetail.start_time) - Date.now()) / 60000;
    if (minsLeft < 30) {
      throw AppError.badRequest(
        'Show ga 30 daqiqadan kam vaqt qoldi — bekor qilib bo\'lmaydi',
        'CANCELLATION_WINDOW_PASSED'
      );
    }

    const updated = await bookingRepo.updateBookingStatus(
      bookingId, 'CANCELLED', booking.version
    );
    const seatIds = booking.seats.map((s) => s.seatId);
    await releaseSeats(booking.show_id, seatIds);

    // Refund event
    if (booking.status === 'CONFIRMED') {
      const payment = await bookingRepo.getPaymentByBookingId(bookingId);
      await publish(EVENTS.BOOKING_CANCELLED, {
        bookingId, userId, refundAmount: booking.total_amount,
        paymentId: payment?.payment_id,
      });
    }

    logger.info('Booking bekor qilindi', { bookingId, userId });
    return updated;
  }

  // ─── 6. Batafsil va ro'yxat ────────────────────────────────────────────────

  async getBookingDetail(bookingId, userId) {
    const booking = await this._getAndVerifyOwner(bookingId, userId);
    return booking;
  }

  async getUserBookings(userId, pagination) {
    return bookingRepo.getUserBookings(userId, pagination);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async _getAndVerifyOwner(bookingId, userId) {
    const booking = await bookingRepo.getBookingById(bookingId);
    if (!booking) throw AppError.notFound('Booking topilmadi');
    if (booking.user_id !== userId) throw AppError.forbidden('Bu sizning bookingizmas');
    return booking;
  }
}

module.exports = new BookingService();
