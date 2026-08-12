'use strict';

const { query }          = require('../config/database');
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
// Called before order creation — the shopper uploads a screenshot of their
// mobile money payment, we push it to Cloudinary, and return the URL to be
// included in the createOrder payload as proof_of_payment_url.
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
async function createOrder(req, res, next) {
  try {
    // 1. Safely extract and default ALL variables to prevent 'undefined' binding errors
    const body = req.body || {};
    
    const first_name    = body.first_name    ?? body.ship_first_name ?? null;
    const last_name     = body.last_name     ?? body.ship_last_name  ?? null;
    const email         = body.email         ?? body.ship_email      ?? req.user?.email ?? null;
    const phone         = body.phone         ?? body.ship_phone      ?? null;
    const address       = body.address       ?? body.ship_address    ?? null;
    const country       = body.country       ?? body.ship_country    ?? null;
    const province      = body.province      ?? body.ship_province   ?? null;
    const items         = body.items         ?? [];
    const payment_method = body.payment_method ?? 'mobile_money';
    const is_pickup     = body.is_pickup     ?? false;
    const proof_of_payment_url = body.proof_of_payment_url ?? null;
    
    // Handle currency
    const currencyCode   = body.currency_used ?? body.currency_code ?? 'ZMW';
    const currencyMap    = { ZMW: 'K', USD: '$', GBP: '£', EUR: '€' };
    const currencySymbol = currencyMap[currencyCode] || 'K';
    
    // Handle totals (fallback to 0 if missing)
    const subtotal_zmw  = parseFloat(body.subtotal_zmw ?? body.subtotal ?? 0) || 0;
    const shipping_zmw  = parseFloat(body.shipping_zmw ?? body.shipping_cost ?? body.shipping ?? 0) || 0;
    const total_zmw     = parseFloat(body.total_zmw ?? body.grand_total ?? body.total ?? 0) || 0;
    
    const exchange_rate = parseFloat(body.exchange_rate ?? 1) || 1;
    const display_total = parseFloat(body.display_total ?? total_zmw) || 0;
    const notes         = body.notes ?? null;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must contain at least one item.' });
    }

    // Use the client-generated reference (already shown to the customer
    // before they paid) if it's valid and not already taken; otherwise
    // generate a fresh one server-side.
    let ref = null;
    if (body.client_ref && /^ILL-\d{4}-\d{4}$/.test(body.client_ref)) {
      const existingClientRef = await query('SELECT id FROM orders WHERE order_ref = ?', [body.client_ref]);
      if (existingClientRef.length === 0) ref = body.client_ref;
    }
    if (!ref) {
      ref = generateRef();
      const existing = await query('SELECT id FROM orders WHERE order_ref = ?', [ref]);
      if (existing.length > 0) ref = generateRef();
    }

    // 2. Insert directly into the `orders` table (matches your DB schema perfectly)
    await query(
      `INSERT INTO orders 
        (order_ref, user_id, email, first_name, last_name, phone, 
         country_code, province, address, items, 
         subtotal_zmw, shipping_zmw, total_zmw, 
         currency_code, currency_symbol, exchange_rate, display_total, 
         payment_method, payment_status, order_status, is_pickup, notes, proof_of_payment_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref, 
        req.user?.id ?? null, 
        email, 
        first_name, 
        last_name, 
        phone, 
        country, 
        province, 
        address, 
        JSON.stringify(items), // Save cart as JSON array directly
        subtotal_zmw, 
        shipping_zmw, 
        total_zmw, 
        currencyCode, 
        currencySymbol, 
        exchange_rate, 
        display_total, 
        payment_method, 
        'unpaid',    // default payment status
        'pending',   // default order status
        is_pickup ? 1 : 0, 
        notes,
        proof_of_payment_url
      ]
    );

    // Fetch the just-created order
    const [order] = await query('SELECT * FROM orders WHERE order_ref = ?', [ref]);

    // Attempt to send confirmation email (don't block if it fails)
    if (order) {
      emailService.sendOrderConfirmation(order, items, req.user).catch(e =>
        logger.error('Order confirmation email failed:', e.message)
      );
    }

    logger.info(`Order created: #${ref} by user ${req.user?.email || email}`);
    return res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      data:    { order: order || {}, items },
    });
  } catch (err) {
    next(err);
  }
}

