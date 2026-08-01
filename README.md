# ILLSTAR Studios — Backend API

Production-ready REST API for the ILLSTAR e-commerce storefront.
Built with **Node.js · Express · MySQL**.

---

## Table of Contents
1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Setup & Installation](#setup--installation)
4. [Environment Variables](#environment-variables)
5. [Database Schema](#database-schema)
6. [API Reference](#api-reference)
   - [Auth](#auth-endpoints)
   - [Products](#product-endpoints)
   - [Orders](#order-endpoints)
   - [Admin — Users](#admin--user-endpoints)
   - [Admin — Dashboard](#admin--dashboard)
7. [Authentication](#authentication)
8. [Image Uploads](#image-uploads)
9. [Email System](#email-system)
10. [Connecting the Frontend](#connecting-the-frontend)
11. [Security Features](#security-features)
12. [Deployment](#deployment)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | MySQL 8 |
| ORM/Query | mysql2/promise (raw SQL, connection pool) |
| Auth | JWT (access + refresh tokens) |
| Password hashing | bcryptjs (12 rounds) |
| File storage | Local disk **or** Cloudinary (auto-detected) |
| Email | Nodemailer (Gmail SMTP / any SMTP) |
| Validation | express-validator |
| Logging | Winston |
| Rate limiting | express-rate-limit |
| Security headers | Helmet |

---

## Project Structure

```
illstar-backend/
├── src/
│   ├── config/
│   │   ├── database.js      # MySQL pool + query helper + transactions
│   │   ├── migrate.js       # Creates all DB tables (run once)
│   │   └── seed.js          # Seeds admin user + products
│   ├── controllers/
│   │   ├── authController.js    # Register, login, logout, verify, reset
│   │   ├── productController.js # CRUD + image uploads
│   │   ├── orderController.js   # Create, list, status updates
│   │   └── userController.js    # Admin user management
│   ├── middleware/
│   │   ├── auth.js          # protect(), adminOnly(), optionalAuth()
│   │   └── errorHandler.js  # validate(), notFound(), errorHandler()
│   ├── routes/
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── orders.js
│   │   └── users.js
│   ├── utils/
│   │   ├── logger.js        # Winston — console + file logs
│   │   ├── jwt.js           # Sign / verify access & refresh tokens
│   │   ├── email.js         # Branded HTML emails (verify, reset, order)
│   │   └── upload.js        # Multer + optional Cloudinary
│   ├── app.js               # Express app (middleware, routes)
│   └── server.js            # HTTP server + graceful shutdown
├── uploads/
│   ├── products/            # Local product images
│   └── avatars/             # Local user avatars
├── logs/
│   ├── combined.log
│   └── error.log
├── .env.example
├── .gitignore
└── package.json
```

---

## Setup & Installation

### Prerequisites
- Node.js 18+
- MySQL 8+
- A Gmail account (or any SMTP server) for emails
- (Optional) A Cloudinary account for cloud image storage

### 1 — Clone & install dependencies

```bash
# From the illstar-backend/ folder:
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env
# Then open .env and fill in your values (see table below)
```

### 3 — Run the database migration

Creates the database and all tables. Safe to re-run.

```bash
npm run migrate
```

### 4 — Seed the database

Creates your admin account and imports the 6 ILLSTAR products.

```bash
npm run seed
```

### 5 — Start the server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

The API will be available at: `http://localhost:5000`

Health check: `GET http://localhost:5000/api/health`

---

## Environment Variables

Copy `.env.example` to `.env` and fill in every value marked **required**.

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `5000`) |
| `NODE_ENV` | No | `development` or `production` |
| `FRONTEND_URL` | Yes | Your frontend URL for CORS + email links |
| `DB_HOST` | Yes | MySQL host (e.g. `localhost`) |
| `DB_PORT` | No | MySQL port (default: `3306`) |
| `DB_NAME` | Yes | Database name (e.g. `illstar_db`) |
| `DB_USER` | Yes | MySQL username |
| `DB_PASSWORD` | Yes | MySQL password |
| `JWT_SECRET` | Yes | Secret key for access tokens — **32+ random chars** |
| `JWT_EXPIRES_IN` | No | Access token lifetime (default: `7d`) |
| `JWT_REFRESH_SECRET` | Yes | Secret key for refresh tokens |
| `JWT_REFRESH_EXPIRES_IN` | No | Refresh token lifetime (default: `30d`) |
| `EMAIL_HOST` | Yes | SMTP host (e.g. `smtp.gmail.com`) |
| `EMAIL_PORT` | No | SMTP port (default: `587`) |
| `EMAIL_USER` | Yes | SMTP username / email address |
| `EMAIL_PASS` | Yes | SMTP password or App Password |
| `EMAIL_FROM` | Yes | Display name + address for outbound emails |
| `BCRYPT_ROUNDS` | No | Hash rounds (default: `12`) |
| `CLOUDINARY_CLOUD_NAME` | No | Leave blank to use local disk storage |
| `CLOUDINARY_API_KEY` | No | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | No | Cloudinary API secret |
| `ADMIN_EMAIL` | No | Admin email for seed script |
| `ADMIN_PASSWORD` | No | Admin password for seed script |

> **Gmail tip:** In your Google Account → Security → 2-Step Verification → App Passwords.
> Generate a 16-char app password and use it as `EMAIL_PASS`.

---

## Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | UUID primary key |
| first_name, last_name | VARCHAR | |
| email | VARCHAR(180) | Unique |
| password_hash | VARCHAR(255) | bcrypt |
| phone | VARCHAR(30) | |
| role | ENUM | `user` or `admin` |
| is_verified | TINYINT | Email verified flag |
| verification_token | VARCHAR | Cleared after use |
| reset_token | VARCHAR | Cleared after use |
| reset_token_expires | DATETIME | 1-hour expiry |
| refresh_token | TEXT | Rotated on every refresh |
| last_login | DATETIME | |

### `products`
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | UUID |
| slug | VARCHAR(120) | Unique URL-friendly identifier |
| name | VARCHAR(200) | |
| price_zmw / usd / gbp / eur | DECIMAL(10,2) | Multi-currency pricing |
| image_url, back_image_url | VARCHAR(500) | |
| extra_images | JSON | Array of additional image URLs |
| sizes, colors | JSON | Arrays |
| stock | INT | Inventory count |
| is_sold_out, is_disabled | TINYINT | Visibility flags |
| sort_order | INT | Display ordering |

### `orders`
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | UUID |
| ref | VARCHAR(30) | e.g. `ILL-2026-4821` |
| user_id | CHAR(36) | FK → users |
| status | ENUM | `pending` → `confirmed` → `shipped` → `delivered` |
| payment_method | ENUM | `whatsapp`, `instagram`, `card`, `paypal`, `mtn`, `airtel` |
| payment_status | ENUM | `unpaid`, `paid`, `refunded` |
| currency / symbol | VARCHAR | |
| subtotal / shipping_cost / grand_total | DECIMAL | |
| is_pickup | TINYINT | Physical pickup flag |
| ship_* | VARCHAR | Shipping address snapshot |

### `order_items`
Line items linked to an order. Each row = one product variant × quantity.

### `email_log`
Audit trail of every email sent (type, status, error).

### `revoked_tokens`
JWT revocation list — populated on logout. Cleaned up by token expiry.

---

## API Reference

**Base URL:** `http://localhost:5000/api`

All responses follow this shape:
```json
{
  "success": true | false,
  "message": "Human-readable result",
  "data": { ... }
}
```

---

### Auth Endpoints

#### `POST /auth/register`
Create a new user account. Sends verification email.

**Body:**
```json
{
  "first_name": "Anthony",
  "last_name":  "Mushumba",
  "email":      "anthony@example.com",
  "password":   "Secure@2026!",
  "phone":      "+260971467772"
}
```

**Response `201`:**
```json
{
  "success": true,
  "message": "Account created! Please check your email to verify your account.",
  "data": {
    "user": { "id": "...", "email": "...", "role": "user", ... },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

---

#### `POST /auth/login`
```json
{ "email": "anthony@example.com", "password": "Secure@2026!" }
```

**Response `200`:** Same shape as register.

---

#### `POST /auth/logout`
Requires `Authorization: Bearer <accessToken>`

Revokes the current access token and clears the refresh token.

---

#### `POST /auth/refresh`
Exchange a refresh token for new tokens.
```json
{ "refreshToken": "eyJ..." }
```

---

#### `GET /auth/verify/:token`
Called from the link in the verification email.

---

#### `POST /auth/forgot-password`
```json
{ "email": "anthony@example.com" }
```
Always returns `200` (prevents email enumeration).

---

#### `POST /auth/reset-password`
```json
{ "token": "...", "password": "NewSecure@2026!" }
```

---

#### `GET /auth/me`
Returns the authenticated user's profile.
Requires `Authorization: Bearer <accessToken>`

---

#### `PUT /auth/me`
Update name and phone.
```json
{ "first_name": "Anthony", "last_name": "M", "phone": "+260971467772" }
```

---

#### `PUT /auth/me/password`
```json
{ "current_password": "old", "new_password": "New@2026!" }
```

---

### Product Endpoints

#### `GET /products`
Returns all non-disabled products (public). Admins receive all products including disabled.

**Query params:** none required.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "slug": "classic-tee",
      "name": "CLASSIC TEE",
      "prices": { "ZMW": 249.99, "USD": 49.99, "GBP": 49.99, "EUR": 49.99 },
      "image_url": "images/classictee-front.jpg",
      "sizes": ["M","L","XL"],
      "colors": ["Black"],
      "is_sold_out": false,
      "is_disabled": false
    }
  ]
}
```

---

#### `GET /products/:id`
`:id` can be the UUID **or** the slug (e.g. `classic-tee`).

---

#### `POST /products` *(Admin)*
Multipart form data. Fields:

| Field | Type | Required |
|---|---|---|
| name | text | Yes |
| slug | text | Yes |
| price_zmw | number | Yes |
| price_usd, price_gbp, price_eur | number | No |
| description, details | text | No |
| sizes | JSON string | e.g. `["S","M","L"]` |
| colors | JSON string | e.g. `["Black","White"]` |
| stock | number | No |
| sort_order | number | No |
| image | file | No |
| back_image | file | No |
| extra_images | files (up to 10) | No |

---

#### `PUT /products/:id` *(Admin)*
Same fields as POST — only send what you want to change.

---

#### `DELETE /products/:id` *(Admin)*
Permanently deletes product and its images from storage.

---

### Order Endpoints

#### `POST /orders`
Place a new order. Sends confirmation email automatically.

**Body:**
```json
{
  "items": [
    {
      "product_id":   "uuid",
      "product_name": "CLASSIC TEE",
      "size":         "L",
      "color":        "Black",
      "qty":          2,
      "unit_price":   249.99,
      "image_url":    "images/classictee-front.jpg"
    }
  ],
  "payment_method":  "whatsapp",
  "currency":        "ZMW",
  "currency_symbol": "K",
  "subtotal":        499.98,
  "shipping_cost":   50.00,
  "grand_total":     549.98,
  "is_pickup":       false,
  "ship_first_name": "Anthony",
  "ship_last_name":  "Mushumba",
  "ship_email":      "anthony@example.com",
  "ship_phone":      "+260971467772",
  "ship_address":    "123 Cairo Road",
  "ship_province":   "Lusaka",
  "ship_country":    "ZM"
}
```

---

#### `GET /orders`
- **User:** returns own orders only
- **Admin:** returns all orders

**Query params:** `page`, `limit`, `status`, `search` (admin only)

---

#### `GET /orders/:id`
Returns order + line items.

---

#### `PATCH /orders/:id/cancel`
User cancels their own `pending` or `confirmed` order.

---

#### `PATCH /orders/:id/status` *(Admin)*
```json
{ "status": "shipped", "payment_status": "paid" }
```
Valid statuses: `pending` `confirmed` `shipped` `delivered` `cancelled` `refunded`

---

### Admin — User Endpoints

All require `Authorization: Bearer <adminToken>`

| Method | Path | Description |
|---|---|---|
| GET | `/users` | List all users (paginated, searchable) |
| GET | `/users/:id` | Get single user |
| PUT | `/users/:id` | Update role or verification status |
| DELETE | `/users/:id` | Delete user |

**Query params for GET /users:** `page`, `limit`, `search`, `role`

---

### Admin — Dashboard

#### `GET /orders/admin/stats`
Returns:
```json
{
  "totalOrders":   42,
  "totalRevenue":  18450.00,
  "totalUsers":    31,
  "pendingOrders": 7,
  "recentOrders":  [ ... ]
}
```

---

## Authentication

The API uses a **dual-token** approach:

| Token | Lifetime | Purpose |
|---|---|---|
| Access token (JWT) | 7 days | Sent in every API request header |
| Refresh token (JWT) | 30 days | Exchange for new access token |

**How to authenticate:**

1. Login → receive `accessToken` + `refreshToken`
2. Store both securely (memory for access token, `httpOnly` cookie or secure storage for refresh)
3. Send access token on every request:
   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
4. When access token expires, call `POST /auth/refresh` with the refresh token
5. On logout, call `POST /auth/logout` — the token is immediately revoked server-side

---

## Image Uploads

### Local storage (default)
Images are saved to `uploads/products/` and served at `/uploads/products/filename.jpg`.

### Cloudinary (recommended for production)
Set the three `CLOUDINARY_*` variables in `.env`. The API will automatically:
- Upload new images to your Cloudinary account
- Delete old images from Cloudinary when a product is updated or deleted
- Return `secure_url` (HTTPS) instead of local paths

No code change required — switching between modes is entirely config-driven.

---

## Email System

All emails use a branded dark-theme HTML template matching ILLSTAR's aesthetic.

| Trigger | Template | Subject |
|---|---|---|
| Registration | `sendVerification()` | "Verify your ILLSTAR account" |
| Forgot password | `sendPasswordReset()` | "Reset your ILLSTAR password" |
| Order placed | `sendOrderConfirmation()` | "ILLSTAR Order Confirmation — #ILL-2026-XXXX" |
| Order status changes | `sendOrderStatusUpdate()` | "📦 Order #ILL-2026-XXXX — Order Shipped!" |

Emails are **fire-and-forget** (non-blocking). Every send attempt is logged to the `email_log` table.

---

## Connecting the Frontend

Replace the `localStorage`-based auth in your `script.js` with API calls:

### Registration
```javascript
const res = await fetch('http://localhost:5000/api/auth/register', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ first_name, last_name, email, password, phone }),
});
const { data } = await res.json();
// Store tokens:
sessionStorage.setItem('accessToken', data.accessToken);
sessionStorage.setItem('refreshToken', data.refreshToken);
```

### Authenticated requests
```javascript
const token = sessionStorage.getItem('accessToken');
const res = await fetch('http://localhost:5000/api/orders', {
  method:  'POST',
  headers: {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify(orderPayload),
});
```

### Fetching products (replaces products.json)
```javascript
// In loadProducts() — replace the fetch('products.json') call:
const res      = await fetch('http://localhost:5000/api/products');
const { data } = await res.json();
products = data; // same shape your renderProducts() already expects
renderProducts();
```

---

## Security Features

| Feature | Detail |
|---|---|
| Password hashing | bcrypt, 12 rounds |
| JWT revocation | Logout adds token JTI to `revoked_tokens` table |
| Refresh token rotation | New refresh token issued on every `/auth/refresh` call |
| Rate limiting | 100 req/15 min globally; 20 req/15 min on auth routes |
| Helmet | Sets 11 security headers (CSP, HSTS, X-Frame-Options, etc.) |
| CORS | Strict allow-list; credentials supported |
| Input validation | express-validator on every write endpoint |
| SQL injection | Parameterised queries only — no string concatenation |
| Error messages | Stack traces hidden in production |
| Email enumeration | `forgotPassword` always returns 200 |
| Admin guard | `adminOnly()` middleware on all sensitive routes |

---

## Deployment

### Railway / Render / Fly.io (recommended)
1. Push the `illstar-backend/` folder to a GitHub repo
2. Connect the repo to your chosen platform
3. Set all environment variables in the platform dashboard
4. The platform will run `npm start` automatically

### VPS (Ubuntu/Debian)
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (process manager)
sudo npm install -g pm2

# In your project folder:
npm install --production
npm run migrate
npm run seed
pm2 start src/server.js --name illstar-api
pm2 save
pm2 startup
```

### Nginx reverse proxy (optional but recommended)
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Then add HTTPS with `certbot --nginx -d api.yourdomain.com`.

---

## Quick-start Checklist

- [ ] `npm install`
- [ ] Copy `.env.example` → `.env` and fill in all values
- [ ] `npm run migrate` — creates the database and tables
- [ ] `npm run seed` — creates admin user and 6 products
- [ ] `npm run dev` — start development server
- [ ] Test health check: `GET http://localhost:5000/api/health`
- [ ] Login as admin and verify the dashboard stats endpoint works
- [ ] Update `FRONTEND_URL` in `.env` to match your deployed frontend URL
- [ ] Set Cloudinary credentials (or leave blank for local storage)
- [ ] Set Gmail App Password for email sending

---

© 2026 ILLSTAR STUDIOS
