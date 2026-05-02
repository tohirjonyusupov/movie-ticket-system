const { Router } = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/bookingController');
const { authenticate, webhookAuth } = require('../middleware');

const router = Router();

// ─── Validators ───────────────────────────────────────────────────────────────
const uuidParam = (name) =>
  param(name).isUUID(4).withMessage(`${name} to'g'ri UUID bo'lishi kerak`);

const createBookingRules = [
  body('showId').isUUID(4).withMessage('showId UUID bo\'lishi kerak'),
  body('seatIds')
    .isArray({ min: 1, max: 10 })
    .withMessage('seatIds — 1 dan 10 gacha elementli massiv'),
  body('seatIds.*').isUUID(4).withMessage('Har bir seatId UUID bo\'lishi kerak'),
  body('paymentMethod')
    .isIn(['CREDIT_CARD','DEBIT_CARD','UPI','WALLET','NET_BANKING'])
    .withMessage('To\'g\'ri payment method tanlang'),
];

const paymentRules = [
  uuidParam('bookingId'),
  body('method')
    .isIn(['CREDIT_CARD','DEBIT_CARD','UPI','WALLET','NET_BANKING'])
    .withMessage('To\'g\'ri payment method tanlang'),
];

// ─── Routes ──────────────────────────────────────────────────────────────────

// Seat map (autentifikatsiya talab qilmaydi)
router.get('/shows/:showId/seats', ctrl.getSeatMap);

// Booking CRUD — autentifikatsiya kerak
router.use(authenticate);

router.get('/bookings',                               ctrl.getUserBookings);
router.get('/bookings/:bookingId',  uuidParam('bookingId'), ctrl.getBookingDetail);
router.post('/bookings',            createBookingRules,     ctrl.createBooking);
router.post('/bookings/:bookingId/payment', paymentRules,   ctrl.initiatePayment);
router.delete('/bookings/:bookingId', uuidParam('bookingId'), ctrl.cancelBooking);

// Payment gateway webhook — alohida auth
router.post('/bookings/payment-callback', webhookAuth, ctrl.paymentCallback);

module.exports = router;
