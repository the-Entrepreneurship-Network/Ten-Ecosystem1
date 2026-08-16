'use strict';

/**
 * Trim string fields on a shallow copy of `obj`.
 * @param {object}   obj    - The source object (typically req.body).
 * @param {string[]} fields - Field names to trim.
 * @returns {object} A new object with trimmed string fields.
 */
function trimFields(obj, fields) {
  const out = { ...obj };
  for (const f of fields) {
    if (typeof out[f] === 'string') out[f] = out[f].trim();
  }
  return out;
}

module.exports = { trimFields };
