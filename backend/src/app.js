const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const routes      = require('./routes');
const { errorHandler, notFound, requestLogger } = require('./middleware');

const app = express();

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Bu rate limitingni kodi
app.use('/api', rateLimit({
  windowMs: 60 * 1000,  // 1 daqiqa
  max: 60,
  standardHeaders: true,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Juda ko\'p so\'rov' } },
}));

// Booking yaratish uchun qattiqroq limit
app.use('/api/bookings', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(requestLogger);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking-service', ts: new Date() });
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
