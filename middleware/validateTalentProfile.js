//E:\Downloads\Ten-Ecosystem1\middleware\validateTalentProfile.js
'use strict';

/**
 * @fileoverview Validation middleware for TalentProfile create/update requests.
 * Returns 422 with field-level error messages on failure.
 */

const VALID_SKILL_LEVELS    = ['beginner', 'intermediate', 'advanced', 'expert'];
const VALID_AVAILABILITY    = ['immediately', '2weeks', '1month', 'not-available'];
const VALID_OPEN_TO         = ['internship', 'fulltime', 'parttime', 'freelance', 'mentorship', 'investment'];
const VALID_VISIBILITY      = ['public', 'network', 'private'];
const URL_PATTERN           = /^https?:\/\/.{3,}/;

/**
 * Validate a single URL string. Returns null if valid, error string if not.
 * @param {string} url
 * @param {string} fieldName
 * @returns {string|null}
 */
function validateUrl(url, fieldName) {
  if (!url) return null;
  if (!URL_PATTERN.test(url)) {
    return `${fieldName} must be a valid URL starting with http:// or https://`;
  }
  return null;
}

/**
 * Express middleware: validates talent profile request body.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function validateTalentProfile(req, res, next) {
  const errors = [];
  const { headline, bio, skills, availability, openTo, visibility, socialLinks } = req.body;

  if (headline !== undefined && String(headline).length > 120) {
    errors.push({ field: 'headline', message: 'Headline must be 120 characters or fewer.' });
  }

  if (bio !== undefined && String(bio).length > 1000) {
    errors.push({ field: 'bio', message: 'Bio must be 1000 characters or fewer.' });
  }

  if (availability !== undefined && !VALID_AVAILABILITY.includes(availability)) {
    errors.push({ field: 'availability', message: `availability must be one of: ${VALID_AVAILABILITY.join(', ')}` });
  }

  if (visibility !== undefined && !VALID_VISIBILITY.includes(visibility)) {
    errors.push({ field: 'visibility', message: `visibility must be one of: ${VALID_VISIBILITY.join(', ')}` });
  }

  if (Array.isArray(skills)) {
    skills.forEach((skill, idx) => {
      if (skill.level && !VALID_SKILL_LEVELS.includes(skill.level)) {
        errors.push({ field: `skills[${idx}].level`, message: `skill level must be one of: ${VALID_SKILL_LEVELS.join(', ')}` });
      }
    });
  }

  if (Array.isArray(openTo)) {
    openTo.forEach((item, idx) => {
      if (!VALID_OPEN_TO.includes(item)) {
        errors.push({ field: `openTo[${idx}]`, message: `openTo values must be one of: ${VALID_OPEN_TO.join(', ')}` });
      }
    });
  }

  if (socialLinks && typeof socialLinks === 'object') {
    const urlFields = ['linkedin', 'github', 'twitter', 'website'];
    urlFields.forEach((field) => {
      const err = validateUrl(socialLinks[field], `socialLinks.${field}`);
      if (err) errors.push({ field: `socialLinks.${field}`, message: err });
    });
  }

  if (errors.length > 0) {
    return res.status(422).json({ success: false, errors });
  }

  return next();
}

module.exports = { validateTalentProfile };
