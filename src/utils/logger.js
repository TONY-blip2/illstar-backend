'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    // Console — human-readable in dev
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
    // Persistent error log
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5_242_880,  // 5 MB
      maxFiles: 5,
    }),
    // Combined log
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10_485_760, // 10 MB
      maxFiles: 10,
    }),
  ],
});

module.exports = logger;
