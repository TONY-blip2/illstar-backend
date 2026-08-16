'use strict';

require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const compression  = require('compression');
const cookieParser = require('cookie-parser');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const fs           = require('fs');

const logger       = require('./utils/logger');
const { testConnection } = require('./config/database');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes    = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes   = require('./routes/orders');
const userRoutes    = require('./routes/users');

const app = express();

// Creating local directories on disk only makes sense outside of Vercel's
// read-only serverless filesystem. Guard this so it doesn't throw in
// production — it's only useful for local development anyway, since
// production uploads go through Cloudinary (see utils/upload.js).
if (!process.env.VERCEL) {
  const uploadDirs = ['uploads/products', 'uploads/avatars'];
  uploadDirs.forEach(dir => {
    const fullPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      logger.info(`Created upload directory: ${dir}`);
    }
  });
}

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://tony-blip2.github.io',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.options('*', cors());

const globalLimiter = rateLimit({
  windowMs:  parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max:       parseInt(process.env.RATE_LIMIT_MAX       || '100'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many auth attempts. Please wait 15 minutes.' },
});

app.use('/api/', globalLimiter);
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/register',        authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(compression());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: msg => logger.info(msg.trim()) },
    skip:   (req) => req.url === '/api/health',
  }));
}

// Local static uploads folder — only relevant for local dev (see note above).
// In production this route simply won't have anything to serve from, which
// is fine since Cloudinary URLs are used instead.
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status:  'ok',
    version: process.env.npm_package_version || '1.0.0',
    env:     process.env.NODE_ENV,
    time:    new Date().toISOString(),
  });
});

app.use('/api/auth',     authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders',   orderRoutes);
app.use('/api/users',    userRoutes);

app.use(notFound);
app.use(errorHandler);

// This is the part Vercel actually needs: an exported Express app that its
// @vercel/node runtime wraps as a serverless function. Nothing below this
// line should run when Vercel imports this file.
module.exports = app;

// ─────────────────────────────────────────────────────────────────────────
// Everything below only runs when this file is executed DIRECTLY (i.e.
// `node src/server.js` on your own machine or a traditional host). Vercel's
// runtime imports this file purely to read `module.exports` above — it does
// NOT execute it as `node server.js`, so require.main !== module in that
// context, and none of this code runs there. Without this guard, Vercel was
// running testConnection() + app.listen() + registering process.exit()
// handlers on every cold start, which is almost certainly why requests were
// never reaching a stable, responding function.
// ─────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '5000');

  async function start() {
    await testConnection();

    const server = app.listen(PORT, () => {
      logger.info(`🚀  ILLSTAR API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
      logger.info(`    Health: http://localhost:${PORT}/api/health`);
    });

    const shutdown = (signal) => {
      logger.info(`${signal} received — shutting down gracefully…`);
      server.close(async () => {
        const { pool } = require('./config/database');
        await pool.end();
        logger.info('MySQL pool closed. Goodbye.');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection:', reason);
    });
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
      process.exit(1);
    });
  }

  start();
}