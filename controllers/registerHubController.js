'use strict';

/**
 * @fileoverview Multi-role registration hub controller.
 * Routes new signups to appropriate existing flows.
 * Does NOT break or bypass the existing /register endpoint.
 */

const path          = require('path');
const bcrypt        = require('bcryptjs');
const EcosystemUser = require('../models/EcosystemUser');
const Student       = require('../models/Student');
const HR            = require('../models/HR');
const Coordinator   = require('../models/Coordinator');
const TalentProfile = require('../models/TalentProfile');

// New profile models
const StudentProfile     = require('../models/StudentProfile');
const FounderProfile     = require('../models/FounderProfile');
const MentorProfile      = require('../models/MentorProfile');
const InvestorProfile     = require('../models/InvestorProfile');
const ContractorProfile   = require('../models/ContractorProfile');
const StartupProfile      = require('../models/StartupProfile');
const CommunityProfile    = require('../models/CommunityProfile');

const MailHistory   = require('../models/MailHistory');
const {
  createEmailTransporter, mailerReady, isSendableAddress,
  renderEmail, escapeHtml, PORTAL_URL, EMAIL_FROM
} = require('../utils/mailer');
const { getFeeFor } = require('../config/tenurePayment');

const { ALL_ROLES, ROLES } = require('../config/roles');

/**
 * Welcome the person who just signed up here.
 *
 * public/register.html posts to /api/register-hub/register, which is this
 * controller — NOT the /register route in server.js. That route has sent a
 * welcome email all along; this one never has. So every account created
 * through the live form was made in silence: no email, no MailHistory row, no
 * log line, nothing to notice. 790 students registered that way.
 *
 * Not the same letter as server.js sends. That one exists to deliver a
 * generated password, because that flow invents one. Here the person chose
 * their own password and typed it twice — mailing it back to them would be
 * handing out a credential over plain SMTP for no reason. This confirms the
 * account and points at the door.
 *
 * Never throws. An account that was created successfully must not be reported
 * as failed because the confirmation could not be sent.
 */
/*
 * The door that belongs to each role.
 *
 * Every welcome mail used to send every role to /student-login — so a founder,
 * mentor, investor or contractor was mailed a link to a sign-in form that is
 * not theirs, on the one message they are most likely to click. Coordinators
 * sign in at the .html page: GET /coordinator-login is a 404.
 */
const DOOR = {
  founder:     ['Sign in to the Founder OS',      '/founder-login'],
  investor:    ['Sign in to the Deal Room',       '/investor-login'],
  contractor:  ['Sign in to the Contractor Desk', '/contractor-login'],
  mentor:      ['Sign in to the portal',          '/login.html?role=mentor'],
  coordinator: ['Sign in to the portal',          '/coordinator-login.html']
};
const doorFor = (role) => DOOR[role] || ['Sign in to the portal', '/student-login'];

/* What each role is there to do — only theirs, never another role's. */
const RESPONSIBILITIES = {
  student: [
    'Mark attendance every working day, Monday to Saturday: fill in the TEN attendance form first, then press the attendance button on your dashboard.',
    'Every week, watch the video, do the task, submit it and take the quiz. The next week opens once this week is approved.',
    'Keep your attendance at 75% or more: the Letter of Completion needs it.',
    'Upload your documents (address proof and marksheet) so your offer letter can be issued.',
    'Ask questions in your domain chat. Keep the working groups free of spam; send complaints to complaints@entrepreneurshipnetwork.net.'
  ],
  coordinator: [
    'Mark and check attendance for the students in your domain.',
    'Review and grade the tasks they submit, and approve or revoke their certificates.',
    'Set your domain test and coding problems, and keep the task list and notice board up to date.',
    'Handle mentor bookings: check the payment reference, then choose a mentor and a time.',
    'Answer your students in the domain chat room.'
  ],
  founder: [
    'Keep your startup profile accurate: investors and interns judge you by it.',
    'Post your roles and move candidates through your hiring pipeline.',
    'Track your fundraising round and answer investors from your inbound list.',
    'Book a mentor when you need advice.'
  ],
  investor: [
    'Keep your investor profile current: founders decide whom to talk to from it.',
    'Browse the startups raising now and register your interest with a short note.',
    'Follow up on founders’ answers and keep your holdings up to date.'
  ],
  mentor: [
    'Keep your profile and expertise current: students and founders choose you from it.',
    'Run the sessions assigned to you on time, and mark each one complete.'
  ],
  contractor: [
    'Work on the projects HR assigns to you.',
    'Log your milestones and timesheets as you go; HR approves each entry.',
    'Keep your profile and availability current.'
  ]
};

/** "Your responsibilities" as an HTML list, or '' for a role without one. */
function responsibilitiesHtml(role) {
  const items = RESPONSIBILITIES[role];
  if (!items) return '';
  return '<p style="margin-top:14px;"><b>Your responsibilities</b></p>'
    + '<ul style="margin:6px 0 0;padding-left:20px;">'
    + items.map((item) => `<li style="margin-top:4px;">${escapeHtml(item)}</li>`).join('')
    + '</ul>';
}

function responsibilitiesText(role) {
  const items = RESPONSIBILITIES[role];
  return items ? `\nYour responsibilities:\n${items.map((item) => `- ${item}`).join('\n')}\n` : '';
}

