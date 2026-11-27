'use strict';

const mongoose = require('mongoose');

/**
 * Openings the job collector found, read by every search.
 *
 * Searching the boards live made every student wait up to half a minute and
 * spent the boards' rate limits once per click. The collector fetches each
 * role every few hours with no one waiting, checks the links and finds the
 * employer's own page, and stores the rows here; a search reads them in a
 * second or two. A row nobody has re-sighted for 30 days expires by itself.
 */
const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // "title|company", lower case
    source: String,
    title: String,
    company: String,
    location: String,
    type: String,
    tags: [String],
    url: String,
    directUrl: String,
    directKind: String,
    posted: String,
    salary: String,
    description: String,
    seenAt: { type: Date, default: Date.now, expires: 30 * 86400 },
}, { versionKey: false });

schema.index({ title: 'text', tags: 'text', description: 'text' },
    { weights: { title: 10, tags: 5, description: 1 }, name: 'opening_text' });

module.exports = mongoose.models.JobOpening || mongoose.model('JobOpening', schema);
