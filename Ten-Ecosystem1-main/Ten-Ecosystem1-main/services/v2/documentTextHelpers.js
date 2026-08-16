"use strict";

/**
 * Shared text-generation helpers for all TEN document generators.
 *
 * These helpers centralise the two most bug-prone pieces of copy in the
 * PDF pipeline:
 *   1. Salutations (e.g. "Dear Devanshi Singh,") — historically split
 *      across multiple lines/paragraphs because they were built out of
 *      several .text() calls or concatenated with newlines.
 *   2. Gendered pronouns (he/she/his/her) — historically hard-coded,
 *      which produced wrong pronouns for records whose stored gender
 *      did not match the assumption.
 */

/**
 * Builds a guaranteed single-line salutation such as "Dear Devanshi Singh,".
 * Whitespace is normalised so the name never contains embedded newlines
 * or double spaces that could push it to a new line/paragraph.
 *
 * @param {string} fullName
 * @returns {string}
 */
function buildSalutation(fullName) {
    const name = String(fullName || "Candidate").trim().replace(/\s+/g, " ");
    return `Dear ${name},`;
}

/**
 * Resolves gendered pronouns from a `gender` field on the record.
 *
 * Falls back to neutral "they/them/their" if gender is missing or
 * unrecognised — we never guess a gender that wasn't provided.
 *
 * The three core fields (`subject`, `object`, `possessive`) match the
 * spec exactly. `possessivePronoun` and `genderNoun` are additionally
 * returned so this function is a drop-in replacement for the older
 * `getPronouns` helper still used by some generators.
 *
 * @param {string} gender - expected: "male" | "female" | "" | undefined
 * @returns {{subject:string, object:string, possessive:string, possessivePronoun:string, genderNoun:string}}
 */
function resolvePronouns(gender) {
    const g = String(gender || "").toLowerCase().trim();
    // `has`/`is` are the verb forms that agree with the subject pronoun.
    // Templates used to hard-code "has"/"is" (written for he/she), which the
    // neutral fallback turned into "they has excellent communication skills"
    // and "they is extremely organized" on real, employer-facing PDFs.
    if (g === "male" || g === "m" || g === "he" || g === "him") {
        return {
            subject: "he",
            object: "him",
            possessive: "his",
            possessivePronoun: "his",
            genderNoun: "male",
            has: "has",
            is: "is"
        };
    }
    if (g === "female" || g === "f" || g === "she" || g === "her") {
        return {
            subject: "she",
            object: "her",
            possessive: "her",
            possessivePronoun: "hers",
            genderNoun: "female",
            has: "has",
            is: "is"
        };
    }
    return {
        subject: "they",
        object: "them",
        possessive: "their",
        possessivePronoun: "theirs",
        genderNoun: "individual",
        has: "have",
        is: "are"
    };
}

module.exports = { buildSalutation, resolvePronouns };
