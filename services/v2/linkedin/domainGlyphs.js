'use strict';

/**
 * Domain glyphs — a small drawn mark that says what the post is about.
 *
 * The company runs internships across eighteen-odd domains, and until now
 * every poster for every one of them looked identical. A Python opening and a
 * Human Resources opening went out as the same gold-on-navy rectangle, so the
 * only thing carrying the subject was the sentence itself. A reader scrolling
 * a feed decides in about a second; a picture that says "Python" before the
 * words are read is worth more than a picture that says "a company".
 *
 * Two rules shaped everything here, and both are about not getting sued and
 * not getting broken:
 *
 *   1. Nothing in this file is anybody's logo. Every glyph is original
 *      geometry — arcs, rectangles, a few paths — that *suggests* a technology
 *      the way a road sign suggests a school. We do not fetch, embed, trace or
 *      approximate a trademarked mark. Python's two-snake device, Java's cup,
 *      the green robot: those are owned by other people, and shipping them on
 *      a recruitment poster is a trademark problem, not a design decision. A
 *      pair of interlocking hooks, a steaming cup, a friendly head with an
 *      antenna carry the same meaning and are ours.
 *   2. The SVG is self-contained and monochrome. These marks are rasterised in
 *      the browser through <img> to <canvas>; anything that reaches outside
 *      the document (an href, a font, a stylesheet) taints the canvas and the
 *      poster silently never attaches. And every glyph draws in a single tint
 *      passed by the design, so it can never fight the palette it lands in —
 *      a gradient-filled clip-art badge on the Paper design would look like a
 *      sticker somebody pasted on.
 *
 * Each glyph is drawn inside a 100x100 box and placed with one transform, so
 * the geometry below can be read and edited as plain numbers; the caller only
 * decides where it goes and how big it is.
 */

/* The house gold. Kept as a literal rather than imported from posterStudio so
   that this module has no dependencies at all — it is drawing, not branding,
   and a glyph should be usable from a context that never loads the studio. */
const DEFAULT_TINT = '#f5c542';

/*
 * A tint is written straight into a fill attribute, so it is checked rather
 * than escaped. Callers pass constants today, but a colour that one day comes
 * from a settings row must not be able to close the attribute and inject
 * markup into the poster. Anything that is not a plain hex colour or a bare
 * CSS colour word falls back to gold: a glyph in the wrong colour is a
 * cosmetic bug, a glyph that can carry a <script> is not.
 */
const SAFE_TINT = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;

function tintOf(value) {
  const tint = String(value == null ? '' : value).trim();
  return SAFE_TINT.test(tint) ? tint : DEFAULT_TINT;
}

/* Numbers reach the document as attribute text, so they are rounded and
   trimmed here. `scale(0.5600000000000001)` is valid SVG but it makes every
   diff unreadable, and NaN from a bad size would produce an attribute the
   renderer rejects outright. */
function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

/* ── the drawings ───────────────────────────────────────────────────────── */

/*
 * Every shape below is expressed in a 100x100 box with the origin top-left.
 * Filled shapes inherit the group's fill; stroked ones set `fill="none"` and
 * their own stroke-width. The group carries `stroke-width="0"` so a filled
 * shape is never accidentally outlined as well — which at 64 px turns a
 * crisp silhouette into a smudge.
 *
 * Each glyph is kept under about ten elements on purpose. These are seen at
 * 56 to 64 pixels on most of the designs; detail below roughly three pixels
 * of the drawing simply disappears, so anything that needs it is wasted work
 * that only makes the file bigger.
 */

