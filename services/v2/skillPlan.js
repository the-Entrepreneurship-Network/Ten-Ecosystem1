'use strict';

const atsEngine = require('./atsResumeEngine');

/**
 * The skills the posting wants that the page cannot prove — and how to
 * actually get them.
 *
 * The tempting version of this feature writes the missing skills onto the
 * resume and tells the student how to learn them afterwards. That trades a
 * document they can defend for one they cannot: the first interviewer asks
 * "tell me about this Kafka project" and the conversation ends there, having
 * cost them the interview, the reference and the relationship. An employer
 * also ends up holding a document that misrepresents a person, which is not
 * ours to hand them.
 *
 * So the gap is reported and the plan is real. Each missing term becomes a
 * project small enough to finish in a weekend or two, with the steps in
 * order, what to measure while building it, and the bullet to add — with the
 * numbers left blank, because the numbers come from the thing they built.
 *
 * Nothing here is a course link or a paid recommendation. Every step is
 * something a person can do with a laptop and the official docs.
 */

/* Recipes keyed by what a term IS, not by its exact spelling: "Postgres",
   "PostgreSQL" and "psql" are one weekend, not three. */
/*
 * Production-shaped, not tutorial-shaped.
 *
 * The first version of this bank asked for a weekend toy — "run the broker
 * locally, publish a message, read it back" — which is a tutorial with a
 * resume line attached, and an interviewer can tell in one question. What
 * earns a place on a page is a system with the properties production
 * demands: it survives a restart, it is measured, it fails safely, someone
 * other than the author uses it. These are scoped in days rather than hours
 * because that is what those properties cost, and each one ends in numbers
 * that are real because the thing genuinely ran.
 */
