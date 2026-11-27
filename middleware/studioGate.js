'use strict';

/**
 * Nothing in the Studio is reachable by URL alone.
 *
 * `app.use(express.static("public"))` serves /job-portal and /resume-portal to
 * anybody who types them. Two products with prices on them were a bookmark
 * away from free, and a paywall that only exists as a button on a page is not
 * a paywall.
 *
 * This sits in FRONT of the static handler — whichever is registered first
 * wins — so the file is never read for someone who has not bought it.
 *
 * What stays public is deliberate: the overview at /student-portal/ is the shop
 * window. A visitor has to be able to see what the money buys, or nobody buys
 * it. The gate covers what is behind the window, not the window.
 */

const studioAccess = require('../services/studioAccess');

/**
 * URL prefix → the portal it belongs to.
 *
 * The course has no entry here on purpose. It used to guard
 * student-journeys.html, which is gone — /domains replaced it, and /domains is
 * the public list a visitor picks a track from, so gating it would put a
 * paywall in front of the menu. The course product is still sold and still
 * granted; there is simply no course page behind the chooser yet to stand in
 * front of. Add one here when there is.
 */
const GUARDED = Object.freeze([
    ['/job-portal',    'job'],
    ['/resume-portal', 'resume']
]);

/** Which portal does this path belong to, if any? */
function portalFor(pathname) {
    const p = String(pathname || '').toLowerCase();
    for (const [prefix, portal] of GUARDED) {
        if (p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix + '?')) return portal;
    }
    return null;
}

function sessionStudentId(req) {
    const s = (req.session && req.session.student) || null;
    return s ? (s.employeeId || s._id || s.id || '') : '';
}

/**
 * Who is asking, in the shape studioAccess reads: their Student row, an
 * Academic Portal learner (who can buy the combo but has no Student row, so
 * checking only for one would bounce them off something they had just paid
 * for), or null when nobody is signed in.
 */
async function subjectOf(req) {
    const who = sessionStudentId(req);
    const learner = (req.session && req.session.learner) || null;
    if (!who && learner) {
        return { _id: learner.id, employeeId: null, tenure: null, email: learner.email, name: learner.name };
    }
    if (!who) return null;
    const Student = require('../models/Student');
    return await Student.findOne({ employeeId: String(who) }).lean()
        || (require('mongoose').Types.ObjectId.isValid(who) ? await Student.findById(who).lean() : null);
}

async function studioGate(req, res, next) {
    // Only ever a page request. A POST to something under these paths is not a
    // page and is guarded by its own route.
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const portal = portalFor(req.path);
    if (!portal) return next();

    try {
        const subject = await subjectOf(req);
        if (!subject) {
            // Signed out. Send them to sign in and back here afterwards rather
            // than to a paywall for something they may already own.
            return res.redirect(302, '/login.html?next=' + encodeURIComponent(req.originalUrl));
        }

        if (await studioAccess.canOpen(subject, portal)) return next();

        return res.redirect(302, '/studio.html?want=' + encodeURIComponent(portal)
            + '&next=' + encodeURIComponent(req.originalUrl));
    } catch (err) {
        /*
         * Fail CLOSED. An error here is the one case where letting someone
         * through is worse than turning them away: the whole point of this
         * file is that the product is not free, and a paywall that opens when
         * the database hiccups is a paywall with a documented bypass.
         */
        console.error('[studio-gate] access check failed:', err.message);
        return res.redirect(302, '/studio.html?error=1');
    }
}

/**
 * The same rule for a portal's API, answered in JSON.
 *
 * The page was behind the paywall and everything the page does was not: the
 * agents never looked at who was calling, so anyone could use them signed out.
 * Fails closed, for the reason above.
 */
function studioApi(portal) {
    return async function studioApiGate(req, res, next) {
        try {
            const subject = await subjectOf(req);
            if (!subject) {
                return res.status(401).json({ ok: false, error: 'Please sign in to use this.', signIn: '/login.html' });
            }
            if (await studioAccess.canOpen(subject, portal)) return next();
            const name = portal === 'job' ? 'Job Portal' : 'Resume Portal';
            return res.status(403).json({ ok: false, error: `This needs the ${name}. You can get it from the Career Studio.`, buy: '/studio.html?want=' + portal });
        } catch (err) {
            console.error('[studio-gate] api access check failed:', err.message);
            return res.status(503).json({ ok: false, error: 'Could not check your access just now. Please try again in a minute.' });
        }
    };
}

module.exports = { studioGate, studioApi, portalFor, GUARDED };
