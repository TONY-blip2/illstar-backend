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
  // On Vercel, every concurrent serverless invocation can spin up its own
  // pool (module state is only reused within a single warm instance, not
  // shared across instances). A connectionLimit of 10 per instance can blow
  // past your database's total connection cap under even light concurrent
  // traffic. Set DB_POOL_MAX=2 (or similar) as a Vercel environment variable
  // in production — locally it'll still default to 10.
  connectionLimit:    parseInt(process.env.DB_POOL_MAX    || '10'),
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
  // Return dates as strings (avoids timezone surprises)
  dateStrings: true,
  // Managed MySQL providers (TiDB Serverless, PlanetScale, etc.) require
  // TLS. Set DB_SSL=true as a Vercel environment variable when connecting
  // to one of those — leave it unset for local MySQL, which usually isn't
  // configured for SSL.
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
    // Do NOT process.exit() here. On a traditional server that's a fine way
    // to fail fast and let a process manager restart you. Inside a Vercel
    // serverless function, process.exit() can kill the execution
    // environment mid-request in unpredictable ways. Log it and let
    // individual queries fail (and get caught by each controller's
    // try/catch -> next(err)) instead of taking down the whole function.
    logger.error('❌  MySQL connection failed:', err.message);
  }
}

// ─── Thin query wrapper (auto-logs slow queries) ─────────────────────────────
async function query(sql, params = []) {
  const start = Date.now();
  const [rows] = await pool.execute(sql, params);
  const ms = Date.now() - start;
  if (ms > 500) logger.warn(`Slow query (${ms}ms): ${sql.slice(0, 120)}`);
  return rows;
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