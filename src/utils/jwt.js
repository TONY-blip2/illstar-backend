'use strict';

const jwt  = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const ACCESS_SECRET  = process.env.JWT_SECRET          || 'change_me_access';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET  || 'change_me_refresh';
const ACCESS_EXP     = process.env.JWT_EXPIRES_IN      || '30d';
const REFRESH_EXP    = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

/**
 * Sign an access token containing the user payload.
 */
function signAccessToken(payload) {
  return jwt.sign(
    { sub: payload.id, email: payload.email, role: payload.role },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXP, jwtid: uuidv4() }
  );
}

/**
 * Sign a long-lived refresh token.
 */
function signRefreshToken(userId) {
  return jwt.sign(
    { sub: userId },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXP, jwtid: uuidv4() }
  );
}

/**
 * Verify an access token.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

/**
 * Verify a refresh token.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/**
 * Decode a token without verification.
 */
function decodeToken(token) {
  return jwt.decode(token, { complete: true }).payload;
}

module.exports = { 
  signAccessToken, 
  signRefreshToken, 
  verifyAccessToken, 
  verifyRefreshToken, 
  decodeToken 
};