'use strict';

/**
 * What a given employer screens a given role on.
 *
 * Tailoring for Google and tailoring for JPMorgan were the same operation:
 * the same domain bench, the same twenty-five projects, the same skills list.
 * They are not the same job. Google's backend interview is distributed systems
 * and complexity under load; JPMorgan's is correctness, latency and an audit
 * trail somebody can be asked about in a regulatory review; TCS's is
 * integration and delivery against a client SLA. A student who builds the
 * wrong three projects has spent a month on the wrong month.
 *
 * SOURCE, stated plainly because it matters: these are the requirements that
 * recur across each employer's own published postings and engineering writing
 * for the role. It is a curated working list, not a live scrape, and it is
 * about the SHAPE of the work — nothing here asserts anything about a
 * particular student, and nothing here goes on a page as a claim. It decides
 * which projects get offered and which skills get named under LEARNING.
 *
 * A company we do not know by name still gets the right answer: its domain
 * decides, so a bank is a bank whether or not it is on the list.
 */

const { domainsFor } = require('./aspirationalCompanies');

/*
 * How each kind of employer screens. The terms are the vocabulary of the
 * work — they become projects through the recipe bank, and skills through the
 * learning plan, so they are written as things you can build or learn rather
 * than as adjectives.
 */
const ARCHETYPES = {
  software: {
    note: 'scale, latency and what happens when a dependency fails',
    projects: ['distributed tracing', 'sharding', 'caching', 'rate limiting',
      'message queue', 'load testing', 'idempotency', 'circuit breakers',
      'schema migrations', 'chaos testing', 'search indexing', 'observability'],
    skills: ['data structures', 'system design', 'concurrency', 'profiling',
      'code review', 'on-call practice'],
  },
  semiconductor: {
    note: 'timing, power and verification you can prove',
    projects: ['verilog', 'timing analysis', 'bring-up', 'hardware testing',
      'signal integrity', 'firmware update', 'sensor calibration'],
    skills: ['rtl design', 'verification', 'low-power design', 'scripting for eda'],
  },
  fintech: {
    note: 'money that reconciles, and a trail for every movement of it',
    projects: ['idempotency', 'audit logging', 'schema migrations', 'webhooks',
      'rate limiting', 'reconciliation', 'ledger design', 'fraud rules'],
    skills: ['double-entry accounting', 'pci basics', 'currency handling', 'retries and backoff'],
  },
  finance: {
    note: 'correctness first, latency second, and everything explainable afterwards',
    projects: ['low-latency messaging', 'risk model', 'time series storage',
      'audit logging', 'reconciliation', 'backtesting harness', 'market data ingestion'],
    skills: ['sql', 'statistics', 'regulatory reporting', 'java or c++ performance'],
  },
  insurance: {
    note: 'pricing you can defend to a regulator',
    projects: ['pricing model', 'claims pipeline', 'data quality tests', 'reporting automation'],
    skills: ['statistics', 'actuarial basics', 'sql', 'model documentation'],
  },
  healthcare: {
    note: 'data integrity and a validated process around it',
    projects: ['clinical data pipeline', 'data quality tests', 'audit logging',
      'medical imaging pipeline', 'de-identification'],
    skills: ['gxp basics', 'hipaa basics', 'statistics', 'validation documentation'],
  },
  retail: {
    note: 'peak traffic, forecasting and a store that cannot go down on a Saturday',
    projects: ['forecasting', 'inventory sync', 'search indexing', 'load testing',
      'a/b testing', 'recommendation ranking'],
    skills: ['sql', 'demand forecasting', 'experiment design', 'cost per order'],
  },
  fmcg: {
    note: 'demand planning and a supply chain that moves physical things',
    projects: ['forecasting', 'route optimisation', 'dashboards', 'data quality tests'],
    skills: ['sql', 'excel modelling', 'supply chain basics', 'scenario modelling'],
  },
  energy: {
    note: 'assets in the physical world, measured continuously and safely',
    projects: ['sensor calibration', 'time series storage', 'anomaly detection',
      'scada integration', 'predictive maintenance'],
    skills: ['signal processing', 'safety standards', 'sql', 'reliability engineering'],
  },
  chemicals: {
    note: 'process control and a batch record that survives an audit',
    projects: ['process simulation', 'anomaly detection', 'data quality tests', 'batch reporting'],
    skills: ['process control', 'statistics', 'safety standards'],
  },
  metals: {
    note: 'yield, downtime and the cost of a stopped line',
    projects: ['predictive maintenance', 'anomaly detection', 'dashboards', 'process simulation'],
    skills: ['statistics', 'reliability engineering', 'sql'],
  },
  infrastructure: {
    note: 'schedule, cost and a design somebody signs off on',
    projects: ['scheduling model', 'cost model', 'dashboards', 'document control'],
    skills: ['project scheduling', 'cost estimation', 'compliance documentation'],
  },
  aerospace: {
    note: 'safety-critical, deterministic, and certified before it flies',
    projects: ['rtos', 'hardware-in-the-loop testing', 'flight data analysis',
      'redundancy design', 'sensor fusion'],
    skills: ['do-178c basics', 'embedded c', 'real-time design', 'requirements traceability'],
  },
  automotive: {
    note: 'real-time control, fleets and software that ships to hardware',
    projects: ['rtos', 'can bus integration', 'sensor fusion', 'over-the-air update',
      'hardware-in-the-loop testing'],
    skills: ['embedded c', 'iso 26262 basics', 'real-time design', 'diagnostics'],
  },
  industrial: {
    note: 'uptime on machines that cost money every minute they are stopped',
    projects: ['predictive maintenance', 'scada integration', 'anomaly detection',
      'digital twin', 'dashboards'],
    skills: ['plc basics', 'reliability engineering', 'statistics'],
  },
  telecom: {
    note: 'throughput, coverage and millions of sessions at once',
    projects: ['high-throughput ingestion', 'network monitoring', 'load testing',
      'time series storage', 'anomaly detection'],
    skills: ['networking', 'protocol analysis', 'capacity planning'],
  },
  networking: {
    note: 'packets, protocols and failure domains',
    projects: ['network monitoring', 'protocol implementation', 'load testing', 'network policy'],
    skills: ['networking', 'protocol analysis', 'linux'],
  },
  hardware: {
    note: 'the seam where software meets a physical device',
    projects: ['firmware update', 'bring-up', 'hardware testing', 'sensor calibration'],
    skills: ['embedded c', 'debugging with a scope', 'power budgeting'],
  },
  media: {
    note: 'delivery at scale, and quality somebody notices immediately',
    projects: ['streaming pipeline', 'transcoding', 'cdn caching', 'a/b testing',
      'recommendation ranking'],
    skills: ['codecs', 'quality of experience metrics', 'caching'],
  },
  logistics: {
    note: 'routing, scanning and a network that runs overnight',
    projects: ['route optimisation', 'tracking pipeline', 'forecasting', 'high-throughput ingestion'],
    skills: ['operations research basics', 'sql', 'geospatial data'],
  },
  itservices: {
    note: 'integration, migration and delivery against a client SLA',
    projects: ['schema migrations', 'api versioning', 'integration testing',
      'legacy migration', 'reporting automation', 'contract testing'],
    skills: ['enterprise integration', 'requirements traceability', 'client documentation',
      'estimation'],
  },
  consulting: {
    note: 'a defensible recommendation, in a deck, on a deadline',
    projects: ['cost model', 'market sizing', 'dashboards', 'scenario modelling'],
    skills: ['structured problem solving', 'excel modelling', 'stakeholder interviews'],
  },
};