/** A student's plan, and whether a fee stands between them and week one. */
function planFor(tenure) {
  if (!tenure) return null;
  const fee = getFeeFor({ tenure });
  return fee.required
    ? { label: `${fee.label} (fast-track)`, line: `Your plan is ${fee.label} on the fast-track. Pay the ₹${fee.amount.toLocaleString('en-IN')} fee by UPI on your dashboard to start week one.` }
    : { label: `${fee.label} (free)`, line: `Your plan is ${fee.label}, free of charge. You can start right away.` };
}

async function sendRegistrationWelcome({ name, email, role, memberId, employeeId, domain, studentId, tenure }) {
  const subject = 'Welcome to The Entrepreneurship Network';
  let status = 'sent';
  let errorMessage = '';
  try {
    if (!mailerReady()) {
      status = 'failed';
      errorMessage = 'Email not configured';
      console.warn(`[Email] \u2717 Welcome mail to ${email} skipped \u2014 SMTP not configured`);
    } else if (!isSendableAddress(email)) {
      status = 'failed';
      errorMessage = 'No usable recipient address';
      console.warn(`[Email] \u2717 Welcome mail skipped \u2014 unusable address: ${email}`);
    } else {
      const plan = role === 'student' ? planFor(tenure) : null;
      const rows = [];
      if (employeeId) rows.push(`<div><b>Employee ID:</b> ${escapeHtml(employeeId)}</div>`);
      if (domain)     rows.push(`<div><b>Domain:</b> ${escapeHtml(domain)}</div>`);
      if (plan)       rows.push(`<div><b>Plan:</b> ${escapeHtml(plan.label)}</div>`);
      if (memberId)   rows.push(`<div><b>Member ID:</b> ${escapeHtml(memberId)}</div>`);
      rows.push(`<div><b>Email:</b> ${escapeHtml(email)}</div>`);

      const [ctaLabel, ctaPath] = doorFor(role);
      const REVIEWED = ['founder', 'investor', 'contractor', 'mentor'].includes(role);

      await createEmailTransporter().sendMail({
        from: EMAIL_FROM,
        to: email,
        subject,
        html: renderEmail({
          heading: REVIEWED ? 'Your application is in' : 'Your account is ready',
          name,
          bodyHtml: `<p>Welcome to The Entrepreneurship Network. Your ${escapeHtml(role)}
                     account has been created.</p>`
                   + (plan ? `<p style="margin-top:10px;">${escapeHtml(plan.line)}</p>` : '')
                   + (REVIEWED
                       ? `<p style="margin-top:10px;">Our team reviews ${escapeHtml(role)} accounts before
                          they open — usually within a day. You will get a second email the moment yours is
                          approved, and that is when the button below starts working.</p>`
                       : `<p style="margin-top:10px;">You can sign in now with this email address and the
                          password you chose.</p>`)
                   + responsibilitiesHtml(role),
          panel: rows.join(''),
          cta: { label: ctaLabel, url: `${PORTAL_URL}${ctaPath}` },
          note: memberId ? 'Keep this email — your member ID is the quickest way for us to find your account.' : ''
        }),
        text: `Welcome to The Entrepreneurship Network.\n\n`
            + (employeeId ? `Employee ID: ${employeeId}\n` : '')
            + (domain ? `Domain: ${domain}\n` : '')
            + (plan ? `${plan.line}\n` : '')
            + (REVIEWED
                ? `\nOur team reviews ${role} accounts before they open. You will be emailed when yours is approved.\n`
                : `\nSign in with this email address and the password you chose:\n`)
            + `${PORTAL_URL}${ctaPath}\n`
            + responsibilitiesText(role)
      });
      console.log(`[Email] \u2713 Welcome mail sent to ${email}`);
    }
  } catch (err) {
    status = 'failed';
    errorMessage = (err && err.message) || 'unknown';
    console.error(`[Email] \u2717 Welcome mail to ${email} failed: ${errorMessage}`);
  }

  // Recorded either way, so scripts/check-mail-health.js can see this path at
  // all. Its absence is why nobody knew it was silent.
  try {
    await MailHistory.create({
      recipientEmail: email, recipientName: name || '', studentId: studentId || null,
      subject, mailType: 'welcome', sentAt: new Date(), status, errorMessage
    });
  } catch (_) { /* the mail matters more than the record of it */ }
}

/**
 * HR's answer to a founder, investor, mentor or contractor.
 *
 * The welcome mail promises "a second email the moment yours is approved",
 * but HR's approve and reject buttons sent nothing at all, so people found out
 * only by trying to sign in. Never throws: HR's decision is saved whether or
 * not the mail goes.
 */
async function sendPartnerDecision({ name, email, role, approved }) {
  const subject = approved ? 'Your TEN account is approved' : 'Your TEN application';
  let status = 'sent';
  let errorMessage = '';
  try {
    if (!mailerReady()) {
      status = 'failed';
      errorMessage = 'Email not configured';
    } else if (!isSendableAddress(email)) {
      status = 'failed';
      errorMessage = 'No usable recipient address';
    } else {
      const [ctaLabel, ctaPath] = doorFor(role);
      await createEmailTransporter().sendMail({
        from: EMAIL_FROM,
        to: email,
        subject,
        html: renderEmail({
          heading: approved ? 'Your account is approved' : 'Your application was not approved',
          name,
          bodyHtml: approved
            ? `<p>Good news: our team has approved your ${escapeHtml(role)} account. You can sign in now.</p>`
              + responsibilitiesHtml(role)
            : `<p>Our team has reviewed your ${escapeHtml(role)} application and could not approve it this time.</p>
               <p style="margin-top:10px;">If you think this is a mistake, write to
               <a href="mailto:complaints@entrepreneurshipnetwork.net" style="color:#f5c542;">complaints@entrepreneurshipnetwork.net</a>.</p>`,
          cta: approved ? { label: ctaLabel, url: `${PORTAL_URL}${ctaPath}` } : null,
          footerWhy: `You are receiving this because you applied for a ${role} account with TEN.`
        }),
        text: approved
          ? `Our team has approved your ${role} account. Sign in: ${PORTAL_URL}${ctaPath}\n` + responsibilitiesText(role)
          : `Our team reviewed your ${role} application and could not approve it this time. `
            + 'If you think this is a mistake, write to complaints@entrepreneurshipnetwork.net.\n'
      });
    }
  } catch (err) {
    status = 'failed';
    errorMessage = (err && err.message) || 'unknown';
    console.error(`[Email] ✗ Decision mail to ${email} failed: ${errorMessage}`);
  }
  try {
    await MailHistory.create({
      recipientEmail: email, recipientName: name || '', subject,
      mailType: approved ? 'partner_approved' : 'partner_rejected', sentAt: new Date(), status, errorMessage
    });
  } catch (_) { /* the mail matters more than the record of it */ }
}

