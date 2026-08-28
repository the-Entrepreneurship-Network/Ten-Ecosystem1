'use strict';

/**
 * The Founder OS API.
 *
 * What a founder can actually do here, end to end:
 *
 *   · keep a startup profile
 *   · post jobs, and move applicants through a hiring pipeline
 *   · search TEN's interns and source candidates into that pipeline
 *   · run fundraising rounds with an investor tracker and a data room
 *   · keep a team roster, and hire people into it straight from the pipeline
 *   · book sessions with approved mentors
 *   · read analytics computed from all of the above
 *
 * Every route resolves the founder from the SESSION. `founderId` is never read
 * from a body, a query or a header — it is what separates one founder's deal
 * room from another's, so there is one function that produces it and no route
 * takes an alternative.
 *
 * This file replaced a two-route version (GET / and GET /stats) whose page had
 * nothing behind it: talent-network.html and founder-os.html were 2,000-line
 * near-duplicates rendering placeholder data.
 */

const express = require('express');
const path    = require('path');

const { requireRole } = require('../middleware/roleGuard');
const { ROLES }       = require('../config/roles');

const Student         = require('../models/Student');
const Payment         = require('../models/Payment');
const MentorProfile   = require('../models/MentorProfile');
const FounderProfile  = require('../models/FounderProfile');
const InvestorProfile = require('../models/InvestorProfile');
const StartupProfile  = require('../models/StartupProfile');
const EcosystemUser   = require('../models/EcosystemUser');

const {
  JobPost, JobApplication, FundraisingRound,
  DataRoomDocument, StartupTeamMember, MentorBooking,
  APPLICATION_STAGES, INVESTOR_STAGES
} = require('../models/founderOS');

const router = express.Router();

/* ── identity ────────────────────────────────────────────────────────────── */

const founderOnly = requireRole(ROLES.FOUNDER, ROLES.ADMIN);

/**
 * The founder acting on this request.
 *
 * attachEcosystemUser has already put the session's identity on req.user; this
 * turns it into the id every document in this file is scoped by. An admin
 * inspecting a founder's workspace may name one with ?founderId= — admins only,
 * and only for reads, because an admin acting AS a founder without saying so
 * would make the audit trail lie.
 */
function founderIdOf(req) {
  const u = req.user || {};
  if (u.role === ROLES.ADMIN && req.query && req.query.founderId) return req.query.founderId;
  return u._id;
}

function isAdmin(req) { return (req.user || {}).role === ROLES.ADMIN; }

/** Wrap an async handler so a rejected promise becomes a 500, not a hang. */
function h(fn) {
  return function (req, res) {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[founderOS] ' + req.method + ' ' + req.path + ':', err.stack || err.message);
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    });
  };
}

/** Keep a string inside a sane length rather than trusting the client. */
function str(v, max) { return String(v == null ? '' : v).slice(0, max || 500); }
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : (dflt || 0); }

/* ── the page ────────────────────────────────────────────────────────────── */

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'founder-os.html'));
});

/* ── who am I ────────────────────────────────────────────────────────────── */

router.get('/me', founderOnly, h(async (req, res) => {
  const id = founderIdOf(req);
  const [user, profile, startup] = await Promise.all([
    EcosystemUser.findById(id).select('fullName email role isActive createdAt').lean().catch(() => null),
    FounderProfile.findOne({ userId: id }).lean().catch(() => null),
    StartupProfile.findOne({ founderId: id }).lean().catch(() => null)
  ]);
  res.json({
    success: true,
    founder: user || { _id: id },
    profile: profile || null,
    startup: startup || null,
    isAdminView: isAdmin(req)
  });
}));

/* ── startup profile ─────────────────────────────────────────────────────── */

router.get('/profile', founderOnly, h(async (req, res) => {
  const id = founderIdOf(req);
  const [profile, startup] = await Promise.all([
    FounderProfile.findOne({ userId: id }).lean(),
    StartupProfile.findOne({ founderId: id }).lean()
  ]);
  res.json({ success: true, profile: profile || null, startup: startup || null });
}));

/**
 * Two documents, one form.
 *
 * FounderProfile and StartupProfile both already existed and both hold a
 * startup name, a description and a team size, written by different parts of
 * the app. Rather than pick a winner and break whatever reads the other, this
 * writes both from one payload and keeps them in step.
 */
