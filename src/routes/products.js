'use strict';

const router     = require('express').Router();
const { body }   = require('express-validator');
const controller = require('../controllers/productController');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');
const { upload }   = require('../utils/upload');

const productUpload = upload.fields([
  { name: 'image',        maxCount: 1  },
  { name: 'back_image',   maxCount: 1  },
  { name: 'extra_images', maxCount: 10 },
]);

const fileCreateRules = [
  body('slug').trim().isSlug().withMessage('Slug must be a valid URL slug.'),
  body('name').trim().notEmpty().withMessage('Product name required.'),
  body('price_zmw').isFloat({ min: 0 }).withMessage('price_zmw must be a positive number.'),
];

const jsonCreateRules = [
  body('name').trim().notEmpty().withMessage('Product name required.'),
  body('price_zmw').isFloat({ min: 0 }).withMessage('price_zmw must be a positive number.'),
];

router.get('/',       optionalAuth, controller.getProducts);
router.get('/:id',    optionalAuth, controller.getProduct);
router.put('/reorder/bulk', protect, adminOnly, controller.reorderProducts);
router.post('/json',  protect, adminOnly, jsonCreateRules, validate, controller.createProductJson);
router.post('/',      protect, adminOnly, productUpload, fileCreateRules, validate, controller.createProduct);
router.put('/:id',    protect, adminOnly, controller.updateProduct);
router.delete('/:id', protect, adminOnly, controller.deleteProduct);

module.exports = router;