const SALT_ROUNDS     = 10;
const ECOSYSTEM_ROLES = [ROLES.FOUNDER, ROLES.MENTOR, ROLES.INVESTOR, ROLES.CONTRACTOR, ROLES.STUDENT];

const ROLE_CONFIG = [
  {
    id: ROLES.STUDENT, label: 'Student',
    description: 'Join as an intern and kickstart your career', icon: '🎓',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'country', type: 'text', label: 'Country', placeholder: 'Your country', required: true },
      // NOT required: public/register.html has no State input at all, so this
      // value is never sent. Enforcing it would reject every single student
      // registration. Add the field to the form first if it is wanted.
      { name: 'state', type: 'text', label: 'State', placeholder: 'Your state', required: false },
      { name: 'city', type: 'text', label: 'City', placeholder: 'Your city', required: true },
      { name: 'university', type: 'text', label: 'University / College', placeholder: 'Your university', required: true },
      { name: 'degree', type: 'text', label: 'Degree', placeholder: 'e.g. B.Tech Computer Science', required: true },
      { name: 'graduationYear', type: 'number', label: 'Graduation Year', placeholder: 'e.g. 2026', required: true },
      // A résumé is uploaded, not typed, so the generic "Please enter your…"
      // sentence would point at the wrong control.
      { name: 'resume', type: 'text', label: 'Resume', placeholder: 'Link to your resume', required: true,
        requiredMessage: 'Please upload your resume as a PDF.' },

      // Skills, LinkedIn and portfolio are OPTIONAL, deliberately.
      //
      // A first-year student with no portfolio and no LinkedIn profile is
      // exactly who this internship exists to train — refusing their
      // registration over three blank boxes turns away the applicants the
      // programme is for. Everything that identifies a student or places them
      // in a cohort (name, email, mobile, location, college, degree, graduation
      // year, résumé, domain, tenure) stays required, because the portal cannot
      // run without it.
      //
      // The `skills` label carries no "(comma-separated)" suffix: a label is the
      // field's name, and it ends up in error messages. The hint belongs in the
      // placeholder, where it is.
      { name: 'skills', type: 'text', label: 'Skills', placeholder: 'e.g. HTML, CSS, React', required: false },
      { name: 'linkedin', type: 'url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/...', required: false },
      { name: 'portfolio', type: 'url', label: 'Portfolio URL', placeholder: 'https://...', required: false },
    ],
  },
  {
    id: ROLES.FOUNDER, label: 'Founder',
    description: 'Run your venture and hire top talent', icon: '🚀',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'startupName', type: 'text', label: 'Startup Name', placeholder: 'Your startup name', required: true },
      { name: 'industry', type: 'text', label: 'Industry', placeholder: 'e.g. FinTech, EdTech', required: true },
      { name: 'stage', type: 'select', label: 'Startup Stage', options: ['Idea', 'Validation', 'MVP', 'Early Revenue', 'Growth', 'Scaling'], required: true },
      { name: 'teamSize', type: 'number', label: 'Team Size', placeholder: 'e.g. 5', required: true },
      { name: 'website', type: 'url', label: 'Website', placeholder: 'https://...', required: false },
      { name: 'linkedin', type: 'url', label: 'LinkedIn', placeholder: 'Startup LinkedIn URL', required: false },
      { name: 'revenue', type: 'text', label: 'Monthly Revenue (₹)', placeholder: 'e.g. ₹50,000 or N/A', required: false },
      { name: 'fundingStage', type: 'select', label: 'Funding Stage', options: ['Bootstrapped', 'Pre-seed', 'Seed', 'Series A', 'Series B', 'Profitable'], required: true },
      { name: 'description', type: 'text', label: 'Startup Description', placeholder: 'Brief description of your startup', required: true },
      { name: 'goals', type: 'text', label: 'Founder Goals (comma-separated)', placeholder: 'e.g. Hire Talent, Build MVP, Raise Funding', required: true }
    ],
  },
  {
    id: ROLES.MENTOR, label: 'Mentor',
    description: 'Guide founders and students with your expertise', icon: '🧑‍🏫',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'company', type: 'text', label: 'Company', placeholder: 'Your active company', required: true },
      { name: 'designation', type: 'text', label: 'Designation', placeholder: 'Your title / role', required: true },
      { name: 'experience', type: 'number', label: 'Years of Experience', placeholder: 'e.g. 8', required: true },
      { name: 'linkedin', type: 'url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/...', required: true },
      { name: 'expertiseAreas', type: 'text', label: 'Expertise Areas (comma-separated)', placeholder: 'e.g. Sales, Product Management, Coding', required: true }
    ],
  },
  {
    id: ROLES.INVESTOR, label: 'Investor',
    description: 'Discover and invest in promising startups', icon: '💰',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'firmName', type: 'text', label: 'Firm Name / Individual', placeholder: 'Your firm name', required: true },
      { name: 'fundSize', type: 'text', label: 'Fund Size (₹)', placeholder: 'e.g. ₹5 Crore or N/A', required: true },
      { name: 'investmentStage', type: 'select', label: 'Investment Stage Preference', options: ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Growth'], required: true },
      { name: 'industryFocus', type: 'text', label: 'Industry Focus (comma-separated)', placeholder: 'e.g. SaaS, FinTech, AI', required: true },
      { name: 'website', type: 'url', label: 'Website', placeholder: 'https://...', required: false }
    ],
  },
  {
    id: ROLES.CONTRACTOR, label: 'Contractor',
    description: 'Offer your skills as a freelance contractor', icon: '🔧',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'skills', type: 'text', label: 'Skills (comma-separated)', placeholder: 'e.g. React, Node, Web3', required: true },
      { name: 'experience', type: 'text', label: 'Experience Details', placeholder: 'e.g. 4 years freelancing', required: true },
      { name: 'portfolio', type: 'url', label: 'Portfolio URL', placeholder: 'https://...', required: false },
      { name: 'hourlyRate', type: 'number', label: 'Hourly Rate (₹)', placeholder: 'e.g. 1200', required: true },
      { name: 'availability', type: 'select', label: 'Availability', options: ['Immediately', 'In 2 weeks', 'In 1 month'], required: true }
    ],
  },
  {
    id: ROLES.HR, label: 'HR',
    description: 'Manage internship programs for your company', icon: '💼',
    fields: [
      { name: 'company',     type: 'text', label: 'Company Name', placeholder: 'Your company',                 required: true },
      { name: 'designation', type: 'text', label: 'Designation',  placeholder: 'Job title',                   required: false },
      { name: 'linkedinUrl', type: 'url',  label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/...', required: false },
    ],
  },
  {
    id: ROLES.COORDINATOR, label: 'Coordinator',
    description: 'Coordinate interns across your department', icon: '🗂️',
    fields: [
      { name: 'department',  type: 'text', label: 'Department',  placeholder: 'Your department', required: true },
      { name: 'institution', type: 'text', label: 'Institution', placeholder: 'Your institution', required: false },
    ],
  },
];

