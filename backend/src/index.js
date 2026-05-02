require('dotenv').config();
const app      = require('./app');
const { pool } = require('./config/db');
const { redis } = require('./config/redis');
const publisher = require('./events/publisher');
const logger   = require('./utils/logger');

const PORT = parseInt(process.env.PORT) || 3001;

async function bootstrap() {
  // DB ulanishini tekshirish
  await pool.query('SELECT 1');
  logger.info('PostgreSQL: ulandi');

  // Redis ulanishi
  await redis.connect();

  // RabbitMQ (ixtiyoriy)
  await publisher.connect();

  // Server ishga tushirish
  const server = app.listen(PORT, () => {
    logger.info(`Booking Service ishga tushdi`, { port: PORT, env: process.env.NODE_ENV });
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} — server to'xtatilmoqda...`);
    server.close(async () => {
      await pool.end();
      await redis.quit();
      logger.info('Barcha ulanishlar yopildi');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Server ishga tushirish xatoligi', { error: err.message });
  process.exit(1);
});
