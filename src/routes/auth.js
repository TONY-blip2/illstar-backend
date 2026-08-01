'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const controller = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');

// ── Validation rules ──────────────────────────────────────────────────────────
const registerRules = [
  body('first_name').trim().isLength({ min: 2, max: 60 }).withMessage('First name: 2–60 characters.'),
  body('last_name').trim().isLength({ min: 2, max: 60 }).withMessage('Last name: 2–60 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  body('phone').optional().trim().isString().isLength({ max: 20 }).withMessage('Invalid phone format.'),
];

const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

const resetRules = [
  body('token').notEmpty(),
  body('password')
    .isLength({ min: 8 })
    .matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/).matches(/[^A-Za-z0-9]/),
];

const changePassRules = [
  body('current_password').notEmpty().withMessage('Current password required.'),
  body('new_password')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters.')
    .matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/).matches(/[^A-Za-z0-9]/),
];

// ── Routes ────────────────────────────────────────────────────────────────────
router.post('/register',        registerRules,  validate, controller.register);
router.post('/login',           loginRules,     validate, controller.login);
router.post('/logout',          protect,                  controller.logout);
router.post('/refresh',                                   controller.refreshToken);
router.get( '/verify/:token',                             controller.verifyEmail);
router.post('/forgot-password', body('email').isEmail(), validate, controller.forgotPassword);
router.post('/reset-password',  resetRules,    validate, controller.resetPassword);

// Profile (authenticated)
router.get( '/me',             protect, controller.getProfile);
router.put( '/me',             protect, [
  body('first_name').optional().trim().isLength({ min: 2, max: 60 }),
  body('last_name').optional().trim().isLength({ min: 2, max: 60 }),
], validate, controller.updateProfile);
router.put( '/me/password',    protect, changePassRules, validate, controller.changePassword);

module.exports = router;
