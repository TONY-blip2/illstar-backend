'use strict';

const { v4: uuidv4 } = require('uuid');
const { query }      = require('../config/database');
const { uploadToCloud, deleteFromCloud } = require('../utils/upload');
const logger = require('../utils/logger');

function safeParse(val, fallback) {
  if (!val) return fallback;
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function parseProduct(p) {
  return {
    ...p,
    sizes:        safeParse(p.sizes, []),
    colors:       safeParse(p.colors, []),
    extra_images: safeParse(p.extra_images, []),
    price_zmw:    parseFloat(p.price_zmw) || 0,
    price_usd:    parseFloat(p.price_usd) || null,
    price_gbp:    parseFloat(p.price_gbp) || null,
    price_eur:    parseFloat(p.price_eur) || null,
    is_sold_out:  !!p.is_sold_out,
    is_disabled:  !!p.is_disabled,
    prices: {
      ZMW: parseFloat(p.price_zmw) || 0,
      USD: parseFloat(p.price_usd) || null,
      GBP: parseFloat(p.price_gbp) || null,
      EUR: parseFloat(p.price_eur) || null,
    },
  };
}

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

async function uniqueSlug(base) {
  let slug = base;
  let suffix = 0;
  while (true) {
    const rows = await query('SELECT id FROM products WHERE slug = ?', [slug]);
    if (rows.length === 0) return slug;
    suffix++;
    slug = `${base}-${suffix}`;
  }
}

async function getProducts(req, res, next) {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const where = isAdmin ? '' : 'WHERE is_disabled = 0';
    const rows = await query(`SELECT * FROM products ${where} ORDER BY sort_order ASC, created_at ASC`);
    return res.json({ success: true, data: rows.map(parseProduct) });
  } catch (err) { next(err); }
}

