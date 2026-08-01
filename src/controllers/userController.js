'use strict';

const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const logger    = require('../utils/logger');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');

function safeUser(u) {
  const { password_hash, verification_token, reset_token, reset_token_expires, refresh_token, ...safe } = u;
  return safe;
}

// GET /admin/users
async function listUsers(req, res, next) {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where  = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (role) { where += ' AND role = ?'; params.push(role); }

    const rows = await query(
      `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM users ${where}`, params);

    return res.json({
      success: true,
      data:    rows.map(safeUser),
      meta:    { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    next(err);
  }
}

// GET /admin/users/:id
async function getUser(req, res, next) {
  try {
    const rows = await query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });
    return res.json({ success: true, data: safeUser(rows[0]) });
  } catch (err) {
    next(err);
  }
}

// PUT /admin/users/:id  (role, is_verified)
async function updateUser(req, res, next) {
  try {
    const { role, is_verified } = req.body;
    const rows = await query('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });

    const sets = []; const vals = [];
    if (role)                       { sets.push('role = ?');        vals.push(role); }
    if (is_verified != null)        { sets.push('is_verified = ?'); vals.push(is_verified ? 1 : 0); }
    if (sets.length === 0) return res.status(400).json({ success: false, message: 'Nothing to update.' });

    vals.push(req.params.id);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
    logger.info(`Admin updated user ${req.params.id}`);
    return res.json({ success: true, message: 'User updated.' });
  } catch (err) {
    next(err);
  }
}

// DELETE /admin/users/:id
async function deleteUser(req, res, next) {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: "You can't delete your own account." });
    }
    const rows = await query('SELECT id, email FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });

    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    logger.info(`Admin deleted user: ${rows[0].email}`);
    return res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, getUser, updateUser, deleteUser };