router.put('/profile', founderOnly, h(async (req, res) => {
  const id = founderIdOf(req);
  const b = req.body || {};

  const founderFields = {
    startupName: str(b.startupName, 140),
    tagline:     str(b.tagline, 200),
    description: str(b.description, 5000),
    website:     str(b.website, 300),
    location:    str(b.location, 140),
    teamSize:    num(b.teamSize, 1),
    fundingAmount: num(b.fundingAmount, 0),
    pitchDeckUrl: str(b.pitchDeckUrl, 500),
    logoUrl:      str(b.logoUrl, 500),
    foundedYear:  num(b.foundedYear, 0)
  };
  if (b.founder && typeof b.founder === 'object') {
    founderFields.founder = {
      name: str(b.founder.name, 140),
      role: str(b.founder.role, 140),
      linkedinUrl: str(b.founder.linkedinUrl, 300)
    };
  }
  if (b.socials && typeof b.socials === 'object') {
    founderFields.socials = {
      twitter:  str(b.socials.twitter, 300),
      linkedin: str(b.socials.linkedin, 300),
      github:   str(b.socials.github, 300)
    };
  }

  const startupFields = {
    founderId:   id,
    startupName: founderFields.startupName || 'Untitled',
    industry:    str(b.industry, 140),
    stage:       str(b.stage, 60),
    teamSize:    founderFields.teamSize,
    website:     founderFields.website,
    linkedin:    (b.socials && str(b.socials.linkedin, 300)) || '',
    revenue:     str(b.revenue, 100),
    fundingStage:str(b.fundingStage, 100),
    description: founderFields.description,
    goals:       Array.isArray(b.goals) ? b.goals.slice(0, 12).map((g) => str(g, 200)) : undefined
  };
  Object.keys(startupFields).forEach((k) => startupFields[k] === undefined && delete startupFields[k]);

  const [profile, startup] = await Promise.all([
    FounderProfile.findOneAndUpdate({ userId: id }, { $set: founderFields },
      { new: true, upsert: true, setDefaultsOnInsert: true }).lean(),
    StartupProfile.findOneAndUpdate({ founderId: id }, { $set: startupFields },
      { new: true, upsert: true, setDefaultsOnInsert: true }).lean()
  ]);

  res.json({ success: true, profile, startup });
}));

/* ── jobs ────────────────────────────────────────────────────────────────── */

router.get('/jobs', founderOnly, h(async (req, res) => {
  const q = { founderId: founderIdOf(req) };
  if (req.query.status) q.status = String(req.query.status);
  const jobs = await JobPost.find(q).sort({ createdAt: -1 }).limit(200).lean();

  // Live per-stage counts, so a board does not need one request per column.
  const ids = jobs.map((j) => j._id);
  const counts = ids.length
    ? await JobApplication.aggregate([
        { $match: { jobId: { $in: ids } } },
        { $group: { _id: { jobId: '$jobId', stage: '$stage' }, n: { $sum: 1 } } }
      ])
    : [];
  const byJob = {};
  counts.forEach((c) => {
    const k = String(c._id.jobId);
    (byJob[k] || (byJob[k] = {}))[c._id.stage] = c.n;
  });
  jobs.forEach((j) => { j.stageCounts = byJob[String(j._id)] || {}; });

  res.json({ success: true, jobs });
}));

router.post('/jobs', founderOnly, h(async (req, res) => {
  const id = founderIdOf(req);
  const b = req.body || {};
  if (!str(b.title, 140).trim()) {
    return res.status(400).json({ success: false, error: 'A job needs a title.' });
  }
  const startup = await StartupProfile.findOne({ founderId: id }).lean().catch(() => null);

  const job = await JobPost.create({
    founderId: id,
    startupName: (startup && startup.startupName) || '',
    title: str(b.title, 140),
    description: str(b.description, 8000),
    domain: str(b.domain, 120),
    skills: Array.isArray(b.skills) ? b.skills.slice(0, 30).map((s) => str(s, 60)) : [],
    employmentType: b.employmentType || 'internship',
    workMode: b.workMode || 'remote',
    location: str(b.location, 140),
    compensationMin: num(b.compensationMin),
    compensationMax: num(b.compensationMax),
    compensationNote: str(b.compensationNote, 200),
    equityOffered: str(b.equityOffered, 100),
    openings: Math.max(1, num(b.openings, 1)),
    experienceLevel: b.experienceLevel || 'fresher',
    status: b.status === 'draft' ? 'draft' : 'open',
    closesAt: b.closesAt ? new Date(b.closesAt) : null
  });
  res.json({ success: true, job });
}));