function getHub(req, res) {
  return res.sendFile(path.join(__dirname, '..', 'public', 'register-hub.html'));
}

function getRoleConfig(req, res) {
  return res.status(200).json({ success: true, roles: ROLE_CONFIG });
}

// Helper to generate legacy Employee ID
// Shared with server.js — see utils/employeeId.js.
const { generateEmployeeId } = require('../utils/employeeId');
const { normalizeDomain } = require('../config/domains');
const { isValidTenure, getTenureLabel } = require('../utils/tenure');
const { findStudentByEmail } = require('../services/loginIdentity');
const { cleanSignupRef } = require('../utils/signupRef');

/**
 * Parse the domain selection, which the form sends as a comma-joined string.
 * Returns canonical names, or a list of the values it could not recognise.
 */
function parseDomainSelection(raw) {
  let values = [];
  if (typeof raw === 'string') {
    values = raw.split(',').map((d) => d.trim()).filter(Boolean);
  } else if (Array.isArray(raw)) {
    // The old code only handled the string case, so an array body silently
    // fell through to the "Web Development" default.
    values = raw.map((d) => String(d).trim()).filter(Boolean);
  }

  const domains = [];
  const unknown = [];
  for (const value of values) {
    const canonical = normalizeDomain(value);
    if (canonical) {
      if (!domains.includes(canonical)) domains.push(canonical);
    } else {
      unknown.push(value);
    }
  }
  return { domains, unknown };
}

/**
 * A message a student can act on, in the words the form uses.
 *
 * "Skills (comma-separated) is required." reads like a database complaint: it
 * repeats a formatting hint the student cannot do anything about, and never
 * says what to do. Parenthetical hints are dropped, and the sentence tells them
 * the action — select for a dropdown, enter for anything they type.
 */
function requiredFieldMessage(field) {
  if (field.requiredMessage) return field.requiredMessage;

  const name = String(field.label || field.name)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .trim()
    .split(/\s+/)
    // Mid-sentence, "Please enter your Graduation Year." reads like a form
    // label pasted into a sentence. Lower-case each word unless it is an
    // acronym (URL) or carries an internal capital (LinkedIn) — those are
    // spelled that way on purpose.
    .map((word) => {
      const isAcronym = word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
      const hasInnerCapital = /[A-Z]/.test(word.slice(1));
      return isAcronym || hasInnerCapital ? word : word.toLowerCase();
    })
    .join(' ');

  const verb = field.type === 'select' ? 'select' : 'enter';
  return `Please ${verb} your ${name}.`;
}

