'use strict';

/**
 * @jest-environment node
 *
 * The course certificates (services/v2/certificateDesign.js): Expert, Nano
 * Degree, Fellowship and the learning portal's Certificate of Completion.
 *
 * A certificate must say what it proves: what the holder can do, what it took
 * (real figures when known), why the tier means something, and how to check
 * it. And it is always light: ivory paper, never a dark page.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const design = require('../../services/v2/certificateDesign');

/** A stand-in pdfkit document that records what is written and painted. */
function recorder() {
    const texts = [], fills = [];
    let lastRect = null;
    const doc = new Proxy({}, {
        get(_, key) {
            if (key === 'text') return (t) => { texts.push(String(t)); return doc; };
            if (key === 'rect') return (...a) => { lastRect = a; return doc; };
            if (key === 'fill') return (c) => { fills.push({ color: c, rect: lastRect }); lastRect = null; return doc; };
            if (key === 'image') return () => doc;
            return () => doc;
        }
    });
    return { doc, texts, fills, all: () => texts.join('\n') };
}

const riya = { studentName: 'Riya Sharma', domain: 'DevOps with AWS', durationText: '3 Months',
    startDate: '1 September 2026', endDate: '30 November 2026', certificateId: 'TEN-2026-FEL-ABC123' };

describe('an internship certificate says what it proves', () => {
    it('the Fellowship: the skills, the real rank and share of work, the rule and the check', async () => {
        const r = recorder();
        await design.drawInternshipCertificate(r.doc, 'fellowship', { ...riya, completionPct: 93.6, cohortRankPct: 3.2 });
        const t = r.all();
        for (const want of ['TEN FELLOWSHIP', 'Riya Sharma', 'WHAT RIYA CAN DO', 'Set up CI/CD pipelines',
            'Work with Docker and Kubernetes', 'WHAT IT TOOK', 'Top 4%', '94%', 'top 10% of their domain',
            'Certificate ID: TEN-2026-FEL-ABC123', 'cert-verify.html']) {
            expect(t).toContain(want);
        }
    });

    it.each([['expert', 'EXPERT CERTIFICATE', '30%+'], ['nano_degree', 'NANO DEGREE', '70%+']])(
        '%s without figures states its rule instead (%s, %s)', async (type, label, rule) => {
            const r = recorder();
            await design.drawInternshipCertificate(r.doc, type, riya);
            expect(r.all()).toContain(label);
            expect(r.all()).toContain(rule);
        });

    it('a domain it does not know still gets sensible skills', () => {
        expect(design.domainSkills('Underwater Basket Weaving')).toHaveLength(4);
    });
});

describe('the course certificate lists what was studied', () => {
    it('every topic is counted, and the topics are named', async () => {
        const course = require('../../config/learnCurriculum').getModule('devops-with-aws');
        const r = recorder();
        await design.drawCourseCertificate(r.doc, { name: 'Riya Sharma', course, certificateId: 'TEN-LLM-X',
            verifyUrl: 'https://portal.test/api/v2/learn/verify/TEN-LLM-X' });
        const t = r.all();
        expect(t).toContain(`${course.topics.length} TOPICS MASTERED`);
        expect(t).toContain('CERTIFICATE OF COMPLETION');
        expect(t).toContain('a proctored final examination');
        expect(t).toContain('Git: history that cannot be lost');
    });
});

describe('always light', () => {
    it.each(['expert', 'nano_degree', 'fellowship'])('%s is drawn on ivory paper', async (type) => {
        const r = recorder();
        await design.drawInternshipCertificate(r.doc, type, riya);
        const page = r.fills.find((f) => f.rect && f.rect[0] === 0 && f.rect[1] === 0 && f.rect[2] > 800);
        expect(page.color).toBe('#FFFDF7');
    });
});

describe('the real generators write a PDF with a QR code', () => {
    it.each(['generateExpertCertificate', 'generateNanoCertificate', 'generateFellowshipCertificate'])('%s', async (fn) => {
        const out = path.join(os.tmpdir(), `cert-${fn}-${process.pid}.pdf`);
        const done = await require('../../services/v2/certificateService')[fn]({ ...riya, completionPct: 80, cohortRankPct: 5 }, out);
        expect(done).toBe(out);
        const pdf = fs.readFileSync(out);
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.length).toBeGreaterThan(5000);
        fs.unlinkSync(out);
    });
});

describe('the offer letter band is a colour pdfkit can read', () => {
    it('a soft tint, not an 8-digit hex (which came out bright green)', () => {
        const { tint } = require('../../services/automationCron');
        expect(tint('#A78BFA', 0x22 / 255)).toBe('#f3f0fe');
        const src = fs.readFileSync(path.join(__dirname, '../../services/automationCron.js'), 'utf8');
        expect(src).not.toMatch(/[cC]olor \+ "[0-9A-Fa-f]{2}"/);
    });
});