router.put('/jobs/:id', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  const allowed = ['title', 'description', 'domain', 'employmentType', 'workMode', 'location',
    'compensationNote', 'equityOffered', 'experienceLevel', 'status'];
  const update = {};
  allowed.forEach((k) => { if (b[k] !== undefined) update[k] = str(b[k], 8000); });
  ['compensationMin', 'compensationMax', 'openings'].forEach((k) => {
    if (b[k] !== undefined) update[k] = num(b[k]);
  });
  if (Array.isArray(b.skills)) update.skills = b.skills.slice(0, 30).map((s) => str(s, 60));
  if (b.closesAt !== undefined) update.closesAt = b.closesAt ? new Date(b.closesAt) : null;

  // Scoped by founderId as well as _id: an id from another founder simply does
  // not match, so there is no "is this mine" check to forget.
  const job = await JobPost.findOneAndUpdate(
    { _id: req.params.id, founderId: founderIdOf(req) }, { $set: update }, { new: true }
  ).lean();
  if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
  res.json({ success: true, job });
}));

router.delete('/jobs/:id', founderOnly, h(async (req, res) => {
  const founderId = founderIdOf(req);
  const job = await JobPost.findOneAndDelete({ _id: req.params.id, founderId });
  if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
  await JobApplication.deleteMany({ jobId: job._id });
  res.json({ success: true });
}));

/* ── the hiring pipeline ─────────────────────────────────────────────────── */

router.get('/applications', founderOnly, h(async (req, res) => {
  const q = { founderId: founderIdOf(req) };
  if (req.query.jobId) q.jobId = req.query.jobId;
  if (req.query.stage) q.stage = String(req.query.stage);

  const applications = await JobApplication.find(q).sort({ updatedAt: -1 }).limit(500).lean();
  res.json({ success: true, applications, stages: APPLICATION_STAGES });
}));

/**
 * Move a candidate.
 *
 * The stage change is appended to `history` rather than only overwriting
 * `stage`, because "this person has been in interview for three weeks" is the
 * question a pipeline is for and a single field cannot answer it.
 */
router.post('/applications/:id/stage', founderOnly, h(async (req, res) => {
  const { stage, note } = req.body || {};
  if (!APPLICATION_STAGES.includes(stage)) {
    return res.status(400).json({ success: false, error: 'Unknown stage: ' + stage });
  }
  const app = await JobApplication.findOne({ _id: req.params.id, founderId: founderIdOf(req) });
  if (!app) return res.status(404).json({ success: false, error: 'Application not found.' });

  const from = app.stage;
  app.stage = stage;
  app.history.push({ from, to: stage, by: str((req.user || {})._id, 100), note: str(note, 500) });
  await app.save();

  // Hiring someone puts them on the team roster. Doing it by hand was the step
  // everybody forgot, which is how a team page goes stale.
  if (stage === 'hired') {
    const exists = await StartupTeamMember.findOne({ founderId: app.founderId, fromApplicationId: app._id });
    if (!exists) {
      const job = await JobPost.findById(app.jobId).lean().catch(() => null);
      await StartupTeamMember.create({
        founderId: app.founderId,
        name: app.name || 'New hire',
        email: app.email || '',
        role: (job && job.title) || '',
        type: (job && job.employmentType === 'internship') ? 'intern' : 'employee',
        fromApplicationId: app._id,
        studentId: app.studentId || null
      });
    }
  }

  res.json({ success: true, application: app.toObject() });
}));

router.put('/applications/:id', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  const update = {};
  if (b.notes !== undefined) update.notes = str(b.notes, 4000);
  if (b.rating !== undefined) update.rating = Math.max(0, Math.min(5, num(b.rating)));
  const app = await JobApplication.findOneAndUpdate(
    { _id: req.params.id, founderId: founderIdOf(req) }, { $set: update }, { new: true }
  ).lean();
  if (!app) return res.status(404).json({ success: false, error: 'Application not found.' });
  res.json({ success: true, application: app });
}));

