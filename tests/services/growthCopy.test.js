'use strict';

/**
 * @jest-environment node
 *
 * A one-line brief becomes a campaign draft.
 *
 * The model writes the words; what this service is responsible for is the two
 * things a model gets dangerously wrong. It must never put a URL the model
 * invented into a button that goes to thousands of students — so the link is
 * chosen from a closed list of real pages, and anything else collapses to the
 * portal home. And it must never suggest an audience that does not exist — so
 * the segment is validated against the real keys and otherwise left blank for
 * the human to pick.
 *
 * Gemini is stubbed; the test drives what the "model" returns and checks what
 * the service makes of it. Nothing here reaches the network.
 */

const segments = require('../../services/growthSegments');

/** Load growthCopy with a stubbed Gemini that returns `reply` (or throws). */
function load({ reply = {}, keyed = true, throws = null } = {}) {
    jest.resetModules();
    const calls = [];
    jest.doMock('../../utils/gemini', () => ({
        ready: () => keyed,
        Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' },
        ask: async (prompt, schema) => {
            calls.push({ prompt, schema });
            if (throws) throw new Error(throws);
            return reply;
        }
    }));
    return { copy: require('../../services/growthCopy'), calls };
}

const GOOD = {
    name: 'Dormant nudge',
    subject: 'Finish your internship and claim your certificate',
    heading: "You're almost there",
    bodyText: 'One task stands between you and your certificate.\n\nFinish it this week.',
    ctaLabel: 'Finish now',
    ctaPath: '/overview',
    segment: 'dormant14'
};

beforeAll(() => { process.env.PORTAL_URL = 'https://portal.example'; });

describe('the button link can only be a real page', () => {
    it('builds the URL from the portal base and the chosen path', async () => {
        const { copy } = load({ reply: { ...GOOD, ctaPath: '/studio.html' } });
        const d = await copy.draft('push the studio');
        expect(d.ctaUrl).toBe('https://portal.example/studio.html');
    });

    it('falls back to the portal home when the model invents a URL', async () => {
        // The failure mode this exists for: a model handed "give me a link"
        // returns a plausible, wrong one, and the campaign ships a 404 button.
        for (const bad of ['https://evil.example/phish', '/made-up-page', 'overview', '', null, undefined]) {
            const { copy } = load({ reply: { ...GOOD, ctaPath: bad } });
            const d = await copy.draft('x');
            expect(d.ctaUrl).toBe('https://portal.example' + copy.DEFAULT_PATH);
        }
    });

    it('accepts every path on the allow-list, and only those', async () => {
        for (const path of Object.keys(load().copy.CTA_PATHS)) {
            const { copy } = load({ reply: { ...GOOD, ctaPath: path } });
            const d = await copy.draft('x');
            expect(d.ctaUrl).toBe('https://portal.example' + path);
        }
    });
});

describe('the segment must be one that exists', () => {
    it('keeps a real segment key', async () => {
        const { copy } = load({ reply: { ...GOOD, segment: 'freeTenure' } });
        expect((await copy.draft('x')).segment).toBe('freeTenure');
        // and it really is a segment, not just a string we trust
        expect(segments.isSegment('freeTenure')).toBe(true);
    });

    it('drops an invented audience to blank, for the human to choose', async () => {
        for (const bad of ['everyone-who-paid', 'VIP', 'picked', '', null]) {
            const { copy } = load({ reply: { ...GOOD, segment: bad } });
            expect((await copy.draft('x')).segment).toBe('');
        }
    });
});

describe('the draft is shaped to the form it fills', () => {
    it('returns exactly the fields the campaign form holds', async () => {
        const { copy } = load({ reply: GOOD });
        const d = await copy.draft('x');
        expect(Object.keys(d).sort()).toEqual(
            ['bodyText', 'ctaLabel', 'ctaUrl', 'heading', 'name', 'segment', 'subject']);
    });

    it('trims each field to the limit the campaign stores', async () => {
        const { copy } = load({ reply: {
            ...GOOD,
            name: 'n'.repeat(500), subject: 's'.repeat(500),
            heading: 'h'.repeat(500), bodyText: 'b'.repeat(30000), ctaLabel: 'c'.repeat(200)
        } });
        const d = await copy.draft('x');
        expect(d.name.length).toBe(copy.LIMITS.name);
        expect(d.subject.length).toBe(copy.LIMITS.subject);
        expect(d.heading.length).toBe(copy.LIMITS.heading);
        expect(d.bodyText.length).toBe(copy.LIMITS.bodyText);
        expect(d.ctaLabel.length).toBe(copy.LIMITS.ctaLabel);
    });

    it('names the campaign after the subject when the model gives no name', async () => {
        const { copy } = load({ reply: { ...GOOD, name: '' } });
        expect((await copy.draft('x')).name).toBe(GOOD.subject);
    });
});

describe('it refuses before it spends a call', () => {
    it('will not draft from an empty brief', async () => {
        const { copy, calls } = load();
        await expect(copy.draft('   ')).rejects.toThrow(/sentence first/);
        expect(calls).toHaveLength(0);
    });

    it('says plainly when the server has no AI key', async () => {
        const { copy, calls } = load({ keyed: false });
        await expect(copy.draft('a real brief')).rejects.toThrow(/AI key/);
        expect(calls).toHaveLength(0);          // never reaches the model
    });
});

describe('the prompt constrains the model to real choices', () => {
    it('hands it the brief, the page list and the segment list', async () => {
        const { copy, calls } = load({ reply: GOOD });
        await copy.draft('a memorable brief about certificates');
        const p = calls[0].prompt;
        expect(p).toContain('a memorable brief about certificates');
        for (const path of Object.keys(copy.CTA_PATHS)) expect(p).toContain(path);
        for (const key of Object.keys(segments.SEGMENTS)) expect(p).toContain(key);
    });
});