const S = {
  /* Two interlocking hooks. The idea is "two forms that clasp", which is what
     the language's own device says, drawn as our own geometry. */
  python: [
    '<path d="M58 20 a22 22 0 1 0 0 44 h-14" fill="none" stroke-width="11" stroke-linecap="round"/>',
    '<path d="M42 80 a22 22 0 1 0 0 -44 h14" fill="none" stroke-width="11" stroke-linecap="round"/>',
  ],

  /* Angle brackets around a slash: the shape of markup itself. */
  web: [
    '<path d="M34 28 L12 50 L34 72" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M66 28 L88 50 L66 72" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M58 22 L42 78" fill="none" stroke-width="9" stroke-linecap="round"/>',
  ],

  /* Axes, a rising curve and the points it was fitted to. */
  data: [
    '<path d="M16 12 V84 H88" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M28 72 C42 68 48 50 60 44 C70 39 76 30 84 24" fill="none" stroke-width="7" stroke-linecap="round"/>',
    '<circle cx="34" cy="68" r="5"/>',
    '<circle cx="50" cy="54" r="5"/>',
    '<circle cx="66" cy="38" r="5"/>',
    '<circle cx="82" cy="24" r="5"/>',
  ],

  /* A megaphone with one sound arc. */
  marketing: [
    '<path d="M18 40 h22 l32 -22 v64 l-32 -22 h-22 a6 6 0 0 1 -6 -6 v-8 a6 6 0 0 1 6 -6 z" fill="none" stroke-width="7" stroke-linejoin="round"/>',
    '<path d="M44 62 v18 a6 6 0 0 0 6 6 h4 a6 6 0 0 0 6 -6 v-8" fill="none" stroke-width="7" stroke-linejoin="round"/>',
    '<path d="M80 34 a22 22 0 0 1 0 32" fill="none" stroke-width="7" stroke-linecap="round"/>',
  ],

  /* Two frames sliding over one another, with the cursor that moved them. */
  uiux: [
    '<rect x="12" y="16" width="52" height="52" rx="10" fill="none" stroke-width="7"/>',
    '<rect x="36" y="34" width="52" height="52" rx="10" fill="none" stroke-width="7"/>',
    '<circle cx="62" cy="60" r="7"/>',
  ],

  /* A shield with a keyhole. */
  cyber: [
    '<path d="M50 10 L84 24 V50 C84 70 68 84 50 92 C32 84 16 70 16 50 V24 Z" fill="none" stroke-width="7" stroke-linejoin="round"/>',
    '<circle cx="50" cy="44" r="8" fill="none" stroke-width="7"/>',
    '<path d="M50 54 V68" fill="none" stroke-width="7" stroke-linecap="round"/>',
  ],

  /* A head with an antenna: a machine that looks back at you. */
  ml: [
    '<rect x="18" y="30" width="64" height="54" rx="14" fill="none" stroke-width="7"/>',
    '<circle cx="38" cy="54" r="6"/>',
    '<circle cx="62" cy="54" r="6"/>',
    '<path d="M50 30 V18" fill="none" stroke-width="6" stroke-linecap="round"/>',
    '<circle cx="50" cy="12" r="6"/>',
    '<path d="M38 70 h24" fill="none" stroke-width="6" stroke-linecap="round"/>',
  ],

  /* Two people, one behind the other. */
  hr: [
    '<circle cx="40" cy="30" r="14" fill="none" stroke-width="7"/>',
    '<path d="M16 84 a24 24 0 0 1 48 0" fill="none" stroke-width="7" stroke-linecap="round"/>',
    '<circle cx="74" cy="34" r="10" fill="none" stroke-width="6"/>',
    '<path d="M60 78 a18 18 0 0 1 32 0" fill="none" stroke-width="6" stroke-linecap="round"/>',
  ],

  /* Columns and the line through them. */
  finance: [
    '<rect x="16" y="62" width="16" height="24" rx="4"/>',
    '<rect x="42" y="52" width="16" height="34" rx="4"/>',
    '<rect x="68" y="40" width="16" height="46" rx="4"/>',
    '<path d="M18 44 L40 28 L58 36 L86 14" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M70 14 h16 v16" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
  ],

  /* A nib over a written line. */
  writing: [
    '<path d="M20 80 L28 52 L62 18 L82 38 L48 72 Z" fill="none" stroke-width="7" stroke-linejoin="round"/>',
    '<path d="M28 52 L48 72" fill="none" stroke-width="6"/>',
    '<path d="M18 90 h48" fill="none" stroke-width="6" stroke-linecap="round"/>',
  ],

  /* A handset. */
  mobile: [
    '<rect x="30" y="8" width="40" height="84" rx="10" fill="none" stroke-width="7"/>',
    '<path d="M43 22 h14" fill="none" stroke-width="5" stroke-linecap="round"/>',
    '<circle cx="50" cy="80" r="5"/>',
  ],

  /* The pen-tool arrow with its anchor point. */
  design: [
    '<path d="M50 10 L86 88 L50 68 L14 88 Z" fill="none" stroke-width="7" stroke-linejoin="round"/>',
    '<circle cx="50" cy="38" r="6"/>',
  ],

  /* A case with a handle. The first attempt was a pair of clasped hands
     reduced to two lines, and at 64 px it read as an arrowhead, not a
     handshake — a glyph that has to be explained has already failed. */
  business: [
    '<rect x="12" y="32" width="76" height="54" rx="10" fill="none" stroke-width="7"/>',
    '<path d="M38 32 V24 a8 8 0 0 1 8 -8 h8 a8 8 0 0 1 8 8 v8" fill="none" stroke-width="7" stroke-linejoin="round"/>',
    '<path d="M12 56 h30 v8 h16 v-8 h30" fill="none" stroke-width="6" stroke-linejoin="round"/>',
  ],

  /* The loop that never ends. The two lobes have to cross at the centre or
     the whole thing reads as two circles side by side, which is what the
     first version drew. */
  devops: [
    '<path d="M50 50 C58 36 66 30 74 30 a20 20 0 0 1 0 40 c-8 0 -16 -6 -24 -20 s-16 -20 -24 -20 a20 20 0 0 0 0 40 c8 0 16 -6 24 -20 z" fill="none" stroke-width="8" stroke-linejoin="round"/>',
  ],

  /* A cup with steam. */
  java: [
    '<path d="M16 42 h52 v20 a20 20 0 0 1 -20 20 H36 a20 20 0 0 1 -20 -20 z" fill="none" stroke-width="7" stroke-linejoin="round"/>',
    '<path d="M68 48 h8 a12 12 0 0 1 0 24 h-8" fill="none" stroke-width="7"/>',
    '<path d="M34 30 c0 -8 8 -10 8 -18" fill="none" stroke-width="6" stroke-linecap="round"/>',
    '<path d="M52 30 c0 -8 8 -10 8 -18" fill="none" stroke-width="6" stroke-linecap="round"/>',
    '<path d="M20 92 h50" fill="none" stroke-width="6" stroke-linecap="round"/>',
  ],

  /* A terminal window with a prompt in it. */
  software: [
    '<rect x="12" y="20" width="76" height="60" rx="10" fill="none" stroke-width="7"/>',
    '<path d="M12 38 h76" fill="none" stroke-width="5"/>',
    '<path d="M30 52 L42 60 L30 68" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M52 68 h18" fill="none" stroke-width="6" stroke-linecap="round"/>',
  ],

  /* A ringed planet. */
  space: [
    '<circle cx="46" cy="50" r="26" fill="none" stroke-width="7"/>',
    '<ellipse cx="46" cy="50" rx="44" ry="13" fill="none" stroke-width="6" transform="rotate(-24 46 50)"/>',
    '<circle cx="84" cy="16" r="5"/>',
  ],

  /* A seedling: the money that was put in before there was anything to see. */
  vc: [
    '<path d="M50 90 V48" fill="none" stroke-width="7" stroke-linecap="round"/>',
    '<path d="M50 56 C50 34 34 24 16 24 c0 22 16 32 34 32 z" fill="none" stroke-width="6" stroke-linejoin="round"/>',
    '<path d="M50 64 C50 46 64 38 84 38 c0 18 -14 26 -34 26 z" fill="none" stroke-width="6" stroke-linejoin="round"/>',
  ],
};

