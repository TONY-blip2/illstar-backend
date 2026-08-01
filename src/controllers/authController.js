'use strict';

const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { query, withTransaction } = require('../config/database');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  decodeToken,
} = require('../utils/jwt');
const emailService = require('../utils/email');
const logger       = require('../utils/logger');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeUser(u) {
  const { password_hash, verification_token, reset_token, reset_token_expires, refresh_token, ...safe } = u;
  return safe;
}

// ─── REGISTER ─────────────────────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { first_name, last_name, email, password, phone } = req.body;

    // Duplicate check
    const existing = await query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
    }

    const passwordHash      = await bcrypt.hash(password, ROUNDS);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const id                = uuidv4();

    await query(
      `INSERT INTO users
        (id, first_name, last_name, email, password_hash, phone, verification_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, first_name.trim(), last_name.trim(), email.toLowerCase().trim(), passwordHash, phone || null, verificationToken]
    );

    const [user] = await query('SELECT * FROM users WHERE id = ?', [id]);

    // Fire-and-forget verification email
    emailService.sendVerification(user, verificationToken).catch(e =>
      logger.error('Verification email failed:', e.message)
    );

    const accessToken  = signAccessToken({ id: user.id, email: user.email, role: user.role });
    const refreshToken = signRefreshToken(user.id);
    await query('UPDATE users SET refresh_token = ? WHERE id = ?', [refreshToken, user.id]);

    logger.info(`New user registered: ${user.email}`);
    return res.status(201).json({
      success: true,
      message: 'Account created! Please check your email to verify your account.',
      data:    { user: safeUser(user), accessToken, refreshToken },
    });
  } catch (err) {
    next(err);
  }
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const rows = await query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    const user = rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const accessToken  = signAccessToken({ id: user.id, email: user.email, role: user.role });
    const refreshToken = signRefreshToken(user.id);

    await query(
      'UPDATE users SET refresh_token = ?, last_login = NOW() WHERE id = ?',
      [refreshToken, user.id]
    );

    logger.info(`User logged in: ${user.email}`);
    return res.json({
      success: true,
      message: 'Login successful.',
      data:    { user: safeUser(user), accessToken, refreshToken },
    });
  } catch (err) {
    next(err);
  }
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
async function logout(req, res, next) {
  try {
    // Revoke the current access token
    if (req.jti) {
      const decoded   = decodeToken(req.headers.authorization.slice(7));
      const expiresAt = new Date(decoded.exp * 1000).toISOString().slice(0, 19).replace('T', ' ');
      await query(
        'INSERT IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)',
        [req.jti, expiresAt]
      );
    }
    // Clear stored refresh token
    await query('UPDATE users SET refresh_token = NULL WHERE id = ?', [req.user.id]);

    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
async function refreshToken(req, res, next) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Refresh token required.' });

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const rows = await query('SELECT * FROM users WHERE id = ? AND refresh_token = ?', [decoded.sub, token]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Refresh token mismatch or revoked.' });
    }
    const user = rows[0];

    const newAccess  = signAccessToken({ id: user.id, email: user.email, role: user.role });
    const newRefresh = signRefreshToken(user.id);
    await query('UPDATE users SET refresh_token = ? WHERE id = ?', [newRefresh, user.id]);

    return res.json({
      success: true,
      data:    { accessToken: newAccess, refreshToken: newRefresh },
    });
  } catch (err) {
    next(err);
  }
}

// ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────
async function verifyEmail(req, res, next) {
  try {
    const { token } = req.params;
    const rows = await query(
      'SELECT id FROM users WHERE verification_token = ? AND is_verified = 0', [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or already-used verification token.' });
    }
    await query(
      'UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?',
      [rows[0].id]
    );
    return res.json({ success: true, message: 'Email verified! You can now log in.' });
  } catch (err) {
    next(err);
  }
}

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const rows = await query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);

    // Always return 200 to prevent email enumeration
    if (rows.length === 0) {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }
    const user  = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const exp   = new Date(Date.now() + 3_600_000); // 1 hour

    await query(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [token, exp, user.id]
    );
    emailService.sendPasswordReset(user, token).catch(e =>
      logger.error('Reset email failed:', e.message)
    );

    return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;

    const rows = await query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()', [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Reset token is invalid or has expired.' });
    }

    const hash = await bcrypt.hash(password, ROUNDS);
    await query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hash, rows[0].id]
    );

    return res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

// ─── GET PROFILE ──────────────────────────────────────────────────────────────
async function getProfile(req, res, next) {
  try {
    const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    return res.json({ success: true, data: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

// ─── UPDATE PROFILE ───────────────────────────────────────────────────────────
async function updateProfile(req, res, next) {
  try {
    const { first_name, last_name, phone } = req.body;
    await query(
      'UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE id = ?',
      [first_name, last_name, phone || null, req.user.id]
    );
    const [updated] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    return res.json({ success: true, message: 'Profile updated.', data: safeUser(updated) });
  } catch (err) {
    next(err);
  }
}

// ─── CHANGE PASSWORD (authenticated) ─────────────────────────────────────────
async function changePassword(req, res, next) {
  try {
    const { current_password, new_password } = req.body;
    const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const hash = await bcrypt.hash(new_password, ROUNDS);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);

    return res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  changePassword,
};
