'use strict';

const nodemailer = require('nodemailer');
const { query }  = require('../config/database');
const logger     = require('./logger');

// ─── Transporter ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const FROM    = process.env.EMAIL_FROM || 'ILLSTAR Studios <noreply@illstar.com>';
const APP_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ─── Shared branded wrapper ───────────────────────────────────────────────────
function branded(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; background:#0f0f0f; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#f0f0f0; }
    .wrap { max-width:580px; margin:40px auto; background:#151515; border-radius:16px; overflow:hidden; }
    .header { background:#111; padding:28px 32px; text-align:center; border-bottom:1px solid #222; }
    .header h1 { margin:0; font-size:26px; letter-spacing:3px; color:#fff; }
    .header p  { margin:4px 0 0; font-size:12px; color:#888; letter-spacing:1px; text-transform:uppercase; }
    .body { padding:32px; }
    .body h2  { font-size:20px; margin:0 0 12px; }
    .body p   { font-size:14px; line-height:1.7; color:#ccc; margin:0 0 16px; }
    .btn { display:inline-block; padding:14px 32px; background:#ff2e2e; color:#fff !important;
           border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;
           letter-spacing:0.5px; margin:8px 0 24px; }
    .divider { border:none; border-top:1px solid #2a2a2a; margin:24px 0; }
    .small { font-size:12px; color:#666; }
    .footer { padding:20px 32px; text-align:center; font-size:12px; color:#555; border-top:1px solid #1e1e1e; }
    table.items { width:100%; border-collapse:collapse; margin:16px 0; }
    table.items th { background:#1e1e1e; font-size:11px; text-transform:uppercase; letter-spacing:.06em;
                     padding:10px 12px; text-align:left; color:#888; }
    table.items td { padding:10px 12px; border-bottom:1px solid #1e1e1e; font-size:13px; }
    .total-row td { border:none; font-size:14px; }
    .total-row.grand td { font-weight:700; font-size:16px; color:#fff; border-top:1px solid #333; padding-top:14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>ILLSTAR</h1>
      <p>Studios</p>
    </div>
    <div class="body">
      ${body}
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} ILLSTAR STUDIOS · Lusaka, Zambia<br>
      <a href="${APP_URL}" style="color:#555;">illstar.com</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── Internal send + audit log ────────────────────────────────────────────────
async function send({ to, subject, html, type }) {
  let status = 'sent';
  let errMsg = null;
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info(`📧  Email sent [${type}] → ${to}`);
  } catch (err) {
    status = 'failed';
    errMsg = err.message;
    logger.error(`📧  Email failed [${type}] → ${to}: ${err.message}`);
  }
  // Audit log (non-blocking)
  query(
    `INSERT INTO email_log (recipient, subject, type, status, error) VALUES (?, ?, ?, ?, ?)`,
    [to, subject, type, status, errMsg]
  ).catch(() => {});
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Sends email-verification link.
 */
async function sendVerification(user, token) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  await send({
    to: user.email,
    subject: 'Verify your ILLSTAR account',
    type: 'verify',
    html: branded('Verify your account', `
      <h2>Welcome to ILLSTAR, ${user.first_name}!</h2>
      <p>Thanks for signing up. Click the button below to verify your email address and activate your account.</p>
      <a class="btn" href="${link}">Verify Email</a>
      <hr class="divider">
      <p class="small">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
      <p class="small">Or copy this URL: ${link}</p>
    `),
  });
}

/**
 * Sends password-reset link.
 */
async function sendPasswordReset(user, token) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  await send({
    to: user.email,
    subject: 'Reset your ILLSTAR password',
    type: 'reset',
    html: branded('Password Reset', `
      <h2>Reset your password</h2>
      <p>Hi ${user.first_name}, we received a request to reset your password.</p>
      <a class="btn" href="${link}">Reset Password</a>
      <hr class="divider">
      <p class="small">This link expires in 1 hour. If you didn't request a reset, ignore this email — your password won't change.</p>
    `),
  });
}

/**
 * Sends order-confirmation email with itemised receipt.
 */
async function sendOrderConfirmation(order, items, user) {
  const itemRows = items.map(i => `
    <tr>
      <td>${i.product_name}</td>
      <td>${i.size} / ${i.color}</td>
      <td style="text-align:center">${i.qty}</td>
      <td style="text-align:right">${order.currency_symbol}${parseFloat(i.line_total).toFixed(2)}</td>
    </tr>`).join('');

  await send({
    to: order.ship_email || user?.email,
    subject: `ILLSTAR Order Confirmation — #${order.ref}`,
    type: 'order_confirm',
    html: branded('Order Confirmed', `
      <h2>Your order is confirmed! 🎉</h2>
      <p>Hi ${order.ship_first_name || 'there'}, thank you for shopping with ILLSTAR STUDIOS.</p>
      <p>We'll send your tracking info once your order has been dispatched.</p>
      <table class="items">
        <thead>
          <tr>
            <th>Item</th><th>Variant</th>
            <th style="text-align:center">Qty</th>
            <th style="text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table class="items">
        <tr class="total-row"><td>Subtotal</td><td style="text-align:right">${order.currency_symbol}${parseFloat(order.subtotal).toFixed(2)}</td></tr>
        <tr class="total-row"><td>Shipping</td><td style="text-align:right">${order.is_pickup ? 'FREE (Pickup)' : order.currency_symbol + parseFloat(order.shipping_cost).toFixed(2)}</td></tr>
        <tr class="total-row grand"><td>Total</td><td style="text-align:right">${order.currency_symbol}${parseFloat(order.grand_total).toFixed(2)} ${order.currency}</td></tr>
      </table>
      <p><strong>Order Ref:</strong> #${order.ref}</p>
      <p><strong>Delivery Address:</strong> ${[order.ship_address, order.ship_province, order.ship_country].filter(Boolean).join(', ')}</p>
      <hr class="divider">
      <p class="small">Questions? WhatsApp us: +260 971 467 772 or DM <a href="https://www.instagram.com/illstarstudios" style="color:#888;">@illstarstudios</a></p>
    `),
  });
}

/**
 * Sends order-status-update email (shipped, delivered, cancelled, etc.).
 */
async function sendOrderStatusUpdate(order, newStatus) {
  const statusMessages = {
    confirmed:  { emoji: '✅', title: 'Order Confirmed',   body: 'Your order has been confirmed and is being prepared.' },
    shipped:    { emoji: '📦', title: 'Order Shipped!',     body: 'Great news — your order is on its way!' },
    delivered:  { emoji: '🎉', title: 'Order Delivered',   body: 'Your order has been delivered. Enjoy!' },
    cancelled:  { emoji: '❌', title: 'Order Cancelled',   body: 'Your order has been cancelled. If you have questions, please contact us.' },
    refunded:   { emoji: '💳', title: 'Refund Processed',  body: 'Your refund has been processed. It may take 5–7 business days to appear.' },
  };
  const msg = statusMessages[newStatus] || { emoji: 'ℹ️', title: 'Order Update', body: `Your order status is now: ${newStatus}` };

  await send({
    to: order.ship_email,
    subject: `${msg.emoji} ILLSTAR Order #${order.ref} — ${msg.title}`,
    type: 'order_status',
    html: branded(msg.title, `
      <h2>${msg.emoji} ${msg.title}</h2>
      <p>Hi ${order.ship_first_name || 'there'},</p>
      <p>${msg.body}</p>
      <p><strong>Order Ref:</strong> #${order.ref}</p>
      <hr class="divider">
      <p class="small">Questions? WhatsApp: +260 971 467 772 or DM @illstarstudios</p>
    `),
  });
}

module.exports = {
  sendVerification,
  sendPasswordReset,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
};
