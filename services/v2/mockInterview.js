'use strict';

const atsEngine = require('./atsResumeEngine');

/**
 * The mock interview: questions from this person's own resume, and a reading
 * of what they actually said.
 *
 * Interview practice tools mostly ask generic questions and then grade the
 * answer with a model. Neither half is necessary. The questions worth
 * rehearsing are the ones a real interviewer would ask about THIS page — the
 * bullet with the number in it, the skill listed with nothing behind it, the
 * gap between two dates — and those come straight out of the fact ledger.
 *
 * The scoring is deterministic and says what it measured. It reads a
 * transcript, not a voice: it can tell whether an answer named a number, a
 * tool and an outcome, how long it ran, and how much of it was filler. It
 * cannot hear confidence, and it does not claim to — a "tone" score derived
 * from a transcript is a guess wearing a number, so what is reported here is
 * what the words show.
 */

/* Words that fill time without carrying anything. */
const FILLER = ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'sort of',
  'kind of', 'i mean', 'literally', 'obviously', 'just', 'stuff', 'things'];

/* Hedges that make a true claim sound unsure. */
const HEDGE = ['i think', 'maybe', 'probably', 'i guess', 'sort of', 'kind of',
  'a little bit', 'somewhat', 'i believe', 'possibly', 'not sure'];

const STAR_MARKERS = {
  situation: /\b(when|while|during|at the time|the project|we were|i was working)\b/i,
  task: /\b(needed to|had to|my job|responsible|asked me|the goal|target)\b/i,
  /* First-person doing, in the words people actually use. The list was ten
     verbs long and missed "I profiled", "I rewrote", "I debugged" — so a
     well-told answer was reported as never saying what the candidate did. */
  action: /\bi\s+(?:then\s+|also\s+|personally\s+)?(?:built|wrote|rewrote|changed|added|removed|migrated|automated|fixed|led|designed|tested|profiled|debugged|refactored|shipped|deployed|configured|implemented|investigated|measured|reduced|improved|set up|took|owned|handled|proposed|introduced)\b/i,
  result: /\b(which (cut|reduced|saved|increased)|resulting in|as a result|ended up|so that|meant that|dropped|rose|went from)\b/i,
};

/**
 * The questions, drawn from the page in front of them.
 *
 * Ordered the way an interview runs: opening, then the work, then the gaps,
 * then the close. Each carries what a good answer must contain, so the report
 * can say what was missing rather than just giving a mark.
 */
function questionsFor(resumeText, options = {}) {
  const led = atsEngine.factLedger(resumeText || '');
  const role = options.role || led.title || 'the role';
  const jd = options.jd || '';
  const qs = [];
  const add = (kind, prompt, wants) => qs.push({ id: `q${qs.length + 1}`, kind, prompt, wants });

  add('opening', `Tell me about yourself and why you are applying for this ${role} position.`,
    ['a role in one sentence', 'two or three things you have actually built', 'why this job specifically']);

  /* The strongest quantified bullet: the one they will be asked to defend. */
  const bullets = [
    ...led.roles.flatMap((r) => r.bullets),
    ...led.projects.flatMap((p) => p.bullets),
  ].map((b) => String(b).trim()).filter(Boolean);

  const scoped = bullets.find((b) => /\d/.test(b));
  if (scoped) {
    add('defend', `Your resume says: "${scoped.slice(0, 140)}". Walk me through that — what did you build, and how did you measure the number?`,
      ['how the number was measured', 'what you personally did', 'what it changed']);
  }

  const other = bullets.filter((b) => b !== scoped).slice(0, 2);
  other.forEach((b) => {
    add('detail', `Tell me more about this: "${String(b).slice(0, 130)}". What was the hardest part?`,
      ['the specific problem', 'the decision you made', 'how it turned out']);
  });

  /* A skill they claimed with no bullet behind it — the question that ends
     interviews when it is not rehearsed. */
  const unbacked = led.unevidencedSkills[0];
  if (unbacked) {
    add('unevidenced', `You list ${unbacked} on your resume but there is no project behind it. Where have you used it?`,
      ['an honest answer about the level you are at', 'what you have actually done with it', 'what you would need to get production-ready']);
  }

  /* A term the posting wants that the page cannot prove. */
  if (jd) {
    const missing = (atsEngine.jdMap(resumeText || '', led, jd) || { mustMissing: [] }).mustMissing[0];
    if (missing) {
      add('gap', `This role asks for ${missing}. Your resume does not show it — how would you handle that?`,
        ['no bluffing', 'the nearest thing you have done', 'how you would pick it up']);
    }
  }

  add('behavioural', 'Tell me about a time something you built broke, or did not work the way you expected. What did you do?',
    ['a real incident', 'what you did about it', 'what you changed afterwards']);

  add('closing', 'What questions do you have for us?',
    ['something specific to the team or the work', 'not pay or holidays in the first round']);

  return { role, questions: qs.slice(0, options.limit || 7) };
}

