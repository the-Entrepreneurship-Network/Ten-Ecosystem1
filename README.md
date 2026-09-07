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

### What is deliberately not in git

These directories exist on a running server but are excluded by `.gitignore`,
so a fresh clone will not have them. That is intentional — do not commit them
back.

| Path | Why |
|---|---|
| `uploads/documents/`, `uploads/certificates/`, `uploads/offer-letters/` | Real student resumes, marksheets and generated letters. Personal data. |
| `.data/` | The local JSON fallback database — user records and password hashes. |
| `.env`, `.session-secret` | Every secret. |
| `credentials-to-distribute.txt` | Cleartext passwords written by the setup script, for one-time hand-out. |
| `node_modules/` | Installed with `npm ci`. |

`uploads/` is **runtime data with no backup other than the server's own disk.**
The production deploy workflow copies it aside before `git reset --hard` and
restores anything the reset removes, so a deploy cannot delete a student's
documents. Anything that changes how deploys work must keep that guarantee.

## Tests

```bash
npm test
```

## Documentation

**Architecture**
- `docs/current-system-map.md` — architecture overview
- `docs/api-map.md` — endpoint inventory
- `docs/database-map.md` — collections and fields

**Security**
- `docs/SECURITY-DO-NOT-EXPOSE.md` — what must never be made public, and why

**Product**
- `docs/design-system.md` — colour, spacing, type, components
- `docs/notifications-plan.md` — the two notification systems and the plan
- `docs/portal-specs.md` — founder / mentor / investor / contractor specs
- `docs/certificate-verification-technical.md` — how verification works
- `docs/certificate-verification-for-students.md` — the same, in plain language

## Operational scripts

| Script | Purpose |
|---|---|
| `scripts/setup-production-env.sh` | Build a complete production `.env` on the server — generates every secret locally, so none of them ever leaves the machine |
| `scripts/generate-credentials-env.js` | Turn cleartext passwords into the bcrypt-hashed `HR_CREDENTIALS` / `COORDINATOR_CREDENTIALS` value |
| `scripts/audit-domain-tenure.js` | Find (and optionally fix) students whose domain / tenure / offer letter disagree. Dry run by default |
| `scripts/seed-dev-student.js` | Seed a local test student (development only) |
| `scripts/verify-security.sh` | Drive a running server through the security and regression checks |
| `scripts/capacity-check.js` | What the machine is, what the app uses of it, and how many interns it can carry. Read-only |
| `scripts/import-fallback-db.js` | Recover rows written to `.data/local_db/` while the database was down. Dry run by default; `--write` to apply |
| `scripts/recalculate-attendance.js` | Recompute attendance percentages after a tenure or joining-date change |
| `scripts/list-unverified-studio-access.js` | List Studio payments sitting on a transaction number nobody has checked. Read-only |
| `scripts/expand-task-tracks.js` | Grow every student's task track without lowering anyone's completion percentage. Dry run by default |

Every script that changes data is **dry run by default** and prints what it
would do. Add `--write` to apply it — except `audit-domain-tenure.js`, which
uses `--apply`. Run it without the flag first and read the output.
