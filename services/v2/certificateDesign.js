'use strict';

/**
 * The one design every TEN course certificate is drawn with: the Expert, Nano
 * Degree and Fellowship certificates (certificateService.js) and the learning
 * portal's Certificate of Completion (routes/v2/learn.js).
 *
 * A certificate has to answer a stranger's question, an employer's usually:
 * "what does this prove?" So beside the name it states, on the page:
 *   - what the holder can do: the domain's skills, or the course's topics;
 *   - what it took: the real share of work approved, the rank, the exams;
 *   - why the tier means something: the rule that gates it;
 *   - how to check it: the ID and a QR code to the public verify page.
 *
 * Always light: ivory paper, one colour per tier, gold trim.
 */

const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const W = 841.89, H = 595.28;            // A4 landscape, in points
const INK = '#0A1628', BODY = '#3D4558', QUIET = '#6B7280', GOLD = '#B8902F', PAPER = '#FFFDF7';
const LOGO = path.join(__dirname, '../../public/ten-logo.png');

const TIERS = {
    expert: {
        label: 'EXPERT CERTIFICATE', accent: '#1D4E89', soft: '#EEF3FA', seal: 'EXPERT',
        why: 'Awarded for completing 30% or more of a TEN virtual internship, every submission reviewed by a coordinator.'
    },
    nano_degree: {
        label: 'NANO DEGREE', accent: '#0F6B63', soft: '#EAF5F3', seal: 'NANO DEGREE',
        why: 'Awarded for completing 70% or more of a TEN virtual internship, every submission reviewed by a coordinator.'
    },
    fellowship: {
        label: 'TEN FELLOWSHIP', accent: '#8C1D40', soft: '#F9EEF2', seal: 'FELLOW',
        why: 'TEN’s highest honour: only for interns ranked in the top 10% of their domain, with 70% or more of their work approved.'
    },
    course: {
        label: 'CERTIFICATE OF COMPLETION', accent: '#22375E', soft: '#EEF1F7', seal: 'COURSE',
        why: 'Awarded for finishing every topic of a TEN course, passing its proctored final examination and its final project.'
    }
};

/** The four things a holder of this domain's certificate can do. */
function domainSkills(domain) {
    try {
        // Lazy: automationCron loads much of the app, and certificates load with it.
        const { getDomainContent } = require('../automationCron');
        const c = getDomainContent(domain || '');
        if (c && Array.isArray(c.responsibilities) && c.responsibilities.length) return c.responsibilities.slice(0, 4);
    } catch (_) { /* fall through to the general list */ }
    return ['Complete real project work to a reviewed standard', 'Apply the domain’s core tools and methods',
        'Plan, document and deliver work every week', 'Communicate progress professionally'];
}

function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || 'The holder';
}

function frame(doc, accent) {
    doc.rect(0, 0, W, H).fill(PAPER);
    doc.rect(16, 16, W - 32, H - 32).lineWidth(2.2).strokeColor(accent).stroke();
    doc.rect(25, 25, W - 50, H - 50).lineWidth(0.8).strokeColor(GOLD).stroke();
    // Small gold diamonds on the inner corners.
    for (const [x, y] of [[25, 25], [W - 25, 25], [25, H - 25], [W - 25, H - 25]]) {
        doc.save().translate(x, y).rotate(45).rect(-5, -5, 10, 10).fill(GOLD).restore();
    }
    // A thin accent band under the header, like a ribbon.
    doc.rect(25, 150, W - 50, 3).fill(accent);
}

function header(doc, tier) {
    if (fs.existsSync(LOGO)) {
        try { doc.image(LOGO, W / 2 - 17, 38, { width: 34, height: 34 }); } catch (_) { /* no logo, no matter */ }
    }
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10.5)
        .text('THE ENTREPRENEURSHIP NETWORK', 0, 80, { width: W, align: 'center', characterSpacing: 4 });
    doc.fillColor(tier.accent).font('Helvetica-Bold').fontSize(24)
        .text(tier.label, 0, 98, { width: W, align: 'center', characterSpacing: 3 });
    doc.fillColor(QUIET).font('Times-Italic').fontSize(11)
        .text(tier.why, 90, 130, { width: W - 180, align: 'center' });
}

