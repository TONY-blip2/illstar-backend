'use strict';

const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * validate — runs express-validator results and short-circuits with 422 if invalid.
 * Place after your validation chain: router.post('/path', [...rules], validate, handler)
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(422).json({
    success: false,
    message: 'Validation failed.',
    errors:  errors.array().map(e => ({ field: e.path, message: e.msg })),
  });
}

/**
 * notFound — 404 handler (mount last before errorHandler)
 */
function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
}

/**
 * errorHandler — global Express error handler
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(`[${req.method}] ${req.originalUrl} — ${err.message}`, {
    stack: err.stack,
    body:  req.body,
  });

  // Multer file-size / type errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'File too large (max 8 MB).' });
  }
  if (err.message?.includes('Only JPEG')) {
    return res.status(415).json({ success: false, message: err.message });
  }

  // MySQL duplicate-entry
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ success: false, message: 'A record with that value already exists.' });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message    = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'An unexpected error occurred. Please try again later.'
    : err.message || 'Internal server error.';

  res.status(statusCode).json({ success: false, message });
}

module.exports = { validate, notFound, errorHandler };
