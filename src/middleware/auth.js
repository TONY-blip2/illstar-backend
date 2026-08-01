'use strict';

const { verifyAccessToken } = require('../utils/jwt');
const { query }             = require('../config/database');
const logger                = require('../utils/logger');

/**
 * protect — verifies the Bearer JWT in Authorization header.
 * Attaches req.user = { id, email, role } on success.
 */
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided.' });
    }

    const token   = authHeader.slice(7);
    const decoded = verifyAccessToken(token);

    // Check token is not revoked
    const revoked = await query(
      'SELECT jti FROM revoked_tokens WHERE jti = ?', [decoded.jti]
    );
    if (revoked.length > 0) {
      return res.status(401).json({ success: false, message: 'Token has been revoked.' });
    }

    // Lightweight user check (confirm user still exists)
    const users = await query(
      'SELECT id, email, role FROM users WHERE id = ?', [decoded.sub]
    );
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    req.user = users[0];
    req.jti  = decoded.jti;
    next();
  } catch (err) {
    logger.warn(`Auth failed: ${err.message}`);
    const msg = err.name === 'TokenExpiredError'
      ? 'Token has expired.'
      : 'Invalid token.';
    return res.status(401).json({ success: false, message: msg });
  }
}

/**
 * adminOnly — must be used after protect().
 * Rejects non-admin users with 403.
 */
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
}

/**
 * optionalAuth — attaches req.user if a valid token is present,
 * but does NOT reject unauthenticated requests.
 * Useful for endpoints that behave differently for logged-in users.
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return next();
    const token   = authHeader.slice(7);
    const decoded = verifyAccessToken(token);
    const users   = await query('SELECT id, email, role FROM users WHERE id = ?', [decoded.sub]);
    if (users.length > 0) req.user = users[0];
  } catch (_) {
    // silently ignore
  }
  next();
}

module.exports = { protect, adminOnly, optionalAuth };
