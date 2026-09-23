'use strict';

const mongoose = require('mongoose');

/**
 * A placement cell, training-and-placement officer or department head at a
 * college — the people who put interns in front of us in bulk.
 *
 * WHY THIS IS NOT A StudioLead
 *
 * StudioLead means "somebody typed their address into our form". That record
 * carries consent in its very definition, and the mail it triggers is a
 * confirmation of something the person just asked for. Nobody here asked for
 * anything. Folding institutional contacts into that collection would make
 * StudioLead's own docblock false and would let a future reader assume a
 * consent that does not exist for these rows.
 *
 * WHY THIS IS NOT A SCRAPED LIST
 *
 * `sourceUrl` is required in spirit on every row and is the difference. A
 * college publishes its placement office address on its own placement page so
 * that companies offering internships will use it — that is the address's
 * entire purpose, the same reasoning services/v2/recruiterContacts.js applies
 * to a hiring team's address in their own job advert. We keep the page it came
 * from so any row can be checked back to the institution that published it.
 *
 * What is deliberately absent: students. No individual student address is ever
 * stored here. One placement officer reaches three hundred students through a
 * channel those students already trust, which is both the legal position and
 * the one that actually gets replies.
 */
const CollegeContactSchema = new mongoose.Schema({
    // Lowercased and unique — the index is what makes "mail a college once"
    // true even when two discovery runs finish at the same moment.
    email:       { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },

    college:     { type: String, default: '', trim: true },
    state:       { type: String, default: '', trim: true },
    website:     { type: String, default: '', trim: true },

    // The published page this address was read from. A row without one cannot
    // be justified, so discovery refuses to write it.
    sourceUrl:   { type: String, default: '', trim: true },

    contactName: { type: String, default: '', trim: true },
    contactRole: { type: String, default: '', trim: true },
    phone:       { type: String, default: '', trim: true },

    // 'aicte-import' for the open dataset, 'page-discovery' for a fetched page.
    via:         { type: String, default: 'page-discovery', trim: true },

    status:      { type: String, enum: ['new', 'mailed', 'replied', 'partnered', 'bounced'], default: 'new', index: true },

    // Same contract as Student.emailOptOut: set once, honoured forever, and
    // never cleared by an import.
    optOut:      { type: Boolean, default: false, index: true },
    optOutAt:    { type: Date },

    lastMailedAt: { type: Date },
    mailCount:    { type: Number, default: 0 },
    lastError:    { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.CollegeContact || mongoose.model('CollegeContact', CollegeContactSchema);
