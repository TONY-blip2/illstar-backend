'use strict';

/**
 * migrate.js
 * Run once (or whenever schema changes):  node src/config/migrate.js
 *
 * Creates all tables in the correct dependency order.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 */

require('dotenv').config();
const mysql  = require('mysql2/promise');
const logger = require('../utils/logger');

const SQL = `
-- ─────────────────────────────────────────────────────────────────
-- 1. USERS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID())  PRIMARY KEY,
  first_name          VARCHAR(60)   NOT NULL,
  last_name           VARCHAR(60)   NOT NULL,
  email               VARCHAR(180)  NOT NULL UNIQUE,
  password_hash       VARCHAR(255)  NOT NULL,
  phone               VARCHAR(30)   DEFAULT NULL,
  role                ENUM('user','admin') NOT NULL DEFAULT 'user',
  is_verified         TINYINT(1)    NOT NULL DEFAULT 0,
  avatar_url          VARCHAR(500)  DEFAULT NULL,
  verification_token  VARCHAR(255)  DEFAULT NULL,
  reset_token         VARCHAR(255)  DEFAULT NULL,
  reset_token_expires DATETIME      DEFAULT NULL,
  refresh_token       TEXT          DEFAULT NULL,
  last_login          DATETIME      DEFAULT NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role  (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────
-- 2. PRODUCTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id            CHAR(36)        NOT NULL DEFAULT (UUID())  PRIMARY KEY,
  slug          VARCHAR(120)    NOT NULL UNIQUE,
  name          VARCHAR(200)    NOT NULL,
  description   TEXT            DEFAULT NULL,
  details       TEXT            DEFAULT NULL,
  price_zmw     DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
  price_usd     DECIMAL(10,2)   DEFAULT NULL,
  price_gbp     DECIMAL(10,2)   DEFAULT NULL,
  price_eur     DECIMAL(10,2)   DEFAULT NULL,
  image_url     VARCHAR(500)    DEFAULT NULL,
  back_image_url VARCHAR(500)   DEFAULT NULL,
  extra_images  JSON            DEFAULT NULL,
  sizes         JSON            DEFAULT NULL,   -- e.g. ["S","M","L","XL"]
  colors        JSON            DEFAULT NULL,   -- e.g. ["Black","White"]
  stock         INT             NOT NULL DEFAULT 0,
  is_sold_out   TINYINT(1)      NOT NULL DEFAULT 0,
  is_disabled   TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order    INT             NOT NULL DEFAULT 0,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slug      (slug),
  INDEX idx_sold_out  (is_sold_out),
  INDEX idx_disabled  (is_disabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────
-- 3. ORDERS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              CHAR(36)      NOT NULL DEFAULT (UUID())  PRIMARY KEY,
  ref             VARCHAR(30)   NOT NULL UNIQUE,        -- e.g. ILL-2026-4821
  user_id         CHAR(36)      DEFAULT NULL,
  status          ENUM('pending','confirmed','shipped','delivered','cancelled','refunded')
                                NOT NULL DEFAULT 'pending',
  payment_method  ENUM('whatsapp','instagram','card','paypal','mtn','airtel')
                                NOT NULL DEFAULT 'whatsapp',
  payment_status  ENUM('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid',
  currency        VARCHAR(5)    NOT NULL DEFAULT 'ZMW',
  currency_symbol VARCHAR(3)    NOT NULL DEFAULT 'K',
  subtotal        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  shipping_cost   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  grand_total     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  is_pickup       TINYINT(1)    NOT NULL DEFAULT 0,
  -- Shipping address snapshot
  ship_first_name VARCHAR(60)   DEFAULT NULL,
  ship_last_name  VARCHAR(60)   DEFAULT NULL,
  ship_email      VARCHAR(180)  DEFAULT NULL,
  ship_phone      VARCHAR(30)   DEFAULT NULL,
  ship_address    VARCHAR(255)  DEFAULT NULL,
  ship_province   VARCHAR(120)  DEFAULT NULL,
  ship_country    VARCHAR(5)    DEFAULT NULL,
  notes           TEXT          DEFAULT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY fk_order_user (user_id) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_ref        (ref),
  INDEX idx_user_id    (user_id),
  INDEX idx_status     (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────
-- 4. ORDER ITEMS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id           CHAR(36)      NOT NULL DEFAULT (UUID())  PRIMARY KEY,
  order_id     CHAR(36)      NOT NULL,
  product_id   CHAR(36)      DEFAULT NULL,
  product_name VARCHAR(200)  NOT NULL,
  size         VARCHAR(20)   NOT NULL,
  color        VARCHAR(60)   NOT NULL,
  qty          INT           NOT NULL DEFAULT 1,
  unit_price   DECIMAL(10,2) NOT NULL,
  line_total   DECIMAL(10,2) NOT NULL,
  image_url    VARCHAR(500)  DEFAULT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY fk_item_order   (order_id)   REFERENCES orders   (id) ON DELETE CASCADE,
  FOREIGN KEY fk_item_product (product_id) REFERENCES products (id) ON DELETE SET NULL,
  INDEX idx_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────
-- 5. EMAIL AUDIT LOG
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_log (
  id          CHAR(36)      NOT NULL DEFAULT (UUID())  PRIMARY KEY,
  recipient   VARCHAR(180)  NOT NULL,
  subject     VARCHAR(300)  NOT NULL,
  type        VARCHAR(60)   NOT NULL,   -- 'verify','reset','order_confirm', etc.
  status      ENUM('sent','failed') NOT NULL DEFAULT 'sent',
  error       TEXT          DEFAULT NULL,
  sent_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recipient (recipient),
  INDEX idx_type      (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────
-- 6. REFRESH TOKENS (revocation list for logout)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        VARCHAR(255) NOT NULL PRIMARY KEY,
  revoked_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME     NOT NULL,
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function migrate() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '3306'),
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true,
    });

    // Create DB if it doesn't exist
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'illstar_db'}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${process.env.DB_NAME || 'illstar_db'}\``);

    await conn.query(SQL);
    logger.info('✅  Migration complete — all tables created/verified');
  } catch (err) {
    logger.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();