async function registerUser(req, res) {
  // What this request created, so a failure part way can be undone (see the catch).
  let createdUserId = null;
  let createdStudentId = null;
  try {
    const { fullName, email, password, role, roleSpecificData = {} } = req.body;
    const name = fullName || req.body.name;

    // Collect EVERY failing field before answering, so the form can show a
    // message under each one rather than a single generic alert. Registration
    // previously returned on the first failure, and skipped `domain` entirely —
    // an unset domain silently became "Web Development" and the account was
    // created anyway.
    const errors = {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      errors.fullName = 'Please enter your full name (at least 2 characters).';
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    }
    if (req.body.confirmPassword && req.body.confirmPassword !== password) {
      return res.status(400).json({ success: false, error: 'Password and Confirm Password do not match.' });
    }
    if (!role || !ALL_ROLES.includes(role)) {
      errors.role = 'Please choose what you are registering as.';
    }

    // Student-specific required fields.
    let studentDomains = [];
    if (role === ROLES.STUDENT) {
      const { domains, unknown } = parseDomainSelection(roleSpecificData.domains);
      studentDomains = domains;

      if (unknown.length) {
        errors.domains = `We do not recognise: ${unknown.join(', ')}. Please pick from the list.`;
      } else if (domains.length === 0) {
        errors.domains = 'Please select your internship domain.';
      } else if (domains.length > 2) {
        errors.domains = 'You can select at most 2 domains.';
      }

      if (!roleSpecificData.tenure) {
        errors.tenure = 'Please select your internship tenure.';
      } else if (!isValidTenure(roleSpecificData.tenure)) {
        errors.tenure = 'Please select a valid internship tenure.';
      }

      // Every field the student form marks with an asterisk, enforced here too.
      //
      // The browser's `required` attribute is a convenience, not a control:
      // this endpoint takes JSON, so a request built by hand — or by a script —
      // never sees the form at all. Only country, city, university, degree,
      // graduation year and skills carried `required`; résumé, LinkedIn and
      // portfolio were optional on both sides, and the hidden résumé input
      // could not carry `required` even in the browser, so its asterisk
      // enforced nothing anywhere.
      //
      // Driven from the field spec above so the two cannot drift apart. Scoped
      // to students on purpose: the founder, mentor, investor and contractor
      // forms have not been checked field-by-field against their specs, and
      // enforcing an unsent field would lock those roles out of registering —
      // which is exactly what `state` would have done here.
      const studentFields = (ROLE_CONFIG.find((r) => r.id === ROLES.STUDENT) || {}).fields || [];
      for (const field of studentFields) {
        if (!field.required || errors[field.name]) continue;

        const value = roleSpecificData[field.name];
        const missing =
          value === undefined ||
          value === null ||
          (typeof value === 'string' && value.trim() === '') ||
          // Number('') is 0 and Number.isFinite(0) is true, so an empty
          // graduation year would otherwise pass as a valid number.
          (field.type === 'number' && !(Number(value) > 0));

        if (missing) errors[field.name] = requiredFieldMessage(field);
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        errors,
        // Kept so older clients that only read `error` still show something.
        error: Object.values(errors)[0]
      });
    }

    // Role specific mandatory field validations for Student
    if (role === ROLES.STUDENT) {
      const mobile = roleSpecificData.mobile || req.body.mobile;
      if (!mobile || !/^\+?[0-9]{10,15}$/.test(mobile.replace(/[\s-]/g, ''))) {
        return res.status(400).json({ success: false, error: 'Valid 10+ digit mobile number is required.' });
      }
      if (!roleSpecificData.country || !roleSpecificData.state || !roleSpecificData.city) {
        return res.status(400).json({ success: false, error: 'Country, State, and City selection are mandatory.' });
      }
      if (!roleSpecificData.university || !roleSpecificData.degree || !roleSpecificData.academicYear) {
        return res.status(400).json({ success: false, error: 'College/University, Degree, and Academic Year are mandatory.' });
      }
      if (!roleSpecificData.skills || (typeof roleSpecificData.skills === 'string' && !roleSpecificData.skills.trim())) {
        return res.status(400).json({ success: false, error: 'At least one skill is required.' });
      }
      if (!roleSpecificData.portfolio || !/^https?:\/\/.+\..+/.test(roleSpecificData.portfolio.trim())) {
        return res.status(400).json({ success: false, error: 'Valid Portfolio URL is mandatory (e.g. https://myportfolio.com).' });
      }
      if (!roleSpecificData.linkedin || !/^https?:\/\/(www\.)?linkedin\.com\/.+/.test(roleSpecificData.linkedin.trim())) {
        return res.status(400).json({ success: false, error: 'Valid LinkedIn profile URL is mandatory.' });
      }
      if (roleSpecificData.resume && typeof roleSpecificData.resume === 'string') {
        const resumePath = roleSpecificData.resume.toLowerCase();
        if (!resumePath.endsWith('.pdf') && !resumePath.includes('pdf')) {
          return res.status(400).json({ success: false, error: 'Resume must strictly be a PDF file.' });
        }
      }
    }

    const trimmedEmail = email.toLowerCase().trim();

    const [existingEco, existingStudent, existingHR, existingCoord] = await Promise.all([
      EcosystemUser.findOne({ email: trimmedEmail }),
      Student.findOne({ email: trimmedEmail }),
      HR.findOne({ email: trimmedEmail }),
      Coordinator.findOne({ email: trimmedEmail }),
    ]);

    /*
     * A student account with no internship record: a sign-up that stopped part
     * way, or one from before the record existed. Its owner cannot use the
     * portal (sign-in now says so and sends them here) and could not register
     * either ("Email already registered"). The same password proves it is
     * theirs, so the half-made account is cleared and this sign-up goes ahead.
     * Without that proof nothing is touched: anyone can type an email here.
     */
    if (existingEco && !existingStudent && !existingHR && !existingCoord
        && role === ROLES.STUDENT && existingEco.role === ROLES.STUDENT
        && !(await findStudentByEmail(Student, trimmedEmail))
        && await bcrypt.compare(password, existingEco.password || '').catch(() => false)) {
      await removeHalfMadeAccount(existingEco._id, null);
      console.log('[register] finished a half-made student sign-up for user %s', existingEco._id);
    } else if (existingEco || existingStudent || existingHR || existingCoord) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered. Please login.',
        error: 'Email already registered. Please login.' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 1. Create central user account in users (EcosystemUser)
    const user = await EcosystemUser.create({
      fullName: name.trim(),
      email:    trimmedEmail,
      password: hashedPassword,
      role:     role,
      phone:    roleSpecificData.mobile || "",
      // Reviewed roles are unverified until a human says otherwise. Students
      // are not reviewed; they are verified by having an internship.
      isVerified: ![ROLES.MENTOR, ROLES.FOUNDER, ROLES.INVESTOR, ROLES.CONTRACTOR].includes(role)
    });
    createdUserId = user._id;

    let genMemberId = '';
    /* Filled in by the student branch below and read by the welcome mail at the
       end of this function, which is outside that branch's scope. */
    let studentEmployeeId = '';
    let studentDomainName = '';
    let studentTenure = '';
    let studentDocId = null;
    // Generate sequential Member IDs for Ecosystem Profiles
    if (role === ROLES.STUDENT) {
      const studentCount = await StudentProfile.countDocuments();
      genMemberId = `TEN-STU-${String(studentCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.FOUNDER) {
      const founderCount = await FounderProfile.countDocuments();
      genMemberId = `TEN-FDR-${String(founderCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.MENTOR) {
      const mentorCount = await MentorProfile.countDocuments();
      genMemberId = `TEN-MTR-${String(mentorCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.INVESTOR) {
      const investorCount = await InvestorProfile.countDocuments();
      genMemberId = `TEN-INV-${String(investorCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.CONTRACTOR) {
      const contractorCount = await ContractorProfile.countDocuments();
      genMemberId = `TEN-CON-${String(contractorCount + 1).padStart(6, '0')}`;
    }

    // 2. Create Role-Specific Profiles in Separate collections/tables with Foreign Keys
    if (role === ROLES.STUDENT) {
      // Create student_profiles
      await StudentProfile.create({
        userId: user._id,
        memberId: genMemberId,
        fullName: name.trim(),
        email: trimmedEmail,
        mobile: roleSpecificData.mobile || "",
        country: roleSpecificData.country || "",
        state: roleSpecificData.state || "",
        city: roleSpecificData.city || "",
        university: roleSpecificData.university || "",
        degree: roleSpecificData.degree || "",
        graduationYear: String(roleSpecificData.graduationYear || ""),
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        resume: roleSpecificData.resume || "",
        linkedin: roleSpecificData.linkedin || "",
        portfolio: roleSpecificData.portfolio || "",
        verificationStatus: 'approved'
      });

      // BACKWARD COMPATIBILITY: also create legacy Student document in students collection
      //
      // Domains were validated above. There is deliberately no
      // `parsedDomains = ['Web Development']` fallback any more: an unselected
      // domain used to enrol the student in Web Development with a TEN/WEB/...
      // employee ID and no error shown, which is exactly what section 4 reports.
      const parsedDomains = studentDomains;
      const domain = parsedDomains[0];
      const employeeId = await generateEmployeeId(domain);
      const tenureValue = getTenureLabel(roleSpecificData.tenure);
      studentEmployeeId = employeeId;
      studentDomainName = domain;
      studentTenure = tenureValue;
      const legacyStudent = await Student.create({
        firstName: name.trim().split(' ')[0] || name.trim(),
        lastName: name.trim().split(' ').slice(1).join(' ') || "",
        name: name.trim(),
        email: trimmedEmail,
        whatsapp: roleSpecificData.mobile || "",
        password: hashedPassword,
        employeeId: employeeId,
        domain: domain,
        domains: parsedDomains,
        collegeName: roleSpecificData.university || "",
        college: roleSpecificData.university || "",
        tenure: tenureValue,
        joiningDate: new Date().toISOString().split('T')[0],
        // The link that brought them (/register?ref=…); undefined when none.
        signupRef: cleanSignupRef(req.body.ref)
      });
      studentDocId = legacyStudent && legacyStudent._id;
      createdStudentId = studentDocId;

      // Automatically create Talent Profile for students
      await TalentProfile.create({
        userId: user._id,
        headline: `${roleSpecificData.degree} Student at ${roleSpecificData.university}`,
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => ({ name: s.trim(), level: 'intermediate' })).filter(x => x.name) : [],
        socialLinks: {
          linkedin: roleSpecificData.linkedin || "",
          github: "",
          twitter: "",
          website: roleSpecificData.portfolio || ""
        },
        visibility: 'public',
        isVerified: true
      });
    }

    else if (role === ROLES.FOUNDER) {
      // Normalize values to avoid Mongoose enum validation errors
      const industryEnumList = ['EdTech','FinTech','HealthTech','AgriTech','CleanTech','Logistics','E-Commerce','SaaS','Gaming','Media','Other'];
      let chosenIndustry = roleSpecificData.industry || "Other";
      const matchedInd = industryEnumList.find(i => i.toLowerCase() === chosenIndustry.toLowerCase().trim());
      chosenIndustry = matchedInd || "Other";

      const stageEnumList = ['idea','validation','mvp','early_revenue','growth','scaling'];
      let chosenStage = (roleSpecificData.stage || "idea").toLowerCase().trim().replace(/[-\s]+/g, '_');
      if (!stageEnumList.includes(chosenStage)) {
        chosenStage = "idea";
      }

      const fundingEnumList = ['bootstrapped','pre_seed','seed','series_a','series_b','profitable'];
      let chosenFunding = (roleSpecificData.fundingStage || "bootstrapped").toLowerCase().trim().replace(/[-\s]+/g, '_');
      if (!fundingEnumList.includes(chosenFunding)) {
        chosenFunding = "bootstrapped";
      }

      const allowedGoals = ['co_founder','developers','designers','marketers','investors','mentors','interns'];
      const rawGoals = roleSpecificData.goals ? roleSpecificData.goals.split(',') : [];
      const chosenLookingFor = [];
      rawGoals.forEach(g => {
        let clean = g.trim().toLowerCase().replace(/[-\s]+/g, '_');
        if (clean === 'hire_talent' || clean === 'interns') clean = 'interns';
        if (clean === 'build_mvp' || clean === 'developers') clean = 'developers';
        if (clean === 'raise_funding' || clean === 'investors') clean = 'investors';
        if (allowedGoals.includes(clean)) {
          if (!chosenLookingFor.includes(clean)) {
            chosenLookingFor.push(clean);
          }
        }
      });
      if (chosenLookingFor.length === 0) {
        chosenLookingFor.push('developers');
      }

      // Create founder_profiles
      await FounderProfile.create({
        userId: user._id,
        memberId: genMemberId,
        startupName: roleSpecificData.startupName || "My Startup",
        industry: chosenIndustry,
        stage: chosenStage,
        teamSize: roleSpecificData.teamSize || 1,
        fundingStatus: chosenFunding,
        website: roleSpecificData.website || "",
        description: roleSpecificData.description || "",
        location: "",
        lookingFor: chosenLookingFor,
        /*
         * PENDING, not approved.
         *
         * This wrote 'approved' at signup while the wizard and the success page
         * both told the applicant HR would review them — so the verification
         * queue that controllers/verificationController.js and the HR console
         * were built to service was permanently empty, and nobody was ever
         * actually checked. Accounts created before this change are stamped
         * `grandfathered` by scripts/grandfather-ecosystem-profiles.js so HR can
         * tell "reviewed" from "was never reviewable".
         */
        verificationStatus: 'pending'
      });

      // Create startup_profiles
      await StartupProfile.create({
        founderId: user._id,
        startupName: roleSpecificData.startupName || "My Startup",
        industry: chosenIndustry,
        stage: roleSpecificData.stage || "",
        teamSize: roleSpecificData.teamSize || 1,
        website: roleSpecificData.website || "",
        linkedin: roleSpecificData.linkedin || "",
        revenue: roleSpecificData.revenue || "",
        fundingStage: roleSpecificData.fundingStage || "",
        description: roleSpecificData.description || "",
        goals: roleSpecificData.goals ? roleSpecificData.goals.split(',').map(g => g.trim()).filter(Boolean) : []
      });
    }

    else if (role === ROLES.MENTOR) {
      // Create mentor_profiles
      await MentorProfile.create({
        userId: user._id,
        memberId: genMemberId,
        headline: `${roleSpecificData.designation} at ${roleSpecificData.company}`,
        linkedinUrl: roleSpecificData.linkedin || "",
        verificationStatus: 'pending'
      });

      // Automatically create Talent Profile for mentors
      await TalentProfile.create({
        userId: user._id,
        headline: `${roleSpecificData.designation} at ${roleSpecificData.company}`,
        skills: roleSpecificData.expertiseAreas ? roleSpecificData.expertiseAreas.split(',').map(s => ({ name: s.trim(), level: 'expert' })).filter(x => x.name) : [],
        socialLinks: {
          linkedin: roleSpecificData.linkedin || "",
          github: "",
          twitter: "",
          website: ""
        },
        visibility: 'public',
        isVerified: true
      });
    }

    else if (role === ROLES.INVESTOR) {
      // Create investor_profiles
      /*
       * The investor's answers used to land almost nowhere. investorType was
       * hardcoded 'vc' whoever signed up, so every card in the directory read
       * "VC" — angels included. stagePreference and sectorFocus were never
       * written at all, which is why no card carried a stage or sector badge
       * and the directory's stage filter matched nobody. The stage and the
       * industry were pasted into a thesis sentence instead: readable, and
       * unqueryable. Each answer now goes in the field the directory reads.
       */
      const STAGES = ['pre_seed', 'seed', 'series_a', 'series_b'];
      const investorStages = String(roleSpecificData.investmentStages || '')
        .split(',').map((v) => v.trim()).filter((v) => STAGES.includes(v));
      const sectorFocus = String(roleSpecificData.industryFocus || '')
        .split(',').map((v) => v.trim()).filter(Boolean).slice(0, 12);
      const TYPES = ['angel', 'vc', 'family_office', 'corporate', 'accelerator', 'govt_fund', 'individual'];
      const investorType = TYPES.includes(roleSpecificData.investorType)
        ? roleSpecificData.investorType : 'individual';

      await InvestorProfile.create({
        userId: user._id,
        memberId: genMemberId,
        fundName: roleSpecificData.firmName || "",
        investorType,
        stagePreference: investorStages,
        sectorFocus,
        investmentRange: {
            min: Math.max(0, Number(roleSpecificData.ticketMin) || 0),
            max: Math.max(0, Number(roleSpecificData.ticketMax) || 0),
            currency: 'INR'
        },
        contactEmail: trimmedEmail,
        thesis: sectorFocus.length
            ? `Investing in ${sectorFocus.join(', ')}${investorStages.length ? ` at ${investorStages.map((v) => v.replace('_', ' ')).join(', ')}` : ''}.`
            : '',
        /*
         * PENDING, not approved.
         *
         * This wrote 'approved' at signup while the wizard and the success page
         * both told the applicant HR would review them — so the verification
         * queue that controllers/verificationController.js and the HR console
         * were built to service was permanently empty, and nobody was ever
         * actually checked. Accounts created before this change are stamped
         * `grandfathered` by scripts/grandfather-ecosystem-profiles.js so HR can
         * tell "reviewed" from "was never reviewable".
         */
        verificationStatus: 'pending',
        website: roleSpecificData.website || ""
      });
    }

    else if (role === ROLES.CONTRACTOR) {
      // Create contractor_profiles
      await ContractorProfile.create({
        userId: user._id,
        memberId: genMemberId,
        name: name.trim(),
        email: trimmedEmail,
        mobile: roleSpecificData.mobile || "",
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        experience: roleSpecificData.experience || "",
        portfolio: roleSpecificData.portfolio || "",
        hourlyRate: roleSpecificData.hourlyRate || 0,
        availability: roleSpecificData.availability || "Immediately",
        /*
         * PENDING, not approved.
         *
         * This wrote 'approved' at signup while the wizard and the success page
         * both told the applicant HR would review them — so the verification
         * queue that controllers/verificationController.js and the HR console
         * were built to service was permanently empty, and nobody was ever
         * actually checked. Accounts created before this change are stamped
         * `grandfathered` by scripts/grandfather-ecosystem-profiles.js so HR can
         * tell "reviewed" from "was never reviewable".
         */
        verificationStatus: 'pending'
      });

      // Automatically create Talent Profile for contractors
      await TalentProfile.create({
        userId: user._id,
        headline: `Independent Contractor - ${roleSpecificData.skills ? roleSpecificData.skills.split(',')[0] : 'Freelancer'}`,
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => ({ name: s.trim(), level: 'advanced' })).filter(x => x.name) : [],
        socialLinks: {
          linkedin: "",
          github: "",
          twitter: "",
          website: roleSpecificData.portfolio || ""
        },
        visibility: 'public',
        isVerified: true
      });
    }

    else if (role === ROLES.HR) {
      await HR.create({ name: name.trim(), email: trimmedEmail, password: hashedPassword, username: trimmedEmail, role: ROLES.HR });
    }

    else if (role === ROLES.COORDINATOR) {
      await Coordinator.create({ name: name.trim(), email: trimmedEmail, password: hashedPassword, username: trimmedEmail, department: roleSpecificData.department || '' });
    }

    // Auto-create Community Profile for every single newcomer
    await CommunityProfile.create({
      userId: user._id,
      role: role,
      joinedAt: new Date(),
      postsCount: 0,
      commentsCount: 0,
      activity: [{
        action: "joined_ecosystem",
        description: "Registered on the TEN Ecosystem platform.",
        timestamp: new Date()
      }]
    });

    await sendRegistrationWelcome({
      name: name.trim(),
      email: trimmedEmail,
      role,
      memberId: genMemberId,
      employeeId: studentEmployeeId,
      domain: studentDomainName,
      studentId: studentDocId,
      tenure: studentTenure
    });

    return res.status(201).json({ 
      success: true, 
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully.`, 
      userId: user._id, 
      role,
      email: trimmedEmail,
      memberId: genMemberId
    });
  } catch (err) {
    // Undo whatever this request made. Left behind, a half-made account turned
    // "Please try again" into "Email already registered. Please login.", and
    // signing in then looped back to the sign-in page for good.
    if (createdUserId) {
      await removeHalfMadeAccount(createdUserId, createdStudentId)
        .catch((e) => console.error('[register] could not undo a failed sign-up:', e.message));
    }
    // A duplicate key is only "already registered" when the key is the email.
    // A clashing Employee ID is our fault, the sign-up was undone above, and
    // trying again works.
    if (err.code === 11000 && /email/i.test(JSON.stringify(err.keyPattern || err.keyValue || err.message || ''))) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered. Please login.',
        error: 'Email already registered. Please login.' 
      });
    }
    console.error("Registration error:", err);
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
}

/**
 * Delete one sign-up's records: the account, every profile keyed to it, and
 * the internship record when there is one. Only ever called with ids this
 * request created, or for an account whose owner just proved the password.
 */
async function removeHalfMadeAccount(userId, studentId) {
  if (!userId) return;
  const keyed = [
    [StudentProfile, 'userId'], [TalentProfile, 'userId'], [FounderProfile, 'userId'],
    [StartupProfile, 'founderId'], [MentorProfile, 'userId'], [InvestorProfile, 'userId'],
    [ContractorProfile, 'userId'], [CommunityProfile, 'userId']
  ];
  await Promise.all(keyed.map(([M, field]) => {
    // Mongoose drops a filter on a field the schema does not have, and
    // deleteMany({}) empties the collection. Never let that happen here.
    if (!M.schema.path(field)) throw new Error(`${M.modelName} has no ${field}`);
    return M.deleteMany({ [field]: userId });
  }));
  if (studentId) await Student.deleteOne({ _id: studentId });
  await EcosystemUser.deleteOne({ _id: userId });
}

module.exports = { getHub, getRoleConfig, registerUser, sendRegistrationWelcome, sendPartnerDecision };

