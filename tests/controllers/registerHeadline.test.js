'use strict';

/**
 * A long degree and college failed the whole sign-up (27 Nov).
 *
 * Sign-up writes a profile headline from what the person typed — "<degree>
 * Student at <college>", "<designation> at <company>", "Independent Contractor
 * - <skill>" — and both profiles allow 120 characters. A student who picked
 * "Other" and typed a long degree and college got "Registration error" nine
 * times and could not register. The headline is now cut to fit, at a word.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const TalentProfile = require('../../models/TalentProfile');
const MentorProfile = require('../../models/MentorProfile');
const { _internal: { headlineOf } } = require('../../controllers/registerHubController');

const LONG = 'Bachelor of Technology in Computer Science and Engineering (Artificial Intelligence and Machine Learning)' +
    ' Student at Sri Venkateswara College of Engineering and Technology (Autonomous)';
const headlineError = (Model, headline) => {
    const err = new Model({ userId: new mongoose.Types.ObjectId(), headline }).validateSync();
    return err && err.errors.headline ? err.errors.headline.kind : null;
};

describe('the sign-up headline', () => {
    it('was the failure: the profile refuses a headline over 120 characters', () => {
        expect(LONG.length).toBeGreaterThan(120);
        expect(headlineError(TalentProfile, LONG)).toBe('maxlength');
    });

    it('now fits both profiles, cut at a word with an ellipsis', () => {
        const h = headlineOf(LONG);
        expect(h.length).toBeLessThanOrEqual(120);
        expect(h.endsWith('…')).toBe(true);
        expect(LONG.startsWith(h.slice(0, -1))).toBe(true);
        expect(LONG.charAt(h.length - 1)).toBe(' ');   // the cut falls between words
        expect(headlineError(TalentProfile, h)).toBeNull();
        expect(headlineError(MentorProfile, h)).toBeNull();
    });

    it('leaves a headline that fits as it is, spaces tidied', () => {
        expect(headlineOf('  B.Tech   Student at  IIT Delhi ')).toBe('B.Tech Student at IIT Delhi');
        expect(headlineOf('x'.repeat(120))).toBe('x'.repeat(120));
        // One unbroken word still fits.
        expect(headlineOf('x'.repeat(200))).toBe('x'.repeat(119) + '…');
    });

    it('every headline sign-up writes goes through it', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../controllers/registerHubController.js'), 'utf8');
        const writes = src.match(/headline:\s*[^\n]+/g) || [];
        expect(writes.length).toBe(4);
        for (const w of writes) expect(w).toMatch(/^headline:\s*headlineOf\(/);
    });
});
