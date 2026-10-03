'use strict';

const mongoose = require('mongoose');

/**
 * A college website the agent knows about, and whether it has been there yet.
 *
 * This exists because the agent had no memory of where it had been. It was
 * handed the same hard-coded list of 371 colleges on every run, so the first
 * run collected everything those sites publish and every run afterwards
 * visited the same 371 pages to find nothing — "Visiting 238 of 371 — found 0".
 * The work was being repeated, not continued.
 *
 * So the list of places to visit is a queue in the database rather than an
 * array in a config file, and it GROWS: every page the agent reads is also
 * read for links to other `.ac.in` and `.edu.in` sites, which go in here as
 * `new`. Indian college sites link to each other constantly — affiliations,
 * consortium pages, NAAC listings, news — so the 371 seeds lead to colleges
 * nobody typed in by hand.
 *
 * Every host in here came from a link somebody actually published. None of it
 * is guessed, which is the same promise the address extraction makes.
 */
const collegeSiteSchema = new mongoose.Schema({
    /** The registrable host, lowercased: `nitk.ac.in`, never `cse.nitk.ac.in`. */
    host: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },

    status: {
        type: String,
        enum: ['new', 'visited', 'dead'],
        default: 'new',
        index: true
    },

    /** The page this host was found on. Evidence, and useful when one goes bad. */
    discoveredFrom: { type: String, default: '' },
    /** 'seed' for the original list, 'crawl' for one the agent found itself. */
    via:            { type: String, default: 'crawl' },

    lastVisitedAt: { type: Date, default: null },
    visitCount:    { type: Number, default: 0 },
    /** How many usable addresses the last visit produced. */
    contactsFound: { type: Number, default: 0 }
}, { timestamps: true });

// The queue query: what has not been visited, oldest first.
collegeSiteSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.models.CollegeSite
    || mongoose.model('CollegeSite', collegeSiteSchema);
