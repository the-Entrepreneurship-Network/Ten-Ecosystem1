'use strict';

const mongoose = require('mongoose');

/*
 * One row per post the LinkedIn agent has drafted for the company page.
 *
 * Two texts live side by side on purpose. `draft` is what a staff member
 * typed; `final` is the version the agent reviewed and rewrote, and it is the
 * ONLY text that is ever sent to LinkedIn. Keeping the original next to it is
 * what lets the history view explain "this is what you wrote, this is what
 * went out and why" — and it is what stops a later "post my original" from
 * quietly bypassing the content guard, because the publish path never reads
 * `draft` at all.
 *
 * `poster.svg` is the brand poster as generated on the server; `poster.png`
 * is the same poster rasterised by the browser (base64) and is only present
 * once someone has clicked Post or Schedule. The scheduler cannot rasterise
 * (no canvas on the server), so a scheduled post carries its own PNG or goes
 * out text-only. `poster.svg` can be a few hundred KB because the TEN mark is
 * embedded as a data URI — that is deliberate, an <img> rasterised through a
 * canvas is not allowed to fetch external hrefs.
 *
 * `status` is the scheduler's contract. The tick moves 'scheduled' to
 * 'publishing' with a single findOneAndUpdate so two PM2 workers cannot both
 * pick up the same post; see services/v2/linkedin/scheduler.js.
 */

const KINDS = ['opening', 'placement', 'leadgen', 'general'];
const STATUSES = ['draft', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'rejected'];
const VERDICTS = ['ok', 'revise', 'block'];

const issueSchema = new mongoose.Schema({
  code: { type: String, default: '' },
  severity: { type: String, default: '' },
  excerpt: { type: String, default: '' },
  message: { type: String, default: '' },
  fix: { type: String, default: '' },
}, { _id: false });

const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: String, default: '' },
  action: { type: String, default: '' },
  note: { type: String, default: '' },
}, { _id: false });

const linkedInPostSchema = new mongoose.Schema({
  kind: { type: String, enum: KINDS, default: 'general' },
  draft: { type: String, default: '' },
  final: { type: String, default: '' },
  issues: { type: [issueSchema], default: [] },
  verdict: { type: String, enum: VERDICTS, default: 'ok' },

  poster: {
    template: { type: String, default: '' },
    fields: { type: mongoose.Schema.Types.Mixed, default: {} },
    svg: { type: String, default: '' },
    /* Base64 PNG rasterised in the browser; only present after Post/Schedule. */
    png: { type: String, default: '' },
    withImage: { type: Boolean, default: true },
  },

  status: { type: String, enum: STATUSES, default: 'draft' },
  scheduledFor: { type: Date },
  publishedAt: { type: Date },

  linkedin: {
    postUrn: { type: String, default: '' },
    imageUrn: { type: String, default: '' },
    url: { type: String, default: '' },
  },

  /* True when the server had no LinkedIn token and "published" means "the
     payload was built and saved but nothing was sent". The UI shows it as a
     badge so nobody believes a dry run reached the feed. */
  dryRun: { type: Boolean, default: false },

  author: {
    role: { type: String, default: '' },
    id: { type: String, default: '' },
    name: { type: String, default: '' },
  },

  history: { type: [historySchema], default: [] },
  error: { type: String, default: '' },
}, { timestamps: true });

/* The scheduler's query and the history list, respectively. */
linkedInPostSchema.index({ status: 1, scheduledFor: 1 });
linkedInPostSchema.index({ createdAt: -1 });

const LinkedInPost = mongoose.model('LinkedInPost', linkedInPostSchema);
LinkedInPost.KINDS = KINDS;
LinkedInPost.STATUSES = STATUSES;
LinkedInPost.VERDICTS = VERDICTS;
module.exports = LinkedInPost;