/* ── talent search ───────────────────────────────────────────────────────── */

/**
 * Search TEN's interns.
 *
 * The projection is an allowlist, not a `.select('-password')`. A founder is an
 * outside party: they get the name, the domain, the tenure and the performance
 * signals, and never the email, the phone number, the college, the address or
 * anything that would let them contact a student outside the platform. The
 * employee ID is included because it is what a founder quotes when sourcing a
 * candidate, and it is already printed on every certificate.
 */
const TALENT_FIELDS = 'name fullName employeeId domain tenure attendancePercentage ' +
  'performanceScore internshipCompleted joiningDate skills';

router.get('/talent', founderOnly, h(async (req, res) => {
  const { domain, search, minPerformance, completedOnly, page = 1, limit = 24 } = req.query;
  const q = {};
  if (domain) q.domain = String(domain);
  if (minPerformance) q.performanceScore = { $gte: num(minPerformance) };
  if (String(completedOnly) === 'true') q.internshipCompleted = true;
  if (search) {
    const rx = new RegExp(String(search).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    q.$or = [{ name: rx }, { fullName: rx }, { employeeId: rx }, { domain: rx }];
  }

  const lim = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));
  const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim;

  const [students, total] = await Promise.all([
    Student.find(q, TALENT_FIELDS).sort({ performanceScore: -1, createdAt: -1 }).skip(skip).limit(lim).lean(),
    Student.countDocuments(q)
  ]);

  res.json({ success: true, talent: students, total, page: Number(page), limit: lim });
}));

/** Source a candidate into a job's pipeline without waiting for them to apply. */
router.post('/talent/:employeeId/source', founderOnly, h(async (req, res) => {
  const founderId = founderIdOf(req);
  const { jobId, note } = req.body || {};
  const job = await JobPost.findOne({ _id: jobId, founderId });
  if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

  const student = await Student.findOne({ employeeId: req.params.employeeId }, TALENT_FIELDS + ' email').lean();
  if (!student) return res.status(404).json({ success: false, error: 'No student with that Employee ID.' });

  const existing = await JobApplication.findOne({ jobId: job._id, studentId: student._id });
  if (existing) return res.status(409).json({ success: false, error: 'Already in this pipeline.' });

  const app = await JobApplication.create({
    jobId: job._id,
    founderId,
    studentId: student._id,
    employeeId: student.employeeId,
    name: student.name || student.fullName || '',
    email: student.email || '',
    domain: student.domain || '',
    stage: 'shortlisted',
    sourcedByFounder: true,
    notes: str(note, 2000),
    history: [{ from: '', to: 'shortlisted', by: str(founderId, 100), note: 'Sourced by founder' }]
  });
  await JobPost.updateOne({ _id: job._id }, { $inc: { applicationCount: 1 } });

  res.json({ success: true, application: app.toObject() });
}));

/* ── fundraising ─────────────────────────────────────────────────────────── */

router.get('/rounds', founderOnly, h(async (req, res) => {
  const rounds = await FundraisingRound.find({ founderId: founderIdOf(req) })
    .sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, rounds, investorStages: INVESTOR_STAGES });
}));

router.post('/rounds', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.name, 120).trim()) return res.status(400).json({ success: false, error: 'A round needs a name.' });
  const round = await FundraisingRound.create({
    founderId: founderIdOf(req),
    name: str(b.name, 120),
    stage: b.stage || 'pre_seed',
    targetAmount: num(b.targetAmount),
    valuation: num(b.valuation),
    currency: str(b.currency, 8) || 'INR',
    status: b.status || 'planning',
    notes: str(b.notes, 8000)
  });
  res.json({ success: true, round });
}));

