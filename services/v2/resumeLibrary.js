'use strict';

const atsEngine = require('./atsResumeEngine');

/**
 * One master resume, many named versions, and a library of every bullet the
 * person has ever written.
 *
 * The pattern every serious builder converges on — Resume Matcher's master
 * plus per-job derivative, ATS Beater's ResumeInfo and CustomResumeInfo,
 * ResumeCraftr's workspace of parsed sections — and the one this agent did
 * not have. Each tailor overwrote the last, so a student who tailored for
 * Amazon on Monday and Google on Tuesday had one file by Tuesday evening and
 * no way back.
 *
 * A version is a derivative, never an invention: it holds the text that was
 * produced for that posting, the score it reached, and what was not claimed,
 * so opening it later shows both the document and the honest note that came
 * with it.
 *
 * The relevance ranking is the part usually done with embeddings. It is done
 * here by counting the posting's own hard terms in each bullet, because a
 * bullet that names Kubernetes is the relevant one for a Kubernetes job and
 * no vector store is required to know that.
 */

const MAX_VERSIONS = 24;

/** A stable id from the company, role and day — one per posting per day. */
function versionId(company, role, at) {
  const day = new Date(at || Date.now()).toISOString().slice(0, 10);
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [slug(company) || 'unnamed', slug(role) || 'role', day].join('-');
}

/**
 * Save a tailored version beside the master.
 *
 * The master is never touched: it is the file the person actually maintains,
 * and a tailoring pass is a photograph of it aimed at one employer.
 */
function saveVersion(library, { text, company, role, jd, score, notClaimed }) {
  const lib = normalise(library);
  const id = versionId(company, role);
  const version = {
    id,
    company: company || null,
    role: role || null,
    at: Date.now(),
    text: String(text || ''),
    score: typeof score === 'number' ? score : null,
    /* Kept with the document, because a version opened in three weeks needs
       its caveat as much as it needs its text. */
    notClaimed: Array.isArray(notClaimed) ? notClaimed.slice(0, 10) : [],
    jdSummary: String(jd || '').slice(0, 300) || null,
  };
  const rest = lib.versions.filter((v) => v.id !== id);
  return { ...lib, versions: [version, ...rest].slice(0, MAX_VERSIONS) };
}

function setMaster(library, text) {
  const lib = normalise(library);
  return { ...lib, master: String(text || ''), masterAt: Date.now() };
}

function normalise(library) {
  const lib = library && typeof library === 'object' ? library : {};
  return {
    master: typeof lib.master === 'string' ? lib.master : '',
    masterAt: lib.masterAt || null,
    versions: Array.isArray(lib.versions) ? lib.versions : [],
  };
}

/** Everything on file, newest first, without the full text of each one. */
function listVersions(library) {
  const lib = normalise(library);
  return {
    hasMaster: Boolean(lib.master.trim()),
    masterAt: lib.masterAt,
    versions: lib.versions.map((v) => ({
      id: v.id,
      company: v.company,
      role: v.role,
      at: v.at,
      score: v.score,
      notClaimed: v.notClaimed.length,
      words: v.text.split(/\s+/).filter(Boolean).length,
    })),
  };
}

function getVersion(library, id) {
  return normalise(library).versions.find((v) => v.id === id) || null;
}

/**
 * Every bullet this person has written, across the master and every version,
 * deduplicated.
 *
 * Somebody who has tailored four times has written the same achievement four
 * ways, and the best phrasing is usually not the newest one. Keeping them all
 * means the next tailoring can pull from the whole history rather than only
 * from the file currently open.
 */
function bulletLibrary(library) {
  const lib = normalise(library);
  const sources = [
    { label: 'master', text: lib.master },
    ...lib.versions.map((v) => ({ label: v.company || v.role || v.id, text: v.text })),
  ];

  const seen = new Map();
  sources.forEach((src) => {
    if (!src.text) return;
    const led = atsEngine.factLedger(src.text);
    [...led.roles.flatMap((r) => r.bullets), ...led.projects.flatMap((p) => p.bullets)]
      .map((b) => String(b).trim())
      .filter((b) => b.split(/\s+/).length > 4)
      .forEach((b) => {
        const key = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!seen.has(key)) seen.set(key, { text: b, from: [src.label], hasNumber: /\d/.test(b) });
        else if (!seen.get(key).from.includes(src.label)) seen.get(key).from.push(src.label);
      });
  });
  return [...seen.values()];
}

