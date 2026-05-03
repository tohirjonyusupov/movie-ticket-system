const { Pool } = require('pg');
const logger = require('../utils/logger');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const isSupabaseConnection = connectionString?.includes('supabase.co');

const poolConfig = connectionString
  ? {
      connectionString,
      ssl: isSupabaseConnection ? { rejectUnauthorized: false } : undefined,
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'movie-ticket-system',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    };

const pool = new Pool({
  ...poolConfig,
  max: parseInt(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

/**
 * Transaction helper — callback ichida query chaqirish uchun
 * @example
 * await withTransaction(async (client) => {
 *   await client.query('...');
 * });
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