/**
 * Turn a list of shapes into a `draw(x, y, size, opts)` function.
 *
 * The group carries the tint and one transform, so the geometry above stays
 * readable as plain 0-100 numbers and a design only has to say where and how
 * big. A size of zero or a size that is not a number returns '' rather than a
 * group scaled by NaN: an invisible glyph is a missing feature, a NaN
 * transform is a poster that renders as nothing at all.
 */
function drawer(shapes) {
  return function draw(x, y, size, opts) {
    const o = opts || {};
    const k = Number(size) / 100;
    if (!Number.isFinite(k) || k <= 0) return '';
    const attrs = [
      `transform="translate(${num(x)} ${num(y)}) scale(${num(k)})"`,
      `fill="${tintOf(o.tint)}"`,
      `stroke="${tintOf(o.tint)}"`,
      'stroke-width="0"',
    ];
    if (o.opacity != null && Number.isFinite(Number(o.opacity))) {
      attrs.push(`opacity="${num(o.opacity)}"`);
    }
    return `<g ${attrs.join(' ')}>${shapes.join('')}</g>`;
  };
}

/* ── the glyphs and what they answer to ─────────────────────────────────── */

/*
 * `aliases` are names for the domain itself — what it is called on the
 * registration form, plus the abbreviations people actually type. `keywords`
 * are the technologies and tasks that merely imply it.
 *
 * The distinction is not decorative; it decides matches. "Recruitment for
 * Python interns" mentions an HR keyword and a Python alias, and the poster
 * has to come out Python. Ranking every alias above every keyword gets that
 * right, where ranking by position or by length gets it backwards.
 *
 * Every name in config/domains.js must appear as an alias of exactly one
 * glyph — the test asserts it, so a domain added to that file and forgotten
 * here fails the build rather than silently shipping a blank poster.
 */
