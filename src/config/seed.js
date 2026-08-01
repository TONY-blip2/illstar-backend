'use strict';

/**
 * seed.js
 * Run once after migration:  node src/config/seed.js
 *
 * • Creates the admin user (credentials from .env)
 * • Imports the 6 ILLSTAR products from the embedded catalogue
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, testConnection, pool } = require('./database');
const logger = require('../utils/logger');

// ─── Products catalogue (mirrors your products.json) ─────────────────────────
const PRODUCTS = [
  {
    slug: 'classic-tee',
    name: 'CLASSIC TEE',
    description: '230 gsm fabric Weight, 100% Cotton. Mid-Weight & Durable. Heavy Screen Print. 1 of 1 Classic Design. Pre-Made in China, Produced in Lusaka, Zambia',
    details: null,
    price_zmw: 249.99,
    price_usd: 49.99,
    price_gbp: 49.99,
    price_eur: 49.99,
    image_url: 'images/classictee-front.jpg',
    back_image_url: 'images/classictee-back.jpg',
    extra_images: null,
    sizes: ['M', 'L', 'XL'],
    colors: ['Black'],
    stock: 50,
    sort_order: 1,
  },
  {
    slug: 'heatwave-tee',
    name: 'HEATWAVE TEE',
    description: 'Limited Edition Summer Collection Vol 1.',
    details: null,
    price_zmw: 249.99,
    price_usd: 49.99,
    price_gbp: 49.99,
    price_eur: 49.99,
    image_url: 'images/heatwavetee-front.jpg',
    back_image_url: 'images/heatwavetee-back.jpg',
    extra_images: JSON.stringify(['images/modelImage1.jpg', 'images/modelImage2.jpg']),
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['White'],
    stock: 50,
    sort_order: 2,
  },
  {
    slug: 'brain-damage-tee',
    name: 'BRAIN DAMAGE TEE',
    description: 'Lightweight bomber jacket with embroidered logo.',
    details: null,
    price_zmw: 249.99,
    price_usd: 49.99,
    price_gbp: 49.99,
    price_eur: 49.99,
    image_url: 'images/brain damage -front.jpg',
    back_image_url: 'images/brain damage-back.jpg',
    extra_images: null,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['White'],
    stock: 50,
    sort_order: 3,
  },
  {
    slug: 'brain-damage-tee-black',
    name: 'BRAIN DAMAGE TEE (BLACK)',
    description: 'Lightweight bomber jacket with embroidered logo.',
    details: null,
    price_zmw: 249.99,
    price_usd: 49.99,
    price_gbp: 49.99,
    price_eur: 49.99,
    image_url: 'images/brindmgeteeblck.front.jpg',
    back_image_url: 'images/brindmgeteeblck.bck.jpg',
    extra_images: null,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black'],
    stock: 50,
    sort_order: 4,
  },
  {
    slug: 'minimal-classic-tee',
    name: 'MINIMAL CLASSIC TEE',
    description: 'tootuff.',
    details: null,
    price_zmw: 249.99,
    price_usd: 49.99,
    price_gbp: 49.99,
    price_eur: 49.99,
    image_url: 'images/minimal classic-front.jpg',
    back_image_url: 'images/minimal classic-back.jpg',
    extra_images: null,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black'],
    stock: 50,
    sort_order: 5,
  },
  {
    slug: 'classic-hoodie',
    name: 'CLASSIC HOODIE',
    description: 'tootuff.',
    details: null,
    price_zmw: 399.99,
    price_usd: 49.99,
    price_gbp: 49.99,
    price_eur: 49.99,
    image_url: 'images/classic-hoodie-front.jpg',
    back_image_url: 'images/classic-hoodie-bck.jpg',
    extra_images: null,
    sizes: ['L', 'XL'],
    colors: ['Black'],
    stock: 50,
    sort_order: 6,
  },
];

async function seed() {
  await testConnection();

  // ── Admin user ────────────────────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL    || 'admin@illstar.com';
  const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@2026!';
  const adminName  = process.env.ADMIN_NAME     || 'ILLSTAR Admin';
  const [firstName, ...rest] = adminName.split(' ');
  const lastName   = rest.join(' ') || 'Admin';

  const existing = await query('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (existing.length === 0) {
    const hash = await bcrypt.hash(adminPass, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    await query(
      `INSERT INTO users (id, first_name, last_name, email, password_hash, role, is_verified)
       VALUES (?, ?, ?, ?, ?, 'admin', 1)`,
      [uuidv4(), firstName, lastName, adminEmail, hash]
    );
    logger.info(`✅  Admin user created: ${adminEmail}`);
  } else {
    logger.info(`ℹ️   Admin user already exists, skipping`);
  }

  // ── Products ──────────────────────────────────────────────────────────────
  for (const p of PRODUCTS) {
    const rows = await query('SELECT id FROM products WHERE slug = ?', [p.slug]);
    if (rows.length === 0) {
      await query(
        `INSERT INTO products
          (id, slug, name, description, details,
           price_zmw, price_usd, price_gbp, price_eur,
           image_url, back_image_url, extra_images,
           sizes, colors, stock, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          p.slug,
          p.name,
          p.description,
          p.details,
          p.price_zmw,
          p.price_usd,
          p.price_gbp,
          p.price_eur,
          p.image_url,
          p.back_image_url,
          p.extra_images,
          JSON.stringify(p.sizes),
          JSON.stringify(p.colors),
          p.stock,
          p.sort_order,
        ]
      );
      logger.info(`✅  Product seeded: ${p.name}`);
    } else {
      logger.info(`ℹ️   Product already exists, skipping: ${p.name}`);
    }
  }

  logger.info('🎉  Seeding complete');
  await pool.end();
}

seed().catch(err => {
  logger.error('Seed failed:', err);
  process.exit(1);
});
