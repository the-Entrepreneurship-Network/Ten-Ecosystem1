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
const RECIPES = [
  {
    match: /\b(kafka|rabbitmq|sqs|pub\/?sub|message queue|event stream)\b/i,
    build: 'A queue-backed order processor',
    hours: '8–12 hours',
    steps: [
      'Run the broker locally with Docker — one container, the official image, default config.',
      'Write a producer that publishes an order as JSON every few seconds.',
      'Write a consumer that reads the queue and writes each order to a file or a table.',
      'Kill the consumer mid-run and restart it. Prove nothing was lost — that is the whole point of the technology and the thing you will be asked about.',
      'Add a second consumer and watch the work split between them.',
      'Measure: how many messages a minute, and what happened to the count when you killed the consumer.',
    ],
    bullet: 'Built a <broker>-backed order pipeline handling <N> messages a minute, with at-least-once delivery verified by killing and restarting consumers mid-run',
    defend: 'Why a queue instead of a direct call, and what happens to a message when a consumer dies.',
  },
  {
    match: /\b(docker|container|containeri[sz]ation)\b/i,
    build: 'Containerise something you have already written',
    hours: '3–5 hours',
    steps: [
      'Take a project you have already finished. Write a Dockerfile for it.',
      'Get the image under 200MB using a multi-stage build — the first attempt is always huge, and shrinking it is the part worth learning.',
      'Add a docker-compose file that starts your app and its database together.',
      'Prove it works on a clean machine: delete your local dependencies and run only the container.',
      'Measure: image size before and after the multi-stage build, and cold start time.',
    ],
    bullet: 'Containerised <project> with a multi-stage Docker build, cutting the image from <before>MB to <after>MB and making a one-command local setup',
    defend: 'What a layer is, why order matters in a Dockerfile, and what multi-stage actually saves.',
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
    bullet: 'Defined <N> cloud resources in Terraform with variables and remote state, making the environment reproducible from a clean account in <N> minutes',
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
    build: `A small project that uses ${term} for something real`,
    hours: '6–10 hours',
    steps: [
      `Read the official ${term} documentation's own getting-started guide, and finish it.`,
      `Rebuild something you have already made, using ${term} for one part of it — the comparison is what teaches you.`,
      'Break it on purpose and fix it. The failure mode is what gets asked about.',
      'Write down one thing it does well and one thing it does badly. Interviewers ask.',
      'Measure something: how much data, how fast, how many users.',
    ],
    bullet: `Built <project> using ${term}, <the number it moved>`,
    defend: `When you would choose ${term} and when you would not.`,
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

module.exports = { planFor, RECIPES };