router.put('/rounds/:id', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  const update = {};
  ['name', 'stage', 'status', 'notes', 'currency'].forEach((k) => {
    if (b[k] !== undefined) update[k] = str(b[k], 8000);
  });
  ['targetAmount', 'raisedAmount', 'valuation'].forEach((k) => {
    if (b[k] !== undefined) update[k] = num(b[k]);
  });
  if (b.status === 'closed') update.closedAt = new Date();
  const round = await FundraisingRound.findOneAndUpdate(
    { _id: req.params.id, founderId: founderIdOf(req) }, { $set: update }, { new: true }
  ).lean();
  if (!round) return res.status(404).json({ success: false, error: 'Round not found.' });
  res.json({ success: true, round });
}));

router.delete('/rounds/:id', founderOnly, h(async (req, res) => {
  const round = await FundraisingRound.findOneAndDelete({ _id: req.params.id, founderId: founderIdOf(req) });
  if (!round) return res.status(404).json({ success: false, error: 'Round not found.' });
  await DataRoomDocument.updateMany({ roundId: round._id }, { $set: { roundId: null } });
  res.json({ success: true });
}));

/** Add or update one investor conversation inside a round. */
router.post('/rounds/:id/investors', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  const round = await FundraisingRound.findOne({ _id: req.params.id, founderId: founderIdOf(req) });
  if (!round) return res.status(404).json({ success: false, error: 'Round not found.' });

  if (b.investorId) {
    const inv = round.investors.id(b.investorId);
    if (!inv) return res.status(404).json({ success: false, error: 'Investor not in this round.' });
    if (b.stage !== undefined) {
      if (!INVESTOR_STAGES.includes(b.stage)) {
        return res.status(400).json({ success: false, error: 'Unknown investor stage: ' + b.stage });
      }
      inv.stage = b.stage;
      inv.committed = b.stage === 'committed';
    }
    ['name', 'firm', 'email', 'nextStep', 'notes'].forEach((k) => {
      if (b[k] !== undefined) inv[k] = str(b[k], 2000);
    });
    if (b.checkSize !== undefined) inv.checkSize = num(b.checkSize);
    inv.lastContactAt = new Date();
  } else {
    if (!str(b.name, 140).trim() && !str(b.firm, 140).trim()) {
      return res.status(400).json({ success: false, error: 'An investor needs a name or a firm.' });
    }
    round.investors.push({
      name: str(b.name, 140), firm: str(b.firm, 140), email: str(b.email, 200),
      investorUserId: b.investorUserId || null,
      stage: INVESTOR_STAGES.includes(b.stage) ? b.stage : 'researching',
      checkSize: num(b.checkSize), nextStep: str(b.nextStep, 300), notes: str(b.notes, 2000)
    });
  }

  // Committed money is the sum of the commitments, not a number typed twice.
  round.raisedAmount = round.investors
    .filter((i) => i.committed)
    .reduce((sum, i) => sum + (Number(i.checkSize) || 0), 0);

  await round.save();
  res.json({ success: true, round: round.toObject() });
}));

router.delete('/rounds/:id/investors/:investorId', founderOnly, h(async (req, res) => {
  const round = await FundraisingRound.findOne({ _id: req.params.id, founderId: founderIdOf(req) });
  if (!round) return res.status(404).json({ success: false, error: 'Round not found.' });
  const inv = round.investors.id(req.params.investorId);
  if (inv) inv.deleteOne();
  round.raisedAmount = round.investors.filter((i) => i.committed)
    .reduce((sum, i) => sum + (Number(i.checkSize) || 0), 0);
  await round.save();
  res.json({ success: true, round: round.toObject() });
}));

/** Investors already on TEN, so a round can name a real one rather than a string. */
router.get('/investor-directory', founderOnly, h(async (req, res) => {
  const profiles = await InvestorProfile.find({ verificationStatus: 'approved' })
    .limit(100).lean().catch(() => []);
  const userIds = profiles.map((p) => p.userId).filter(Boolean);
  const users = userIds.length
    ? await EcosystemUser.find({ _id: { $in: userIds } }).select('fullName').lean().catch(() => [])
    : [];
  const nameOf = {};
  users.forEach((u) => { nameOf[String(u._id)] = u.fullName; });

  res.json({
    success: true,
    investors: profiles.map((p) => ({
      userId: p.userId,
      name: nameOf[String(p.userId)] || '',
      firm: p.firmName || p.fundName || '',
      focus: p.investmentFocus || p.sectors || [],
      ticketSize: p.ticketSize || p.checkSize || ''
    }))
  });
}));

