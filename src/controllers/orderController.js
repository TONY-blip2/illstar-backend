'use strict';

const { query, withTransaction } = require('../config/database');
const { v4: uuidv4 }     = require('uuid');
const emailService       = require('../utils/email');
const logger             = require('../utils/logger');
const { uploadToCloud }  = require('../utils/upload');

// ─── Generate order ref ───────────────────────────────────────────────────────
function generateRef() {
  const yr   = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ILL-${yr}-${rand}`;
}

// ─── UPLOAD PAYMENT PROOF (authenticated users) ──────────────────────────────
async function uploadProof(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    const url = await uploadToCloud(req.file.path, 'illstar/payment-proofs');
    return res.json({ success: true, data: { url } });
  } catch (err) {
    next(err);
  }
}

// ─── CREATE ORDER (authenticated users) ──────────────────────────────────────
// NOTE ON SCHEMA: the real `orders` table uses column names like `ref`,
// `status`, `grand_total`, `ship_first_name`, etc. Line items live in a
// SEPARATE `order_items` table. Every query below is written against the REAL
// columns, and SELECTs alias them back to the names the frontend expects
// (order_ref, order_status, total_zmw, etc.) so main.js needs no changes.
async function createOrder(req, res, next) {
  try {
    const body = req.body || {};

    const first_name    = body.first_name    ?? body.ship_first_name ?? null;
    const last_name      = body.last_name     ?? body.ship_last_name  ?? null;
    const email          = body.email         ?? body.ship_email      ?? req.user?.email ?? null;
    const phone          = body.phone         ?? body.ship_phone      ?? null;
    const address        = body.address       ?? body.ship_address    ?? null;
    const country        = body.country       ?? body.ship_country    ?? null;
    const province       = body.province      ?? body.ship_province   ?? null;
    const items          = body.items         ?? [];
    const payment_method = body.payment_method ?? 'mobile_money';
    const is_pickup       = body.is_pickup     ?? false;
    const proof_of_payment_url = body.proof_of_payment_url ?? null;

    const currencyCode   = body.currency_used ?? body.currency_code ?? 'ZMW';
    const currencyMap    = { ZMW: 'K', USD: '$', GBP: '£', EUR: '€' };
    const currencySymbol = currencyMap[currencyCode] || 'K';

    const subtotal_zmw  = parseFloat(body.subtotal_zmw ?? body.subtotal ?? 0) || 0;
    const shipping_zmw  = parseFloat(body.shipping_zmw ?? body.shipping_cost ?? body.shipping ?? 0) || 0;
    const total_zmw     = parseFloat(body.total_zmw ?? body.grand_total ?? body.total ?? 0) || 0;
    const notes         = body.notes ?? null;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must contain at least one item.' });
    }

    // Use the client-generated reference (already shown to the customer
    // before they paid) if it's valid and not already taken; otherwise
    // generate a fresh one server-side.
    let ref = null;
    if (body.client_ref && /^ILL-\d{4}-\d{4}$/.test(body.client_ref)) {
      const existingClientRef = await query('SELECT id FROM orders WHERE ref = ?', [body.client_ref]);
      if (existingClientRef.length === 0) ref = body.client_ref;
    }
    if (!ref) {
      ref = generateRef();
      const existing = await query('SELECT id FROM orders WHERE ref = ?', [ref]);
      if (existing.length > 0) ref = generateRef();
    }

    const VALID_PAYMENT_METHODS = ['whatsapp', 'instagram', 'card', 'paypal', 'mtn', 'airtel'];
    const dbPaymentMethod = VALID_PAYMENT_METHODS.includes(payment_method) ? payment_method : 'whatsapp';

    const orderId = uuidv4();

    const result = await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO orders
          (id, ref, user_id, status, payment_method, payment_status,
           currency, currency_symbol, subtotal, shipping_cost, grand_total,
           is_pickup, ship_first_name, ship_last_name, ship_email, ship_phone,
           ship_address, ship_province, ship_country, notes, proof_of_payment_url)
         VALUES (?, ?, ?, 'pending', ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId, ref, req.user?.id ?? null, dbPaymentMethod,
          currencyCode, currencySymbol, subtotal_zmw, shipping_zmw, total_zmw,
          is_pickup ? 1 : 0, first_name, last_name, email, phone,
          address, province, country, notes, proof_of_payment_url,
        ]
      );

      for (const item of items) {
        const productName = item.name || item.product_name || 'Item';
        const unitPrice    = parseFloat(item.price) || 0;
        const qty          = parseInt(item.qty) || 1;
        await conn.execute(
          `INSERT INTO order_items
            (id, order_id, product_id, product_name, size, color, qty, unit_price, line_total, image_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(), orderId, item.product_id ?? item.id ?? null, productName,
            item.size ?? '', item.color ?? '', qty, unitPrice, unitPrice * qty,
            item.image ?? item.image_url ?? null,
          ]
        );
      }

      return orderId;
    });

    const [order] = await query('SELECT * FROM orders WHERE id = ?', [result]);

    if (order) {
      emailService.sendOrderConfirmation(order, items, req.user).catch(e =>
        logger.error('Order confirmation email failed:', e.message)
      );
    }

    logger.info(`Order created: #${ref} by user ${req.user?.email || email}`);
    return res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      data:    { order: { ...order, order_ref: order.ref, total_zmw: order.grand_total }, items },
    });
  } catch (err) {
    next(err);
  }
}

