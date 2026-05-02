const AppError = require('../utils/AppError');
const logger   = require('../utils/logger');
const jwt      = require('jsonwebtoken');   // yoki API Gateway orqali keladi

// ─── Auth Middleware ──────────────────────────────────────────────────────────
// Haqiqiy tizimda API Gateway token ni tekshirib, header ga userId yozadi.
// Bu yerda oddiy JWT parse qilamiz.
function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return next(AppError.unauthorized('Token kerak'));
    }
    // JWT secret — ishlab chiqarishda auth servisning public key ishlatiladi
    const payload = jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET || 'dev_secret'
    );
    req.user = { userId: payload.sub || payload.userId, ...payload };
    next();
  } catch {
    next(AppError.unauthorized('Token noto\'g\'ri yoki muddati o\'tgan'));
  }
}

// ─── Webhook Auth (payment gateway) ──────────────────────────────────────────
function webhookAuth(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.PAYMENT_WEBHOOK_SECRET) {
    return next(AppError.unauthorized('Webhook secret noto\'g\'ri'));
  }
  next();
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
function errorHandler(err, req, res, next) {  // eslint-disable-line no-unused-vars
  // DB version conflict ni AppError ga aylantiramiz
  if (err.message === 'BOOKING_VERSION_CONFLICT') {
    err = AppError.conflict(
      'Booking ma\'lumotlari o\'zgartirildi. Iltimos qayta urinib ko\'ring.',
      'VERSION_CONFLICT'
    );
  }

  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  if (!isOperational) {
    logger.error('Kutilmagan xato', {
      message: err.message,
      stack:   err.stack,
      path:    req.path,
    });
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code:    err.code    || 'INTERNAL_ERROR',
      message: err.message || 'Ichki server xatosi',
    },
  });
}

// ─── 404 Handler ─────────────────────────────────────────────────────────────
function notFound(req, res, next) {
  next(AppError.notFound(`${req.method} ${req.path} mavjud emas`));
}

// ─── Request Logger ───────────────────────────────────────────────────────────
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP', {
      method:   req.method,
      path:     req.path,
      status:   res.statusCode,
      ms:       Date.now() - start,
      userId:   req.user?.userId,
    });
  });
  next();
}

module.exports = { authenticate, webhookAuth, errorHandler, notFound, requestLogger };
