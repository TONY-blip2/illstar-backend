'use strict';

const router     = require('express').Router();
const { body }   = require('express-validator');
const controller = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');
const { upload }   = require('../utils/upload');

// ── Validation rules ──────────────────────────────────────────────────────────
const createRules = [
  body('items').isArray({ min: 1 }).withMessage('At least one item required.'),
  body('items.*.size').notEmpty().withMessage('Each item needs a size.'),
  body('items.*.color').notEmpty().withMessage('Each item needs a color.'),
  body('items.*.qty').isInt({ min: 1, max: 15 }).withMessage('Qty must be 1–15.'),
  // Accept both frontend variations safely
  body('first_name').optional({ checkFalsy: true }).trim(),
  body('ship_first_name').optional({ checkFalsy: true }).trim(),
  body('last_name').optional({ checkFalsy: true }).trim(),
  body('ship_last_name').optional({ checkFalsy: true }).trim(),
  body('email').optional({ checkFalsy: true }).isEmail(),
  body('ship_email').optional({ checkFalsy: true }).isEmail(),
  body('country').optional({ checkFalsy: true }),
  body('ship_country').optional({ checkFalsy: true }),
  body('subtotal_zmw').optional({ checkFalsy: true }).isFloat({ min: 0 }),
  body('subtotal').optional({ checkFalsy: true }).isFloat({ min: 0 }),
  body('total_zmw').optional({ checkFalsy: true }).isFloat({ min: 0 }),
  body('grand_total').optional({ checkFalsy: true }).isFloat({ min: 0 }),
];

const statusRules = [
  body('status').optional().isIn(['pending','confirmed','shipped','delivered','cancelled','refunded']),
  body('payment_status').optional().isIn(['unpaid','paid','refunded']),
];

// ── Routes ────────────────────────────────────────────────────────────────────
// User routes
router.post('/upload-proof', protect, upload.single('proof'), controller.uploadProof);
router.post('/',        protect, createRules, validate, controller.createOrder);
router.get( '/',        protect,               controller.listOrders);
router.get( '/:id',     protect,               controller.getOrder);
router.patch('/:id/cancel', protect,           controller.cancelOrder);

// Admin routes
router.get(   '/admin/stats',  protect, adminOnly, controller.getDashboardStats);
router.patch( '/:id/status',   protect, adminOnly, statusRules, validate, controller.updateOrderStatus);

module.exports = router;