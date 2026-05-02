const Redis = require('ioredis');
const logger = require('../utils/logger');

const redis = new Redis({
  host:     process.env.REDIS_HOST     || 'localhost',
  port:     parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  lazyConnect: true,
});

redis.on('connect',   () => logger.info('Redis connected'));
redis.on('error',  (err) => logger.error('Redis error', { error: err.message }));

// ─── Seat lock kalitlari ───────────────────────────────────────────────────
// Format: seat_lock:{showId}:{seatId}  → value: userId
// ──────────────────────────────────────────────────────────────────────────

const SEAT_LOCK_TTL = parseInt(process.env.SEAT_LOCK_TTL) || 600; // 10 daqiqa

/**
 * Bir yoki bir nechta o'rinni atomic tarzda lock qilish (Lua script).
 * Agar birontasi band bo'lsa — hech birini lock qilmaydi.
 */
const lockSeatsScript = `
local keys = KEYS
local userId = ARGV[1]
local ttl    = tonumber(ARGV[2])

-- Avval barchasini tekshiramiz
for _, key in ipairs(keys) do
  if redis.call('EXISTS', key) == 1 then
    return {err = 'SEAT_ALREADY_LOCKED:' .. key}
  end
end

-- Hammasi bo'sh — lock qilamiz
for _, key in ipairs(keys) do
  redis.call('SET', key, userId, 'EX', ttl)
end
return 1
`;

/**
 * Lock qilish
 * @param {string} showId
 * @param {string[]} seatIds
 * @param {string} userId
 * @throws {Error} SEAT_ALREADY_LOCKED
 */
async function lockSeats(showId, seatIds, userId) {
  const keys = seatIds.map((id) => `seat_lock:${showId}:${id}`);
  const result = await redis.eval(
    lockSeatsScript,
    keys.length,
    ...keys,
    userId,
    SEAT_LOCK_TTL
  );
  if (result !== 1) throw new Error(`SEAT_ALREADY_LOCKED`);
}

/**
 * Lock ni ozod qilish
 */
async function releaseSeats(showId, seatIds) {
  const keys = seatIds.map((id) => `seat_lock:${showId}:${id}`);
  if (keys.length) await redis.del(...keys);
}

/**
 * Lock egasini tekshirish
 */
async function getSeatLockOwner(showId, seatId) {
  return redis.get(`seat_lock:${showId}:${seatId}`);
}

module.exports = { redis, lockSeats, releaseSeats, getSeatLockOwner, SEAT_LOCK_TTL };
