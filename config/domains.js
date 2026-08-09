'use strict';

/**
 * The single list of internship domains.
 *
 * Three lists used to exist and none of them agreed:
 *
 *   - DOMAINS_ENUM in middleware/validationSchemas.js (the validator)
 *   - the domain cards in public/register.html (what a student can pick)
 *   - domainShortCodes in server.js and a second copy in
 *     controllers/registerHubController.js (employee-ID prefixes)
 *
 * The register form offered "Business Development", "Space Intern" and
 * "Finance", none of which were in the validator — so switching the validator
 * on would have rejected valid choices. Meanwhile the validator listed
 * "HR Management", "Vibe Coding", "Space Research" and "Business Analyst",
 * which the form never offered but existing students are enrolled in.
 *
 * This file is the union, so enabling validation cannot lock anybody out.
 * `selectable: false` marks a domain that existing students hold but which is
 * no longer offered to new registrations.
 */

const DOMAINS = [
  { name: 'DevOps with AWS',         shortCode: 'DEVOPS',  selectable: true },
  { name: 'Python Development',      shortCode: 'PY',      selectable: true },
  { name: 'Java Development',        shortCode: 'JAVA',    selectable: true },
  { name: 'Web Development',         shortCode: 'WEB',     selectable: true },
  { name: 'MERN Stack Development',  shortCode: 'MERN',    selectable: true },
  { name: 'Artificial Intelligence', shortCode: 'AI',      selectable: true },
  { name: 'Data Science',            shortCode: 'DS',      selectable: true },
  { name: 'Cyber Security',          shortCode: 'CYBER',   selectable: true },
  { name: 'Software Engineering',    shortCode: 'SDE',     selectable: true },
  { name: 'Flutter Development',     shortCode: 'FLUTTER', selectable: true },
  { name: 'Business Development',    shortCode: 'BD',      selectable: true },
  { name: 'HR',                      shortCode: 'HR',      selectable: true },
  { name: 'Space Intern',            shortCode: 'SPACE',   selectable: true },
  { name: 'Venture Capital',         shortCode: 'VC',      selectable: true },
  { name: 'Finance',                 shortCode: 'FIN',     selectable: true },

  // Held by existing students; not offered on the registration form.
  { name: 'HR Management',           shortCode: 'HRMGMT',  selectable: false },
  { name: 'Vibe Coding',             shortCode: 'VIBE',    selectable: false },
  { name: 'Space Research',          shortCode: 'SPACERES', selectable: false },
  { name: 'Business Analyst',        shortCode: 'BA',      selectable: false }
];

/** Every valid domain name — what the validator accepts. */
const DOMAIN_NAMES = DOMAINS.map((d) => d.name);

/** Only the domains a new student may choose. */
const SELECTABLE_DOMAIN_NAMES = DOMAINS.filter((d) => d.selectable).map((d) => d.name);

/** name → employee-ID prefix. */
const DOMAIN_SHORT_CODES = DOMAINS.reduce((acc, d) => {
  acc[d.name] = d.shortCode;
  return acc;
}, {});

const _BY_LOWER_NAME = DOMAINS.reduce((acc, d) => {
  acc[d.name.toLowerCase()] = d;
  return acc;
}, {});

/**
 * Resolve a domain name case-insensitively, tolerating extra whitespace.
 * @returns {string|null} the canonical name, or null if unrecognised
 */
function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  const found = _BY_LOWER_NAME[key];
  return found ? found.name : null;
}

function isValidDomain(value) {
  return normalizeDomain(value) !== null;
}

/**
 * Employee-ID prefix for a domain.
 *
 * NOTE: "Space Research" and "Space Intern" both used to map to "SPACE",
 * making TEN/SPACE/1005 ambiguous. Space Research is now SPACERES.
 * Unknown domains fall back to "GEN" rather than an uppercased free-text value,
 * which previously let an arbitrary request body become part of an employee ID.
 */
function getDomainShortCode(domain) {
  const canonical = normalizeDomain(domain);
  return canonical ? DOMAIN_SHORT_CODES[canonical] : 'GEN';
}

module.exports = {
  DOMAINS,
  DOMAIN_NAMES,
  SELECTABLE_DOMAIN_NAMES,
  DOMAIN_SHORT_CODES,
  normalizeDomain,
  isValidDomain,
  getDomainShortCode
};
