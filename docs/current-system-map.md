# Current System Map

## Project Name
**TEN Internship Management System** (InternshipManagementSystem-Final)

## Tech Stack
| Layer | Technology |
|-------|------------|
| Runtime | Node.js (v18+) |
| Framework | Express.js v5.2.1 |
| Database | MongoDB (via Mongoose v6.13.8) |
| Auth | Session-based (bcrypt password hashing) |
| Realtime | Socket.io |
| PDF | pdfkit |
| Email | Nodemailer |
| Payments | Razorpay (existing) |
| QR Codes | qrcode |
| Security | helmet, express-rate-limit |
| File Upload | multer |

## Entry Point
`server.js` — monolithic file, ~4500 lines.

## Port
`process.env.PORT` or **5000** (default)

## Database
MongoDB Atlas — connection string from `process.env.MONGODB_URI`

## Environment Variables
| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | MongoDB connection string |
| `PORT` | Server port |
| `EMAIL_USER` | SMTP email address |
| `EMAIL_PASS` | SMTP email password |
| `GITHUB_TOKEN` | GitHub API token (internal use) |
| `GITHUB_REPO_OWNER` | Repo owner |
| `GITHUB_REPO_NAME` | Repo name |

## Description
A full-stack internship management platform that handles:
- Student onboarding, task submissions, attendance, certificates
- HR management of intern cohorts with domain-based tracking
- Coordinator oversight and performance reviews
- AI-powered task & query bots (Gemini 2.0 Flash)
- Real-time chat via Socket.io
- Payment processing via Razorpay
- Automated email notifications and document verification
- Leaderboards, badges, and gamification

## Static Assets
Served from `public/` directory at route `/`.
Uploads served from `uploads/` at `/uploads`.
