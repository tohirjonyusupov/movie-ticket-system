const amqp = require('amqplib');
const logger = require('../utils/logger');

let channel = null;

const EXCHANGE = 'booking.events';
const EVENTS = {
  BOOKING_CREATED:    'booking.created',
  PAYMENT_INITIATED:  'payment.initiated',
  BOOKING_CONFIRMED:  'booking.confirmed',
  BOOKING_FAILED:     'booking.failed',
  BOOKING_CANCELLED:  'booking.cancelled',
};

async function connect() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
    channel = await conn.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    logger.info('RabbitMQ connected');

    conn.on('error', (err) => {
      logger.error('RabbitMQ connection error', { error: err.message });
      channel = null;
    });
  } catch (err) {
    logger.warn('RabbitMQ unavailable — events disabled', { error: err.message });
  }
}

/**
 * Event yuborish
 * @param {string} routingKey  — EVENTS konstantalaridan biri
 * @param {object} payload
 */
async function publish(routingKey, payload) {
  if (!channel) {
    logger.warn('RabbitMQ channel yo\'q — event yuborilmadi', { routingKey });
    return;
  }
  try {
    channel.publish(
      EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify({ ...payload, timestamp: new Date().toISOString() })),
      { persistent: true, contentType: 'application/json' }
    );
    logger.debug('Event published', { routingKey });
  } catch (err) {
    logger.error('Event publish xatoligi', { routingKey, error: err.message });
  }
}

module.exports = { connect, publish, EVENTS };