async function getProduct(req, res, next) {
  try {
    const rows = await query('SELECT * FROM products WHERE id = ? OR slug = ?', [req.params.id, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Product not found.' });
    return res.json({ success: true, data: parseProduct(rows[0]) });
  } catch (err) { next(err); }
}

async function createProduct(req, res, next) {
  try {
    const { slug, name, description, details, price_zmw, price_usd, price_gbp, price_eur, sizes, colors, stock, sort_order } = req.body;
    const id = uuidv4();
    const finalSlug = await uniqueSlug(slug || slugify(name));
    const sizesJSON = JSON.stringify(Array.isArray(sizes) ? sizes : safeParse(sizes, []));
    const colorsJSON = JSON.stringify(Array.isArray(colors) ? colors : safeParse(colors, []));
    let imageUrl = null, backImageUrl = null, extraImagesJSON = null;
    if (req.files && req.files.image && req.files.image[0]) imageUrl = await uploadToCloud(req.files.image[0].path, 'illstar/products');
    if (req.files && req.files.back_image && req.files.back_image[0]) backImageUrl = await uploadToCloud(req.files.back_image[0].path, 'illstar/products');
    if (req.files && req.files.extra_images && req.files.extra_images.length) {
      const urls = await Promise.all(req.files.extra_images.map(f => uploadToCloud(f.path, 'illstar/products')));
      extraImagesJSON = JSON.stringify(urls);
    }
    await query(
      `INSERT INTO products (id, slug, name, description, details, price_zmw, price_usd, price_gbp, price_eur, image_url, back_image_url, extra_images, sizes, colors, stock, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, finalSlug, name, description || null, details || null, price_zmw || 0, price_usd || null, price_gbp || null, price_eur || null, imageUrl, backImageUrl, extraImagesJSON, sizesJSON, colorsJSON, parseInt(stock) || 0, parseInt(sort_order) || 0]
    );
    const [created] = await query('SELECT * FROM products WHERE id = ?', [id]);
    logger.info(`Product created (file): ${name}`);
    return res.status(201).json({ success: true, message: 'Product created.', data: parseProduct(created) });
  } catch (err) { next(err); }
}

async function createProductJson(req, res, next) {
  try {
    const { name, description, details, price_zmw, price_usd, price_gbp, price_eur, image_url, back_image_url, extra_images, sizes, colors, stock, is_sold_out, is_disabled } = req.body;
    const id = uuidv4();
    const finalSlug = await uniqueSlug(slugify(name));
    const sizesJSON = JSON.stringify(Array.isArray(sizes) ? sizes : safeParse(sizes, []));
    const colorsJSON = JSON.stringify(Array.isArray(colors) ? colors : safeParse(colors, []));
    const extrasJSON = JSON.stringify(Array.isArray(extra_images) ? extra_images : safeParse(extra_images, []));
    await query(
      `INSERT INTO products (id, slug, name, description, details, price_zmw, price_usd, price_gbp, price_eur, image_url, back_image_url, extra_images, sizes, colors, stock, is_sold_out, is_disabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, finalSlug, name, description || null, details || null, price_zmw || 0, price_usd || null, price_gbp || null, price_eur || null, image_url || null, back_image_url || null, extrasJSON, sizesJSON, colorsJSON, stock != null ? parseInt(stock) : 0, is_sold_out ? 1 : 0, is_disabled ? 1 : 0]
    );
    const [created] = await query('SELECT * FROM products WHERE id = ?', [id]);
    logger.info(`Product created (json): ${name}`);
    return res.status(201).json({ success: true, message: 'Product created.', data: parseProduct(created) });
  } catch (err) { next(err); }
}

async function updateProduct(req, res, next) {
  try {
    const rows = await query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Product not found.' });
    const existing = rows[0];
    const { name, description, details, price_zmw, price_usd, price_gbp, price_eur, image_url, back_image_url, extra_images, sizes, colors, stock, sort_order, is_sold_out, is_disabled } = req.body;
    let imageUrl = existing.image_url;
    let backImageUrl = existing.back_image_url;
    let extrasJSON = existing.extra_images;
    if (req.files && req.files.image && req.files.image[0]) { if (existing.image_url) await deleteFromCloud(existing.image_url); imageUrl = await uploadToCloud(req.files.image[0].path, 'illstar/products'); }
    if (req.files && req.files.back_image && req.files.back_image[0]) { if (existing.back_image_url) await deleteFromCloud(existing.back_image_url); backImageUrl = await uploadToCloud(req.files.back_image[0].path, 'illstar/products'); }
    if (req.files && req.files.extra_images && req.files.extra_images.length) {
      const urls = await Promise.all(req.files.extra_images.map(f => uploadToCloud(f.path, 'illstar/products')));
      extrasJSON = JSON.stringify(urls);
    }
    if (image_url !== undefined) imageUrl = image_url || existing.image_url;
    if (back_image_url !== undefined) backImageUrl = back_image_url || existing.back_image_url;
    if (extra_images !== undefined && !(req.files && req.files.extra_images && req.files.extra_images.length)) {
      extrasJSON = Array.isArray(extra_images) ? JSON.stringify(extra_images) : extra_images;
    }
    const sizesJSON = sizes ? JSON.stringify(Array.isArray(sizes) ? sizes : safeParse(sizes, [])) : existing.sizes;
    const colorsJSON = colors ? JSON.stringify(Array.isArray(colors) ? colors : safeParse(colors, [])) : existing.colors;
    let finalSlug = existing.slug;
    if (name && name.trim() !== existing.name) finalSlug = await uniqueSlug(slugify(name));
    await query(
      `UPDATE products SET slug = ?, name = ?, description = ?, details = ?, price_zmw = ?, price_usd = ?, price_gbp = ?, price_eur = ?, image_url = ?, back_image_url = ?, extra_images = ?, sizes = ?, colors = ?, stock = ?, sort_order = ?, is_sold_out = ?, is_disabled = ? WHERE id = ?`,
      [finalSlug, name || existing.name, description ?? existing.description, details ?? existing.details, price_zmw != null ? parseFloat(price_zmw) : existing.price_zmw, price_usd != null ? parseFloat(price_usd) : existing.price_usd, price_gbp != null ? parseFloat(price_gbp) : existing.price_gbp, price_eur != null ? parseFloat(price_eur) : existing.price_eur, imageUrl, backImageUrl, extrasJSON, sizesJSON, colorsJSON, stock != null ? parseInt(stock) : existing.stock, sort_order != null ? parseInt(sort_order) : existing.sort_order, is_sold_out != null ? (is_sold_out ? 1 : 0) : existing.is_sold_out, is_disabled != null ? (is_disabled ? 1 : 0) : existing.is_disabled, req.params.id]
    );
    const [updated] = await query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    logger.info(`Product updated: ${updated.name}`);
    return res.json({ success: true, message: 'Product updated.', data: parseProduct(updated) });
  } catch (err) { next(err); }
}

async function deleteProduct(req, res, next) {
  try {
    const rows = await query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Product not found.' });
    if (rows[0].image_url) await deleteFromCloud(rows[0].image_url);
    if (rows[0].back_image_url) await deleteFromCloud(rows[0].back_image_url);
    await query('DELETE FROM products WHERE id = ?', [req.params.id]);
    logger.info(`Product deleted: ${rows[0].name}`);
    return res.json({ success: true, message: 'Product deleted.' });
  } catch (err) { next(err); }
}

async function reorderProducts(req, res, next) {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, message: 'order array required.' });
    }
    await Promise.all(
      order.map(({ id, sort_order }) =>
        query('UPDATE products SET sort_order = ? WHERE id = ?', [sort_order, id])
      )
    );
    logger.info(`Products reordered: ${order.length} items`);
    return res.json({ success: true, message: 'Products reordered.' });
  } catch (err) { next(err); }
}

module.exports = {
  getProducts,
  getProduct,
  createProduct,
  createProductJson,
  updateProduct,
  deleteProduct,
  reorderProducts
};
