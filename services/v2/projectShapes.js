'use strict';

/**
 * A project, taken apart so it can be rebuilt for a particular employer and a
 * particular job title.
 *
 * The tables in skillPlan hold finished project sentences — "Sharded a
 * multi-million-row dataset with consistent-hash routing and an online
 * rebalancer, adding a shard under live read/write load with zero lost
 * writes". That sentence is right, and it was going onto every page: a data
 * scientist at Google and a backend engineer at HDFC Bank got the same words,
 * because the sentence has no room in it for who is reading or what they are
 * hiring for.
 *
 * So each one is stored in three pieces:
 *
 *   did      the verb and everything up to the object
 *   rest     everything after the object
 *   artefact the noun the project is called, for the title
 *
 * The employer supplies the object — the data or system their engineering is
 * actually about — and the role supplies a closing clause naming what that job
 * is measured on. The result is the same engineering, aimed:
 *
 *   Sharded retail banking ledgers with consistent-hash routing and an online
 *   rebalancer, adding a shard under live read/write load with zero lost
 *   writes, with the reconciliation proving the ledger balanced afterwards
 *
 *   Sharded a web-scale document index with consistent-hash routing and an
 *   online rebalancer, adding a shard under live read/write load with zero
 *   lost writes, with tail latency at the API boundary as the number that
 *   mattered
 *
 * Neither is a claim about the employer. It is a specification for a project
 * the student builds, shaped like the work that employer does — which is the
 * only kind of portfolio project that survives being asked about.
 */

/*
 * Keyed by the project title as skillPlan writes it, because that is the one
 * string every path through the engine already has. A title with no shape here
 * falls back to its stored sentence unchanged, so adding a project never
 * requires touching this file first.
 */
