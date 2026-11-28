'use strict';

/**
 * A LinkedIn profile saved as a PDF ("More → Save to PDF"), turned into the
 * resume text the agents read: name, headline and contact on top, then
 * SUMMARY, SKILLS, EXPERIENCE, EDUCATION, CERTIFICATIONS and ACHIEVEMENTS.
 *
 * The layout is LinkedIn's two-column export as pdf-parse reads it, checked
 * against two real exports: the sidebar comes first (Contact, Top Skills,
 * Languages, Certifications, Honors-Awards, Publications), then the name, the
 * headline and the location, then Summary, Experience and Education, with
 * "Page 1 of 2" wherever a page breaks — once in the middle of an education
 * entry. The sidebar is narrow, so its text wraps: a URL breaks after a
 * hyphen, an email can leave its last letter on the next line, and one real
 * export had a line reading only "Experience" (the end of a certificate's
 * name) long before the Experience section.
 *
 * Text that is not that export is returned exactly as it came, and so is the
 * export itself if any step here fails.
 */

const SIDEBAR = ['Contact', 'Top Skills', 'Languages', 'Certifications', 'Honors-Awards', 'Publications', 'Patents'];
const MAIN_END = ['Education', 'Volunteer Experience', 'Projects', 'Courses'];
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
const DATE_LINE = new RegExp(`^(?:(?:${MONTHS})\\s+)?\\d{4}\\s*[-–—]\\s*(?:(?:(?:${MONTHS})\\s+)?\\d{4}|Present)\\s*(?:\\([^)]*\\))?$`, 'i');
const DURATION_LINE = /^(?:\d+\s+(?:years?|months?)\s*){1,2}$|^less than a year$/i;
const PAGE = /^Page \d+ of \d+$/;
const LABEL = /\s*\((LinkedIn|Mobile|Personal|Company|Portfolio|Other|Home|Work|Blog|RSS Feed)\)\s*$/;
const BULLET = /^[-•*·▪]\s*/;