const GLYPHS = [
  {
    id: 'python',
    label: 'Python Development',
    aliases: ['python development', 'python developer', 'python', 'py'],
    keywords: ['django', 'flask', 'fastapi', 'pandas scripting'],
    draw: drawer(S.python),
  },
  {
    id: 'web',
    label: 'Web Development',
    aliases: [
      'web development', 'web developer', 'web dev', 'mern stack development',
      'mern stack', 'mern', 'full stack', 'fullstack', 'frontend', 'front end',
    ],
    keywords: ['react', 'reactjs', 'javascript', 'html', 'css', 'tailwind', 'website', 'web design'],
    draw: drawer(S.web),
  },
  {
    id: 'data',
    label: 'Data Science',
    aliases: ['data science', 'data scientist', 'data analytics', 'data analysis', 'data analyst'],
    keywords: ['analytics', 'pandas', 'numpy', 'power bi', 'tableau', 'dashboards'],
    draw: drawer(S.data),
  },
  {
    id: 'marketing',
    label: 'Digital Marketing',
    aliases: ['digital marketing', 'marketing'],
    keywords: ['seo', 'social media', 'social media marketing', 'content marketing', 'advertising', 'campaigns', 'branding'],
    draw: drawer(S.marketing),
  },
  {
    id: 'uiux',
    label: 'UI/UX',
    aliases: ['ui/ux', 'ui ux', 'uiux', 'ux design', 'ui design', 'user experience', 'user interface', 'ux', 'ui'],
    keywords: ['figma', 'wireframe', 'wireframes', 'prototyping', 'usability'],
    draw: drawer(S.uiux),
  },
  {
    id: 'cyber',
    label: 'Cyber Security',
    aliases: ['cyber security', 'cybersecurity', 'cyber'],
    keywords: ['infosec', 'information security', 'ethical hacking', 'penetration testing', 'pentesting', 'vulnerability'],
    draw: drawer(S.cyber),
  },
  {
    id: 'ml',
    label: 'Machine Learning',
    aliases: ['machine learning', 'artificial intelligence', 'ml', 'ai'],
    keywords: ['deep learning', 'neural network', 'neural networks', 'nlp', 'computer vision', 'generative ai', 'llm'],
    draw: drawer(S.ml),
  },
  {
    id: 'hr',
    label: 'Human Resources',
    aliases: ['human resources', 'human resource', 'hr management', 'hr'],
    keywords: ['recruitment', 'talent acquisition', 'people operations', 'onboarding', 'payroll'],
    draw: drawer(S.hr),
  },
  {
    id: 'finance',
    label: 'Finance',
    aliases: ['finance', 'financial'],
    keywords: ['fintech', 'accounting', 'accounts', 'valuation', 'equity research', 'bookkeeping'],
    draw: drawer(S.finance),
  },
  {
    id: 'writing',
    label: 'Content Writing',
    aliases: ['content writing', 'content writer', 'copywriting', 'copywriter'],
    keywords: ['technical writing', 'blog writing', 'editorial', 'proofreading'],
    draw: drawer(S.writing),
  },
  {
    id: 'mobile',
    label: 'Android Development',
    aliases: [
      'android development', 'android developer', 'android',
      'flutter development', 'flutter', 'mobile development', 'app development',
    ],
    keywords: ['kotlin', 'react native', 'ios', 'swift', 'mobile app'],
    draw: drawer(S.mobile),
  },
  {
    id: 'design',
    label: 'Graphic Design',
    aliases: ['graphic design', 'graphic designer', 'visual design'],
    keywords: ['illustration', 'typography', 'brand identity', 'poster design'],
    draw: drawer(S.design),
  },
  {
    id: 'business',
    label: 'Business Development',
    aliases: ['business development', 'business analyst', 'business analysis', 'bd'],
    keywords: ['sales', 'partnerships', 'lead generation', 'client outreach'],
    draw: drawer(S.business),
  },
  {
    id: 'devops',
    label: 'DevOps with AWS',
    aliases: ['devops with aws', 'devops'],
    keywords: ['aws', 'cloud', 'docker', 'kubernetes', 'ci/cd', 'terraform'],
    draw: drawer(S.devops),
  },
  {
    id: 'java',
    label: 'Java Development',
    aliases: ['java development', 'java developer', 'java'],
    keywords: ['spring boot', 'spring', 'hibernate'],
    draw: drawer(S.java),
  },
  {
    id: 'software',
    label: 'Software Engineering',
    aliases: ['software engineering', 'software engineer', 'software development', 'sde', 'vibe coding'],
    keywords: ['backend', 'back end', 'apis', 'system design'],
    draw: drawer(S.software),
  },
  {
    id: 'space',
    label: 'Space Intern',
    /* No bare 'space' here. It is the one domain whose short name is also an
       ordinary English word, and "only a little space left in this batch" is
       a sentence about seats in a cohort, not about satellites — it went out
       with a planet drawn on it. Both names in config/domains.js still
       resolve through the two-word aliases, which is the whole requirement. */
    aliases: ['space intern', 'space research'],
    keywords: ['astronomy', 'satellite', 'aerospace', 'orbital'],
    draw: drawer(S.space),
  },
  {
    id: 'vc',
    label: 'Venture Capital',
    aliases: ['venture capital', 'vc'],
    keywords: ['startup funding', 'term sheet', 'due diligence', 'seed round'],
    draw: drawer(S.vc),
  },
];