// ─── LIST ORDERS (admin = all, user = own) ────────────────────────────────────
async function listOrders(req, res, next) {
  try {
    const isAdmin = req.user.role === 'admin';
    const { page = 1, limit = 20, status, search } = req.query;

    const limitNum = Math.max(1, parseInt(limit) || 20);
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const offset   = (pageNum - 1) * limitNum;

    // Build secure WHERE clause
    let where  = isAdmin ? 'WHERE 1=1' : 'WHERE user_id = ?';
    const params = isAdmin ? [] : [req.user.id];

    if (status) { where += ' AND order_status = ?'; params.push(status); }
    if (search && isAdmin) {
      where += ' AND (order_ref LIKE ? OR email LIKE ? OR first_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    // NOTE: LIMIT/OFFSET are embedded directly rather than bound as `?`
    // placeholders — mysql2's prepared-statement execute() throws
    // "Incorrect arguments to mysqld_stmt_execute" in many versions when
    // LIMIT/OFFSET are passed as parameters. Safe here since limitNum/offset
    // are guaranteed integers from parseInt() above, never raw user input.
    const rows = await query(
      `SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

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

    const rows = await query(
      `SELECT o.*, u.first_name, u.last_name, u.email AS user_email
         FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where}`,
      params
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = rows[0];
    let items = [];
    try {
        items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
    } catch(e) {
        items = [];
    }

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
    if (status)         { sets.push('order_status = ?');     values.push(status); }
    if (payment_status) { sets.push('payment_status = ?');   values.push(payment_status); }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide status or payment_status.' });
    }
    values.push(req.params.id);
    await query(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, values);

    if (status && status !== order.order_status) {
      const [updated] = await query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
      emailService.sendOrderStatusUpdate(updated, status).catch(e =>
        logger.error('Status email failed:', e.message)
      );
    }

    logger.info(`Order #${order.order_ref} updated by admin — status: ${status}, payment: ${payment_status}`);
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

    if (!['pending', 'confirmed'].includes(order.order_status)) {
      return res.status(400).json({
        success: false,
        message: 'Only pending or confirmed orders can be cancelled.',
      });
    }

    await query("UPDATE orders SET order_status = 'cancelled' WHERE id = ?", [req.params.id]);
    emailService.sendOrderStatusUpdate({ ...order, order_status: 'cancelled' }, 'cancelled').catch(() => {});

    return res.json({ success: true, message: 'Order cancelled.' });
  } catch (err) {
    next(err);
  }
}

// ─── ADMIN DASHBOARD STATS ────────────────────────────────────────────────────
async function getDashboardStats(req, res, next) {
  try {
    const [{ totalOrders }]   = await query("SELECT COUNT(*) AS totalOrders FROM orders WHERE order_status != 'cancelled'");
    const [{ totalRevenue }]  = await query("SELECT COALESCE(SUM(total_zmw),0) AS totalRevenue FROM orders WHERE payment_status = 'paid'");
    const [{ totalUsers }]    = await query("SELECT COUNT(*) AS totalUsers FROM users WHERE role = 'customer'");
    const [{ pendingOrders }] = await query("SELECT COUNT(*) AS pendingOrders FROM orders WHERE order_status = 'pending'");
    
    const [{ activeUsers }]   = await query("SELECT COUNT(*) AS activeUsers FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 30 DAY)");

    const recentOrders = await query(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT 10'
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
  getDashboardStats,
  uploadProof,
};