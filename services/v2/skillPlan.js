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
/*
 * Real systems, named, for the themes the employers actually screen on.
 *
 * Everything without a recipe fell through to generic(), which produced "A
 * production-shaped service built on sharding" — a title with a technology
 * slotted into it, which is exactly the dummy-project smell a reviewer spots
 * in one glance and which was going onto pages tailored for Google. These are
 * specific builds with a domain, a failure mode and a number to report, drawn
 * from what each company's own engineering writing and postings describe the
 * work as. Where a term has one of these, nothing generic is ever shown.
 *
 * On what these are NOT: nobody publishes which candidate's projects got them
 * hired, so nothing here is derived from hiring outcomes and nothing claims to
 * be. What is public is the shape of the work each of these companies says it
 * does, and a project shaped like the work is the thing worth building.
 *
 * [ match, build, hours, steps[], bullet, defend ]
 */
const BRIEFS = [
  ['sharding|partitioning|consistent hashing',
    'A sharded datastore that survives a shard being added',
    '4–6 days',
    ['Take one table that will not fit on one box — 20 million rows of something real, generated or public.',
      'Shard it across four Postgres instances by consistent hashing on a key you choose and can justify.',
      'Write the router so the application never knows which shard it is talking to.',
      'Build the rebalancer: add a fifth shard and move the minimum number of keys, online, with no lost writes.',
      'Run a read/write load test during the rebalance and record what the latency did.',
      'Measure: rows moved, p99 during rebalance vs steady state, and the number of keys that actually had to move.'],
    'Sharded a <N>-million-row dataset across <N> nodes with consistent hashing, rebalancing online with <N>ms p99 and zero lost writes',
    'Why consistent hashing over modulo, and what happens to an in-flight write during a rebalance.'],
  ['distributed tracing|observability|opentelemetry',
    'A three-service request traced end to end, with the slow span found',
    '2–3 days',
    ['Take three services that call each other and instrument them with OpenTelemetry.',
      'Propagate the trace context across every hop, including the async one — that hop is where traces usually break.',
      'Ship spans to Jaeger or Tempo and put a dashboard on p50/p95/p99 per service.',
      'Add deliberate latency in one dependency and find it from the trace alone, not from the code.',
      'Wire one alert to a latency objective so it pages on the symptom, not the cause.',
      'Measure: which span held the p99, what it was, and what the number became after you fixed it.'],
    'Instrumented <N> services with distributed tracing, locating a <N>ms p99 regression in <the slow span> and cutting it to <N>ms',
    'How context propagates across an async boundary, and why sampling at the edge is not the same as sampling per service.'],
  ['search indexing|search relevance|elasticsearch|opensearch',
    'A search that returns the right thing, measured against a labelled set',
    '3–5 days',
    ['Index a real corpus — 100,000 documents at least, a public dataset is fine.',
      'Get a baseline working with plain BM25 and write down what it gets wrong.',
      'Label 100 queries with what a correct result looks like. This is the part everybody skips and it is the whole project.',
      'Improve it: analysers, synonyms, field boosts, then a re-ranking pass. Re-measure after each change.',
      'Report precision@10 and mean reciprocal rank against the labelled set, before and after.',
      'Measure: index size, query p95, and the relevance numbers — not just "it feels better".'],
    'Built search over <N> documents, lifting precision@10 from <before> to <after> against a hand-labelled query set at <N>ms p95',
    'What your labelled set does not cover, and why precision@10 rather than accuracy.'],
  ['load testing|performance testing|capacity planning',
    'A service load-tested to the point where it breaks, with the reason',
    '2–3 days',
    ['Take a service you already built. Write a load profile that looks like real traffic, not a flat line.',
      'Ramp until something gives. Find the knee: the concurrency where latency stops being linear.',
      'Profile at the knee and name the actual bottleneck — connection pool, GC, a lock, a missing index.',
      'Fix one thing. Re-run the identical profile. Record both curves.',
      'Write the capacity statement: this service holds N requests a second at p99 under Xms on this hardware.',
      'Measure: the knee before and after, and the one change that moved it.'],
    'Load-tested <the service> to <N> requests a second, identifying <the bottleneck> at the latency knee and raising throughput <before> to <after>',
    'Why the knee is where it is, and what you would hit next if you doubled the load again.'],
  ['idempotency|exactly-once|deduplication',
    'A payment endpoint that cannot double-charge, proven under retries',
    '2–3 days',
    ['Build an endpoint that moves money between two accounts in a real ledger table.',
      'Require an idempotency key and store the result against it, in the same transaction as the effect.',
      'Write the concurrent test: fire the same key 50 times in parallel and assert exactly one charge.',
      'Handle the hard case — a retry that arrives while the first request is still in flight.',
      'Add reconciliation: a job that proves the ledger balances, and run it after a chaos pass.',
      'Measure: duplicate charges under N concurrent retries (it must be zero), and the reconciliation result.'],
    'Built an idempotent payments endpoint proven against <N> concurrent duplicate requests with zero double-charges and a reconciling ledger',
    'What happens when the retry arrives before the first request has committed.'],
  ['caching|redis|cache invalidation',
    'A cache with an invalidation strategy you can defend',
    '1–2 days',
    ['Find the slowest real query in something you built and put a cache in front of it.',
      'Choose a strategy on purpose — write-through, write-behind or TTL — and write down why.',
      'Solve the stampede: what happens when the key expires and 500 requests miss at once.',
      'Instrument hit rate, and the latency at hit and at miss, separately.',
      'Prove correctness: a test that shows stale data is impossible in your invalidation path.',
      'Measure: hit rate, p99 before and after, and the origin load you removed.'],
    'Cached <the hot path> at a <N>% hit rate, cutting p99 from <before>ms to <after>ms with single-flight protection against stampedes',
    'How you invalidate, and what you would do differently at ten times the key count.'],
  ['rate limiting|throttling|quota',
    'A rate limiter that holds under a burst, shared across instances',
    '1–2 days',
    ['Implement a token bucket in Redis so the limit is shared across every instance, not per-process.',
      'Return the standard headers — limit, remaining, reset — and a 429 with Retry-After.',
      'Test the burst: 1,000 requests in one second against a 100/second limit, and assert exactly what gets through.',
      'Handle the Redis outage: decide fail-open or fail-closed and defend the choice in a comment.',
      'Add a per-key override so one abusive client can be throttled without touching everyone else.',
      'Measure: allowed vs rejected under burst, and the limiter overhead in milliseconds.'],
    'Built a distributed token-bucket rate limiter holding <N> requests a second across <N> instances, adding <N>ms overhead',
    'Why a token bucket rather than a fixed window, and what your limiter does when Redis is down.'],
  ['chaos testing|resilience|circuit breaker',
    'A system that survives its dependency being killed, on purpose',
    '3–4 days',
    ['Take a service with at least two downstream dependencies you can turn off.',
      'Add circuit breakers with real thresholds, plus timeouts and bounded retries with jitter.',
      'Write the game day: kill a dependency, kill the database, add 2s of latency, fill the disk.',
      'Run each and record what the user actually saw — not what the logs said.',
      'Fix the worst failure mode and re-run the identical experiment.',
      'Measure: error rate and recovery time per experiment, before and after.'],
    'Ran <N> chaos experiments against <the service>, cutting recovery from <before>s to <after>s with circuit breakers and bounded retries',
    'Why retries without jitter make an outage worse, and where you chose to fail open.'],
  ['a/b testing|experiment design|feature flags',
    'An experiment platform that can call a result honestly',
    '2–4 days',
    ['Build flag-based assignment with a stable hash so a user never flips between variants.',
      'Compute the sample size you need BEFORE running anything, and write it down.',
      'Log exposure and outcome events, and build the analysis that produces a confidence interval.',
      'Run a real experiment on something you own, even if the effect is small.',
      'Write the readout: effect size, interval, and whether you would ship it.',
      'Measure: the sample you needed, the sample you got, and the interval you ended with.'],
    'Built experiment assignment and readout for <N> users, calling <the change> with a <N>% effect at a stated confidence interval',
    'Why you cannot peek at a running experiment, and what you would do about a novelty effect.'],
  ['schema migration|zero downtime|expand and contract',
    'A breaking schema change shipped with no downtime',
    '2–3 days',
    ['Take a live table with data and a column that has to change type or split in two.',
      'Do it expand-and-contract: add, dual-write, backfill, verify, switch reads, drop.',
      'Write the backfill so it runs in batches and can be resumed after being killed halfway.',
      'Verify with a reconciliation query that proves old and new agree on every row.',
      'Run the whole thing against live read/write traffic and record the error count.',
      'Measure: rows backfilled, time taken, and errors seen by clients (target zero).'],
    'Migrated a <N>-row table through expand-and-contract under live traffic, backfilling in batches with zero client-visible errors',
    'What happens if the deploy is rolled back after the dual-write step.'],
  ['model serving|inference|batch inference',
    'A model behind an API, with the latency and the cost measured',
    '3–4 days',
    ['Take a trained model — yours or an open one — and serve it behind a real HTTP API.',
      'Add batching so concurrent requests share a forward pass, and tune the batch window.',
      'Measure cold start, p50 and p99 under concurrency, and cost per thousand inferences.',
      'Add input validation and a fallback for when the model is unavailable.',
      'Version the model and prove you can roll back to the previous one in one command.',
      'Measure: throughput, p99, cost per 1,000 calls, and rollback time.'],
    'Served <the model> at <N> inferences a second, p99 <N>ms, cutting cost per thousand from <before> to <after> with request batching',
    'What your batch window trades away, and how you would detect the model getting worse in production.'],
  ['prompt evaluation|llm evaluation|retrieval augmented generation',
    'A retrieval system with an evaluation set that can fail it',
    '3–5 days',
    ['Build retrieval over a corpus you know well, so you can tell a right answer from a plausible one.',
      'Write 100 question-and-expected-answer pairs by hand before touching the pipeline.',
      'Score with retrieval hit rate and answer faithfulness, both automated, both re-runnable.',
      'Change one thing at a time — chunk size, embedding model, re-ranking — and re-score every time.',
      'Add a regression gate so a change that lowers the score cannot be merged.',
      'Measure: hit rate and faithfulness before and after, and the change that actually moved them.'],
    'Built retrieval over <N> documents with a hand-labelled eval set, lifting answer faithfulness from <before> to <after>',
    'Where your eval set is wrong, and why hit rate alone does not tell you the answer was right.'],
  ['audit logging|audit trail|compliance logging',
    'An append-only audit trail that survives an auditor',
    '2–3 days',
    ['Log every state change to an append-only store with actor, timestamp, before and after.',
      'Make tampering detectable: hash-chain the entries so a deleted row breaks the chain.',
      'Build the query an auditor actually asks — reconstruct this record as it stood on this date.',
      'Separate the retention policy from the data and enforce it in a job.',
      'Prove it: mutate a row directly in the database and show the verifier catching it.',
      'Measure: write overhead in milliseconds, and the verifier finding a planted tamper.'],
    'Built a hash-chained audit trail over <N> state changes, reconstructing any record at any date and detecting tampering in <N>ms',
    'Why a hash chain rather than trusting database permissions, and what your retention job deletes.'],
  ['reconciliation|ledger|double.entry',
    'A double-entry ledger that proves it balances',
    '3–4 days',
    ['Model accounts and entries properly: every movement is two entries, and they sum to zero.',
      'Enforce it in the database with a constraint, not in application code where it can be bypassed.',
      'Build the reconciliation job that recomputes every balance from entries and compares.',
      'Simulate the failures — a crash mid-transfer, a duplicate webhook, an out-of-order settlement.',
      'Show the job catching a deliberately planted discrepancy.',
      'Measure: entries reconciled, run time, and discrepancies found (planted and real).'],
    'Built a double-entry ledger reconciling <N> entries with database-enforced balance, catching planted discrepancies in <N>s',
    'Why double entry rather than a balance column, and what your job does when it finds a real break.'],
  ['forecasting|demand forecasting|time series',
    'A forecast measured against a baseline that is hard to beat',
    '2–4 days',
    ['Take a real series with seasonality — public demand, energy, or traffic data.',
      'Establish the naive baseline first: last value, and seasonal naive. Most models lose to these.',
      'Build a proper model and back-test it with rolling origin, never a random split.',
      'Report MAPE and MAE against the baseline, per horizon, not averaged into one number.',
      'Say where it fails — which weeks, and why — rather than only where it works.',
      'Measure: error at 1, 4 and 12 periods out, against the seasonal naive.'],
    'Forecast <the series> at <N>% MAPE at a <N>-period horizon, beating seasonal naive by <N> points on rolling-origin back-tests',
    'Why rolling origin rather than a random split, and the horizon where your model stops being useful.'],
  ['predictive maintenance|anomaly detection|condition monitoring',
    'An anomaly detector with a false-positive rate somebody would accept',
    '3–4 days',
    ['Take real sensor or metric data with known incidents in it — public datasets exist for this.',
      'Start with a threshold and a z-score baseline, and measure them honestly.',
      'Build the real detector and compare on the same labelled incidents.',
      'Tune for the cost asymmetry: a missed failure and a false alarm are not equally expensive, and you should say which.',
      'Add an explanation to every alert — which signal moved and by how much.',
      'Measure: precision, recall, false alarms per week, and lead time before the incident.'],
    'Built anomaly detection over <N> sensor streams at <N>% precision and <N> false alarms a week, with <N> hours of lead time',
    'The cost you assumed for a false alarm versus a miss, and how lead time changes the answer.'],
  ['legacy migration|strangler|modernisation',
    'A legacy component replaced under live traffic, reversibly',
    '4–6 days',
    ['Pick one component of something old and put a facade in front of it.',
      'Build the replacement behind a flag and dual-run both, comparing outputs on live traffic.',
      'Log every divergence and drive it to zero before switching anything.',
      'Cut over a percentage at a time, with a rollback that takes one command.',
      'Delete the old path only after a full cycle with no divergence — deleting it is the project.',
      'Measure: divergences found and fixed, cutover percentage over time, rollback time.'],
    'Replaced <the legacy component> under live traffic via a strangler facade, driving divergence to zero across <N> requests before cutover',
    'What you did about the divergence you could not explain, and how you would roll back after deletion.'],
];

const RECIPES = [
  ...BRIEFS.map(([match, build, hours, steps, bullet, defend]) => ({
    match: new RegExp(`\\b(${match})\\b`, 'i'), build, hours, steps, bullet, defend,
  })),
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
    /*
     * Named for the thing, not for the technology.
     *
     * "A production-shaped service built on sharding" is a title with a word
     * slotted into it, and it reads as a placeholder to anybody who has
     * reviewed a resume — which is what it was. A brief that says what the
     * system IS survives the same glance.
     */
    build: `A working system where ${term} is the hard part`,
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
/** Plans for a named list of terms, in the order given. */
function plansFor(terms, exclude = [], limit = 50) {
  const skip = new Set((exclude || []).map((s) => String(s).toLowerCase()));
  const seen = new Set();
  return (terms || [])
    .filter((t) => {
      const k = String(t || '').toLowerCase();
      if (!k || seen.has(k) || skip.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, Math.max(1, limit))
    .map((term) => {
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
  withPlannedSkills, learnPlan, catalogueFor, plansFor, DEEP_BENCH,
  plannedLines, withoutPlanned, PLANNED, RE_PLANNED,
};