/* ── data room ───────────────────────────────────────────────────────────── */

router.get('/dataroom', founderOnly, h(async (req, res) => {
  const q = { founderId: founderIdOf(req) };
  if (req.query.roundId) q.roundId = req.query.roundId;
  const documents = await DataRoomDocument.find(q).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, documents });
}));

router.post('/dataroom', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.title, 200).trim()) return res.status(400).json({ success: false, error: 'A document needs a title.' });
  const doc = await DataRoomDocument.create({
    founderId: founderIdOf(req),
    roundId: b.roundId || null,
    title: str(b.title, 200),
    category: b.category || 'other',
    url: str(b.url, 500),
    note: str(b.note, 2000),
    visibility: b.visibility === 'shared' ? 'shared' : 'private'
  });
  res.json({ success: true, document: doc });
}));

router.put('/dataroom/:id', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  const update = {};
  ['title', 'category', 'url', 'note'].forEach((k) => { if (b[k] !== undefined) update[k] = str(b[k], 2000); });
  if (b.visibility !== undefined) update.visibility = b.visibility === 'shared' ? 'shared' : 'private';
  if (b.roundId !== undefined) update.roundId = b.roundId || null;
  const doc = await DataRoomDocument.findOneAndUpdate(
    { _id: req.params.id, founderId: founderIdOf(req) }, { $set: update }, { new: true }
  ).lean();
  if (!doc) return res.status(404).json({ success: false, error: 'Document not found.' });
  res.json({ success: true, document: doc });
}));

router.delete('/dataroom/:id', founderOnly, h(async (req, res) => {
  const doc = await DataRoomDocument.findOneAndDelete({ _id: req.params.id, founderId: founderIdOf(req) });
  if (!doc) return res.status(404).json({ success: false, error: 'Document not found.' });
  res.json({ success: true });
}));

/* ── team ────────────────────────────────────────────────────────────────── */

router.get('/team', founderOnly, h(async (req, res) => {
  const team = await StartupTeamMember.find({ founderId: founderIdOf(req) })
    .sort({ status: 1, joinedAt: -1 }).limit(200).lean();
  const equityAllocated = team.filter((m) => m.status !== 'alumni')
    .reduce((s, m) => s + (Number(m.equity) || 0), 0);
  res.json({ success: true, team, equityAllocated });
}));

router.post('/team', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.name, 120).trim()) return res.status(400).json({ success: false, error: 'A team member needs a name.' });
  const member = await StartupTeamMember.create({
    founderId: founderIdOf(req),
    name: str(b.name, 120),
    email: str(b.email, 200).toLowerCase(),
    role: str(b.role, 120),
    type: b.type || 'employee',
    equity: Math.max(0, Math.min(100, num(b.equity))),
    status: b.status === 'invited' ? 'invited' : 'active',
    notes: str(b.notes, 2000)
  });
  res.json({ success: true, member });
}));

router.put('/team/:id', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  const update = {};
  ['name', 'email', 'role', 'type', 'status', 'notes'].forEach((k) => {
    if (b[k] !== undefined) update[k] = str(b[k], 2000);
  });
  if (b.equity !== undefined) update.equity = Math.max(0, Math.min(100, num(b.equity)));
  if (b.status === 'alumni') update.leftAt = new Date();
  const member = await StartupTeamMember.findOneAndUpdate(
    { _id: req.params.id, founderId: founderIdOf(req) }, { $set: update }, { new: true }
  ).lean();
  if (!member) return res.status(404).json({ success: false, error: 'Team member not found.' });
  res.json({ success: true, member });
}));

router.delete('/team/:id', founderOnly, h(async (req, res) => {
  const member = await StartupTeamMember.findOneAndDelete({ _id: req.params.id, founderId: founderIdOf(req) });
  if (!member) return res.status(404).json({ success: false, error: 'Team member not found.' });
  res.json({ success: true });
}));

/* ── mentors ─────────────────────────────────────────────────────────────── */