const SHAPES = {
  /* ── the named briefs ─────────────────────────────────────────────────── */
  'A sharded datastore that survives a shard being added': {
    artefact: 'shard router with an online rebalancer',
    did: 'Sharded',
    rest: 'with consistent-hash routing and an online rebalancer, adding a shard under live read/write load with zero lost writes, with real users reading through the rebalance',
  },
  'A three-service request traced end to end, with the slow span found': {
    artefact: 'request trace across three services',
    did: 'Traced the request path over',
    /* "through", not "across": a substrate that already ends in "across
       devices" made the composed line read "across devices across three
       services", and a doubled preposition is the tell that a sentence was
       assembled rather than written. */
    rest: 'through three services including the async hop, locating a latency regression from the trace alone and alerting on the objective rather than the cause, on the dashboard the on-call rota reads daily',
  },
  'A search that returns the right thing, measured against a labelled set': {
    artefact: 'relevance harness with a hand-labelled query set',
    did: 'Built search over',
    rest: 'and raised precision@10 against a hand-labelled query set using analysers, field boosts and a re-ranking pass, against the queries users actually run',
  },
  'A service load-tested to the point where it breaks, with the reason': {
    artefact: 'load profile taken to the latency knee',
    did: 'Load-tested the service behind',
    rest: 'to its latency knee under a realistic traffic profile, named the bottleneck by profiling at that point and raised throughput by fixing it, against traffic shaped like a real day of users',
  },
  'A payment endpoint that cannot double-charge, proven under retries': {
    artefact: 'idempotent write path with a reconciling ledger',
    did: 'Built an idempotent write path over',
    rest: 'storing the result against the key in the same transaction as the effect, proven by firing duplicate concurrent requests and reconciling afterwards, on the path real users pay through',
  },
  'A cache with an invalidation strategy you can defend': {
    artefact: 'cache tier with a defended invalidation strategy',
    did: 'Put a cache in front of the slowest query over',
    rest: 'with a deliberate write-through invalidation strategy, measuring hit rate and bounding stale-read exposure on the hot path users actually hit',
  },
  'A rate limiter that holds under a burst, shared across instances': {
    artefact: 'distributed token-bucket limiter',
    did: 'Rate-limited the endpoints serving',
    rest: 'with a distributed token bucket and the standard limit, remaining and reset headers, holding one limit correctly across every client that shares it',
  },
  'A system that survives its dependency being killed, on purpose': {
    artefact: 'circuit breakers proven by killing the dependency',
    did: 'Hardened the service over',
    rest: 'with circuit breakers, real timeouts and bounded retries across two downstream dependencies, then killed each one under load with users served throughout',
  },
  'An experiment platform that can call a result honestly': {
    artefact: 'experiment assignment with the sample size fixed first',
    did: 'Built flag-based experiment assignment over',
    rest: 'with stable hashing and the sample size computed before launch, so a result could be called before any users were exposed to it',
  },
  'A breaking schema change shipped with no downtime': {
    artefact: 'expand-and-contract migration on a live table',
    did: 'Shipped a breaking schema change to',
    rest: 'expand-and-contract — add, dual-write, backfill, verify, cut over — with no downtime and a reversible step at every stage, with users reading and writing throughout',
  },
  'A model behind an API, with the latency and the cost measured': {
    artefact: 'batched inference service with a cost model',
    did: 'Served a model trained on',
    rest: 'behind an API with request batching so concurrent calls share a forward pass, measuring tail latency and cost per inference on the requests real users send',
  },
  'A retrieval system with an evaluation set that can fail it': {
    artefact: 'retrieval evaluation set that can fail a release',
    did: 'Built retrieval over',
    rest: 'with a hand-written evaluation set of question-and-expected-answer pairs, so a change that made answers worse failed the suite instead of shipping, so a worse answer never reaches users',
  },
  'An append-only audit trail that survives an auditor': {
    artefact: 'hash-chained audit trail',
    did: 'Built an append-only audit trail over',
    rest: 'with hash-chained entries, making a deleted or altered record detectable rather than merely unlikely, with every read and write attributable to a user',
  },
  'A double-entry ledger that proves it balances': {
    artefact: 'double-entry ledger with a database-enforced invariant',
    did: 'Modelled a double-entry ledger over',
    rest: 'with the balance invariant enforced by a database constraint rather than application code, and a reconciliation job that proves it after every run, reconciled daily',
  },
  'A forecast measured against a baseline that is hard to beat': {
    artefact: 'forecast beaten against a seasonal-naive baseline',
    did: 'Built a forecast over',
    rest: 'that beat both naive and seasonal-naive baselines on rolling-origin back-tests, reporting error at a stated horizon rather than on a single split, re-scored weekly as new data arrived',
  },
  'An anomaly detector with a false-positive rate somebody would accept': {
    artefact: 'anomaly detector tuned to an on-call false-positive rate',
    did: 'Built an anomaly detector over',
    rest: 'against known incidents, tuned from a z-score baseline down to a false-positive rate an on-call rota would accept, at a rate an on-call rota can triage daily',
  },
  'A legacy component replaced under live traffic, reversibly': {
    artefact: 'reversible cutover with both paths dual-run',
    did: 'Replaced a legacy component handling',
    rest: ', dual-running both paths and comparing their outputs, cutting over under live traffic with the switch still reversible, with users served throughout the comparison',
  },

  /* ── the term buckets, ordinary tier ──────────────────────────────────── */
  'Event-driven order pipeline with exactly-once processing': {
    artefact: 'event pipeline with exactly-once processing',
    did: 'Built an event-driven pipeline over',
    rest: 'with transactional-outbox publishing and idempotent consumers, proven by reconciling every message after killing a consumer mid-run, run daily against live traffic',
  },
  'Containerised multi-service stack with CI-built images': {
    artefact: 'containerised stack with CI-built images',
    did: 'Containerised the multi-service stack behind',
    rest: 'with multi-stage non-root images and health checks, wiring CI to build, scan and push on every merge, used daily by the team',
  },
  'Kubernetes deployment that survives node loss': {
    artefact: 'Kubernetes deployment that survives node loss',
    did: 'Deployed the services behind',
    rest: 'to Kubernetes with liveness and readiness probes, resource limits and rolling updates, recovering automatically from pod and node failure, while users stayed on it',
  },
  'Reproducible environment defined entirely in code': {
    artefact: 'environment defined entirely in code',
    did: 'Defined the cloud environment for',
    rest: 'in Terraform with reusable modules and remote state, rebuilding it from a clean account without a manual step, used weekly for fresh environments',
  },
  'CI pipeline that gates every merge': {
    artefact: 'CI pipeline that gates every merge',
    did: 'Built the CI pipeline for',
    rest: 'running tests, lint, type-checks and build on every push, with dependency caching and required status checks before merge, run on every push and every daily release',
  },
  'Interface over a live API with real error states': {
    artefact: 'interface with real loading and error states',
    did: 'Built an interface over',
    rest: 'with search, routing, loading and error states, removing render-blocking assets to improve first paint on slow connections, for users on slow connections',
  },
  'Relational schema with a query plan behind it': {
    artefact: 'relational schema with a covering index',
    did: 'Modelled a normalised schema over',
    rest: 'and cut the slowest report by adding a covering index, reading the query plan before and after, on the report users open daily',
  },
  'API other engineers can use without asking': {
    artefact: 'versioned API with contract tests',
    did: 'Built a versioned REST API over',
    rest: 'with pagination, idempotent writes, structured errors and generated documentation, consumed by client teams and covered by contract tests, used daily by client teams',
  },
  'Test suite that catches regressions before review': {
    artefact: 'test suite wired into the merge gate',
    did: 'Wrote unit and integration tests over the critical paths of',
    rest: ', wiring coverage into CI so an untested path blocks the merge, run daily on every push',
  },
  'Service deployed, monitored and costed': {
    artefact: 'service with a per-request cost budget',
    did: 'Deployed the service behind',
    rest: 'to the cloud with autoscaling, structured logging and alerting, tracking its cost per request against a budget, while serving users',
  },
  'Analysis that answers a question end to end': {
    artefact: 'reproducible analysis with its cleaning decisions written down',
    did: 'Built a reproducible pipeline over',
    rest: 'in Python, documenting the cleaning decisions and what each could and could not change about the answer, rerun weekly',
  },
  'Model trained, evaluated and served': {
    artefact: 'model served with drift monitoring',
    did: 'Trained a model on',
    rest: 'against a held-out split and honest baselines, then served it behind an API with input validation and drift monitoring, for users in production',
  },
  'Application hardened against the OWASP top ten': {
    artefact: 'threat model with the findings closed',
    did: 'Threat-modelled the application handling',
    rest: ', fixed the injection and access-control findings it surfaced, and added dependency and secret scanning to CI, re-run weekly against new dependencies',
  },
  'Service you can debug at three in the morning': {
    artefact: 'runbook that turns an alert into an action',
    did: 'Instrumented the services behind',
    rest: 'with structured logs, metrics and distributed tracing, and wrote the runbook that turns an alert into an action, used daily by the on-call rota',
  },
  'Firmware that recovers from its own failures': {
    artefact: 'firmware with a watchdog and a safe update path',
    did: 'Wrote firmware on a microcontroller handling',
    rest: 'with a watchdog, a safe update path and calibrated sensor input, recovering cleanly from power loss mid-write, on devices real users depend on',
  },

  /* ── the term buckets, industry tier ──────────────────────────────────── */
  'Multi-region event backbone with replay and exactly-once delivery': {
    artefact: 'multi-region event backbone with offset replay',
    did: 'Designed a partitioned event backbone for',
    rest: 'with a transactional outbox, consumer-group rebalancing and offset replay, verified by reprocessing a full day of traffic and reconciling against the source of truth, replayed daily',
  },
  'Hardened image supply chain with provenance and scanning': {
    artefact: 'image supply chain with signed provenance',
    did: 'Built a hardened image pipeline for',
    rest: 'with distroless multi-stage builds, signed provenance and blocking vulnerability gates, failing CI on any unsigned layer, on every image the team ships daily',
  },
  'Multi-tenant cluster with autoscaling and safe rollout': {
    artefact: 'multi-tenant cluster with progressive rollout',
    did: 'Ran a multi-tenant Kubernetes platform for',
    rest: 'with horizontal autoscaling, pod-disruption budgets, network-policy isolation and progressive rollout, draining a node under live traffic without a failed request, while users were on it',
  },
  'Multi-account infrastructure with policy enforcement': {
    artefact: 'multi-account estate with policy-as-code gates',
    did: 'Built a multi-account Terraform estate for',
    rest: 'with reusable modules, state locking and policy-as-code gates in CI, so a non-compliant plan fails before it can be applied, for the teams that apply it weekly',
  },
  'Progressive delivery with automated rollback': {
    artefact: 'progressive delivery with automated rollback',
    did: 'Built a delivery pipeline for',
    rest: 'with canary analysis, automatic rollback on error-budget burn and reproducible artefacts promoted unchanged from staging to production, on every release the team cuts weekly',
  },
  'Design-system-backed interface tuned for Core Web Vitals': {
    artefact: 'design-system interface green on Core Web Vitals',
    did: 'Built an interface over',
    rest: 'on a shared design system with code-splitting, server rendering and accessibility to WCAG AA, holding Core Web Vitals green on throttled mobile connections, for users on throttled mobile connections',
  },
  'Sharded datastore with online resharding': {
    artefact: 'datastore with an online resharding path',
    did: 'Sharded',
    rest: 'with consistent-hash routing and an online resharding path, moving a shard under live traffic with no read downtime and verifying row counts on both sides, while users kept reading',
  },
  'Public API with versioning, quotas and a deprecation path': {
    artefact: 'public API with quotas and a deprecation policy',
    did: 'Built a public API over',
    rest: 'with negotiated versioning, per-tenant quotas, idempotency keys and a published deprecation policy, backed by contract tests that fail CI on a breaking change, used daily by client teams',
  },
  'Deterministic suite with contract and chaos coverage': {
    artefact: 'deterministic suite with fault injection',
    did: 'Built a deterministic test suite over',
    rest: 'with contract tests across service boundaries and fault injection on dependencies, holding flake near zero across repeated CI runs, run daily',
  },
  'Multi-region service with failover and a cost model': {
    artefact: 'multi-region service with health-based failover',
    did: 'Ran a multi-region service over',
    rest: 'with health-based failover, cross-region replication and a per-request cost model, failing a region over without dropping a single user request',
  },
  'Warehouse model with lineage and data-quality gates': {
    artefact: 'incremental warehouse model with data-quality gates',
    did: 'Built an incremental warehouse model over',
    rest: 'with slowly changing dimensions, column-level lineage and data-quality tests that halt the load on a failed expectation, running daily',
  },
  'Production model with evaluation harness and drift alarms': {
    artefact: 'evaluation harness with shadow traffic and drift alarms',
    did: 'Built an evaluation harness over',
    rest: 'with a labelled set and a strong baseline, served the model with batched inference and shadow traffic, and alarmed on distribution drift before accuracy moved, for users in production',
  },
  'Detection pipeline with tuned, low-noise alerting': {
    artefact: 'detection pipeline tuned to a triageable alert rate',
    did: 'Built a detection pipeline over',
    rest: 'with tuned rules and enrichment, cutting false positives to a level an on-call team can actually triage, daily',
  },
  'SLO-driven observability with error budgets': {
    artefact: 'SLOs with burn-rate alerting wired to paging',
    did: 'Defined SLOs over the user-facing journeys through',
    rest: 'with error budgets, wired burn-rate alerting to paging policy, and traced a real regression end to end across services, on the journeys users take daily',
  },
  'Fail-safe firmware with verified over-the-air update': {
    artefact: 'A/B firmware update with signed images and rollback',
    did: 'Built a fail-safe firmware update path for',
    rest: 'with A/B partitions, signed images and automatic rollback, proven by interrupting the update at every stage, on devices in the field that users depend on',
  },
};

/** Tidy the seams a three-piece join leaves behind. */
function join(parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** `retail-ledger` → `Retail-ledger`, for the head of a project title. */
function leadCap(s) {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

module.exports = { SHAPES, join, leadCap };