/*
 * The houses whose bar is distinctive enough to name.
 *
 * These sit on top of the archetype rather than replacing it — an Amazon
 * backend engineer is still a backend engineer. Each list is what recurs in
 * that employer's own postings and engineering writing for the role.
 */
const HOUSE = {
  google: { note: 'algorithmic depth and systems that stay correct at planetary scale',
    projects: ['sharding', 'distributed tracing', 'search indexing', 'load testing'],
    skills: ['data structures', 'complexity analysis', 'system design', 'c++ or go'] },
  amazon: { note: 'ownership end to end, cost per request, and a written design doc',
    projects: ['idempotency', 'message queue', 'autoscaling', 'cost optimisation'],
    skills: ['system design', 'aws', 'operational metrics', 'writing design documents'] },
  microsoft: { note: 'platform thinking and backwards compatibility nobody notices',
    projects: ['api versioning', 'schema migrations', 'observability', 'contract testing'],
    skills: ['system design', 'azure', 'accessibility', 'secure development lifecycle'] },
  meta: { note: 'product velocity with measurement attached to every change',
    projects: ['a/b testing', 'feature flags', 'caching', 'recommendation ranking'],
    skills: ['experiment design', 'profiling', 'data structures'] },
  apple: { note: 'the last ten percent of quality, and privacy by construction',
    projects: ['app performance', 'offline sync', 'accessibility', 'ui testing'],
    skills: ['performance profiling', 'privacy engineering', 'swift or objective-c'] },
  netflix: { note: 'streaming at scale and a system that expects to be broken',
    projects: ['chaos testing', 'streaming pipeline', 'circuit breakers', 'canary releases'],
    skills: ['resilience patterns', 'observability', 'jvm tuning'] },
  nvidia: { note: 'throughput on hardware you have to understand to use',
    projects: ['batch inference', 'quantisation', 'load testing', 'profiling harness'],
    skills: ['cuda basics', 'gpu memory model', 'numerical precision'] },
  openai: { note: 'evaluation you trust before capability you claim',
    projects: ['prompt evaluation', 'retrieval augmented generation', 'model serving',
      'data drift monitoring'],
    skills: ['evaluation design', 'python', 'inference optimisation'] },
  tesla: { note: 'software that ships to a vehicle and cannot be rolled back casually',
    projects: ['over-the-air update', 'sensor fusion', 'hardware-in-the-loop testing'],
    skills: ['embedded c', 'real-time design', 'safety analysis'] },
  spacex: { note: 'deterministic behaviour under conditions you only get one shot at',
    projects: ['rtos', 'redundancy design', 'flight data analysis', 'hardware testing'],
    skills: ['embedded c', 'requirements traceability', 'failure analysis'] },
  stripe: { note: 'money that reconciles and an API other engineers enjoy using',
    projects: ['idempotency', 'webhooks', 'api versioning', 'reconciliation'],
    skills: ['api design', 'currency handling', 'writing documentation'] },
  'goldman sachs': { note: 'quantitative rigour and a number you can defend line by line',
    projects: ['risk model', 'backtesting harness', 'time series storage'],
    skills: ['statistics', 'derivatives basics', 'sql', 'performance-sensitive java or c++'] },
  'jpmorgan chase': { note: 'correctness, controls and an audit trail for everything',
    projects: ['audit logging', 'reconciliation', 'low-latency messaging', 'schema migrations'],
    skills: ['java', 'regulatory reporting', 'secure development lifecycle'] },
  'tata consultancy services': { note: 'delivery against a client contract, documented as you go',
    projects: ['legacy migration', 'integration testing', 'reporting automation'],
    skills: ['enterprise integration', 'estimation', 'client documentation'] },
  infosys: { note: 'migration and integration work that has to land on a date',
    projects: ['legacy migration', 'schema migrations', 'contract testing'],
    skills: ['enterprise integration', 'estimation', 'requirements traceability'] },
  'reliance industries': { note: 'consumer scale in India and assets in the physical world',
    projects: ['high-throughput ingestion', 'anomaly detection', 'tracking pipeline'],
    skills: ['sql', 'capacity planning', 'networking'] },
  'hdfc bank': { note: 'transaction integrity and RBI-facing controls',
    projects: ['audit logging', 'reconciliation', 'fraud rules'],
    skills: ['java', 'regulatory reporting', 'secure development lifecycle'] },
};

