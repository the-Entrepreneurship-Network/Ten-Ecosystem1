# TEN Internship Portal

Internship management platform for The Entrepreneurship Network (TEN) — student
onboarding, task journeys, attendance, certificates, and role portals for HR,
coordinators, founders, mentors, investors and contractors.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 5 (CommonJS) |
| Database | MongoDB via Mongoose 6, with a local JSON fallback |
| Realtime | Socket.IO (chat) + Server-Sent Events (notifications) |
| Auth | `express-session`, bcrypt password hashing |
| Documents | PDFKit, QR codes |
| Email | Nodemailer |

Frontend is plain HTML/CSS/JS in `public/` — no framework, no build step.

## Running locally

```bash
npm ci --legacy-peer-deps
cp .env.example .env      # then fill in the values — see below
node server.js            # defaults to PORT=5000
```

Without `MONGODB_URI` the app falls back to JSON files under `.data/local_db/`
(gitignored). That mode is for local development only — it does not enforce
unique indexes the way MongoDB does.

## Configuration

Every secret is read from the environment. Nothing is hardcoded, and the app
validates its configuration at boot (`config/secrets.js`): in production a
missing or weak secret aborts startup rather than falling back to a default.

Start from `.env.example`, which documents each variable. The two credential
maps take bcrypt hashes, generated with:

```bash
node scripts/generate-credentials-env.js --in /tmp/hr.json --var HR_CREDENTIALS
```

**Never commit a `.env` file.** See [docs/SECURITY-DO-NOT-EXPOSE.md](docs/SECURITY-DO-NOT-EXPOSE.md)
for what must stay private and why.

## Layout

```
server.js            Express app — routes, the JSON fallback engine, Socket.IO
routes/              Route modules mounted under /api/*
  routes/v2/         The v2 student portal, tasks, quiz, certificates, payments
controllers/         Handlers for the newer route modules
models/              Mongoose schemas
middleware/          Auth guards, validation schemas
services/            Document generation, task engine, coins, cron jobs
utils/               Attendance, tenure, document numbering, mail
public/              All frontend pages and assets
scripts/             Operational and migration scripts
docs/                Architecture maps and written specifications
seeds/               Database seed scripts
```

## Tests

```bash
npm test
```

## Documentation

- `docs/current-system-map.md` — architecture overview
- `docs/api-map.md` — endpoint inventory
- `docs/database-map.md` — collections and fields
- `docs/SECURITY-DO-NOT-EXPOSE.md` — what must never be made public