const words = (l) => l.split(/\s+/).filter(Boolean);
/* A sentence or a long line belongs to a description, not to a header. */
const descriptive = (l) => l.length > 60 || /[.!?:;,]$/.test(l) || BULLET.test(l) || /^[a-z]/.test(l);
const shortTitle = (l) => l.length <= 40 && words(l).length <= 6 && /^[A-Z0-9]/.test(l) && !descriptive(l);
const place = (l) => l.length <= 60 && words(l).length <= 7 && !/[.!?:;]$/.test(l) && !BULLET.test(l)
    && !DATE_LINE.test(l) && !DURATION_LINE.test(l)
    && (l.includes(',') || words(l).every((w) => /^[A-Z(]/.test(w) || /^(of|and|the|de|da|del|la|le)$/.test(w)));
const looksLikeName = (l) => !!l && l.length <= 50 && !/\d|@|\||\bat\b/.test(l) && words(l).length >= 1 && words(l).length <= 5
    && words(l).every((w) => /^[A-Z][A-Za-z'’.-]*$/.test(w) || /^(de|da|van|von|bin|binti|al|el)$/.test(w));

/** Wrapped text back into paragraphs: a bullet or a finished sentence starts a new one. */
function paragraphs(lines) {
    const out = [];
    lines.forEach((l) => {
        const text = l.replace(BULLET, '');
        if (!text) return;
        if (!out.length || BULLET.test(l) || /[.!?:]$/.test(out[out.length - 1])) out.push(text);
        else out[out.length - 1] += ` ${text}`;
    });
    return out;
}

/** The Contact block: email, phone, profile and site links, with wrapped lines put back together. */
function contactOf(lines) {
    const out = { email: '', phone: '', links: [] };
    for (let i = 0; i < lines.length; i += 1) {
        let l = lines[i];
        if (l.includes('@')) {
            /* "…@gmail.co" + "m": the sidebar was too narrow for the last letter. */
            if (/^[a-z]{1,4}$/.test(lines[i + 1] || '')) { l += lines[i + 1]; i += 1; }
            if (!out.email) out.email = l;
            continue;
        }
        if (/linkedin\.com\/|www\.|https?:\/\//i.test(l) || (/-$/.test(l) && !LABEL.test(l))) {
            while (!LABEL.test(l) && i + 1 < lines.length && !/\s/.test(lines[i + 1].replace(LABEL, ''))) { l += lines[i + 1]; i += 1; }
            out.links.push(l.replace(LABEL, '').replace(/^https?:\/\//, '').replace(/^www\./, ''));
            continue;
        }
        const bare = l.replace(LABEL, '');
        if (/^\+?[\d\s()-]{7,}$/.test(bare)) { if (!out.phone) out.phone = bare.trim(); continue; }
        if (bare) out.links.push(bare);
    }
    return out;
}

/**
 * Experience entries from the main column. A role is its title, then its
 * dates ("May 2020 - Present (3 years)"), then perhaps its location, then its
 * description. Its company is the line above the title, or above a total-time
 * line ("4 years 2 months") when one company held several roles, which the
 * later roles of that company then share.
 */
function experienceOf(lines) {
    const D = lines.map((l, i) => (DATE_LINE.test(l) && i > 0 ? i : -1)).filter((i) => i >= 0);
    const entries = [];
    let group = '';
    let from = 0;
    D.forEach((d, k) => {
        const gap = lines.slice(from, d - 1);
        let company = '';
        let desc = gap;
        if (gap.length >= 2 && DURATION_LINE.test(gap[gap.length - 1])) {
            company = gap[gap.length - 2];
            desc = gap.slice(0, -2);
            group = company;
        } else if (!gap.length || (group && descriptive(gap[gap.length - 1]))) {
            company = group;
        } else {
            company = gap[gap.length - 1];
            desc = gap.slice(0, -1);
            group = '';
            /* A long company name wraps onto two short lines. */
            if (desc.length === 1 && shortTitle(desc[0])) { company = `${desc[0]} ${company}`; desc = []; }
        }
        if (entries.length) entries[entries.length - 1].desc.push(...desc);

        /* The line after the dates is the location when it reads like a place,
           unless it can only be the next role's company. */
        const nextTitle = k + 1 < D.length ? D[k + 1] - 1 : lines.length;
        let next = d + 1;
        const onlyLineBeforeNext = next === nextTitle - 1;
        if (next < nextTitle && place(lines[next]) && !(onlyLineBeforeNext && !group)) next += 1;
        entries.push({ company, title: lines[d - 1], dates: lines[d].replace(/\s*\([^)]*\)\s*$/, ''), desc: [] });
        from = next;
    });
    if (entries.length) entries[entries.length - 1].desc.push(...lines.slice(from));
    return entries;
}

/** Education: the school, then the degree, which ends with "· (2016 - 2020)". */
function educationOf(lines) {
    const out = [];
    let buf = [];
    const DATES = /\s*·?\s*\((\d{4})\s*[-–—]\s*(\d{4}|Present)\)\s*$/i;
    lines.forEach((l) => {
        buf.push(l);
        const m = l.match(DATES);
        if (!m) return;
        const school = buf[0].replace(DATES, '');
        const degree = buf.slice(1).join(' ').replace(DATES, '').trim();
        out.push([degree, school, `${m[1]} - ${m[2]}`].filter(Boolean).join(' | '));
        buf = [];
    });
    return out.concat(buf);
}

/** The whole profile as resume text, or null when this is not LinkedIn's export. */
function convert(text) {
    const raw = String(text || '');
    if (!/linkedin\.com\/in\//i.test(raw)) return null;
    const L = raw.split('\n').map((l) => l.trim()).filter((l) => l && !PAGE.test(l));
    if (L.indexOf('Contact') < 0 || !raw.split('\n').some((l) => PAGE.test(l.trim()))) return null;

    /* The main column starts at Summary, or at the Experience heading that a
       role's dates follow — not at a sidebar line that only reads "Experience". */
    const expAt = L.findIndex((l, i) => l === 'Experience' && L.slice(i + 1, i + 6).some((x) => DATE_LINE.test(x)));
    const sumAt = L.indexOf('Summary');
    const main = sumAt >= 0 && (expAt < 0 || sumAt < expAt) ? sumAt : expAt;
    if (main < 3) return null;

    /* The name: the line matching the profile link's handle, or the line
       three above the main column (name, headline, location). */
    const linkAt = L.findIndex((l) => /linkedin\.com\/in\//i.test(l));
    let handle = L[linkAt].replace(/.*linkedin\.com\/in\//i, '');
    for (let i = linkAt + 1; !LABEL.test(handle) && i < L.length && i < linkAt + 3; i += 1) handle += L[i];
    const tokens = handle.replace(LABEL, '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 2);
    let nameAt = -1;
    for (let k = main - 2; k >= Math.max(0, main - 6) && nameAt < 0; k -= 1) {
        const w = words(L[k].toLowerCase()).map((x) => x.replace(/[^a-z]/g, ''));
        if (looksLikeName(L[k]) && w.filter((x) => tokens.includes(x)).length >= Math.min(2, w.length)) nameAt = k;
    }
    if (nameAt < 0) nameAt = looksLikeName(L[main - 3]) ? main - 3 : main - 2;
    const name = L[nameAt];
    const headline = L.slice(nameAt + 1, main - 1).join(' ');
    const location = nameAt < main - 1 ? L[main - 1] : '';

    /* The sidebar, section by section, up to the name. */
    const side = {};
    let current = null;
    L.slice(0, nameAt).forEach((l) => {
        if (SIDEBAR.includes(l)) { current = l; side[l] = side[l] || []; return; }
        if (current) side[current].push(l);
    });
    const contact = contactOf(side.Contact || []);

    const end = (start) => {
        const stop = L.findIndex((l, i) => i > start && MAIN_END.includes(l));
        return stop < 0 ? L.length : stop;
    };
    const summary = sumAt >= 0 && sumAt === main ? paragraphs(L.slice(sumAt + 1, expAt > sumAt ? expAt : end(sumAt))) : [];
    const roles = expAt >= 0 ? experienceOf(L.slice(expAt + 1, end(expAt))) : [];
    const eduAt = L.findIndex((l, i) => i > main && l === 'Education');
    const education = eduAt >= 0 ? educationOf(L.slice(eduAt + 1)) : [];

    const doc = [name];
    if (headline) doc.push(headline);
    doc.push([contact.email, contact.phone, ...contact.links, location].filter(Boolean).join(' | '));
    const section = (title, lines) => { if (lines.length) doc.push('', title, ...lines); };
    section('SUMMARY', summary);
    section('SKILLS', [
        ...(side['Top Skills'] || []).length ? [(side['Top Skills']).join(', ')] : [],
        ...(side.Languages || []).length ? [`Languages: ${side.Languages.join(', ')}`] : [],
    ]);
    section('EXPERIENCE', roles.flatMap((r) => [
        [r.title, r.company, r.dates].filter(Boolean).join(' | '),
        ...paragraphs(r.desc).map((p) => `- ${p}`),
    ]));
    section('EDUCATION', education);
    section('CERTIFICATIONS', side.Certifications || []);
    section('ACHIEVEMENTS', [...(side['Honors-Awards'] || []), ...(side.Publications || []), ...(side.Patents || [])]);
    return doc.join('\n');
}

/** Resume text for an uploaded PDF's text: converted when it is LinkedIn's export, as it was otherwise. */
function toResume(text) {
    try {
        return convert(text) || text;
    } catch (e) {
        return text;
    }
}

module.exports = { toResume, convert, experienceOf, educationOf, contactOf };
