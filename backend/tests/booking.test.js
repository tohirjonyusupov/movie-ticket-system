/**
 * Booking Service — Integration Tests
 *
 * Ishga tushirish:
 *   npm test
 *
 * Muhit: test DB va Redis mock kerak.
 * Bu yerda jest.mock orqali DB va Redis mock qilinadi.
 */

const request    = require('supertest');
const app        = require('../src/app');
const bookingRepo = require('../src/repositories/bookingRepository');
const redisConfig = require('../src/config/redis');
const publisher  = require('../src/events/publisher');

// ─── Mocklar ──────────────────────────────────────────────────────────────────
jest.mock('../src/repositories/bookingRepository');
jest.mock('../src/config/redis', () => ({
  lockSeats:   jest.fn(),
  releaseSeats: jest.fn(),
  getSeatLockOwner: jest.fn(),
  redis: { mget: jest.fn().mockResolvedValue([]), connect: jest.fn() },
  SEAT_LOCK_TTL: 600,
}));
jest.mock('../src/events/publisher', () => ({
  connect: jest.fn(),
  publish: jest.fn(),
  EVENTS: {
    BOOKING_CREATED:   'booking.created',
    PAYMENT_INITIATED: 'payment.initiated',
    BOOKING_CONFIRMED: 'booking.confirmed',
    BOOKING_FAILED:    'booking.failed',
    BOOKING_CANCELLED: 'booking.cancelled',
  },
}));

// ─── JWT token yasash (test uchun) ────────────────────────────────────────────
process.env.JWT_SECRET = 'test_secret';
const jwt = require('jsonwebtoken');
const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const authHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ sub: TEST_USER_ID }, 'test_secret', { expiresIn: '1h' })}`,
});

const SHOW_ID = 'aabb8400-e29b-41d4-a716-446655440001';
const SEAT_IDS = [
  'cc008400-e29b-41d4-a716-446655440002',
  'dd018400-e29b-41d4-a716-446655440003',
];

// ─── Test ma'lumotlari ────────────────────────────────────────────────────────
const mockShow = {
  show_id:    SHOW_ID,
  movie_id:   'mmm08400-e29b-41d4-a716-000000000001',
  screen_id:  'sss08400-e29b-41d4-a716-000000000002',
  movie_title: 'Test Film',
  start_time: new Date(Date.now() + 3600000).toISOString(), // 1 soat keyin
  base_price: '50000',
  status: 'ACTIVE',
};

const mockSeats = SEAT_IDS.map((id, i) => ({
  seat_id: id,
  screen_id: mockShow.screen_id,
  row_label: 'A',
  seat_number: i + 1,
  seat_type: 'STANDARD',
  price_multiplier: '1.0',
}));

const mockBooking = {
  booking_id:   '11118400-e29b-41d4-a716-446655440099',
  user_id:      TEST_USER_ID,
  show_id:      SHOW_ID,
  status:       'PENDING',
  total_amount: '100000',
  version:      1,
};

// ─── Test suitlari ────────────────────────────────────────────────────────────

describe('GET /api/shows/:showId/seats', () => {
  it('seat map qaytarishi kerak', async () => {
    bookingRepo.getShowById.mockResolvedValue(mockShow);
    bookingRepo.getAvailableSeatMap.mockResolvedValue(
      mockSeats.map((s) => ({ ...s, db_status: 'AVAILABLE' }))
    );

    const res = await request(app).get(`/api/shows/${SHOW_ID}/seats`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.seats).toHaveLength(2);
    expect(res.body.data.seats[0]).toHaveProperty('status', 'AVAILABLE');
  });

  it('noto\'g\'ri showId uchun 404 qaytarishi kerak', async () => {
    bookingRepo.getShowById.mockResolvedValue(null);
    const res = await request(app).get(`/api/shows/${SHOW_ID}/seats`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/bookings', () => {
  beforeEach(() => {
    bookingRepo.getShowById.mockResolvedValue(mockShow);
    bookingRepo.getSeatsByIds.mockResolvedValue(mockSeats);
    bookingRepo.createBookingWithSeats.mockResolvedValue(mockBooking);
    redisConfig.lockSeats.mockResolvedValue(undefined);
  });

  it('muvaffaqiyatli booking yaratishi kerak', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set(authHeader())
      .send({ showId: SHOW_ID, seatIds: SEAT_IDS, paymentMethod: 'UPI' });

    expect(res.status).toBe(201);
    expect(res.body.data.booking_id).toBeDefined();
    expect(publisher.publish).toHaveBeenCalledWith(
      'booking.created', expect.objectContaining({ bookingId: mockBooking.booking_id })
    );
  });

  it('token bo\'lmasa 401 qaytarishi kerak', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ showId: SHOW_ID, seatIds: SEAT_IDS, paymentMethod: 'UPI' });
    expect(res.status).toBe(401);
  });

  it('seat band bo\'lsa 409 qaytarishi kerak', async () => {
    redisConfig.lockSeats.mockRejectedValue(new Error('SEAT_ALREADY_LOCKED'));
    const res = await request(app)
      .post('/api/bookings')
      .set(authHeader())
      .send({ showId: SHOW_ID, seatIds: SEAT_IDS, paymentMethod: 'UPI' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEAT_ALREADY_LOCKED');
  });

  it('noto\'g\'ri paymentMethod uchun 400 qaytarishi kerak', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set(authHeader())
      .send({ showId: SHOW_ID, seatIds: SEAT_IDS, paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/bookings/:bookingId', () => {
  it('PENDING bookingni bekor qilishi kerak', async () => {
    bookingRepo.getBookingById.mockResolvedValue({
      ...mockBooking, seats: mockSeats.map((s) => ({ seatId: s.seat_id })),
    });
    bookingRepo.getShowById.mockResolvedValue(mockShow);
    bookingRepo.updateBookingStatus.mockResolvedValue({ ...mockBooking, status: 'CANCELLED' });

    const res = await request(app)
      .delete(`/api/bookings/${mockBooking.booking_id}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(redisConfig.releaseSeats).toHaveBeenCalled();
  });
});

describe('Health check', () => {
  it('200 qaytarishi kerak', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