// ─── LIST ORDERS (admin = all, user = own, minus ones they've cleared) ───────
async function listOrders(req, res, next) {
  try {
    const isAdmin = req.user.role === 'admin';
    const { page = 1, limit = 20, status, search } = req.query;

    const limitNum = Math.max(1, parseInt(limit) || 20);
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const offset   = (pageNum - 1) * limitNum;

    // Customers don't see orders they've cleared from their history
    // (hidden_by_user). Admins always see everything.
    let where  = isAdmin ? 'WHERE 1=1' : 'WHERE user_id = ? AND hidden_by_user = 0';
    const params = isAdmin ? [] : [req.user.id];

    if (status) { where += ' AND status = ?'; params.push(status); }
    if (search && isAdmin) {
      where += ' AND (ref LIKE ? OR ship_email LIKE ? OR ship_first_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const selectCols = `
      id, ref AS order_ref, user_id, status AS order_status, payment_method,
      payment_status, currency AS currency_code, currency_symbol,
      subtotal AS subtotal_zmw, shipping_cost AS shipping_zmw,
      grand_total AS total_zmw, grand_total AS display_total, is_pickup,
      ship_first_name AS first_name, ship_last_name AS last_name,
      ship_email AS email, ship_phone AS phone, ship_address AS address,
      ship_province AS province, ship_country AS country_code, notes,
      proof_of_payment_url, created_at, updated_at`;

    const rows = await query(
      `SELECT ${selectCols} FROM orders ${where} ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const allItems = await query(
        `SELECT order_id, product_name AS name, product_name, size, color, qty,
                unit_price AS price, line_total, image_url
         FROM order_items WHERE order_id IN (${placeholders})`,
        ids
      );
      const byOrder = {};
      allItems.forEach(it => { (byOrder[it.order_id] ??= []).push(it); });
      rows.forEach(r => { r.items = byOrder[r.id] || []; });
    }

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM orders ${where}`,
      params
    );

    return res.json({
      success: true,
      data:    rows,
      meta:    { total, page: pageNum, limit: limitNum },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET SINGLE ORDER ─────────────────────────────────────────────────────────
async function getOrder(req, res, next) {
  try {
    const isAdmin = req.user.role === 'admin';
    const where   = isAdmin ? 'WHERE o.id = ?' : 'WHERE o.id = ? AND o.user_id = ?';
    const params  = isAdmin ? [req.params.id]  : [req.params.id, req.user.id];

    const selectCols = `
      o.id, o.ref AS order_ref, o.user_id, o.status AS order_status, o.payment_method,
      o.payment_status, o.currency AS currency_code, o.currency_symbol,
      o.subtotal AS subtotal_zmw, o.shipping_cost AS shipping_zmw,
      o.grand_total AS total_zmw, o.grand_total AS display_total, o.is_pickup,
      o.ship_first_name AS first_name, o.ship_last_name AS last_name,
      o.ship_email AS email, o.ship_phone AS phone, o.ship_address AS address,
      o.ship_province AS province, o.ship_country AS country_code, o.notes,
      o.proof_of_payment_url, o.created_at, o.updated_at`;

    const rows = await query(
      `SELECT ${selectCols} FROM orders o ${where}`,
      params
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = rows[0];
    const items = await query(
      `SELECT product_name AS name, product_name, size, color, qty,
              unit_price AS price, line_total, image_url
       FROM order_items WHERE order_id = ? ORDER BY created_at ASC`,
      [order.id]
    );

    return res.json({ success: true, data: { order, items } });
  } catch (err) {
    next(err);
  }
}

// ─── UPDATE STATUS (admin only) ───────────────────────────────────────────────
async function updateOrderStatus(req, res, next) {
  try {
    const { status, payment_status } = req.body;
    const rows = await query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const order = rows[0];

    const sets   = [];
    const values = [];
    if (status)         { sets.push('status = ?');         values.push(status); }
    if (payment_status) { sets.push('payment_status = ?'); values.push(payment_status); }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide status or payment_status.' });
    }
    values.push(req.params.id);
    await query(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, values);

    if (status && status !== order.status) {
      const [updated] = await query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
      emailService.sendOrderStatusUpdate(updated, status).catch(e =>
        logger.error('Status email failed:', e.message)
      );
    }

    logger.info(`Order #${order.ref} updated by admin — status: ${status}, payment: ${payment_status}`);
    return res.json({ success: true, message: 'Order updated.' });
  } catch (err) {
    next(err);
  }
}

