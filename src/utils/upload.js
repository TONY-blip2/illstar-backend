'use strict';

const multer     = require('multer');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');
const logger     = require('./logger');

// ─── Cloudinary (optional) ────────────────────────────────────────────────────
let cloudinary = null;
if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  logger.info('☁️   Cloudinary configured');
} else {
  logger.info('💾  Using local disk storage for uploads');
}

// ─── Local disk storage ───────────────────────────────────────────────────────
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.fieldname === 'avatar' ? 'uploads/avatars' : 'uploads/products';
    cb(null, path.join(__dirname, '../../', folder));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_TYPES = /jpeg|jpg|png|webp|avif/;

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype.split('/')[1];
    if (ALLOWED_TYPES.test(ext) && ALLOWED_TYPES.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP and AVIF images are allowed.'));
    }
  },
});

/**
 * Upload a file buffer / path to Cloudinary.
 * Falls back to returning the local path if Cloudinary is not configured.
 * @param {string} localPath  Absolute path on disk (from multer)
 * @param {string} folder     Cloudinary folder name
 * @returns {Promise<string>} Public URL
 */
async function uploadToCloud(localPath, folder = 'illstar/products') {
  if (!cloudinary) {
    // Return a relative URL that the static-file server will serve
    const rel = localPath.replace(path.join(__dirname, '../../'), '').replace(/\\/g, '/');
    return `/${rel}`;
  }
  const result = await cloudinary.uploader.upload(localPath, {
    folder,
    use_filename: false,
    unique_filename: true,
    overwrite: false,
  });
  return result.secure_url;
}

/**
 * Delete an image from Cloudinary by its public_id.
 * No-op if Cloudinary is not configured.
 */
async function deleteFromCloud(publicIdOrUrl) {
  if (!cloudinary || !publicIdOrUrl) return;
  // Extract public_id from URL if a full URL was passed
  const match = publicIdOrUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/i);
  if (match) await cloudinary.uploader.destroy(match[1]);
}

module.exports = { upload, uploadToCloud, deleteFromCloud };
