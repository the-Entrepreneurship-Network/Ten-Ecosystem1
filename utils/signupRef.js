'use strict';

/**
 * Which link brought a sign-up: the `ref` in a link such as
 * /register?ref=li-2026-12-01-webdev.
 *
 * public/ref.js keeps it for 30 days from any page that loads it, and the
 * registration sends it with the form. The student record keeps it as
 * `signupRef`, and GET /api/growth/signup-sources counts sign-ups per label.
 *
 * A ref is a label TEN chooses. Anything else a visitor types into the address
 * bar is dropped, not stored. public/ref.js uses the same pattern.
 */
const SIGNUP_REF = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The label to store, or undefined when there is none worth storing. */
function cleanSignupRef(value) {
    const ref = String(value == null ? '' : value).trim().toLowerCase();
    return SIGNUP_REF.test(ref) ? ref : undefined;
}

module.exports = { SIGNUP_REF, cleanSignupRef };
