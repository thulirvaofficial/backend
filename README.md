# THULIRVA Common Backend API

A unified, centralized Node.js / Express backend service powering both:
1. **The THULIRVA Website** (`/website` customer store & `/admin` dashboard)
2. **The THULIRVA Mobile App** (`/thulirva_mobile_app` Android & iOS)

---

## Architecture Overview

```
E:\website (3)\
├── backend/                  <-- Central Common Backend
│   ├── config/              <-- Database & system configurations
│   ├── controllers/         <-- Business logic controllers
│   ├── middleware/          <-- Authentication & request validation
│   ├── routes/              <-- REST API routes (/api/*)
│   ├── utils/               <-- Helper utilities & formatters
│   ├── .env                 <-- Environment variables (PORT, DB credentials)
│   ├── package.json         <-- Node.js dependencies & scripts
│   └── server.js            <-- Main Express server entry point
│
├── website/                  <-- Web Store & Admin Panel
│   ├── website/             <-- Customer Store (HTML, CSS, JS)
│   └── admin/               <-- Admin Dashboard
│
└── thulirva_mobile_app/      <-- Flutter Mobile Application
    └── lib/                 <-- Mobile app screens, state, & API client
```

---

## Starting the Backend

From the workspace root or inside the `backend` directory:

```bash
cd "E:\website (3)\backend"
npm start
```

Or using nodemon for live reload during development:

```bash
npm run dev
```

---

## Active Service URLs

- **API Base URL**: `http://localhost:5500/api`
  - Mobile Wi-Fi Access: `http://<YOUR_LOCAL_IP>:5500/api` (e.g., `http://10.223.74.171:5500/api`)
- **Customer Website**: `http://localhost:5500/`
- **Admin Dashboard**: `http://localhost:5500/admin`
- **Static Assets & Uploads**: `http://localhost:5500/assets/...` and `http://localhost:5500/uploads/...`

---

## Key Endpoints

- `POST /api/auth/login` - User authentication (Web & App)
- `POST /api/auth/register` - New customer registration
- `GET  /api/products` - Product catalog (featured & category filtered)
- `GET  /api/categories` - Product categories list
- `POST /api/orders` - Order placement & tracking
- `GET  /api/orders/user` - Customer order history
- `POST /api/subscriptions` - Milk & dairy recurring subscriptions
- `GET  /api/coupons` - Discounts & promotional codes
- `GET  /api/notifications` - Customer alerts & order status updates