const RECIPES = [
  {
    match: /\b(kafka|rabbitmq|sqs|pub\/?sub|message queue|event stream)\b/i,
    build: 'An event-driven order pipeline with exactly-once processing',
    hours: '3–5 days',
    steps: [
      'Model a real domain with money in it — orders, payments, refunds — so correctness actually matters.',
      'Producer writes to the broker inside the same transaction as the database write, using the outbox pattern. This is the part that separates a demo from a system.',
      'Consumer processes idempotently: keep a processed-id table so a redelivered message cannot double-charge anyone.',
      'Add a dead-letter queue and a replay tool for it. Poison messages are what actually take pipelines down.',
      'Load-test it: push 50,000 messages through and record throughput and lag.',
      'Kill consumers mid-run, restart, and prove from the ledger that nothing was lost and nothing was applied twice.',
      'Measure: messages a minute, p99 consumer lag, and the count reconciliation before and after the kill.',
    ],
    bullet: 'Built an event-driven order pipeline on <broker> processing <N> messages a minute at <N>ms p99 lag, with transactional-outbox publishing and idempotent consumers proven by reconciliation after mid-run failures',
    defend: 'Why the outbox pattern instead of publishing after commit, and how you made the consumer idempotent.',
  },
  {
    match: /\b(docker|container|containeri[sz]ation)\b/i,
    build: 'A containerised multi-service stack with health checks and CI-built images',
    hours: '2–4 days',
    steps: [
      'Take a real application with a database and at least two services. Write a Dockerfile for each.',
      'Multi-stage builds, non-root users, pinned base image digests. Get each image under 200MB and say what you cut.',
      'docker-compose brings the whole stack up with one command, with health checks and correct start ordering.',
      'Add a CI job that builds, scans the image for CVEs, and pushes it to a registry on every merge.',
      'Prove it from a clean machine: clone, one command, working stack — that reproducibility is the claim.',
      'Measure: image sizes before and after, cold start time, and how many CVEs the scan removed.',
    ],
    /* Opens with a verb the checker counts. "Containerised" reads well and
       scores as no verb at all, which quietly cost the page three points. */
    bullet: 'Built and containerised a <N>-service stack with multi-stage, non-root images, cutting image size from <before>MB to <after>MB and wiring CI to build, scan and push on every merge',
    defend: 'Why layer order matters for cache hits, and what running as non-root actually prevents.',
  },
  {
    match: /\b(kubernetes|k8s|eks|gke|aks)\b/i,
    build: 'A two-service deployment on a local cluster',
    hours: '10–15 hours',
    steps: [
      'Install kind or minikube — a real cluster on your laptop, no cloud bill.',
      'Deploy a container you already built. Write the Deployment and Service YAML by hand once before using any generator.',
      'Scale it to three replicas and delete a pod. Watch it come back.',
      'Add a ConfigMap for settings and a Secret for a fake password, so you have touched both.',
      'Add a liveness probe, then deliberately break the app and watch the restart.',
      'Measure: replica count, and how long recovery took after you deleted a pod.',
    ],
    bullet: 'Deployed <project> to a Kubernetes cluster across <N> replicas with liveness probes, recovering automatically from pod failure in <N> seconds',
    defend: 'The difference between a Deployment, a Pod and a Service, and what a liveness probe actually checks.',
  },
  {
    match: /\b(terraform|infrastructure as code|iac|cloudformation|pulumi)\b/i,
    build: 'One environment, defined in code',
    hours: '6–10 hours',
    steps: [
      'Pick the smallest real thing: one storage bucket and one permission policy.',
      'Write it in Terraform. Run plan and read the output line by line before applying.',
      'Destroy it. Recreate it. Confirm you get exactly the same thing back — that reproducibility IS the skill.',
      'Move a hard-coded value into a variable and an output.',
      'Commit the state backend config, never the state file, and be able to say why.',
      'Measure: how many resources the config manages, and how long a full create-destroy cycle takes.',
    ],
    bullet: 'Automated <N> cloud resources in Terraform with variables and remote state, making the environment reproducible from a clean account in <N> minutes',
    defend: 'What state is for, and what happens when two people apply at the same time.',
  },
  {
    match: /\b(ci\/?cd|jenkins|github actions|gitlab ci|pipeline|continuous integration)\b/i,
    build: 'A pipeline on a repo you already have',
    hours: '4–6 hours',
    steps: [
      'Add a workflow that runs your tests on every push. Nothing else, first.',
      'Make it fail on purpose. Confirm the red X appears and blocks the merge.',
      'Add a linter and a build step.',
      'Cache your dependencies and watch the run time drop — that number is your bullet.',
      'Add a deploy step gated on the main branch only.',
      'Measure: run time before and after caching, and how many broken commits it has caught since.',
    ],
    bullet: 'Set up a CI pipeline running tests, lint and build on every push, cutting run time from <before> to <after> with dependency caching',
    defend: 'What runs on a pull request versus on main, and why caching is safe.',
  },
  {
    match: /\b(react|vue|angular|svelte|frontend|front-end)\b/i,
    build: 'One interface that talks to a real API',
    hours: '10–15 hours',
    steps: [
      'Pick a free public API that needs no key. Build a page that lists things from it.',
      'Add search and a loading state. Handle the request failing — most student projects skip this and interviewers notice.',
      'Add a detail view with real routing, so the back button works.',
      'Make it usable on a phone without a separate layout.',
      'Run Lighthouse. Fix the two worst things it reports.',
      'Measure: how many records it handles, and your Lighthouse score before and after.',
    ],
    bullet: 'Built a <framework> interface over the <API> API with search, routing and error states, scoring <N> on Lighthouse after fixing render-blocking assets',
    defend: 'What re-renders when state changes, and how you stopped it re-fetching on every keystroke.',
  },
  {
    match: /\b(sql|postgres|postgresql|mysql|database|rdbms)\b/i,
    build: 'A schema with real data in it',
    hours: '6–8 hours',
    steps: [
      'Find a public dataset with at least 100,000 rows. Load it into Postgres.',
      'Write five queries that answer real questions about it — joins, not just selects.',
      'Run EXPLAIN on the slowest one. Read the plan.',
      'Add the index it needs. Run EXPLAIN again. Write down both times.',
      'Add a constraint that prevents bad data, and try to insert bad data.',
      'Measure: rows loaded, and query time before and after the index.',
    ],
    bullet: 'Modelled a <N>-row dataset in PostgreSQL and cut the slowest report query from <before>ms to <after>ms by adding a covering index',
    defend: 'Why that index helped, and what it costs on writes.',
  },
  {
    match: /\b(rest|api|endpoint|backend|back-end|express|fastapi|spring)\b/i,
    build: 'An API somebody else could use',
    hours: '8–12 hours',
    steps: [
      'Build four endpoints around one resource — create, read, update, delete.',
      'Add validation that rejects bad input with a useful message and the right status code.',
      'Add authentication. A token is enough; you need to have touched it.',
      'Write the API docs, or generate them from the code.',
      'Load-test it with a simple tool and note where it slows down.',
      'Measure: requests a second before it degrades, and your p95 latency.',
    ],
    bullet: 'Built a REST API with authentication and input validation, serving <N> requests a second at <N>ms p95 under load testing',
    defend: 'Your status codes, and what happens to a request with a bad token.',
  },
  {
    match: /\b(test|testing|jest|pytest|junit|unit test|tdd|qa)\b/i,
    build: 'Coverage on a project you already finished',
    hours: '5–8 hours',
    steps: [
      'Measure the coverage you have now. Write the number down; it is your "before".',
      'Write tests for the part you are most afraid to change. That is where the bugs are.',
      'Add one integration test that exercises a real path end to end.',
      'Deliberately break the code and confirm a test catches it. A suite that never fails is proving nothing.',
      'Wire the suite into CI so it runs on every push.',
      'Measure: coverage before and after, and how many real bugs the tests found.',
    ],
    bullet: 'Raised test coverage on <project> from <before>% to <after>%, catching <N> regressions before release',
    defend: 'What you chose not to test and why.',
  },
  {
    match: /\b(aws|azure|gcp|cloud|s3|lambda|ec2)\b/i,
    build: 'One thing deployed and running',
    hours: '6–10 hours',
    steps: [
      'Use the free tier. Set a billing alert at a low figure before you do anything else.',
      'Deploy a small service — a function or a container, not a fleet.',
      'Put its files in object storage and serve them.',
      'Give it the narrowest permissions that still work. Start by denying everything and adding back only what breaks.',
      'Turn on logging and find your own request in it.',
      'Measure: what it costs a month, and cold start time if it is serverless.',
    ],
    bullet: 'Deployed <project> on <cloud> using <services>, running at under <cost> a month with least-privilege access policies',
    defend: 'Why those permissions and not the wildcard.',
  },
  {
    match: /\b(python|pandas|numpy|data analysis|analytics)\b/i,
    build: 'An analysis that answers a question',
    hours: '8–12 hours',
    steps: [
      'Find a messy public dataset. Messy is the point — clean ones teach nothing.',
      'Write down the question BEFORE you look at the data.',
      'Clean it in a notebook, keeping a note of every row you dropped and why.',
      'Answer the question with a chart somebody else could read without you narrating it.',
      'Write the three-sentence finding at the top, the way a manager would want it.',
      'Measure: rows processed, and what the answer actually was.',
    ],
    bullet: 'Analysed a <N>-row dataset in Python to answer <question>, finding <result>',
    defend: 'What you dropped during cleaning and whether it could have changed the answer.',
  },
];