function recipient(doc, name, statement) {
    doc.fillColor(QUIET).font('Times-Italic').fontSize(13).text('This certifies that', 0, 168, { width: W, align: 'center' });
    doc.fillColor(INK).font('Times-Bold').fontSize(38).text(name || '', 60, 186, { width: W - 120, align: 'center' });
    doc.moveTo(W / 2 - 180, 232).lineTo(W / 2 + 180, 232).lineWidth(0.8).strokeColor(GOLD).stroke();
    doc.fillColor(BODY).font('Helvetica').fontSize(12)
        .text(statement, 100, 242, { width: W - 200, align: 'center', lineGap: 2 });
}

/** Left: what they can do. Right: what it took. */
function panels(doc, tier, can, took) {
    const top = 292, height = 150;
    doc.roundedRect(60, top, 430, height, 8).fill(tier.soft);
    doc.roundedRect(506, top, W - 566, height, 8).fill(tier.soft);

    doc.fillColor(tier.accent).font('Helvetica-Bold').fontSize(9).text(can.title, 78, top + 14, { characterSpacing: 2 });
    let y = top + 34;
    const twoCols = can.items.length > 5;
    can.items.forEach((item, i) => {
        const col = twoCols && i >= Math.ceil(can.items.length / 2) ? 1 : 0;
        const row = twoCols ? i % Math.ceil(can.items.length / 2) : i;
        const x = 80 + col * 205, yy = y + row * (twoCols ? 19 : 25);
        doc.rect(x, yy + 4, 5, 5).fill(tier.accent);
        doc.fillColor(INK).font('Helvetica').fontSize(twoCols ? 10 : 11.5)
            .text(item, x + 13, yy, { width: (twoCols ? 190 : 390), lineBreak: false, ellipsis: true });
    });

    doc.fillColor(tier.accent).font('Helvetica-Bold').fontSize(9).text('WHAT IT TOOK', 524, top + 14, { characterSpacing: 2 });
    y = top + 32;
    for (const [value, caption] of took) {
        doc.fillColor(tier.accent).font('Helvetica-Bold').fontSize(16).text(value, 524, y, { width: 84 });
        doc.fillColor(BODY).font('Helvetica').fontSize(9.5).text(caption, 610, y + 3, { width: W - 60 - 610 - 14 });
        y += 37;
    }
}

