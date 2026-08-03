'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

// Winston's File transport tries to create/write to a logs/ folder on disk
// the moment it's set up. Vercel's serverless filesystem is read-only
// everywhere except /tmp, so that throws immediately on cold start — which
// crashed EVERY request, since almost every file in the app requires this
// logger. Vercel already captures and displays everything the Console
// transport prints (that's exactly what you were looking at in the Runtime
// Logs page), so file logging is only useful locally anyway — skip it in
// production/on Vercel rather than trying to make it write somewhere else.
const isServerless = !!process.env.VERCEL;

const loggerTransports = [
  // Console — human-readable in dev, and this is what Vercel's own log
  // viewer displays in production, so it's the only transport we need there.
  new transports.Console({
    format: format.combine(
      format.colorize(),
      format.printf(({ timestamp, level, message, stack }) =>
        stack
          ? `${timestamp} [${level}]: ${message}\n${stack}`
          : `${timestamp} [${level}]: ${message}`
      )
    ),
  }),
];

if (!isServerless) {
  loggerTransports.push(
    // Persistent error log — local development only
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5_242_880,  // 5 MB
      maxFiles: 5,
    }),
    // Combined log — local development only
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10_485_760, // 10 MB
      maxFiles: 10,
    })
  );
}

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: loggerTransports,
});

module.exports = logger;