// ─── CANCEL ORDER (user cancels own pending order) ────────────────────────────
async function cancelOrder(req, res, next) {
  try {
    const rows = await query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const order = rows[0];

    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only pending or confirmed orders can be cancelled.',
      });
    }

    await query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [req.params.id]);
    emailService.sendOrderStatusUpdate({ ...order, status: 'cancelled' }, 'cancelled').catch(() => {});

    return res.json({ success: true, message: 'Order cancelled.' });
  } catch (err) {
    next(err);
  }
}

// ─── CLEAR ORDER HISTORY (customer, from their profile) ──────────────────────
// This only HIDES orders from the customer's own profile — the order records
// stay in the database so your revenue, fulfilment and admin dashboard are
// unaffected. Only finished orders are hidden; anything still being processed
// (pending / confirmed / shipped) always stays visible.
async function clearOrderHistory(req, res, next) {
  try {
    await query(
      "UPDATE orders SET hidden_by_user = 1 WHERE user_id = ? AND status IN ('delivered', 'cancelled', 'refunded')",
      [req.user.id]
    );
    return res.json({ success: true, message: 'Order history cleared.' });
  } catch (err) {
    next(err);
  }
}

// ─── CLEAR ALL ORDERS (admin only) — PERMANENT ────────────────────────────────
// Deletes EVERY order and its line items from the database. This cannot be
// undone and resets revenue/order counts to zero. Intended for wiping test
// orders; the frontend makes the admin type DELETE before this is called.
async function clearAllOrders(req, res, next) {
  try {
    await withTransaction(async (conn) => {
      await conn.execute('DELETE FROM order_items');
      await conn.execute('DELETE FROM orders');
    });
    logger.warn(`ALL orders were cleared by admin ${req.user.email}`);
    return res.json({ success: true, message: 'All orders cleared.' });
  } catch (err) {
    next(err);
  }
}

// ─── ADMIN DASHBOARD STATS ────────────────────────────────────────────────────
async function getDashboardStats(req, res, next) {
  try {
    const [{ totalOrders }]   = await query("SELECT COUNT(*) AS totalOrders FROM orders WHERE status != 'cancelled'");
    const [{ totalRevenue }]  = await query("SELECT COALESCE(SUM(grand_total),0) AS totalRevenue FROM orders WHERE payment_status = 'paid'");
    const [{ totalUsers }]    = await query("SELECT COUNT(*) AS totalUsers FROM users WHERE role != 'admin'");
    const [{ pendingOrders }] = await query("SELECT COUNT(*) AS pendingOrders FROM orders WHERE status = 'pending'");
    const [{ activeUsers }]   = await query("SELECT COUNT(*) AS activeUsers FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 30 DAY)");

    const recentOrders = await query(
      `SELECT id, ref AS order_ref, grand_total AS total_zmw,
              ship_first_name AS first_name, ship_last_name AS last_name,
              ship_email AS email, ship_phone AS phone,
              ship_province AS province, ship_country AS country_code,
              status AS order_status, payment_status,
              proof_of_payment_url, created_at
       FROM orders ORDER BY created_at DESC LIMIT 10`
    );

    return res.json({
      success: true,
      data: {
        totalOrders,
        totalRevenue: parseFloat(totalRevenue),
        totalUsers,
        activeUsers,
        pendingOrders,
        recentOrders,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  updateOrderStatus,
  cancelOrder,
  clearOrderHistory,
  clearAllOrders,
  getDashboardStats,
  uploadProof,
};