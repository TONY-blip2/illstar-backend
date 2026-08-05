'use strict';

const mysql  = require('mysql2/promise');
const logger = require('../utils/logger');

// ─── Connection pool ──────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  database:           process.env.DB_NAME     || 'illstar_db',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || 'rootpss',
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_POOL_MAX    || '10'),
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
  ssl: process.env.DB_SSL === 'true'
    ? { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    : undefined,
});

// ─── Verify connectivity on startup ──────────────────────────────────────────
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    logger.info('✅  MySQL connected successfully');
    conn.release();
  } catch (err) {
    logger.error('❌  MySQL connection failed:', err.message);
  }
}

// Error codes that mean "this specific connection is dead" — worth retrying
// once with a brand-new connection, rather than failing the whole request.
// TiDB Cloud's public endpoint runs behind AWS Global Accelerator, which
// silently drops any connection idle longer than ~340 seconds and explicitly
// does not honor TCP keep-alive to prevent that (per TiDB's own docs). On
// Vercel, a "warm" serverless instance can reuse the same pool across
// requests spaced further apart than that window, handing back a connection
// that LOOKS fine to mysql2 but was already killed by AWS — which is exactly
// what was causing intermittent timeouts on some requests but not others.
const RETRYABLE_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ETIMEDOUT',
  'ER_SERVER_SHUTDOWN',
  'EPIPE',
  'ENOTFOUND',
]);

function isRetryable(err) {
  return RETRYABLE_CODES.has(err.code) || RETRYABLE_CODES.has(err.errno);
}

// ─── Thin query wrapper (auto-logs slow queries, retries dead connections) ───
async function query(sql, params = [], _isRetry = false) {
  const start = Date.now();
  try {
    const [rows] = await pool.execute(sql, params);
    const ms = Date.now() - start;
    if (ms > 500) logger.warn(`Slow query (${ms}ms): ${sql.slice(0, 120)}`);
    return rows;
  } catch (err) {
    if (!_isRetry && isRetryable(err)) {
      logger.warn(`Stale DB connection detected (${err.code}) — retrying once with a fresh connection.`);
      return query(sql, params, true);
    }
    throw err;
  }
}

// ─── Transaction helper ───────────────────────────────────────────────────────
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, withTransaction, testConnection };