/** A plan for a term with no specific recipe — still concrete, never vague. */
function generic(term) {
  return {
    /*
     * Even without a recipe, the shape is production, not tutorial.
     *
     * "A small project that uses X for something real" was a weekend toy
     * with a resume line attached, and an interviewer spots one in a single
     * question. The properties below are what make any system worth listing
     * — real data, someone else using it, measured, and it survives failure
     * — and they apply whatever the technology turns out to be.
     */
    build: `A production-shaped service built on ${term}`,
    hours: '3–5 days',
    steps: [
      `Pick a real problem someone actually has, not a to-do list. ${term} should be the part that makes it work, not decoration.`,
      'Use real data at real volume — a public dataset, a live API, or your own traffic. Ten rows proves nothing.',
      'Handle failure explicitly: what happens on a timeout, a bad input, a restart mid-operation. Write the test that proves it.',
      'Put it somewhere other people can reach, with logging you can search when it misbehaves.',
      'Get at least a handful of real users on it and watch what breaks. That is the part interviewers ask about.',
      `Measure: throughput or volume, latency, and one number that shows ${term} was the right choice.`,
    ],
    bullet: `Built <what it does> on ${term}, serving <N> users at <N>ms, handling <the failure mode you covered>`,
    defend: `When you would choose ${term} and when you would not, and what broke first under load.`,
  };
}

