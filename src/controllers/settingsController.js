'use strict';

const { query } = require('../config/database');
const emailService = require('../utils/email');
const logger = require('../utils/logger');

// ─── PUBLIC: check store status ──────────────────────────────────────────────
// Every visitor's browser calls this on page load. The FIRST call that
// happens after drop_at has passed is what flips the store open AND fires
// the "we're live" email blast — guarded by notified_live so it only ever
// fires once, no matter how many people check at the same moment.
async function getSiteStatus(req, res, next) {
  try {
    const [settings] = await query('SELECT * FROM site_settings WHERE id = 1');
    if (!settings) {
      return res.json({ success: true, data: { is_open: true, drop_at: null, server_time: new Date().toISOString() } });
    }

    let isOpen = !!settings.is_open;
    const dropAt = settings.drop_at;

    if (!isOpen && dropAt && new Date(dropAt) <= new Date()) {
      isOpen = true;
      await query('UPDATE site_settings SET is_open = 1 WHERE id = 1');

      if (!settings.notified_live) {
        await query('UPDATE site_settings SET notified_live = 1 WHERE id = 1');
        const subscribers = await query('SELECT email FROM subscribers');
        subscribers.forEach(s => {
          emailService.sendSiteLiveEmail(s.email).catch(e =>
            logger.error('Site-live email failed:', e.message)
          );
        });
        logger.info(`Store opened automatically — notified ${subscribers.length} subscribers.`);
      }
    }

    return res.json({
      success: true,
      data: { is_open: isOpen, drop_at: dropAt, server_time: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
}

// ─── ADMIN: update store open/closed + drop date ─────────────────────────────
async function updateSiteSettings(req, res, next) {
  try {
    const { is_open, drop_at } = req.body;
    const sets = [];
    const values = [];
    if (is_open !== undefined) { sets.push('is_open = ?'); values.push(is_open ? 1 : 0); }
    if (drop_at !== undefined) {
      sets.push('drop_at = ?'); values.push(drop_at || null);
      // Setting a (new) drop date resets the one-time "live" email guard,
      // so rescheduling a drop correctly allows the notification to fire again.
      sets.push('notified_live = 0');
    }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide is_open and/or drop_at.' });
    }
    await query(`UPDATE site_settings SET ${sets.join(', ')} WHERE id = 1`, values);
    const [updated] = await query('SELECT * FROM site_settings WHERE id = 1');
    return res.json({ success: true, message: 'Settings updated.', data: updated });
  } catch (err) {
    next(err);
  }
}

// ─── PUBLIC: email signup for drop notification ──────────────────────────────
async function subscribe(req, res, next) {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required.' });
    }
    await query('INSERT IGNORE INTO subscribers (email) VALUES (?)', [email.toLowerCase().trim()]);
    return res.json({ success: true, message: "You're on the list! We'll email you the moment we launch." });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSiteStatus, updateSiteSettings, subscribe };
