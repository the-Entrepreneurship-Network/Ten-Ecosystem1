'use strict';

/**
 * The job collector's shelf: what it saves and what a search reads back.
 * See models/JobOpening.js for why it exists.
 */

const JobOpening = require('../../models/JobOpening');

const FIELDS = ['source', 'title', 'company', 'location', 'type', 'tags', 'url',
    'directUrl', 'directKind', 'posted', 'salary', 'description'];
const keyOf = (j) => `${j.title}|${j.company}`.toLowerCase().trim();

/** Upsert by title and company, refreshing seenAt. Returns how many rows. */
async function save(rows) {
    const ops = (rows || []).filter((j) => j && j.title && (j.directUrl || j.url)).map((j) => {
        const set = { seenAt: new Date() };
        FIELDS.forEach((f) => { if (j[f] !== undefined && j[f] !== null) set[f] = j[f]; });
        return { updateOne: { filter: { key: keyOf(j) }, update: { $set: set }, upsert: true } };
    });
    if (ops.length) await JobOpening.bulkWrite(ops, { ordered: false });
    return ops.length;
}

/**
 * Stored openings for a profile: a text search on the role and skills (any
 * word counts), best matches first. Rows carry fromStore, so a search knows
 * their links were already checked by the collector.
 */
async function find(profile, limit = 300) {
    const words = [profile && profile.role, ...((profile && profile.skills) || [])].filter(Boolean).join(' ');
    if (!words.trim()) return [];
    const rows = await JobOpening.find({ $text: { $search: words } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();
    return rows.map(({ _id, key, score, seenAt, ...j }) => ({ ...j, tags: j.tags || [], fromStore: true }));
}

module.exports = { save, find, keyOf };
