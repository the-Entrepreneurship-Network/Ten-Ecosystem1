# TEN Ecosystem — working rules

Read this before proposing or building anything.

---

## 1. The money rule

**Total hosting cost must stay under ₹3,000 per month, including GST.**

This is a hard ceiling set by the owner, not a target to aim near. It covers
everything the company pays to keep the portal running: AWS, any other cloud,
any paid SaaS the app depends on.

**Before building or proposing anything that adds a recurring cost, say what it
costs first, and wait.** Not after the work. Not in a footnote. The owner
decides whether it is worth it — the job here is to put an honest number in
front of them while the decision is still cheap to change.

That means, for every proposal:

| Say this | Example |
|---|---|
| What it costs per month | "n8n Cloud is about ₹2,200/month" |
| What the free option is | "or ₹0 on a Google/Oracle free-tier box" |
| What it does to the ceiling | "this takes us to ₹5,200 — over the limit" |
| The cheaper way to get the same result | "`services/automationCron.js` already does this" |

If something cannot be done inside ₹3,000, **say so plainly and offer the
nearest thing that can be.** Do not quietly build it and let the bill arrive.

One-off costs (a security audit, a legal opinion, a paid font) follow the same
rule — state the number before starting.

### Current baseline

Roughly, at Mumbai list prices, ~₹85/USD. Verify against the real bill; these
are estimates, not invoices.

| Item | Now | After the planned fixes |
|---|---|---|
| EC2 `t3.medium` (2 vCPU, 4 GB) | ~₹2,580 | ~₹1,420 with a 3-year Savings Plan |
| 50 GB disk | ~₹485 on gp2 | ~₹385 on gp3 |
| 1 Elastic IP | ~₹310 | ~₹310 |
| **Subtotal** | **~₹3,375** | **~₹2,115** |
| With 18% GST | ~₹3,985 | **~₹2,495** |

The account has been billing about **₹7,500/month**, so roughly **₹3,500 of it
is something other than this server** — most likely a NAT Gateway (~₹3,400),
an idle load balancer, orphaned disks or snapshots, or a forgotten instance in
another region. Find and remove that before anything else; no amount of tuning
this server closes a gap that size.

### What is free, and what is not

- **Free and fine to use:** Cloudflare Pages and R2 (static files, video —
  zero egress charge), Google Cloud free tier (`e2-micro`, US regions only),
  Oracle Cloud free tier (Mumbai, generous), Cloud Run and Cloudflare Workers
  (scale to zero), Amazon SES (~₹8 per 1,000 mails).
- **Not free:** Vercel's Hobby plan is **non-commercial only**. TEN sells the
  Career Studio, so commercial use needs Vercel Pro at ~₹1,700/month/user.
  Cloudflare Pages does the same job free.
- **Serverless cannot host everything.** The portal uses `socket.io`, which
  needs a connection held open. Vercel and other serverless platforms drop
  those. Chat and live notifications must stay on a real server.

---

## 2. Do not break what works

Every change must leave the existing features working — logins, chat,
notifications, payments, certificates, the links between the portals. The owner
has said this repeatedly and it outranks elegance, tidiness and cost saving.

In practice:

- **Grep for callers before changing or deleting anything.** A route with no
  caller can be deleted; a route with one caller must keep answering at the
  same URL.
- **`routes/v2/certificates.js` is mounted twice**, at `/api/v2` and at
  `/api/v2/certificates`. A change there lands at two URLs. Test both.
- **Models live in two directories:** `models/` and `models/new/`. A script
  that only scans one will silently skip collections — this has already cost
  260 rows of student task history once.
- Prefer the shortest change that fixes the root cause over a clever rewrite.

---

## 3. Reuse before building

Several things that sound like new projects already exist here. Check this list
before quoting a cost for them.

| If asked for | It already exists as |
|---|---|
| Messaging / chat server | `socket.io` + `models/Message.js`, `ChatRead`, `ChatReport` |
| Mailing / campaign tooling | `utils/mailer.js`, `services/notificationEmail.js`, `models/MailHistory.js`, `models/StudioLead.js`, SES configured |
| Scheduled automation | `services/automationCron.js` |
| A points / rewards token | `StudentCoin`, `CoinRedemption` — run a DAO on these before paying for a blockchain |
| Capacity and load figures | `scripts/capacity-check.js` |
| Server health and self-healing | `services/dbHealth.js`, `scripts/server/harden-mongod.sh`, `scripts/server/watchdog.sh` |

Building a second copy of any of these costs money **and** splits the data.

---

## 4. Secrets

Everything secret — passwords, API keys, connection strings — comes from `.env`
on the server. Never hardcode one, never commit one, never paste one into chat
or a PR description. `scripts/setup-production-env.sh` generates them on the
box.

---

## 5. Delivery

Work goes on a branch and is delivered as a pull request. The owner merges.
Never push straight to `main`.