router.get('/mentors', founderOnly, h(async (req, res) => {
  const q = { verificationStatus: 'approved' };
  if (req.query.availability) q.availability = String(req.query.availability);
  const profiles = await MentorProfile.find(q).limit(100).lean();

  const userIds = profiles.map((p) => p.userId).filter(Boolean);
  const users = userIds.length
    ? await EcosystemUser.find({ _id: { $in: userIds } }).select('fullName bio').lean().catch(() => [])
    : [];
  const byId = {};
  users.forEach((u) => { byId[String(u._id)] = u; });

  res.json({
    success: true,
    mentors: profiles.map((p) => {
      const u = byId[String(p.userId)] || {};
      return {
        userId: p.userId,
        name: u.fullName || 'TEN Mentor',
        headline: p.headline || '',
        bio: p.bio || u.bio || '',
        expertise: (p.expertise || []).map((e) => e.area).filter(Boolean),
        industries: p.industries || [],
        sessionRate: p.sessionRate || 0,
        sessionType: p.sessionType || [],
        availability: p.availability || 'actively_mentoring',
        totalMentoringHours: p.totalMentoringHours || 0
      };
    })
  });
}));

router.get('/bookings', founderOnly, h(async (req, res) => {
  const bookings = await MentorBooking.find({ founderId: founderIdOf(req) })
    .sort({ requestedFor: -1 }).limit(100).lean();
  res.json({ success: true, bookings });
}));

router.post('/bookings', founderOnly, h(async (req, res) => {
  const b = req.body || {};
  if (!b.mentorId) return res.status(400).json({ success: false, error: 'Pick a mentor.' });
  if (!str(b.topic, 200).trim()) return res.status(400).json({ success: false, error: 'Say what the session is about.' });
  if (!b.requestedFor) return res.status(400).json({ success: false, error: 'Pick a date and time.' });

  const when = new Date(b.requestedFor);
  if (isNaN(when.getTime())) return res.status(400).json({ success: false, error: 'That date could not be read.' });
  if (when.getTime() < Date.now()) {
    return res.status(400).json({ success: false, error: 'That time has already passed.' });
  }

  const booking = await MentorBooking.create({
    founderId: founderIdOf(req),
    mentorId: b.mentorId,
    mentorName: str(b.mentorName, 140),
    topic: str(b.topic, 200),
    agenda: str(b.agenda, 4000),
    requestedFor: when,
    durationMins: Math.max(15, Math.min(180, num(b.durationMins, 30)))
  });

  // Tell the mentor. A booking nobody is told about is a calendar entry for one.
  try {
    const EcosystemNotification = require('../models/EcosystemNotification');
    /*
     * 'info' is not one of EcosystemNotification's types, so every one of
     * these throw ValidationError, got swallowed by the catch below, and the
     * mentor was never told about a single booking. The founder saw
     * "Request sent"; nothing had been sent.
     */
    await EcosystemNotification.create({
      userId: b.mentorId,
      type: 'mentor_request',
      title: 'New session request',
      message: `A founder has requested a ${booking.durationMins}-minute session: "${booking.topic}".`,
      link: '/mentor-dashboard.html'
    });
  } catch (err) {
    console.error('[founderOS] mentor notification failed:', err.message);
  }

  res.json({ success: true, booking });
}));

router.post('/bookings/:id/cancel', founderOnly, h(async (req, res) => {
  const booking = await MentorBooking.findOneAndUpdate(
    { _id: req.params.id, founderId: founderIdOf(req), status: { $in: ['requested', 'confirmed'] } },
    { $set: { status: 'cancelled' } }, { new: true }
  ).lean();
  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found, or already finished.' });
  res.json({ success: true, booking });
}));

/* ── analytics ───────────────────────────────────────────────────────────── */

/**
 * Everything the overview needs, in one request.
 *
 * The old /stats returned platform-wide totals — every student on TEN, all
 * revenue — under a founder's name, which told a founder nothing about their
 * own startup. These are the founder's own numbers; the platform ones are kept
 * separately under `platform` and labelled as such.
 */