/** The archetype for a company, by name if we know it, by domain otherwise. */
function archetypeFor(company, role) {
  const { COMPANIES } = require('./aspirationalCompanies');
  const hit = COMPANIES.find(([n]) => n.toLowerCase() === String(company || '').toLowerCase());
  /*
   * An unknown employer is not a blank: whatever the role is, its domain says
   * how that kind of business screens. A bank we have never heard of is still
   * a bank, and a student tailoring for one should get the bank's bench.
   */
  const domain = hit ? hit[1] : domainsFor(role)[0];
  return ARCHETYPES[domain] || ARCHETYPES.software;
}

/**
 * What to build and what to learn, for this employer and this role.
 *
 * House terms lead where we know the house, then its archetype, and the
 * caller layers the role's own bench behind both — so the result is shaped by
 * the company without stopping being shaped by the job.
 */
function profileFor(company, role) {
  const key = String(company || '').toLowerCase();
  const house = HOUSE[key] || null;
  const arch = archetypeFor(company, role);
  const dedupe = (list) => [...new Set(list.filter(Boolean).map((s) => String(s)))];
  return {
    company: company || '',
    known: Boolean(house),
    note: house ? house.note : arch.note,
    projects: dedupe([...(house ? house.projects : []), ...arch.projects]),
    skills: dedupe([...(house ? house.skills : []), ...arch.skills]),
  };
}

/** One line naming what this employer looks for, for the reply. */
function noteFor(company, role) {
  const p = profileFor(company, role);
  return `${company} screens ${String(role || 'this role').toLowerCase()} on ${p.note}.`;
}

module.exports = { profileFor, noteFor, ARCHETYPES, HOUSE };
