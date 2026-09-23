'use strict';

/**
 * How much marketing email the Growth OS is allowed to send, and what is
 * reserved for the portal.
 *
 * The sending account (Sender.net free) allows 15,000 mails a month across
 * EVERYTHING. Certificates, offer letters and password resets share that
 * allowance with campaigns, so a campaign that eats the whole budget stops a
 * student receiving the certificate they earned. That is the failure this file
 * exists to prevent:
 *
 *   stage 1        7,500   what the Growth OS may send without asking
 *   extension     +4,000   what an admin may unlock once stage 1 is spent
 *   ─────────────────────
 *   ceiling       11,500   marketing can never exceed this in one period
 *   reserve        3,500   left for the portal, always
 *   ─────────────────────
 *   provider      15,000
 *
 * CEILING + RESERVE must equal PROVIDER_MONTHLY_CAP. The assertion at the
 * bottom is what stops someone raising one number and silently eating the
 * reserve six months from now.
 */

const num = (name, fallback) => {
    const raw = parseInt(process.env[name], 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

const PROVIDER_MONTHLY_CAP = num('GROWTH_PROVIDER_CAP', 15000);
const STAGE1_LIMIT         = num('GROWTH_STAGE1_LIMIT', 7500);
const EXTENSION_MAX        = num('GROWTH_EXTENSION_MAX', 4000);
const PORTAL_RESERVE       = num('GROWTH_PORTAL_RESERVE', 3500);
const MARKETING_CEILING    = STAGE1_LIMIT + EXTENSION_MAX;

/*
 * Which day of the month the allowance resets.
 *
 * Not necessarily the 1st. A provider's free tier resets on the day the
 * account was opened, so a counter that rolls over on the 1st can read
 * "0 used" while the provider still counts 14,000 against you. Set
 * GROWTH_QUOTA_RESET_DAY to the day your Sender.net dashboard resets.
 *
 * Clamped to 1-28 because there is no 30th of February and a Date built with
 * one rolls forward into March, which would move the period boundary.
 */
const RESET_DAY = Math.min(28, Math.max(1, num('GROWTH_QUOTA_RESET_DAY', 1)));

/*
 * What counts against the marketing quota.
 *
 * Everything NOT in this set is portal mail and is never blocked — a
 * certificate, an offer letter or a password reset goes out even when the
 * marketing allowance is at zero. That is the whole point of the reserve.
 */
const MARKETING_TYPES = Object.freeze([
    'inactive-reengagement',
    'active-appreciation',
    'promotion',
    'campaign'
]);

/** The first instant of the period containing `now`. */
function periodStart(now = new Date(), resetDay = RESET_DAY) {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), resetDay, 0, 0, 0, 0);
    if (d.getTime() < start.getTime()) start.setMonth(start.getMonth() - 1);
    return start;
}

/** The first instant of the NEXT period — what the dashboard shows as "resets". */
function periodEnd(now = new Date(), resetDay = RESET_DAY) {
    const start = periodStart(now, resetDay);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return end;
}

/** A stable label for the period, for grant records: "2026-09". */
function periodKey(now = new Date(), resetDay = RESET_DAY) {
    const s = periodStart(now, resetDay);
    return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`;
}

if (MARKETING_CEILING + PORTAL_RESERVE > PROVIDER_MONTHLY_CAP) {
    throw new Error(
        `[growthQuota] stage1 (${STAGE1_LIMIT}) + extension (${EXTENSION_MAX}) + portal reserve `
        + `(${PORTAL_RESERVE}) = ${MARKETING_CEILING + PORTAL_RESERVE}, which is more than the `
        + `provider's ${PROVIDER_MONTHLY_CAP}/month. Lower one of them or raise GROWTH_PROVIDER_CAP.`
    );
}

module.exports = {
    PROVIDER_MONTHLY_CAP, STAGE1_LIMIT, EXTENSION_MAX, PORTAL_RESERVE,
    MARKETING_CEILING, RESET_DAY, MARKETING_TYPES,
    periodStart, periodEnd, periodKey
};