/**
 * The plan for one resume against one posting.
 *
 * Ordered by what the posting calls essential, because a weekend spent on a
 * "nice to have" is a weekend that did not move the application.
 */
function planFor(resumeText, jd, options = {}) {
  const led = atsEngine.factLedger(resumeText || '');
  const map = atsEngine.jdMap(resumeText || '', led, jd || '');
  if (!map) return { ok: false, reason: 'That posting names no hard requirements I can measure against.' };

  const missing = map.rows.filter((r) => r.status === 'not claimed');
  const weak = map.rows.filter((r) => r.status === 'listed only');

  const plans = missing
    .sort((a, b) => (a.kind === 'must' ? -1 : 1) - (b.kind === 'must' ? -1 : 1))
    .slice(0, options.limit || 4)
    .map((row) => {
      const recipe = RECIPES.find((r) => r.match.test(row.term)) || generic(row.term);
      return {
        term: row.term,
        essential: row.kind === 'must',
        build: recipe.build,
        hours: recipe.hours,
        steps: recipe.steps,
        /* The bullet goes on the page AFTER the thing exists, with the
           blanks filled from what it actually did. */
        bulletAfter: recipe.bullet,
        defend: recipe.defend,
      };
    });

  return {
    ok: true,
    missing: missing.map((r) => r.term),
    weak: weak.map((r) => r.term),
    plans,
    /* Said plainly, because the whole feature turns on it. */
    rule: 'None of this is on your resume yet, and none of it should be until you have built it. A project you cannot walk through is worse than an empty section — it fails the first question an interviewer asks about it, and it costs you the interview rather than the line.',
    weakNote: weak.length
      ? `You already list ${weak.slice(0, 4).join(', ')} with no bullet behind ${weak.length === 1 ? 'it' : 'them'}. That is the cheapest gap to close: one small project each, and a claim you already made becomes one you can defend.`
      : null,
  };
}

/*
 * The marker that keeps a planned project out of a real application.
 *
 * It is deliberately loud and deliberately machine-readable: the export path
 * refuses to build a PDF while any line carries it, so the only way a planned
 * project reaches an employer is if the student states the work is done.
 */
const PLANNED = '[PLANNED — not built yet]';
const RE_PLANNED = /\[PLANNED[^\]]*\]/i;

/**
 * The plan, written in the shape of the resume it is aiming at.
 *
 * A list of things to build is a to-do list; the same list written as the
 * projects section it will become is a target you can see. So the entries go
 * onto the draft — marked, blanked, and gated — and the student works towards
 * a page that already shows them what it will say.
 *
 * Every claim is a blank until they fill it. Nothing here asserts a number,
 * a date or an outcome, because none of those exist yet.
 */
function projectEntries(plan) {
  if (!plan || !plan.ok) return [];
  return plan.plans.map((p) => ({
    term: p.term,
    /* Named for what it does, not for the technology, because that is how a
       project is named on a resume. */
    name: p.build,
    line: `${PLANNED} ${p.build} — ${p.bulletAfter}`,
    hours: p.hours,
    steps: p.steps,
    defend: p.defend,
  }));
}

/**
 * The draft with the planned projects added under their own heading.
 *
 * A separate heading rather than mixed into PROJECTS: a reader — and the
 * student themselves three weeks later — must be able to tell at a glance
 * which of these exist.
 */