/**
 * One answer, read.
 *
 * Everything here is countable from the transcript. Nothing infers a mood.
 */
function scoreAnswer(transcript, question) {
  const text = String(transcript || '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  const low = text.toLowerCase();
  const wants = (question && question.wants) || [];

  if (words.length < 8) {
    return {
      words: words.length,
      tooShort: true,
      score: 0,
      of: 100,
      met: [],
      missing: wants,
      notes: ['Barely an answer — an interviewer hears silence as "I have not done this".'],
    };
  }

  const fillerHits = FILLER.filter((f) => low.includes(f));
  const fillerRate = fillerHits.reduce(
    (n, f) => n + (low.match(new RegExp(`\\b${f.replace(/ /g, '\\s+')}\\b`, 'g')) || []).length, 0) / words.length;
  const hedgeHits = HEDGE.filter((h) => low.includes(h));

  const hasNumber = /\d/.test(text);
  const star = Object.entries(STAR_MARKERS)
    .filter(([, re]) => re.test(text)).map(([k]) => k);
  const firstPerson = (low.match(/\bi\s/g) || []).length;
  const weTold = (low.match(/\bwe\s/g) || []).length;

  const notes = [];
  let score = 0;

  /* Length: an interview answer runs 60–200 words. Shorter is a shrug,
     longer stops being answered and starts being narrated. */
  if (words.length >= 60 && words.length <= 220) score += 25;
  else if (words.length >= 35) { score += 15; notes.push(`${words.length} words — aim for 60 to 200; that is about 45 seconds.`); }
  else { score += 5; notes.push(`Only ${words.length} words. That reads as "I do not have an example".`); }

  /* A number is the difference between a claim and an anecdote. */
  if (hasNumber) score += 20;
  else notes.push('No number anywhere. Interviewers remember figures and forget adjectives.');

  /* STAR shape, counted by its markers rather than asserted. */
  score += Math.min(30, star.length * 8);
  if (!star.includes('result')) notes.push('You described what you did but never said what changed because of it.');
  if (!star.includes('action')) notes.push('The answer never says what YOU did — an interviewer cannot credit you for it.');

  /* Ownership: "we" throughout, with no "I", makes it impossible to tell
     what this person contributed. */
  if (firstPerson === 0 && weTold > 2) {
    notes.push('Every sentence says "we". Say what you personally did — that is the thing being hired.');
  } else score += 10;

  /* Filler and hedging, reported as rates rather than vibes. */
  if (fillerRate < 0.02) score += 10;
  else notes.push(`Filler words are ${(fillerRate * 100).toFixed(1)}% of the answer (${fillerHits.slice(0, 4).join(', ')}). Under 2% sounds prepared.`);

  if (!hedgeHits.length) score += 5;
  else notes.push(`Hedging: "${hedgeHits.slice(0, 3).join('", "')}". You did the work — say so plainly.`);

  /*
   * What a good answer to THIS question had to contain, judged by the thing
   * itself rather than by keyword-matching the description of it. Looking for
   * the first long word of "how the number was measured" inside the answer
   * found nothing in a reply that plainly measured the number, so the list
   * came back entirely unmet on an answer scoring 86.
   */
  const checks = {
    'how the number was measured': () => hasNumber && /\b(measured|dashboard|monitor|metric|logs|apm|benchmark|tracked|counted)\b/i.test(text),
    'what you personally did': () => STAR_MARKERS.action.test(text),
    'what it changed': () => STAR_MARKERS.result.test(text),
    'the specific problem': () => STAR_MARKERS.situation.test(text),
    'the decision you made': () => /\b(i (chose|decided|picked|went with)|instead of|rather than|because)\b/i.test(text),
    'how it turned out': () => STAR_MARKERS.result.test(text),
  };
  const met = wants.filter((w) => (checks[w] ? checks[w]() : words.length >= 60));

  return {
    words: words.length,
    tooShort: false,
    score: Math.max(0, Math.min(100, score)),
    of: 100,
    hasNumber,
    star,
    fillerRate: Number((fillerRate * 100).toFixed(1)),
    fillerWords: fillerHits.slice(0, 6),
    hedges: hedgeHits.slice(0, 4),
    ownership: firstPerson === 0 && weTold > 2 ? 'we' : 'i',
    met,
    missing: wants.filter((w) => !met.includes(w)),
    notes,
  };
}

/**
 * The whole session, read together.
 *
 * The headline number is the mean of the answers actually given — an unanswered
 * question is reported as unanswered rather than scored as zero and buried in
 * an average, because "you skipped four" and "you answered four badly" are
 * different problems with different fixes.
 */
function scoreSession(answers) {
  const given = (answers || []).filter((a) => a && a.transcript && a.transcript.trim().split(/\s+/).length >= 8);
  const skipped = (answers || []).length - given.length;

  /*
   * Too little said is reported as too little said.
   *
   * The temptation is to average whatever exists and print a number, so the
   * session "worked". A candidate who said forty words across seven questions
   * has not performed badly, they have not performed — and telling them 62
   * would be the single most misleading thing this file could do. The gauge
   * reads zero and says why, which is what a real reviewer would say.
   */
  const totalWords = (answers || [])
    .reduce((n, a) => n + String((a && a.transcript) || '').split(/\s+/).filter(Boolean).length, 0);

  /* Sixty words is about twenty-five seconds of speech: below it there is
     nothing to read. Two honest fifty-word answers are a real attempt and
     must not be thrown away as silence. */
  if (!given.length || totalWords < 60) {
    return {
      answered: given.length,
      skipped,
      score: 0,
      of: 100,
      verdict: 'We need more answers.',
      detail: `You gave ${totalWords} words across ${(answers || []).length} question${(answers || []).length === 1 ? '' : 's'}. That is not enough to report on — an interviewer would hear it as "I do not have an example".`,
      strengths: [],
      fixes: ['Answer at least three questions properly — roughly 45 seconds each — and run it again.'],
    };
  }

  const scored = given.map((a) => ({ ...a, result: scoreAnswer(a.transcript, a.question) }));
  const score = Math.round(scored.reduce((n, s) => n + s.result.score, 0) / scored.length);

  const withNumbers = scored.filter((s) => s.result.hasNumber).length;
  const avgWords = Math.round(scored.reduce((n, s) => n + s.result.words, 0) / scored.length);
  const avgFiller = Number((scored.reduce((n, s) => n + s.result.fillerRate, 0) / scored.length).toFixed(1));

  const strengths = [];
  if (withNumbers === scored.length) strengths.push('Every answer carried a number.');
  else if (withNumbers) strengths.push(`${withNumbers} of ${scored.length} answers carried a number.`);
  if (avgFiller < 2) strengths.push(`Filler was ${avgFiller}% — that sounds prepared.`);
  if (avgWords >= 60 && avgWords <= 220) strengths.push(`Answers averaged ${avgWords} words, which is the right length.`);
  if (scored.every((s) => s.result.star.includes('result'))) strengths.push('Every answer said what changed as a result.');

  /* The fixes, worst first, deduplicated: three copies of the same note is
     one problem, not three. */
  const seen = new Set();
  const fixes = scored.flatMap((s) => s.result.notes).filter((n) => {
    const key = n.slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);

  /*
   * The three labels an interview report is expected to carry, derived from
   * the words and labelled as such.
   *
   * Clarity, confidence and enthusiasm are properties of a voice. This has
   * only a transcript, so each one is named from something countable in the
   * text and the report says so out loud rather than implying a microphone
   * was listening. A number pretending to be a measurement of someone's
   * confidence is the worst thing a tool like this can hand a nervous student.
   */
  const hedgeCount = scored.reduce((n, s) => n + s.result.hedges.length, 0);
  const resultShare = scored.filter((s) => s.result.star.includes('result')).length / scored.length;
  const ownedShare = scored.filter((s) => s.result.ownership === 'i').length / scored.length;

  const tone = {
    clarity: avgFiller < 2 && avgWords >= 60 && avgWords <= 220 ? 'Clear'
      : avgFiller < 5 ? 'Mostly clear' : 'Ambiguous',
    clarityWhy: `${avgFiller}% filler, answers averaging ${avgWords} words.`,
    confidence: hedgeCount === 0 && ownedShare > 0.7 ? 'Assured'
      : hedgeCount <= 2 ? 'Steady' : 'Hedging',
    confidenceWhy: hedgeCount
      ? `${hedgeCount} hedge${hedgeCount === 1 ? '' : 's'} ("I think", "maybe") across ${scored.length} answers.`
      : 'No hedging, and you said "I" rather than "we".',
    enthusiasm: resultShare > 0.7 && withNumbers === scored.length ? 'Engaged'
      : resultShare > 0.3 ? 'Even' : 'Tepid',
    enthusiasmWhy: `${Math.round(resultShare * 100)}% of answers said what changed as a result.`,
    caveat: 'Read from your words, not your voice — there is no microphone in this. Treat these as labels for the transcript, not a verdict on how you came across.',
  };

  /* Pace, honestly framed. Without audio there is no words-per-minute, only
     an estimate from answer length at a normal speaking rate. */
  const pace = {
    proxy: true,
    estimate: `${avgWords} words per answer, roughly ${Math.round(avgWords / 2.3)} seconds at a normal speaking pace`,
    inRange: avgWords >= 60 && avgWords <= 220,
    note: 'A text proxy, not words per minute — that needs the audio, which this does not have.',
  };

  return {
    answered: scored.length,
    skipped,
    score,
    of: 100,
    avgWords,
    avgFiller,
    withNumbers,
    tone,
    pace,
    verdict: score >= 80 ? 'Strong — this would hold up in a first round.'
      : score >= 60 ? 'Passable, and the gaps are specific enough to rehearse.'
        : 'Not ready yet. The answers are there; the shape is not.',
    strengths,
    fixes,
    perQuestion: scored.map((s) => ({
      prompt: s.question && s.question.prompt,
      score: s.result.score,
      words: s.result.words,
      notes: s.result.notes,
    })),
    caveat: 'Measured from the transcript — length, numbers, answer shape, filler and ownership. It cannot hear your voice, and it does not pretend to score confidence.',
  };
}

/**
 * Better answers, assembled only from what the resume already says.
 *
 * The obvious move is to write three polished answers and hand them over.
 * That would put words in somebody's mouth that they cannot defend when the
 * follow-up question comes, which is worse than a bad answer honestly given.
 * So these are scaffolds: their own bullet, dropped into the shape an
 * interviewer is listening for, with the parts only they can fill left
 * visibly blank.
 */
function betterAnswers(resumeText, limit = 3) {
  const led = atsEngine.factLedger(resumeText || '');
  const bullets = [
    ...led.roles.flatMap((r) => r.bullets),
    ...led.projects.flatMap((p) => p.bullets),
  ].map((b) => String(b).trim()).filter((b) => b.split(/\s+/).length > 5);

  /* The ones with a number first: they are the answers that land. */
  const ordered = [...bullets].sort((a, b) => (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0));

  return ordered.slice(0, limit).map((b) => ({
    from: b.slice(0, 120),
    scaffold: [
      `Situation — "${b.slice(0, 90)}${b.length > 90 ? '…' : ''}". Say where and when: which team, which month.`,
      'Task — what you were asked for, in one sentence.',
      `Action — what YOU did. Start with "I": ${/\d/.test(b) ? 'name the change you made that produced that number.' : 'name the specific thing you built or fixed.'}`,
      /\d/.test(b)
        ? 'Result — you already have the figure. Say how you measured it, because that is the follow-up.'
        : 'Result — this bullet has no number. Find one before the interview: how many, how much, how often.',
    ],
    hasNumber: /\d/.test(b),
  }));
}

module.exports = { questionsFor, scoreAnswer, scoreSession, betterAnswers, FILLER, HEDGE };
