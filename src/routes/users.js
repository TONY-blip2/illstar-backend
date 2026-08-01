'use strict';

const router     = require('express').Router();
const { body }   = require('express-validator');
const controller = require('../controllers/userController');
const { protect, adminOnly } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');

const updateRules = [
  body('role').optional().isIn(['user','admin']).withMessage('Role must be user or admin.'),
  body('is_verified').optional().isBoolean(),
];

router.get( '/',    protect, adminOnly, controller.listUsers);
router.get( '/:id', protect, adminOnly, controller.getUser);
router.put( '/:id', protect, adminOnly, updateRules, validate, controller.updateUser);
router.delete('/:id', protect, adminOnly, controller.deleteUser);

module.exports = router;