/**
 * The bullets that matter for one posting, ranked.
 *
 * Scored on the posting's own hard terms, with a number worth something on
 * its own — an achievement that names two of the required tools AND carries a
 * figure is the first line of the tailored page, and that is decidable
 * without a model.
 */
function rankForJd(library, jd, limit = 8) {
  const terms = atsEngine.jdHardTerms(jd || '');
  const bullets = bulletLibrary(library);
  if (!terms.length) return bullets.slice(0, limit).map((b) => ({ ...b, hits: [], score: 0 }));

  return bullets
    .map((b) => {
      const low = b.text.toLowerCase();
      const hits = terms.filter((t) => low.includes(t));
      return { ...b, hits, score: hits.length * 2 + (b.hasNumber ? 1 : 0) };
    })
    /* A number is a tie-breaker between relevant bullets, never a reason to
       call an irrelevant one relevant: ranking a nursing posting against a
       backend resume returned two bullets that matched nothing. */
    .filter((b) => b.hits.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * The blunt read — what a tired recruiter would say about this page in ten
 * seconds, and the checklist behind it.
 *
 * ATS Beater calls this a roast. The value is not the tone, it is that it is
 * short and specific enough to act on before the detailed score arrives. Each
 * line is a fact about the file, never a judgement about the person.
 */
function quickCheck(text) {
  const raw = String(text || '');
  const led = atsEngine.factLedger(raw);
  const words = raw.split(/\s+/).filter(Boolean).length;
  const bullets = [...led.roles.flatMap((r) => r.bullets), ...led.projects.flatMap((p) => p.bullets)];
  const scoped = bullets.filter((b) => /\d/.test(b)).length;

  const checks = [
    { id: 'contact', label: 'Reachable', pass: Boolean(led.email && led.phone),
      note: led.email && led.phone ? 'Email and phone are both there in the body.' : 'An ATS that cannot reply usually discards the application.' },
    { id: 'link', label: 'Profile link', pass: Boolean(led.link),
      note: led.link ? 'Profile URL present as text.' : 'No GitHub or LinkedIn. It is the cheapest credibility on the page.' },
    { id: 'sections', label: 'Standard sections', pass: ['experience', 'education', 'skills'].every((s) => led.sectionsFound.includes(s)),
      note: 'Experience, Education and Skills under those words — a parser looks for the words, not the meaning.' },
    { id: 'numbers', label: 'Numbers in bullets', pass: bullets.length > 0 && scoped >= bullets.length / 2,
      note: `${scoped} of ${bullets.length} bullets carry a figure. Half is the bar; interviewers remember figures.` },
    { id: 'dates', label: 'Dated roles', pass: led.roles.length === 0 || led.roles.every((r) => r.hasDates),
      note: 'Every role needs a month and year at both ends, or it reads as a gap.' },
    { id: 'length', label: 'Fits a page', pass: words >= 250 && words <= 900,
      note: `${words} words. Under 250 is thin, over 900 is two pages of a one-page job.` },
    { id: 'verbs', label: 'Bullets open with a verb', pass: bullets.length > 0 && bullets.filter((b) => /^(built|led|wrote|shipped|cut|automated|migrated|designed|reduced|delivered|implemented|improved|added|ran|tested)/i.test(b)).length >= bullets.length / 2,
      note: 'Half your bullets or more should open with what you did, not what you were responsible for.' },
    { id: 'evidence', label: 'Skills backed by bullets', pass: led.unevidencedSkills.length === 0,
      note: led.unevidencedSkills.length ? `Claimed with nothing behind them: ${led.unevidencedSkills.slice(0, 4).join(', ')}.` : 'Every skill on the page appears in a bullet.' },
  ];

  const failed = checks.filter((c) => !c.pass);
  return {
    checks,
    passed: checks.length - failed.length,
    of: checks.length,
    verdict: failed.length === 0 ? 'Nothing here would get it binned. Run the full score for the last few points.'
      : failed.length <= 2 ? `Two things short: ${failed.map((f) => f.label.toLowerCase()).join(' and ')}.`
        : `${failed.length} of ${checks.length} checks fail. Fix these before anything subtle.`,
    worst: failed.slice(0, 3),
  };
}

module.exports = {
  normalise, setMaster, saveVersion, listVersions, getVersion,
  bulletLibrary, rankForJd, quickCheck, versionId,
};