router.get('/analytics', founderOnly, h(async (req, res) => {
  const founderId = founderIdOf(req);

  const [jobs, applications, rounds, team, bookings, documents] = await Promise.all([
    JobPost.find({ founderId }).lean(),
    JobApplication.find({ founderId }).select('stage createdAt jobId domain').lean(),
    FundraisingRound.find({ founderId }).lean(),
    StartupTeamMember.find({ founderId }).lean(),
    MentorBooking.find({ founderId }).select('status durationMins requestedFor').lean(),
    DataRoomDocument.find({ founderId }).select('visibility viewCount').lean()
  ]);

  const byStage = {};
  APPLICATION_STAGES.forEach((s) => { byStage[s] = 0; });
  applications.forEach((a) => { byStage[a.stage] = (byStage[a.stage] || 0) + 1; });

  const applied = applications.length;
  const hired = byStage.hired || 0;

  // Where candidates come from, so a founder can tell which domain answers.
  const byDomain = {};
  applications.forEach((a) => {
    const d = a.domain || 'Unspecified';
    byDomain[d] = (byDomain[d] || 0) + 1;
  });

  const activeRound = rounds.find((r) => r.status === 'raising') || null;
  const totalRaised = rounds.reduce((s, r) => s + (Number(r.raisedAmount) || 0), 0);
  const totalTarget = rounds.reduce((s, r) => s + (Number(r.targetAmount) || 0), 0);

  const investorFunnel = {};
  INVESTOR_STAGES.forEach((s) => { investorFunnel[s] = 0; });
  rounds.forEach((r) => (r.investors || []).forEach((i) => {
    investorFunnel[i.stage] = (investorFunnel[i.stage] || 0) + 1;
  }));

  const mentorHours = bookings
    .filter((b) => b.status === 'completed')
    .reduce((s, b) => s + (Number(b.durationMins) || 0), 0) / 60;

  res.json({
    success: true,
    hiring: {
      jobsOpen: jobs.filter((j) => j.status === 'open').length,
      jobsTotal: jobs.length,
      applications: applied,
      byStage,
      byDomain,
      hired,
      // Rounded to a whole percent: a hiring funnel with two decimal places is
      // precision the sample size does not have.
      conversionPct: applied ? Math.round((hired / applied) * 100) : 0
    },
    fundraising: {
      rounds: rounds.length,
      activeRound: activeRound ? {
        _id: activeRound._id, name: activeRound.name, stage: activeRound.stage,
        targetAmount: activeRound.targetAmount, raisedAmount: activeRound.raisedAmount,
        currency: activeRound.currency
      } : null,
      totalRaised,
      totalTarget,
      progressPct: totalTarget ? Math.round((totalRaised / totalTarget) * 100) : 0,
      investorFunnel
    },
    team: {
      total: team.filter((m) => m.status === 'active').length,
      invited: team.filter((m) => m.status === 'invited').length,
      alumni: team.filter((m) => m.status === 'alumni').length,
      equityAllocated: team.filter((m) => m.status !== 'alumni')
        .reduce((s, m) => s + (Number(m.equity) || 0), 0)
    },
    mentorship: {
      requested: bookings.filter((b) => b.status === 'requested').length,
      confirmed: bookings.filter((b) => b.status === 'confirmed').length,
      completed: bookings.filter((b) => b.status === 'completed').length,
      hours: Math.round(mentorHours * 10) / 10
    },
    dataRoom: {
      documents: documents.length,
      shared: documents.filter((d) => d.visibility === 'shared').length,
      views: documents.reduce((s, d) => s + (Number(d.viewCount) || 0), 0)
    }
  });
}));

/**
 * Platform-wide numbers.
 *
 * Kept because the old page rendered them and removing them would blank a card
 * somebody is used to — but they are now clearly the PLATFORM's figures, not
 * the founder's, which is how they were presented before.
 */
router.get('/stats', founderOnly, h(async (req, res) => {
  const [internships, mentors, applications, revenueResult] = await Promise.all([
    Student.countDocuments(),
    MentorProfile.countDocuments({ verificationStatus: 'approved' }),
    Promise.all([
      FounderProfile.countDocuments({ verificationStatus: 'pending' }),
      MentorProfile.countDocuments({ verificationStatus: 'pending' }),
      InvestorProfile.countDocuments({ verificationStatus: 'pending' })
    ]).then(([f, m, i]) => f + m + i),
    Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);

  const revenue = revenueResult && revenueResult[0] ? Math.round(revenueResult[0].total) : 0;
  res.json({ success: true, internships, revenue, mentors, applications });
}));

module.exports = router;
