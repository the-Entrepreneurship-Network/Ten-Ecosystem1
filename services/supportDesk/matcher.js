'use strict';

/**
 * Which saved answer a student's email is asking for, without AI.
 *
 * TF-IDF cosine similarity between the email and each answer's example
 * questions, after folding together the ways students write the same thing:
 * "emp id", "empid" and "employee no." are one token; greetings, "sir",
 * "please" and Hinglish fillers carry nothing; plurals and tenses collapse.
 * Every sentence is scored on its own as well as the whole email, so one
 * clear question inside a long story still matches.
 *
 * An answer is used only when it scores above the threshold. Anything less
 * goes to a person: a wrong answer about fees or certificates is worse than
 * "our team will reply". Money disputes, harassment, legal threats and
 * anything about self-harm always go to a person, whatever they match.
 */

// Folded to one token before splitting. Specific phrases first.
const PHRASES = [
    // Letter-writing filler that would otherwise outweigh the one word that matters.
    [/\bfeel free to (?:contact|reach|call|message) (?:me|us)\b/g, ' '],
    [/\b(?:employee|emp)\s*e-?mail\s*id\b/g, ' employeeid '],
    [/\b(?:employee|emp|intern(?:ship)?|ten)\s*(?:id|i\.d\.?|no\.?|number|code)\b|\bemp-?id\b/g, ' employeeid '],
    [/\b(?:offer|joining|appointment)\s*letters?\b/g, ' offerletter '],
    [/\bletters? of recommendation\b|\brecommendation letters?\b|\blor\b/g, ' lor '],
    // Both tokens, so "internship certificate" still meets a plain "certificate".
    [/\bletters? of completion\b|\bcompletion (?:letter|certificate)s?\b|\binternship certificates?\b|\bloc\b/g, ' completioncertificate certificate '],
    [/\bcertificates?\b|\bcerti\b|\bcert\b/g, ' certificate '],
    [/\b(?:forgot|forget|forgotten|reset|recover|lost)\s+(?:my\s+|the\s+)?(?:password|pass|pwd)\b|\bpassword\s+(?:bhool|bhul)\b/g, ' passwordreset '],
    [/\b(?:log\s?-?in|sign\s?-?in|signin)\b/g, ' login '],
    // Kept apart: "what is the fee" and "how do I pay" want different answers.
    [/\b(?:fees?|charges?|paisa|paise|amount|cost|price|pricing)\b/g, ' fee '],
    [/\b(?:pay|paid|paying|payments?|upi|utr)\b/g, ' pay '],
    [/\b(?:attendance|attendence|attendnce|atendance|attandance)\b/g, ' attendance '],
    [/\bwhats\s?app\b|\bwa\s+group\b/g, ' whatsapp '],
    [/\bmark\s?sheets?\b|\bmarks?\s?cards?\b/g, ' marksheet '],
    [/\baddress\s+proofs?\b|\baadh?aa?r\b|\bid\s+proof\b/g, ' addressproof '],
    [/\bdocs?\b|\bdocuments?\b/g, ' document '],
    [/\btasks?\b|\bassignments?\b/g, ' task '],
    [/\bco-?ordinators?\b/g, ' coordinator '],
    [/\bstipend\b|\bsalary\b/g, ' stipend '],
    [/\bfree of (?:cost|charge)\b|\bwithout (?:any )?fee\b/g, ' free '],
    // Hinglish: the words that carry the question, in English.
    [/\bkab\b/g, ' when '], [/\b(?:kaise|kese|kaisa)\b/g, ' how '],
    [/\b(?:milega|milegi|milta|milti|mila|mili)\b/g, ' get ']
];

const STOP = new Set((
    'a an the and or but if so to of in on at for from by with about as into than then also just only very ' +
    'is am are was were be been being do does did done have has had having can could would should will shall may might must ' +
    'i me my mine we us our you your he she him her it its they them their this that these those there here ' +
    'what when how why where which who whom whose whether any some all each every no not yes ok okay ' +
    'get got getting want wanted need needed know tell let help like please pls plz kindly ' +
    'sir mam maam madam hello hi hii hey dear team regards thanks thank thankyou ' +
    'after before still already now today yet again really actually completely successfully currently ' +
    'respected anyone able look regarding request requesting query matter concern ' +
    'come coming came give given provide provided send sent share shared sharing ' +
    'write writing inform informing earliest convenience grateful further detail details require required ' +
    'feel forward looking response consideration assistance guidance ' +
    "didn doesn don haven hasn isn wasn won aren weren couldn wouldn " +
    'hai hain ka ki ke ko se me mein mai main hu hoon ho raha rahi rahe kar karo karna kya ye yeh wo woh bhi aur toh ji na ab abhi ' +
    'not nahi'
).split(/\s+/));