const IDS = GLYPHS.map((g) => g.id);

const BY_ID = GLYPHS.reduce((acc, g) => {
  acc[g.id] = g;
  return acc;
}, Object.create(null));

/* ── matching ───────────────────────────────────────────────────────────── */

/*
 * Needles are matched on a word boundary of our own rather than \b, because
 * several of them contain a slash ("ui/ux", "ci/cd") and \b sits in the wrong
 * place around punctuation. The lookbehind says "not glued to a letter or a
 * digit on the left", which is what is actually wanted: "java" must not fire
 * on "javascript", "py" must not fire on "happy", and "ai" must not fire on
 * "email" — each of those was a real wrong glyph on a real sentence.
 *
 * The lookahead is deliberately narrower than the lookbehind: it blocks a
 * trailing letter but allows a trailing digit. Every false positive the left
 * side prevents is a needle buried inside a longer word, and a word cannot
 * grow to the right by a digit and mean something else — "Python3", "Web3"
 * and "HTML5" are the things people type, and blocking the digit sent all
 * three to the blank poster this feature exists to replace.
 */
function needleRegex(needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z])`, 'i');
}

/*
 * Compiled once at load. There are a few hundred needles and glyphFor runs on
 * every agent turn that previews a poster; rebuilding the regexes per call
 * turned a free lookup into measurable work for no reason.
 *
 * ALIAS_RANK sits far above KEYWORD_RANK so that any alias beats any keyword
 * however long the keyword is; within one rank the longer phrase wins, since
 * "machine learning" is a more specific claim about the text than "ml".
 */
const ALIAS_RANK = 1000;
const KEYWORD_RANK = 0;

const NEEDLES = [];
GLYPHS.forEach((glyph) => {
  glyph.aliases.forEach((a) => {
    NEEDLES.push({ id: glyph.id, re: needleRegex(a), score: ALIAS_RANK + a.length });
  });
  glyph.keywords.forEach((k) => {
    NEEDLES.push({ id: glyph.id, re: needleRegex(k), score: KEYWORD_RANK + k.length });
  });
});

/**
 * The text a sentence is matched against, with the parts that only look like
 * words taken out of it.
 *
 * Two different wrong glyphs on real posts are fixed here.
 *
 * The first is links. The agent hands this function the whole finished post,
 * registration link included, and a link's path is not prose. "Register at
 * https://bit.ly/ten-ai before Friday" printed a robot head on a post with no
 * domain in it, because '/', '.' and '-' all read as word boundaries and the
 * two-letter aliases — 'ai', 'py', 'ml', 'ui', 'ux', 'hr', 'bd', 'vc', 'sde'
 * — turn every short slug into a trap. Nobody names a domain inside a URL or
 * an address, so removing them before matching costs nothing and closes the
 * whole class.
 *
 * The second is the hyphen. It is a spelling choice, not a different word:
 * "Full-stack" and "Full Stack" are the same opening, and only the second one
 * used to find its glyph. Folding hyphens and underscores to spaces once,
 * here, is the honest fix — the alternative is enumerating every hyphenated
 * spelling in the alias lists, and that list is never finished.
 */
function haystackFor(text) {
  return String(text == null ? '' : text)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/[-_]+/g, ' ');
}

/**
 * The glyph this sentence is about, or null.
 *
 * Null is a normal answer, not a failure: most posts are not about a domain,
 * and the six designs are complete without a glyph. Guessing is the worse
 * outcome — a Python mark on a placement post about a finance role is not a
 * near miss, it is wrong information printed on a picture and published.
 *
 * So a sentence that names two domains returns null. "Openings in HR and BD"
 * names two with equal authority and there is no honest way to pick one; the
 * poster goes out clean instead.
 *
 * That refusal is decided on the *rank* of the match, not on its score, and
 * the difference is the bug this shape exists to prevent. Scoring made the
 * guarantee an accident of spelling: "HR and BD" came out null only because
 * both aliases happen to be two characters long, while "HR and Business
 * Development" quietly printed a briefcase, because the longer name outscored
 * the shorter one. Counting the distinct glyphs named by an alias makes the
 * two sentences behave the same, which is what a caller can actually rely on.
 * Length still decides between aliases of one glyph ("machine learning" over
 * "ml") and between keywords, where it is choosing a spelling rather than
 * choosing a subject.
 *
 * @param {string} text  anything the author wrote
 * @returns {object|null} a glyph from GLYPHS
 */
function glyphFor(text) {
  const haystack = haystackFor(text);
  if (!haystack.trim()) return null;

  const named = Object.create(null);
  let namedCount = 0;
  let best = -1;
  let winner = null;
  let tied = false;

  for (let i = 0; i < NEEDLES.length; i += 1) {
    const n = NEEDLES[i];
    if (!n.re.test(haystack)) continue;
    if (n.score >= ALIAS_RANK && !named[n.id]) {
      named[n.id] = true;
      namedCount += 1;
    }
    if (n.score > best) {
      best = n.score;
      winner = n.id;
      tied = false;
    } else if (n.score === best && n.id !== winner) {
      tied = true;
    }
  }

  if (namedCount > 1) return null;
  if (!winner || tied) return null;
  return BY_ID[winner];
}

/**
 * Draw a glyph by id. Returns '' for anything unknown.
 *
 * The empty string matters more than it looks: the six designs concatenate
 * this into their markup, so an unknown id has to vanish without leaving a
 * gap, a placeholder, or a thrown error halfway through building a poster.
 *
 * @param {object} args
 * @param {string} args.id       one of IDS
 * @param {number} args.x        left edge of the 100x100 drawing box, in poster units
 * @param {number} args.y        top edge of the box
 * @param {number} args.size     the box's rendered size in poster units
 * @param {string} [args.tint]   any hex colour; defaults to the house gold
 * @param {number} [args.opacity]
 */
function draw({ id, x, y, size, tint, opacity } = {}) {
  const glyph = BY_ID[id];
  if (!glyph) return '';
  return glyph.draw(x || 0, y || 0, size, { tint, opacity });
}

module.exports = { GLYPHS, IDS, glyphFor, draw, DEFAULT_TINT };
