'use strict';

/**
 * TEN Career Studio — the one price list.
 *
 * Three products that were being given away because `express.static("public")`
 * serves /job-portal, /resume-portal and the course pages to anyone with the
 * URL. They are sold now, and this is the only place a price is written: the
 * pricing screen renders from it, the order endpoint charges from it, and the
 * access check reads the same `unlocks` list. A price that lives in two places
 * eventually disagrees with itself — the tenure tables in this project once
 * existed in five and silently gave every student a 30-day internship.
 *
 * The combo is deliberately cheaper than the parts. Buying all three singly is
 * ₹650; the combo is ₹500, and the screen shows that saving rather than
 * claiming one that is not real.
 */

/** What a student can open. Also the keys the access check answers for. */
const PORTALS = Object.freeze(['course', 'resume', 'job']);

const PRODUCTS = Object.freeze({
    course: {
        key: 'course',
        name: 'Courses & Modules',
        blurb: 'The LLM portal: 20+ topics per domain, proctored AI-marked exams, a two-hour final and a verifiable certificate.',
        price: 300,
        unlocks: ['course'],
        includes: [
            'One module per domain — 20+ topics each, difficulty rising as you go',
            'Human-written lessons: the technical explanation, then the simple one',
            'A video per topic, and a proctored exam after it — AI-set, AI-marked',
            'A two-hour CBT-style final, a big project (optional), a verifiable certificate'
        ],
        // The ONLY product that may be paid after completion: the certificate
        // is what waits for the money. Job and Resume are pay-first — their
        // value is consumed the moment they are used, so there is no
        // completion moment left to collect at.
        deferrable: true
    },
    resume: {
        key: 'resume',
        name: 'Resume Portal',
        blurb: 'Build an ATS-proof resume, and have it checked against a real job description.',
        price: 150,
        unlocks: ['resume'],
        includes: [
            'An ATS-proof resume built from your real work',
            'Checked line by line against a job description you choose',
            'Export and reuse for every application'
        ]
    },
    job: {
        key: 'job',
        name: 'Job Portal',
        blurb: 'An agent hunts live openings across the web and applies on your behalf.',
        price: 200,
        unlocks: ['job'],
        includes: [
            'An agent that hunts live openings across the web',
            'Applications sent on your behalf, tracked in one place',
            'Openings matched to your domain and level'
        ]
    },
    combo: {
        key: 'combo',
        name: 'Career Studio — all three',
        blurb: 'Course, resume and job hunting together. Everything the Studio does, one price.',
        price: 500,
        badge: 'BEST VALUE',
        unlocks: ['course', 'resume', 'job'],
        includes: [
            'Everything in the course, the Resume Portal and the Job Portal',
            'One payment, one login — ₹150 less than buying them separately'
        ]
    }
});

/**
 * What paying later costs on top.
 *
 * Paying at the end is worth something to the student and costs us the risk of
 * never being paid at all, so it is priced: ₹300 now, ₹400 when you finish.
 * The screen says both numbers next to each other, which is the whole point —
 * a nudge that hides the cheaper option is not a nudge, it is a trick.
 */
const DEFER_SURCHARGE = 100;

/** What this product costs if the fee waits until completion. */
function deferredPriceFor(productKey) {
    const p = PRODUCTS[productKey];
    return p && p.deferrable ? p.price + DEFER_SURCHARGE : null;
}

/** How the fee is settled. Both are offered on the pricing screen. */
const PAY_MODES = Object.freeze({
    /** Pay before you start. Access opens when an admin approves the UTR. */
    NOW: 'now',
    /**
     * Learn now, pay when you finish.
     *
     * Access opens immediately and the fee is recorded as due. The certificate
     * is what is held back until it is settled — not the learning, which is the
     * whole point of offering this.
     */
    AFTER: 'after'
});

/** Canonical purpose for a Payment row, e.g. "studio_combo". */
function purposeFor(productKey) {
    return `studio_${productKey}`;
}

/** Every purpose this config can produce — for one indexed query, not four. */
function allPurposes() {
    return Object.keys(PRODUCTS).map(purposeFor);
}

/** "studio_combo" → "combo", or null when it is not one of ours. */
function productKeyFromPurpose(purpose) {
    const key = String(purpose || '').replace(/^studio_/, '');
    return PRODUCTS[key] && String(purpose).startsWith('studio_') ? key : null;
}

function getProduct(key) {
    return PRODUCTS[key] || null;
}

/** What buying this opens. Unknown product opens nothing, never everything. */
function unlocksFor(key) {
    const p = PRODUCTS[key];
    return p ? p.unlocks.slice() : [];
}

/**
 * The pricing screen, in the order it is read: the three singles, then the
 * combo with the saving it actually represents.
 */
function getPricingTable() {
    const singles = ['course', 'resume', 'job'].map((k) =>
        ({ ...PRODUCTS[k], deferredPrice: deferredPriceFor(k) }));
    const singlesTotal = singles.reduce((sum, p) => sum + p.price, 0);
    return {
        singles,
        combo: { ...PRODUCTS.combo, insteadOf: singlesTotal, saving: singlesTotal - PRODUCTS.combo.price },
        payModes: PAY_MODES,
        deferSurcharge: DEFER_SURCHARGE
    };
}

module.exports = {
    PORTALS,
    PRODUCTS,
    PAY_MODES,
    DEFER_SURCHARGE,
    deferredPriceFor,
    purposeFor,
    allPurposes,
    productKeyFromPurpose,
    getProduct,
    unlocksFor,
    getPricingTable
};