/*
 * Always a person, whatever matches. The first line is what needs a human
 * because of what it is. The rest is where the portal itself is inconsistent
 * today (HANDOVER §17.2), so any fixed answer would be wrong for someone:
 * stipend, the Letter of Recommendation, fines, name corrections, changing
 * domain or plan, and end dates.
 *
 * The course certificates (Expert, Nano Degree, Fellowship) were on this list
 * while their Download was a 404 and two tiers said "Payment coming soon".
 * They have one price setting and one checkout now, so they have an answer.
 */
const SENSITIVE = new RegExp('\\b(?:' + [
    'refunds?|money back|charge-?back|cheat(?:ed|ing)?|scam|fraud|fake|police|legal|lawyer|advocate|court|consumer forum',
    'harass(?:ed|ment|ing)?|abus(?:e|ed|ive)|threat(?:en|ened|ening)?|suicid(?:e|al)|kill myself|self[- ]harm|sexual(?:ly)?',
    'delete my (?:data|account)|remove my (?:data|account)|complaint against|misbehav(?:e|ed|iour|ior)',
    'stipend|salary|paid internship|internship (?:is )?paid',
    'lor|letters? of recommendation|recommendation letters?',
    // Not a bare "fine": "it was working fine" is not about money.
    'fines|fine amount|(?:pay|paid|paying) (?:the |a |my )?fine|(?:attendance|lor|loc) fine|penalt(?:y|ies)',
    'wrong name|name (?:is )?wrong|name correction|correct(?:ion)? (?:in |of )?my name|spelling (?:mistake|error)|misspelt|misspelled',
    'change (?:my |the )?(?:domain|plan|tenure)|switch (?:my |the )?(?:domain|plan)',
    'end date|extend (?:my )?internship|internship extension'
].join('|') + ')\\b', 'i');

function stem(t) {
    if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
    else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
    else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
    if (t.length > 3 && t.endsWith('e')) t = t.slice(0, -1);
    return t;
}

function tokens(text) {
    let s = ' ' + String(text || '').toLowerCase() + ' ';
    for (const [re, to] of PHRASES) s = s.replace(re, to);
    return s.split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)).map(stem);
}

function vector(toks, idf) {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [t, n] of tf) {
        const w = (1 + Math.log(n)) * (idf.get(t) || idf.unknown);
        v.set(t, w);
        norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) };
}

function cosine(a, b) {
    if (!a.norm || !b.norm) return 0;
    let dot = 0;
    for (const [t, w] of a.v) {
        const o = b.v.get(t);
        if (o) dot += w * o;
    }
    return dot / (a.norm * b.norm);
}

/**
 * @param {string} text   subject and body of the email, quoted replies already removed
 * @param {Array<{question:string, examples?:string[]}>} entries  the active answers
 * @returns {{answers: Array<{entry:object, score:number}>, sensitive: boolean, best: number}}
 */
function match(text, entries, { threshold = Number(process.env.SUPPORT_MATCH_THRESHOLD) || 0.5 } = {}) {
    const sensitive = SENSITIVE.test(String(text || ''));
    const docs = [];
    entries.forEach((entry, i) => {
        for (const example of [entry.question].concat(entry.examples || [])) {
            const toks = tokens(example);
            if (toks.length) docs.push({ i, toks });
        }
    });

    const df = new Map();
    for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) || 0) + 1);
    const idf = new Map();
    for (const [t, n] of df) idf.set(t, Math.log((docs.length + 1) / (n + 1)) + 1);
    idf.unknown = Math.log(docs.length + 1) + 1;
    for (const d of docs) d.vec = vector(d.toks, idf);

    // The whole email, and each sentence of it on its own.
    const pieces = [String(text || '')].concat(String(text || '').split(/[.?!\n]+/));
    const scores = new Array(entries.length).fill(0);
    for (const piece of pieces) {
        const toks = tokens(piece);
        if (!toks.length) continue;
        const q = vector(toks, idf);
        for (const d of docs) scores[d.i] = Math.max(scores[d.i], cosine(q, d.vec));
    }

    const ranked = scores.map((score, i) => ({ entry: entries[i], score }))
        .filter((r) => r.score >= threshold)
        .sort((a, b) => b.score - a.score);
    // A second answer only when it is nearly as strong as the first: two
    // questions in one email, not a weak echo of the first.
    const answers = ranked.slice(0, 2).filter((r, k) => k === 0 || r.score >= ranked[0].score - 0.25);
    return { answers, sensitive, best: ranked.length ? ranked[0].score : Math.max(0, ...scores) };
}

module.exports = { match, tokens };
