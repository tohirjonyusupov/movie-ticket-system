const { validationResult } = require('express-validator');
const bookingService = require('../services/bookingService');
const AppError = require('../utils/AppError');
const logger   = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
//  BookingController
//  HTTP so'rovlarni qabul qilib, service ga uzatadi.
//  Validatsiya xatosi bo'lsa darhol qaytaradi.
// ─────────────────────────────────────────────────────────────────────────────

function handleValidation(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw AppError.badRequest(
      errors.array().map((e) => e.msg).join('; '),
      'VALIDATION_ERROR'
    );
  }
}

// GET /shows/:showId/seats
async function getSeatMap(req, res, next) {
  try {
    const result = await bookingService.getSeatMap(req.params.showId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /bookings
async function createBooking(req, res, next) {
  try {
    handleValidation(req);
    const { showId, seatIds, paymentMethod } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];

    const booking = await bookingService.createBooking({
      userId:  req.user.userId,
      showId, seatIds, paymentMethod, idempotencyKey,
    });
    res.status(201).json({ success: true, data: booking });
  } catch (err) { next(err); }
}

// POST /bookings/:bookingId/payment
async function initiatePayment(req, res, next) {
  try {
    handleValidation(req);
    const result = await bookingService.initiatePayment({
      bookingId: req.params.bookingId,
      userId:    req.user.userId,
      method:    req.body.method,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /bookings/payment-callback  (payment gateway webhook)
async function paymentCallback(req, res, next) {
  try {
    const { bookingId, paymentId, gatewayRef, success } = req.body;
    await bookingService.handlePaymentCallback({ bookingId, paymentId, gatewayRef, success });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// DELETE /bookings/:bookingId
async function cancelBooking(req, res, next) {
  try {
    const booking = await bookingService.cancelBooking({
      bookingId: req.params.bookingId,
      userId:    req.user.userId,
    });
    res.json({ success: true, data: booking });
  } catch (err) { next(err); }
}

// GET /bookings/:bookingId
async function getBookingDetail(req, res, next) {
  try {
    const booking = await bookingService.getBookingDetail(
      req.params.bookingId,
      req.user.userId
    );
    res.json({ success: true, data: booking });
  } catch (err) { next(err); }
}

// GET /bookings  (foydalanuvchi tarixi)
async function getUserBookings(req, res, next) {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const bookings = await bookingService.getUserBookings(
      req.user.userId, { limit, offset }
    );
    res.json({ success: true, data: bookings });
  } catch (err) { next(err); }
}

module.exports = {
  getSeatMap, createBooking, initiatePayment,
  paymentCallback, cancelBooking, getBookingDetail, getUserBookings,
};

function test(){
  
}