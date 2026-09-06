'use strict';

const router      = require('express').Router();
const { body }     = require('express-validator');
const controller   = require('../controllers/settingsController');
const { protect, adminOnly } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');

router.get('/status', controller.getSiteStatus);
router.post('/subscribe', body('email').isEmail(), validate, controller.subscribe);
router.patch('/', protect, adminOnly, controller.updateSiteSettings);

module.exports = router;
