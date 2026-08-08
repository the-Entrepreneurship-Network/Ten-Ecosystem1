# TEN Internship Portal

A Node.js/Express internship management portal for The Entrepreneurship Network (TEN).

## Stack
- **Backend**: Node.js + Express (CommonJS), Socket.IO
- **Frontend**: Plain HTML/CSS/JS in `public/` — no build step needed
- **Database**: MongoDB (via Mongoose) with a local JSON file fallback when no `MONGODB_URI` is set
- **Other**: Google Genai AI, Razorpay payments, Nodemailer email, PDFKit, QR codes

## Running the app
```
PORT=5000 node server.js
```
The workflow "Start application" handles this. The app is available at port 5000.

## Environment variables
Copy `.env.example` and fill in values. Key vars:
- `MONGODB_URI` — MongoDB Atlas connection string (optional; falls back to local JSON files in `uploads/local_db/`)
- `SESSION_SECRET` — already set in Replit secrets
- `ADMIN_API_SECRET` — secret for admin API routes
- `EMAIL_USER` / `EMAIL_PASS` — Nodemailer SMTP credentials
- `HR_CREDENTIALS` / `COORDINATOR_CREDENTIALS` — JSON maps of username→password
- `CORS_ALLOWED_ORIGINS` — comma-separated allowed origins

## Project structure
- `server.js` — monolithic Express server (all routes + middleware inline, ~6900 lines)
- `public/` — all frontend HTML/CSS/JS files served statically
- `routes/` — additional Express route files mounted at `/api/*`
- `controllers/` — controller logic for routes
- `models/` — Mongoose models
- `middleware/` — Express middleware
- `services/` — service utilities
- `uploads/` — file uploads and local DB fallback (`uploads/local_db/`)
- `seeds/` — database seed scripts

## User preferences