async function footer(doc, tier, { certificateId, issued, verifyUrl }) {
    // Signature, in a script face when pdfHelpers has registered one.
    let script = 'Times-Italic';
    try { doc.font('DancingScript-Regular'); script = 'DancingScript-Regular'; } catch (_) { /* not registered */ }
    doc.fillColor(INK).font(script).fontSize(22).text('Kamlesh Gupta', 82, 470, { width: 200 });
    doc.moveTo(80, 500).lineTo(270, 500).lineWidth(0.7).strokeColor(BODY).stroke();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text('Kamlesh Gupta', 80, 506);
    doc.fillColor(QUIET).font('Helvetica').fontSize(8.5).text('Director, The Entrepreneurship Network', 80, 519);

    // The seal.
    const cx = W / 2, cy = 500;
    doc.circle(cx, cy, 36).fill(tier.accent);
    doc.circle(cx, cy, 31).lineWidth(1.2).strokeColor(GOLD).stroke();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15).text('TEN', cx - 30, cy - 12, { width: 60, align: 'center' });
    doc.fillColor('#F3E3B4').font('Helvetica-Bold').fontSize(5.6).text(tier.seal, cx - 30, cy + 6, { width: 60, align: 'center', characterSpacing: 0.8 });

    // Proof: the ID and a QR code that opens the public verify page.
    if (verifyUrl) {
        const png = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 240, color: { dark: INK, light: '#FFFFFF' } });
        doc.image(png, W - 136, 454, { width: 70, height: 70 });
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text(`Certificate ID: ${certificateId || ''}`, W - 420, 466, { width: 270, align: 'right' });
    doc.fillColor(QUIET).font('Helvetica').fontSize(8.5)
        .text(`Issued ${issued}`, W - 420, 480, { width: 270, align: 'right' })
        .text('Scan the code to check it is genuine, or visit', W - 420, 494, { width: 270, align: 'right' });
    const shown = String(verifyUrl || '').replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/[^/]*$/, (m) => (/verify\//.test(verifyUrl) ? '' : m));
    doc.fillColor(tier.accent).font('Helvetica').fontSize(7.2).text(shown, W - 420, 507, { width: 270, align: 'right' });
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Draw one internship certificate (expert | nano_degree | fellowship) onto doc.
 * data: studentName, domain, durationText, startDate, endDate, certificateId,
 * and when known completionPct (tasks approved) and cohortRankPct.
 */
async function drawInternshipCertificate(doc, type, data) {
    const tier = TIERS[type];
    if (!tier) throw new Error('unknown certificate type ' + type);
    const pct = Number.isFinite(data.completionPct) ? Math.round(data.completionPct) : null;
    const rank = Number.isFinite(data.cohortRankPct) ? Math.max(1, Math.ceil(data.cohortRankPct)) : null;
    const need = { expert: 30, nano_degree: 70, fellowship: 70 }[type];
    const period = data.startDate && data.endDate ? `${data.startDate} – ${data.endDate}` : '';
    const award = { expert: 'the Expert Certificate', nano_degree: 'the Nano Degree', fellowship: 'the TEN Fellowship' }[type];

    frame(doc, tier.accent);
    header(doc, tier);
    const when = [data.durationText || data.tenure, period].filter(Boolean).join(', ');
    recipient(doc, data.studentName, `has earned ${award} in ${data.domain || 'their domain'}, through The Entrepreneurship `
        + `Network’s virtual internship${when ? ` (${when})` : ''}.`);

    const took = [];
    if (type === 'fellowship') took.push([rank ? `Top ${rank}%` : 'Top 10%', `of all interns in ${data.domain || 'the domain'}`]);
    took.push([pct != null ? `${pct}%` : `${need}%+`, `of tasks approved by a TEN coordinator (${need}% needed)`]);
    took.push([data.durationText || data.tenure || '—', 'of weekly tasks, reviews and attendance']);
    if (took.length < 3) took.push(['Verified', 'anyone can check this certificate by its ID or QR code']);
    panels(doc, tier, { title: `WHAT ${firstName(data.studentName).toUpperCase()} CAN DO`, items: domainSkills(data.domain) }, took);

    const base = (process.env.BASE_URL || 'https://virtualinternships.entrepreneurshipnetwork.net').replace(/\/$/, '');
    await footer(doc, tier, { certificateId: data.certificateId, issued: fmtDate(data.issuedAt || Date.now()),
        verifyUrl: data.certificateId ? `${base}/cert-verify.html?id=${encodeURIComponent(data.certificateId)}` : '' });
}

/**
 * The learning portal's Certificate of Completion. course: { name, topics[] };
 * topics are listed as what was mastered.
 */
async function drawCourseCertificate(doc, { name, course, certificateId, issuedAt, verifyUrl }) {
    const tier = TIERS.course;
    const all = (course.topics || []).map((t) => String(t.title || t.name || t).trim());
    const topics = all.filter((t) => !/final (mini )?project/i.test(t))
        .map((t) => (t.length <= 38 ? t : t.split(':')[0].trim()));
    frame(doc, tier.accent);
    header(doc, tier);
    recipient(doc, name, `has completed the TEN course in ${course.name}: every topic studied and tested, `
        + 'the proctored final examination passed, and the final project finished.');
    // Ten topics fit the panel; the count says how many there were.
    const shown = topics.length > 10 ? topics.filter((_, i) => i % Math.ceil(topics.length / 10) === 0).slice(0, 10) : topics;
    panels(doc, tier, { title: `${all.length} TOPICS MASTERED, INCLUDING`, items: shown }, [
        [String((course.topics || []).length), 'topics, each with a lesson and a test'],
        ['Passed', 'a proctored final examination'],
        ['Done', 'a final project, reviewed']
    ]);
    await footer(doc, tier, { certificateId, issued: fmtDate(issuedAt || Date.now()), verifyUrl });
}

/** Write a certificate PDF to outputPath; resolves with the path. */
function renderToFile(outputPath, draw) {
    return new Promise((resolve, reject) => {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: 'Certificate — The Entrepreneurship Network' } });
        try { require('./pdfHelpers').registerFonts(doc); } catch (_) { /* standard fonts only */ }
        const stream = fs.createWriteStream(outputPath);
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
        doc.pipe(stream);
        Promise.resolve(draw(doc)).then(() => doc.end(), (err) => { doc.end(); reject(err); });
    });
}

module.exports = { TIERS, domainSkills, drawInternshipCertificate, drawCourseCertificate, renderToFile, W, H };