function withPlannedProjects(resumeText, entries) {
  if (!entries.length) return String(resumeText || '');
  const lines = String(resumeText || '').split('\n');
  const block = ['', 'PLANNED PROJECTS (not yet built — remove or complete before applying)'];
  entries.forEach((e) => block.push(`- ${e.line}`));

  /* Placed before EDUCATION where there is one, so the page keeps its
     ordinary shape. */
  const eduAt = lines.findIndex((l) => /^EDUCATION\b/i.test(l.trim()));
  if (eduAt === -1) return [...lines, ...block].join('\n');
  return [...lines.slice(0, eduAt), ...block, '', ...lines.slice(eduAt)].join('\n');
}

/**
 * The skills the posting wants, added to the page and marked as not yet true.
 *
 * Reporting them as "missing keywords" told a student what was wrong and
 * nothing about what to do, on a page they had just asked to be tailored —
 * the one moment they are looking for the finished thing. So they go on,
 * under their own heading, marked, with the same rule as a planned project:
 * the draft may carry them, the PDF may not exist while it does.
 *
 * A skill is smaller than a project, so it earns a shorter plan — but it is
 * still work, and the deadline is the day they apply.
 */
function withPlannedSkills(resumeText, skills) {
  const wanted = (skills || []).filter(Boolean).slice(0, 8);
  if (!wanted.length) return String(resumeText || '');
  const lines = String(resumeText || '').split('\n');
  const block = ['', `LEARNING (${PLANNED} — remove or complete before applying)`, wanted.join(', ')];

  const at = lines.findIndex((l) => /^(PLANNED PROJECTS|EDUCATION)\b/i.test(l.trim()));
  if (at === -1) return [...lines, ...block].join('\n');
  return [...lines.slice(0, at), ...block, '', ...lines.slice(at)].join('\n');
}

/** How to make one claimed skill true, in the days before applying. */
function learnPlan(term) {
  const recipe = RECIPES.find((r) => r.match.test(term));
  if (recipe) {
    return {
      term,
      hours: recipe.hours,
      steps: recipe.steps.slice(0, 4),
      proof: `You can say you have used ${term} once ${recipe.build.toLowerCase()} exists and you can walk through it.`,
    };
  }
  return {
    term,
    hours: '1–2 days',
    steps: [
      `Finish the official ${term} getting-started guide end to end — not a video, the docs.`,
      `Add ${term} to a project you have already built, replacing something you did another way.`,
      'Break it deliberately and fix it: the failure is what gets asked about.',
      `Write two sentences on when you would choose ${term} and when you would not.`,
    ],
    proof: `You can say you have used ${term} once it is running in something of yours and you can explain the tradeoff.`,
  };
}

/** Every planned line still on a page. Empty means it is safe to export. */
function plannedLines(resumeText) {
  return String(resumeText || '')
    .split('\n')
    .filter((l) => RE_PLANNED.test(l))
    .map((l) => l.replace(/^-\s*/, '').replace(RE_PLANNED, '').trim());
}

/**
 * The page with the planned section taken back out — for a student who
 * decides to apply now with what they actually have.
 */
function withoutPlanned(resumeText) {
  const lines = String(resumeText || '').split('\n');
  const out = [];
  let skipping = false;
  lines.forEach((l) => {
    if (/^PLANNED PROJECTS\b/i.test(l.trim())) { skipping = true; return; }
    /* The section ends at the next heading. */
    if (skipping && /^[A-Z][A-Z &]{2,30}$/.test(l.trim())) skipping = false;
    if (skipping || RE_PLANNED.test(l)) return;
    out.push(l);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The same plan, without a job description.
 *
 * Somebody who says "make it 98" has not pasted a posting, and the honest
 * answer to what is missing is still knowable: the tools their target role is
 * expected to show that their page does not. Asking them to supply an advert
 * before it can help is asking for the thing they came here to avoid.
 */
function planForTarget(resumeText, missingTerms, options = {}) {
  const cap = Math.max(1, options.limit || 5);
  const terms = (missingTerms || []).filter(Boolean).slice(0, cap + 1);
  if (!terms.length) return { ok: false, reason: 'Nothing obvious is missing for that target.' };

  /*
   * Five, not three.
   *
   * A page reaches the length an ATS wants at around 250 words, and a
   * five-bullet resume sits near 130 — so three projects still leaves it
   * short and the student is told "not enough" after doing the work. Five
   * production-grade projects, picked from freely, is enough to close the
   * gap that remains once the wording is already right.
   */
  const plans = terms.slice(0, cap).map((term) => {
    const recipe = RECIPES.find((r) => r.match.test(term)) || generic(term);
    return {
      term,
      essential: true,
      build: recipe.build,
      hours: recipe.hours,
      steps: recipe.steps,
      bulletAfter: recipe.bullet,
      defend: recipe.defend,
    };
  });

  return {
    ok: true,
    missing: terms,
    weak: [],
    plans,
    rule: 'None of this is on your resume yet, and none of it should be until you have built it. A project you cannot walk through is worse than an empty section — it fails the first question an interviewer asks about it.',
    weakNote: null,
  };
}

/*
 * The deep bench: everything a domain's engineers are expected to have touched.
 *
 * Five options is the right size when the gap is five tools wide. It is the
 * wrong size when somebody is tailoring against Google — there the honest
 * answer is that a dozen things are missing, and offering five of them and
 * then declaring a ceiling reads as the agent giving up. These are the terms a
 * catalogue is drawn from, so a student aiming high can see the whole bench
 * and pick their way up it rather than being handed a short list and a no.
 *
 * The scoring keyword banks are deliberately NOT these. A score measured
 * against forty terms would move every number on every page; these exist only
 * to name work worth doing.
 */
const DEEP_BENCH = {
  software: ['rest api', 'postgresql', 'redis', 'docker', 'kubernetes', 'kafka',
    'ci/cd', 'terraform', 'aws', 'observability', 'load testing', 'caching',
    'authentication', 'rate limiting', 'graphql', 'grpc', 'websockets',
    'database indexing', 'message queue', 'feature flags', 'blue-green deploys',
    'schema migrations', 'distributed tracing', 'circuit breakers', 'idempotency',
    'pagination', 'search indexing', 'background jobs', 'webhooks', 'api versioning',
    'connection pooling', 'query optimisation', 'sharding', 'replication',
    'chaos testing', 'contract testing', 'canary releases', 'secrets management',
    'audit logging', 'multi-tenancy'],
  frontend: ['react', 'typescript', 'state management', 'accessibility',
    'core web vitals', 'server-side rendering', 'code splitting', 'design systems',
    'component testing', 'end-to-end testing', 'responsive layout', 'i18n',
    'progressive enhancement', 'web sockets', 'service workers', 'bundle analysis',
    'image optimisation', 'form validation', 'error boundaries', 'storybook'],
  data: ['sql', 'python', 'pandas', 'etl', 'data modelling', 'airflow', 'dbt',
    'warehouse design', 'incremental loads', 'data quality tests', 'dashboards',
    'a/b testing', 'cohort analysis', 'statistics', 'forecasting', 'spark',
    'streaming ingestion', 'partitioning', 'slowly changing dimensions',
    'metric definitions', 'anomaly detection', 'experiment design'],
  ml: ['python', 'pytorch', 'scikit-learn', 'feature engineering', 'model evaluation',
    'cross-validation', 'hyperparameter tuning', 'model serving', 'mlflow',
    'data drift monitoring', 'embeddings', 'vector search', 'fine-tuning',
    'prompt evaluation', 'retrieval augmented generation', 'quantisation',
    'batch inference', 'online inference', 'model registry', 'bias testing'],
  devops: ['linux', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'jenkins',
    'monitoring', 'alerting', 'log aggregation', 'incident response', 'slo design',
    'autoscaling', 'cost optimisation', 'secrets management', 'network policy',
    'backup and restore', 'disaster recovery', 'gitops', 'image scanning',
    'infrastructure testing', 'capacity planning', 'blue-green deploys'],
  security: ['owasp top ten', 'threat modelling', 'penetration testing',
    'static analysis', 'dependency scanning', 'secrets detection', 'siem',
    'incident response', 'network segmentation', 'cryptography', 'iam policy',
    'zero trust', 'log correlation', 'vulnerability triage', 'security headers',
    'authentication hardening', 'forensics', 'red teaming'],
  mobile: ['android', 'ios', 'offline sync', 'push notifications', 'app performance',
    'crash reporting', 'ci for mobile', 'deep linking', 'accessibility',
    'store release process', 'background tasks', 'local storage', 'ui testing'],
  hardware: ['embedded c', 'rtos', 'schematic capture', 'pcb layout', 'signal integrity',
    'firmware update', 'sensor calibration', 'power budgeting', 'hardware testing',
    'verilog', 'timing analysis', 'bring-up', 'thermal design', 'emc testing'],
  business: ['excel modelling', 'sql', 'dashboards', 'kpi definition',
    'process mapping', 'requirements gathering', 'stakeholder interviews',
    'cost benefit analysis', 'forecasting', 'market sizing', 'pricing analysis',
    'scenario modelling', 'variance analysis', 'reporting automation'],
  design: ['design systems', 'user research', 'usability testing', 'prototyping',
    'information architecture', 'accessibility', 'interaction design',
    'design tokens', 'handoff specs', 'content design', 'motion design'],
};

/* Which benches a title draws from, best-fit first. */
const BENCH_FOR = [
  [/front.?end|react|ui developer|web developer|interaction|visual design/i, ['frontend', 'software']],
  [/design|ux|user research|content design/i, ['design', 'frontend']],
  [/\bml\b|machine learning|deep learning|\bai\b|llm|nlp|vision|research engineer/i, ['ml', 'data', 'software']],
  [/data (analyst|engineer|scientist)|analytics|business intelligence|warehouse|\betl\b/i, ['data', 'software']],
  [/devops|\bsre\b|platform|reliability|cloud|infrastructure|release/i, ['devops', 'software']],
  [/security|infosec|grc|forensic|threat|cryptograph|privacy/i, ['security', 'software']],
  [/android|\bios\b|mobile|flutter|react native/i, ['mobile', 'software']],
  [/embedded|firmware|vlsi|asic|\brf\b|hardware|electronic|mechatronic|avionic|controls/i, ['hardware', 'software']],
  [/analyst|consultant|manager|product owner|operations|supply chain|finance|risk|actuar|marketing|recruit/i, ['business', 'data']],
  [/./, ['software', 'data']],
];

/**
 * A catalogue of projects worth building for a target, as deep as asked for.
 *
 * `exclude` is whatever the page already evidences — nobody should be told to
 * build the thing they have already built. The order is bench order, which is
 * roughly what a team would want in what order.
 */
function catalogueFor(target, exclude = [], limit = 25) {
  const skip = new Set((exclude || []).map((s) => String(s).toLowerCase()));
  const benches = (BENCH_FOR.find(([re]) => re.test(String(target || ''))) || [, ['software']])[1];
  const seen = new Set();
  const terms = [];
  benches.forEach((b) => (DEEP_BENCH[b] || []).forEach((t) => {
    const k = t.toLowerCase();
    if (seen.has(k) || skip.has(k)) return;
    seen.add(k);
    terms.push(t);
  }));
  return terms.slice(0, Math.max(1, limit)).map((term) => {
    const recipe = RECIPES.find((r) => r.match.test(term)) || generic(term);
    return {
      term,
      essential: true,
      build: recipe.build,
      hours: recipe.hours,
      steps: recipe.steps,
      bulletAfter: recipe.bullet,
      defend: recipe.defend,
    };
  });
}

module.exports = {
  planFor, planForTarget, RECIPES, projectEntries, withPlannedProjects,
  withPlannedSkills, learnPlan, catalogueFor, DEEP_BENCH,
  plannedLines, withoutPlanned, PLANNED, RE_PLANNED,
};
