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
 * SOURCE, stated plainly because it matters and because it is easy to imply
 * more than is true: these are the requirements that recur across each
 * employer's own PUBLISHED postings, engineering writing and published hiring
 * rubrics. This is not anybody's internal shortlisting data — who a company
 * actually advanced over the last six years lives in their ATS, is not
 * published, and nothing here should be read as claiming to know it. What it
 * does know is what they ask for in writing, repeatedly, which is the thing a
 * student can act on anyway.
 *
 * It is about the SHAPE of the work. Nothing here asserts anything about a
 * particular student and nothing here goes on a page as a claim; it decides
 * which projects get offered, which skills get named under LEARNING, and what
 * the page is told to lead with.
 *
 * A company we do not know by name still gets a real answer: its domain
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
/*
 * Written as a table rather than nested objects, because there are a hundred
 * and sixty-six of them and a table is the only shape that stays readable and
 * stays edited. Each row:
 *
 *   [ name, what they screen on, what the PAGE should lead with,
 *     [projects worth building], [skills worth naming] ]
 *
 * The third column is the one that changes the resume itself. "What do they
 * look for" is answered everywhere on the internet in adjectives; what a
 * student needs is which of their own true facts to put at the top for this
 * employer, and that differs sharply — Amazon reads for a written argument
 * with numbers in it, an IT-services firm reads for certifications and
 * delivery dates, a bank reads for controls and accuracy.
 */
const HOUSES = [
  /* ---------------- software, cloud, consumer internet ---------------- */
  ['Google', 'algorithmic depth and systems that stay correct at planetary scale',
    'the hardest technical problem you have solved, with the complexity stated',
    ['sharding', 'distributed tracing', 'search indexing', 'load testing'],
    ['data structures', 'complexity analysis', 'system design', 'c++ or go']],
  ['Amazon', 'ownership end to end, cost per request, and a written design doc',
    'outcomes you owned alone, each with a number and what it cost',
    ['idempotency', 'message queue', 'autoscaling', 'cost optimisation'],
    ['system design', 'aws', 'operational metrics', 'writing design documents']],
  ['Microsoft', 'platform thinking and backwards compatibility nobody notices',
    'work other people built on top of, and what you did not break',
    ['api versioning', 'schema migrations', 'observability', 'contract testing'],
    ['system design', 'azure', 'accessibility', 'secure development lifecycle']],
  ['Meta', 'product velocity with measurement attached to every change',
    'shipped features with the metric they moved, not the feature list',
    ['a/b testing', 'feature flags', 'caching', 'recommendation ranking'],
    ['experiment design', 'profiling', 'data structures']],
  ['Apple', 'the last ten percent of quality, and privacy by construction',
    'craft: the detail you refused to ship without, and why it mattered',
    ['app performance', 'offline sync', 'accessibility', 'ui testing'],
    ['performance profiling', 'privacy engineering', 'swift or objective-c']],
  ['Netflix', 'streaming at scale and a system that expects to be broken',
    'senior judgement — a call you made alone and what it cost or saved',
    ['chaos testing', 'streaming pipeline', 'circuit breakers', 'canary releases'],
    ['resilience patterns', 'observability', 'jvm tuning']],
  ['OpenAI', 'evaluation you trust before capability you claim',
    'what you measured before you believed it, and how you measured it',
    ['prompt evaluation', 'retrieval augmented generation', 'model serving', 'data drift monitoring'],
    ['evaluation design', 'python', 'inference optimisation']],
  ['Salesforce', 'multi-tenant platform work and customers who cannot be broken',
    'integrations you shipped and the tenants or accounts they served',
    ['multi-tenancy', 'api versioning', 'integration testing', 'audit logging'],
    ['apex or java', 'data modelling', 'release management']],
  ['Adobe', 'creative tooling where the render loop is the product',
    'anything visual you made fast, with the before and after timings',
    ['image optimisation', 'app performance', 'batch inference', 'profiling harness'],
    ['performance profiling', 'graphics basics', 'c++ or rust']],
  ['Oracle', 'data correctness at volume, and upgrades that do not lose rows',
    'database work with row counts, query times and a migration you survived',
    ['query optimisation', 'schema migrations', 'replication', 'connection pooling'],
    ['sql', 'plsql or java', 'backup and recovery']],
  ['IBM', 'enterprise systems, standards and long support horizons',
    'certifications, standards you worked to, and systems still running',
    ['legacy migration', 'contract testing', 'audit logging', 'observability'],
    ['enterprise integration', 'java', 'requirements traceability']],
  ['Intuit', 'money accuracy for people who are not accountants',
    'anything where being wrong cost money, and how you prevented it',
    ['reconciliation', 'audit logging', 'a/b testing', 'data quality tests'],
    ['double-entry accounting', 'tax domain basics', 'sql']],
  ['ServiceNow', 'workflow platforms and the processes they replace',
    'a manual process you automated, with hours saved per week',
    ['reporting automation', 'integration testing', 'api versioning', 'background jobs'],
    ['workflow modelling', 'javascript', 'enterprise integration']],
  ['Workday', 'HR and finance data where a wrong field is a payroll incident',
    'data accuracy work, and the checks you put around it',
    ['data quality tests', 'schema migrations', 'audit logging', 'reporting automation'],
    ['sql', 'data modelling', 'privacy engineering']],
  ['Snowflake', 'query performance and the bill it produces',
    'warehouse work with data volumes, query times and cost per query',
    ['warehouse design', 'partitioning', 'query optimisation', 'incremental loads'],
    ['sql', 'cost optimisation', 'data modelling']],
  ['Palantir', 'messy real-world data turned into something operators trust',
    'the hardest data you have cleaned, and what decision it enabled',
    ['etl', 'data quality tests', 'search indexing', 'access control'],
    ['python or java', 'data modelling', 'stakeholder interviews']],
  ['Uber', 'real-time systems where latency is somebody standing on a street',
    'live systems with request volumes and p99 latency',
    ['high-throughput ingestion', 'route optimisation', 'caching', 'circuit breakers'],
    ['system design', 'go or java', 'geospatial data']],
  ['Airbnb', 'trust, search relevance and a product people feel',
    'search or ranking work with a conversion or quality number',
    ['search indexing', 'recommendation ranking', 'a/b testing', 'fraud rules'],
    ['experiment design', 'data structures', 'design sense']],
  ['Booking Holdings', 'experimentation at a scale where a percent is real money',
    'experiments you ran and what they proved, including the failures',
    ['a/b testing', 'search indexing', 'caching', 'load testing'],
    ['experiment design', 'statistics', 'sql']],
  ['PayPal', 'payment correctness and fraud you catch before the customer does',
    'transaction work with volumes, and the controls around it',
    ['reconciliation', 'fraud rules', 'idempotency', 'audit logging'],
    ['java', 'pci basics', 'anomaly detection']],
  ['Block', 'payments for small merchants, hardware and software together',
    'end-to-end work: something you built that a real merchant used',
    ['idempotency', 'reconciliation', 'offline sync', 'webhooks'],
    ['api design', 'currency handling', 'embedded basics']],
  ['Stripe', 'money that reconciles and an API other engineers enjoy using',
    'API design and the documentation you wrote for it',
    ['idempotency', 'webhooks', 'api versioning', 'reconciliation'],
    ['api design', 'currency handling', 'writing documentation']],
  ['Cisco', 'packets, protocols and failure domains',
    'network work with throughput, and a protocol you implemented',
    ['network monitoring', 'protocol implementation', 'network policy', 'load testing'],
    ['networking', 'protocol analysis', 'linux']],
  ['Dell Technologies', 'hardware and the software that has to run on it',
    'systems work close to the metal, with measured throughput',
    ['firmware update', 'hardware testing', 'observability', 'capacity planning'],
    ['linux', 'embedded c', 'storage basics']],
  ['Hewlett Packard Enterprise', 'enterprise infrastructure and support horizons',
    'infrastructure you operated, with uptime and incident numbers',
    ['observability', 'backup and restore', 'capacity planning', 'network monitoring'],
    ['linux', 'networking', 'reliability engineering']],

  /* ---------------------- semiconductors, hardware --------------------- */
  ['Nvidia', 'throughput on hardware you have to understand to use',
    'anything you made faster, with the profile before and after',
    ['batch inference', 'quantisation', 'load testing', 'profiling harness'],
    ['cuda basics', 'gpu memory model', 'numerical precision']],
  ['Intel', 'silicon and the toolchain around it',
    'low-level work: instruction counts, cache behaviour, power',
    ['verilog', 'timing analysis', 'profiling harness', 'bring-up'],
    ['computer architecture', 'c or c++', 'performance profiling']],
  ['AMD', 'performance per watt, proven on real workloads',
    'benchmark work with the workload named and the numbers shown',
    ['profiling harness', 'timing analysis', 'batch inference', 'hardware testing'],
    ['computer architecture', 'c++', 'benchmarking']],
  ['Qualcomm', 'wireless and mobile silicon with strict power budgets',
    'embedded work with power figures and a shipped device',
    ['firmware update', 'signal integrity', 'rtos', 'power budgeting'],
    ['embedded c', 'dsp basics', 'protocol analysis']],
  ['Broadcom', 'networking and storage silicon at volume',
    'RTL or driver work, with the standard you implemented',
    ['verilog', 'timing analysis', 'protocol implementation', 'hardware testing'],
    ['rtl design', 'verification', 'networking']],
  ['Texas Instruments', 'analogue and embedded parts that go into everything',
    'circuits you designed and boards you brought up',
    ['pcb layout', 'sensor calibration', 'bring-up', 'power budgeting'],
    ['analogue design', 'embedded c', 'lab instrumentation']],
  ['Micron Technology', 'memory yield, reliability and test coverage',
    'test and yield work, with defect rates and sample sizes',
    ['hardware testing', 'anomaly detection', 'data quality tests', 'timing analysis'],
    ['statistics', 'verification', 'process control']],
  ['Applied Materials', 'process equipment and the physics inside it',
    'process or controls work with tolerances and yield',
    ['process simulation', 'sensor calibration', 'anomaly detection', 'predictive maintenance'],
    ['process control', 'physics fundamentals', 'python']],
  ['Analog Devices', 'precision signal chains where noise is the enemy',
    'measurement work: noise floors, calibration, and the bench setup',
    ['sensor calibration', 'signal integrity', 'pcb layout', 'hardware testing'],
    ['analogue design', 'signal processing', 'lab instrumentation']],
  ['Lam Research', 'etch and deposition equipment held to fine tolerances',
    'equipment work with uptime, tolerance and throughput figures',
    ['process simulation', 'predictive maintenance', 'scada integration', 'anomaly detection'],
    ['process control', 'reliability engineering', 'python']],
  ['KLA', 'inspection and metrology — finding defects nobody can see',
    'imaging or detection work with false-positive rates',
    ['medical imaging pipeline', 'anomaly detection', 'data quality tests', 'batch inference'],
    ['image processing', 'statistics', 'c++ or python']],

  /* ------------------------ banking and finance ------------------------ */
  ['Goldman Sachs', 'quantitative rigour and a number you can defend line by line',
    'quantitative work with the method stated and the assumptions named',
    ['risk model', 'backtesting harness', 'time series storage'],
    ['statistics', 'derivatives basics', 'sql', 'performance-sensitive java or c++']],
  ['JPMorgan Chase', 'correctness, controls and an audit trail for everything',
    'accuracy and controls: what could go wrong and what you put in the way',
    ['audit logging', 'reconciliation', 'low-latency messaging', 'schema migrations'],
    ['java', 'regulatory reporting', 'secure development lifecycle']],
  ['Morgan Stanley', 'risk you can explain to a committee',
    'analysis with the assumptions written down and stress-tested',
    ['risk model', 'reconciliation', 'reporting automation', 'time series storage'],
    ['statistics', 'sql', 'regulatory reporting']],
  ['Bank of America', 'scale, controls and regulatory reporting that lands on time',
    'controls, reconciliation and deadlines you met',
    ['audit logging', 'reconciliation', 'reporting automation', 'schema migrations'],
    ['java', 'sql', 'regulatory reporting']],
  ['Citigroup', 'cross-border money movement and the rules on each side',
    'work spanning systems or countries, and the reconciliation between them',
    ['reconciliation', 'low-latency messaging', 'audit logging', 'currency handling'],
    ['java', 'regulatory reporting', 'currency handling']],
  ['Wells Fargo', 'retail banking controls and remediation that sticks',
    'process and control work, with what you fixed permanently',
    ['audit logging', 'reconciliation', 'data quality tests', 'reporting automation'],
    ['sql', 'regulatory reporting', 'process mapping']],
  ['BlackRock', 'portfolio analytics and models that survive a market move',
    'analytics with the model, the data and the backtest shown',
    ['risk model', 'backtesting harness', 'time series storage', 'data quality tests'],
    ['python', 'statistics', 'portfolio theory']],
  ['American Express', 'credit risk, fraud and a premium customer experience',
    'risk or fraud work with precision and recall, not just accuracy',
    ['fraud rules', 'risk model', 'anomaly detection', 'a/b testing'],
    ['statistics', 'sql', 'credit risk basics']],
  ['Visa', 'authorisation at planetary scale, measured in milliseconds',
    'high-volume transaction work with latency percentiles',
    ['low-latency messaging', 'idempotency', 'load testing', 'fraud rules'],
    ['java or c++', 'networking', 'pci basics']],
  ['Mastercard', 'payment rails, standards and the disputes process',
    'standards-based work and the edge cases you handled',
    ['reconciliation', 'idempotency', 'fraud rules', 'audit logging'],
    ['java', 'pci basics', 'protocol analysis']],
  ['Charles Schwab', 'brokerage correctness and a client who can see every trade',
    'accuracy work, and reporting a customer reads directly',
    ['reconciliation', 'audit logging', 'reporting automation', 'time series storage'],
    ['sql', 'regulatory reporting', 'java']],
  ['S&P Global', 'data lineage and a number somebody will quote in a filing',
    'data pipelines with provenance and quality checks',
    ['etl', 'data quality tests', 'data lineage', 'warehouse design'],
    ['sql', 'python', 'data governance']],
  ['Moody’s', 'ratings methodology you can publish and defend',
    'modelling with documented method and validation',
    ['risk model', 'data quality tests', 'reporting automation', 'scenario modelling'],
    ['statistics', 'credit risk basics', 'model documentation']],
  ['Chubb', 'underwriting discipline and claims that price correctly',
    'pricing or claims work with loss ratios and sample sizes',
    ['pricing model', 'claims pipeline', 'data quality tests', 'anomaly detection'],
    ['statistics', 'actuarial basics', 'sql']],
  ['Progressive', 'telematics and pricing that reacts to real driving',
    'behavioural data work with the signal you extracted',
    ['pricing model', 'anomaly detection', 'high-throughput ingestion', 'a/b testing'],
    ['statistics', 'sql', 'geospatial data']],
  ['MetLife', 'long-horizon liabilities and the models behind them',
    'long-term modelling with assumptions and sensitivity shown',
    ['pricing model', 'scenario modelling', 'reporting automation', 'data quality tests'],
    ['actuarial basics', 'statistics', 'sql']],
  ['HDFC Bank', 'transaction integrity and RBI-facing controls',
    'accuracy, controls and the regulatory deadline you met',
    ['audit logging', 'reconciliation', 'fraud rules'],
    ['java', 'regulatory reporting', 'secure development lifecycle']],
  ['ICICI Bank', 'digital banking volume with RBI controls behind it',
    'digital channel work with user volumes and uptime',
    ['idempotency', 'audit logging', 'fraud rules', 'load testing'],
    ['java', 'regulatory reporting', 'api design']],
  ['State Bank of India', 'the largest branch and channel network in the country',
    'systems serving very large user counts, and how they stayed up',
    ['load testing', 'reconciliation', 'audit logging', 'capacity planning'],
    ['java', 'sql', 'regulatory reporting']],
  ['Axis Bank', 'retail digital banking and partnership integrations',
    'integration work with partners, and the contracts between systems',
    ['api versioning', 'reconciliation', 'webhooks', 'audit logging'],
    ['java', 'api design', 'regulatory reporting']],
  ['Kotak Mahindra Bank', 'digital-first banking with tight risk discipline',
    'onboarding or risk work with conversion and default numbers',
    ['fraud rules', 'risk model', 'reconciliation', 'data quality tests'],
    ['sql', 'statistics', 'regulatory reporting']],
  ['Bajaj Finance', 'consumer lending decisions made in seconds',
    'credit decisioning work with approval and default rates',
    ['risk model', 'fraud rules', 'reporting automation', 'anomaly detection'],
    ['statistics', 'sql', 'credit risk basics']],
  ['SBI Life Insurance', 'policy administration and persistency',
    'policy or claims data work with accuracy figures',
    ['pricing model', 'claims pipeline', 'reporting automation', 'data quality tests'],
    ['actuarial basics', 'sql', 'regulatory reporting']],
  ['HDFC Life Insurance', 'pricing and persistency you can defend to IRDAI',
    'modelling with documented assumptions and validation',
    ['pricing model', 'scenario modelling', 'data quality tests', 'reporting automation'],
    ['actuarial basics', 'statistics', 'model documentation']],
  ['Shriram Finance', 'lending to customers formal credit data misses',
    'alternative-data credit work and what it predicted',
    ['risk model', 'data quality tests', 'anomaly detection', 'reporting automation'],
    ['statistics', 'sql', 'credit risk basics']],
  ['Jio Financial Services', 'financial products at consumer-internet scale',
    'high-volume consumer systems with onboarding funnels',
    ['idempotency', 'fraud rules', 'high-throughput ingestion', 'a/b testing'],
    ['api design', 'sql', 'regulatory reporting']],

  /* ------------------------- healthcare, pharma ------------------------ */
  ['Johnson & Johnson', 'validated processes and patient safety above speed',
    'work under a quality system, with the documentation you produced',
    ['clinical data pipeline', 'data quality tests', 'audit logging', 'de-identification'],
    ['gxp basics', 'statistics', 'validation documentation']],
  ['Pfizer', 'trial data integrity and regulatory submissions',
    'clinical or lab data work with the standard you followed',
    ['clinical data pipeline', 'data quality tests', 'reporting automation', 'de-identification'],
    ['cdisc basics', 'statistics', 'gxp basics']],
  ['Merck', 'research pipelines and reproducible analysis',
    'reproducible analysis: the pipeline, the seed, the version',
    ['clinical data pipeline', 'data quality tests', 'batch inference', 'de-identification'],
    ['statistics', 'python or r', 'gxp basics']],
  ['Eli Lilly', 'trial operations and manufacturing quality together',
    'process and data work with quality metrics attached',
    ['clinical data pipeline', 'process simulation', 'data quality tests', 'anomaly detection'],
    ['statistics', 'gxp basics', 'process control']],
  ['AbbVie', 'immunology pipelines and validated computational work',
    'analysis with the validation evidence beside it',
    ['clinical data pipeline', 'batch inference', 'data quality tests', 'de-identification'],
    ['statistics', 'python or r', 'validation documentation']],
  ['Amgen', 'biologics process data and computational biology',
    'biological data work with methods and controls stated',
    ['clinical data pipeline', 'process simulation', 'batch inference', 'data quality tests'],
    ['bioinformatics basics', 'statistics', 'python']],
  ['Thermo Fisher Scientific', 'instruments, and the data that comes off them',
    'instrument or lab-data work with calibration and throughput',
    ['sensor calibration', 'high-throughput ingestion', 'data quality tests', 'anomaly detection'],
    ['lab instrumentation', 'signal processing', 'python']],
  ['Danaher', 'operating discipline applied to life-science tooling',
    'measurable process improvement, with before and after',
    ['process simulation', 'predictive maintenance', 'data quality tests', 'dashboards'],
    ['process control', 'statistics', 'lean basics']],
  ['Medtronic', 'devices where a software fault is a clinical event',
    'safety-critical work and the hazard analysis behind it',
    ['rtos', 'hardware-in-the-loop testing', 'audit logging', 'sensor calibration'],
    ['iec 62304 basics', 'embedded c', 'risk analysis']],
  ['UnitedHealth Group', 'claims at national volume, and members who feel every error',
    'claims or eligibility data work with volumes and error rates',
    ['claims pipeline', 'data quality tests', 'de-identification', 'reporting automation'],
    ['sql', 'hipaa basics', 'statistics']],
  ['Abbott', 'diagnostics accuracy and device reliability',
    'measurement accuracy work, with sensitivity and specificity',
    ['sensor calibration', 'hardware testing', 'anomaly detection', 'data quality tests'],
    ['statistics', 'embedded c', 'gxp basics']],
  ['Gilead Sciences', 'virology research data and trial rigour',
    'analysis with the study design and the limitations stated',
    ['clinical data pipeline', 'batch inference', 'data quality tests', 'de-identification'],
    ['statistics', 'bioinformatics basics', 'python']],
  ['Sun Pharmaceutical', 'generics quality, cost and regulatory filings',
    'quality and cost work with batch data behind it',
    ['process simulation', 'data quality tests', 'reporting automation', 'anomaly detection'],
    ['gxp basics', 'statistics', 'process control']],
  ['Dr. Reddy’s Laboratories', 'process chemistry and filings for regulated markets',
    'process work with yield and impurity numbers',
    ['process simulation', 'data quality tests', 'batch reporting', 'anomaly detection'],
    ['process control', 'statistics', 'gxp basics']],
  ['Cipla', 'affordable manufacturing at scale, held to spec',
    'manufacturing data work with yield and deviation counts',
    ['process simulation', 'predictive maintenance', 'batch reporting', 'data quality tests'],
    ['process control', 'gxp basics', 'sql']],
  ['Divi’s Laboratories', 'custom synthesis and process efficiency',
    'chemistry or process work with conversion and cost figures',
    ['process simulation', 'anomaly detection', 'batch reporting', 'data quality tests'],
    ['process control', 'statistics', 'safety standards']],
  ['Apollo Hospitals', 'clinical operations and patient data handled properly',
    'healthcare data work with privacy handling made explicit',
    ['claims pipeline', 'de-identification', 'dashboards', 'data quality tests'],
    ['sql', 'hipaa basics', 'clinical workflow basics']],

  /* --------------------------- retail and FMCG -------------------------- */
  ['Walmart', 'supply chain and a store that cannot go down on a Saturday',
    'scale and reliability, with peak traffic and inventory numbers',
    ['forecasting', 'inventory sync', 'load testing', 'search indexing'],
    ['sql', 'demand forecasting', 'system design']],
  ['Costco', 'lean operations and a membership model built on price',
    'cost work: what you made cheaper and by how much',
    ['forecasting', 'inventory sync', 'dashboards', 'route optimisation'],
    ['sql', 'supply chain basics', 'cost modelling']],
  ['Target', 'omnichannel fulfilment and a peak season that cannot slip',
    'fulfilment or inventory work with peak volumes',
    ['inventory sync', 'forecasting', 'load testing', 'recommendation ranking'],
    ['sql', 'demand forecasting', 'experiment design']],
  ['Home Depot', 'store-level inventory truth and pro customers',
    'inventory accuracy work with store counts and error rates',
    ['inventory sync', 'forecasting', 'search indexing', 'dashboards'],
    ['sql', 'supply chain basics', 'search relevance']],
  ['Nike', 'brand, direct-to-consumer, and drops that spike traffic',
    'launch traffic work, and the experience you protected',
    ['load testing', 'inventory sync', 'a/b testing', 'recommendation ranking'],
    ['system design', 'experiment design', 'design sense']],
  ['Starbucks', 'store operations, loyalty and mobile ordering',
    'mobile or loyalty work with adoption and throughput figures',
    ['offline sync', 'forecasting', 'a/b testing', 'inventory sync'],
    ['mobile basics', 'sql', 'experiment design']],
  ['McDonald’s', 'throughput per store and consistency across thousands of them',
    'operations work where seconds per order mattered',
    ['forecasting', 'inventory sync', 'dashboards', 'route optimisation'],
    ['sql', 'operations research basics', 'process mapping']],
  ['Procter & Gamble', 'brand data, demand planning and rigorous experimentation',
    'a decision you made from data, with the test that supported it',
    ['forecasting', 'a/b testing', 'dashboards', 'data quality tests'],
    ['statistics', 'excel modelling', 'supply chain basics']],
  ['Coca-Cola', 'distribution reach and brand consistency',
    'route, demand or channel work with coverage numbers',
    ['route optimisation', 'forecasting', 'dashboards', 'inventory sync'],
    ['sql', 'supply chain basics', 'demand forecasting']],
  ['PepsiCo', 'demand planning across food and beverage together',
    'planning work with forecast accuracy stated',
    ['forecasting', 'route optimisation', 'dashboards', 'scenario modelling'],
    ['demand forecasting', 'sql', 'excel modelling']],
  ['Unilever', 'sustainability targets alongside brand performance',
    'work with both a commercial and a sustainability number',
    ['forecasting', 'dashboards', 'data quality tests', 'scenario modelling'],
    ['sql', 'supply chain basics', 'statistics']],
  ['Colgate-Palmolive', 'category share and cost discipline',
    'share or cost analysis with the method shown',
    ['forecasting', 'pricing analysis', 'dashboards', 'data quality tests'],
    ['excel modelling', 'sql', 'statistics']],
  ['Mondelez International', 'snacking demand that swings with season and promotion',
    'promotion and seasonality work with lift measured',
    ['forecasting', 'pricing analysis', 'a/b testing', 'dashboards'],
    ['demand forecasting', 'statistics', 'sql']],
  ['Hindustan Unilever', 'distribution into every Indian pin code',
    'distribution or rural reach work with coverage figures',
    ['route optimisation', 'forecasting', 'dashboards', 'inventory sync'],
    ['sql', 'supply chain basics', 'excel modelling']],
  ['ITC', 'diversified businesses under one operating discipline',
    'cross-business analysis with a clear commercial number',
    ['forecasting', 'dashboards', 'scenario modelling', 'pricing analysis'],
    ['excel modelling', 'sql', 'supply chain basics']],
  ['Nestlé India', 'food safety and demand planning together',
    'quality and planning work, with compliance evidence',
    ['forecasting', 'data quality tests', 'batch reporting', 'dashboards'],
    ['food safety basics', 'sql', 'demand forecasting']],
  ['Britannia Industries', 'shelf life, distribution and cost per unit',
    'cost and freshness work with wastage numbers',
    ['forecasting', 'route optimisation', 'inventory sync', 'dashboards'],
    ['supply chain basics', 'sql', 'excel modelling']],
  ['Titan Company', 'retail experience and inventory in high-value goods',
    'inventory and retail analytics with margin figures',
    ['inventory sync', 'forecasting', 'dashboards', 'fraud rules'],
    ['sql', 'retail analytics', 'excel modelling']],
  ['Trent', 'fast fashion turns and store-level decisions',
    'merchandising work with sell-through and markdown numbers',
    ['forecasting', 'inventory sync', 'pricing analysis', 'dashboards'],
    ['retail analytics', 'sql', 'demand forecasting']],
  ['Asian Paints', 'colour, formulation and one of India’s best supply chains',
    'supply chain or formulation work with service levels',
    ['forecasting', 'route optimisation', 'process simulation', 'dashboards'],
    ['supply chain basics', 'process control', 'sql']],

  /* ---------------------- energy, chemicals, utilities ------------------ */
  ['ExxonMobil', 'assets in the physical world, measured continuously and safely',
    'field or process data work, with safety handled explicitly',
    ['sensor calibration', 'time series storage', 'anomaly detection', 'predictive maintenance'],
    ['signal processing', 'safety standards', 'python']],
  ['Chevron', 'reservoir and operations data at industrial scale',
    'geoscience or operations analysis with uncertainty stated',
    ['time series storage', 'anomaly detection', 'scenario modelling', 'sensor calibration'],
    ['statistics', 'geospatial data', 'safety standards']],
  ['ConocoPhillips', 'production optimisation and capital discipline',
    'production or cost analysis with the model shown',
    ['time series storage', 'predictive maintenance', 'scenario modelling', 'dashboards'],
    ['statistics', 'reliability engineering', 'python']],
  ['NextEra Energy', 'renewables at grid scale and forecasting the weather',
    'forecasting work with error bars and grid impact',
    ['forecasting', 'time series storage', 'anomaly detection', 'scada integration'],
    ['statistics', 'power systems basics', 'python']],
  ['Schlumberger', 'field services and instrumentation in hard conditions',
    'instrumentation work that survived the field',
    ['sensor calibration', 'time series storage', 'predictive maintenance', 'anomaly detection'],
    ['signal processing', 'embedded c', 'safety standards']],
  ['Linde', 'industrial gases, plant efficiency and safety',
    'plant efficiency work with energy or yield numbers',
    ['process simulation', 'predictive maintenance', 'scada integration', 'anomaly detection'],
    ['process control', 'safety standards', 'statistics']],
  ['Dow', 'process chemistry and continuous plants',
    'process work with throughput, yield and safety evidence',
    ['process simulation', 'anomaly detection', 'batch reporting', 'predictive maintenance'],
    ['process control', 'chemical engineering fundamentals', 'safety standards']],
  ['Air Products', 'gas plants, hydrogen and long-lived capital assets',
    'plant or reliability work with uptime figures',
    ['process simulation', 'predictive maintenance', 'scada integration', 'dashboards'],
    ['process control', 'reliability engineering', 'safety standards']],
  ['Reliance Industries', 'consumer scale in India and assets in the physical world',
    'either very large user numbers or very large physical throughput',
    ['high-throughput ingestion', 'anomaly detection', 'tracking pipeline'],
    ['sql', 'capacity planning', 'networking']],
  ['ONGC', 'exploration and production data under state scrutiny',
    'subsurface or production analysis with documented method',
    ['time series storage', 'anomaly detection', 'scenario modelling', 'sensor calibration'],
    ['geospatial data', 'statistics', 'safety standards']],
  ['NTPC', 'thermal and renewable generation held to availability targets',
    'plant availability work with outage and heat-rate numbers',
    ['predictive maintenance', 'scada integration', 'time series storage', 'dashboards'],
    ['power systems basics', 'reliability engineering', 'sql']],
  ['Power Grid Corporation', 'transmission reliability across a national grid',
    'grid or network reliability work with outage statistics',
    ['scada integration', 'anomaly detection', 'network monitoring', 'time series storage'],
    ['power systems basics', 'networking', 'reliability engineering']],
  ['Coal India', 'mine operations, logistics and safety',
    'operations and safety work with tonnage and incident rates',
    ['route optimisation', 'predictive maintenance', 'dashboards', 'anomaly detection'],
    ['safety standards', 'operations research basics', 'sql']],
  ['BPCL', 'refining margins and a national retail network',
    'refinery or retail-network analysis with margin figures',
    ['process simulation', 'forecasting', 'route optimisation', 'dashboards'],
    ['process control', 'supply chain basics', 'sql']],

  /* ------------- industrial, aerospace, infrastructure, metals ---------- */
  ['Tesla', 'software that ships to a vehicle and cannot be rolled back casually',
    'something you shipped to physical hardware, and how you updated it',
    ['over-the-air update', 'sensor fusion', 'hardware-in-the-loop testing'],
    ['embedded c', 'real-time design', 'safety analysis']],
  ['SpaceX', 'deterministic behaviour under conditions you only get one shot at',
    'work that had to be right first time, and how you proved it would be',
    ['rtos', 'redundancy design', 'flight data analysis', 'hardware testing'],
    ['embedded c', 'requirements traceability', 'failure analysis']],
  ['Boeing', 'certification evidence as part of the engineering, not after it',
    'requirements traceability and the test evidence behind it',
    ['rtos', 'hardware-in-the-loop testing', 'redundancy design', 'flight data analysis'],
    ['do-178c basics', 'requirements traceability', 'embedded c']],
  ['Lockheed Martin', 'mission systems, clearances and rigorous process',
    'systems engineering work with requirements and verification',
    ['redundancy design', 'sensor fusion', 'hardware-in-the-loop testing', 'rtos'],
    ['requirements traceability', 'embedded c', 'systems engineering']],
  ['RTX', 'avionics and defence electronics built to standard',
    'standards-based engineering with the verification artefacts',
    ['rtos', 'signal integrity', 'hardware-in-the-loop testing', 'redundancy design'],
    ['do-178c basics', 'embedded c', 'requirements traceability']],
  ['Northrop Grumman', 'autonomy and sensing where failure is not recoverable',
    'sensing or autonomy work with failure modes analysed',
    ['sensor fusion', 'redundancy design', 'flight data analysis', 'rtos'],
    ['requirements traceability', 'embedded c', 'failure analysis']],
  ['General Electric', 'industrial machines and the data they emit',
    'asset performance work with uptime and maintenance figures',
    ['predictive maintenance', 'digital twin', 'scada integration', 'time series storage'],
    ['reliability engineering', 'statistics', 'python']],
  ['Honeywell', 'controls, safety systems and building automation',
    'control-systems work with the safety case included',
    ['scada integration', 'rtos', 'anomaly detection', 'predictive maintenance'],
    ['plc basics', 'safety standards', 'embedded c']],
  ['Caterpillar', 'heavy machines, telematics and dealer service',
    'machine data work with utilisation and downtime numbers',
    ['predictive maintenance', 'time series storage', 'route optimisation', 'anomaly detection'],
    ['reliability engineering', 'sql', 'embedded basics']],
  ['3M', 'materials science turned into manufacturable products',
    'materials or process work with test data behind it',
    ['process simulation', 'data quality tests', 'anomaly detection', 'dashboards'],
    ['statistics', 'process control', 'design of experiments']],
  ['Emerson Electric', 'automation, measurement and valve-level control',
    'instrumentation and control work with tolerances stated',
    ['scada integration', 'sensor calibration', 'predictive maintenance', 'rtos'],
    ['plc basics', 'process control', 'embedded c']],
  ['Eaton', 'power management and electrical safety',
    'electrical systems work with load and safety figures',
    ['scada integration', 'predictive maintenance', 'sensor calibration', 'anomaly detection'],
    ['power systems basics', 'safety standards', 'embedded c']],
  ['Siemens', 'industrial software and automation, standards throughout',
    'automation work with the standard and the commissioning evidence',
    ['scada integration', 'digital twin', 'predictive maintenance', 'process simulation'],
    ['plc basics', 'process control', 'requirements traceability']],
  ['Larsen & Toubro', 'projects delivered on schedule at physical scale',
    'a project you delivered, with schedule, cost and scope stated',
    ['scheduling model', 'cost model', 'document control', 'dashboards'],
    ['project scheduling', 'cost estimation', 'compliance documentation']],
  ['Bharat Electronics', 'defence electronics to Indian standards',
    'electronics and verification work with the standard named',
    ['signal integrity', 'rtos', 'hardware testing', 'redundancy design'],
    ['embedded c', 'requirements traceability', 'rf basics']],
  ['Hindustan Aeronautics', 'aircraft build and maintenance under certification',
    'aerospace work with the airworthiness evidence',
    ['rtos', 'hardware-in-the-loop testing', 'flight data analysis', 'redundancy design'],
    ['do-178c basics', 'requirements traceability', 'embedded c']],
  ['UltraTech Cement', 'plant efficiency, logistics and energy per tonne',
    'plant or logistics work with cost per tonne',
    ['process simulation', 'predictive maintenance', 'route optimisation', 'dashboards'],
    ['process control', 'supply chain basics', 'sql']],
  ['Grasim Industries', 'diversified manufacturing under one capital discipline',
    'manufacturing analysis with margin and utilisation figures',
    ['process simulation', 'forecasting', 'predictive maintenance', 'dashboards'],
    ['process control', 'excel modelling', 'sql']],
  ['JSW Steel', 'yield, downtime and the cost of a stopped line',
    'plant work with tonnage, yield and downtime numbers',
    ['predictive maintenance', 'process simulation', 'anomaly detection', 'dashboards'],
    ['process control', 'reliability engineering', 'statistics']],
  ['Tata Steel', 'long-cycle plants, safety culture and process control',
    'process and safety work with measured improvement',
    ['process simulation', 'predictive maintenance', 'scada integration', 'anomaly detection'],
    ['process control', 'safety standards', 'statistics']],
  ['Hindalco Industries', 'metals processing, energy cost and recovery rates',
    'recovery and energy work with the numbers behind it',
    ['process simulation', 'anomaly detection', 'predictive maintenance', 'dashboards'],
    ['process control', 'statistics', 'reliability engineering']],
  ['Adani Enterprises', 'large capital projects executed quickly',
    'project delivery with schedule and cost held',
    ['scheduling model', 'cost model', 'dashboards', 'document control'],
    ['project scheduling', 'cost estimation', 'stakeholder interviews']],
  ['Adani Ports', 'terminal throughput and vessel turnaround',
    'logistics work with turnaround and throughput figures',
    ['route optimisation', 'tracking pipeline', 'forecasting', 'dashboards'],
    ['operations research basics', 'sql', 'geospatial data']],

  /* ----------------------------- automotive ---------------------------- */
  ['Ford', 'vehicle software and a supply chain of thousands of parts',
    'embedded or supply-chain work with volumes and defect rates',
    ['can bus integration', 'over-the-air update', 'hardware-in-the-loop testing', 'forecasting'],
    ['embedded c', 'iso 26262 basics', 'diagnostics']],
  ['General Motors', 'electrification and software-defined vehicles',
    'vehicle systems work with the safety analysis attached',
    ['can bus integration', 'sensor fusion', 'over-the-air update', 'rtos'],
    ['embedded c', 'iso 26262 basics', 'real-time design']],
  ['Rivian', 'building a vehicle and its software from scratch, fast',
    'end-to-end ownership on hardware, shipped',
    ['over-the-air update', 'can bus integration', 'hardware-in-the-loop testing', 'sensor fusion'],
    ['embedded c', 'real-time design', 'diagnostics']],
  ['Maruti Suzuki', 'cost engineering and volume manufacturing in India',
    'cost-per-unit work with the manufacturing data behind it',
    ['process simulation', 'predictive maintenance', 'forecasting', 'dashboards'],
    ['process control', 'supply chain basics', 'statistics']],
  ['Tata Motors', 'commercial vehicles and electrification together',
    'vehicle or plant work with reliability and cost figures',
    ['can bus integration', 'predictive maintenance', 'over-the-air update', 'process simulation'],
    ['embedded c', 'process control', 'diagnostics']],
  ['Mahindra & Mahindra', 'rural durability and a broad vehicle portfolio',
    'durability and field-failure work with the data',
    ['predictive maintenance', 'can bus integration', 'hardware testing', 'anomaly detection'],
    ['embedded c', 'reliability engineering', 'diagnostics']],
  ['Bajaj Auto', 'two-wheeler engineering at export volumes',
    'cost, emissions or durability work with test figures',
    ['hardware testing', 'can bus integration', 'process simulation', 'anomaly detection'],
    ['embedded c', 'process control', 'emissions basics']],
  ['Hero MotoCorp', 'mass-market two-wheelers and a service network',
    'manufacturing or service-data work with volume figures',
    ['predictive maintenance', 'forecasting', 'process simulation', 'dashboards'],
    ['process control', 'sql', 'reliability engineering']],
  ['Eicher Motors', 'premium motorcycles and commercial vehicle engineering',
    'engineering work with quality and warranty numbers',
    ['hardware testing', 'predictive maintenance', 'can bus integration', 'anomaly detection'],
    ['embedded c', 'reliability engineering', 'process control']],

  /* -------------------------- telecom and media ------------------------ */
  ['Verizon', 'network throughput, coverage and millions of sessions at once',
    'network-scale work with throughput and session figures',
    ['high-throughput ingestion', 'network monitoring', 'load testing', 'capacity planning'],
    ['networking', 'protocol analysis', 'capacity planning']],
  ['AT&T', 'network modernisation and legacy that cannot be switched off',
    'migration work on live infrastructure, with zero-downtime evidence',
    ['legacy migration', 'network monitoring', 'load testing', 'observability'],
    ['networking', 'enterprise integration', 'capacity planning']],
  ['T-Mobile', 'network expansion and a customer experience built on it',
    'coverage or customer-experience work with measured impact',
    ['network monitoring', 'high-throughput ingestion', 'a/b testing', 'anomaly detection'],
    ['networking', 'sql', 'experiment design']],
  ['Bharti Airtel', 'subscriber scale in India and spectrum efficiency',
    'very high volume systems, with subscriber and traffic numbers',
    ['high-throughput ingestion', 'network monitoring', 'capacity planning', 'anomaly detection'],
    ['networking', 'sql', 'capacity planning']],
  ['Comcast', 'delivery infrastructure and a set-top experience',
    'streaming or delivery work with quality-of-experience metrics',
    ['cdn caching', 'streaming pipeline', 'network monitoring', 'load testing'],
    ['networking', 'codecs', 'caching']],
  ['Walt Disney', 'streaming quality and content at franchise scale',
    'media delivery work with playback and quality numbers',
    ['streaming pipeline', 'transcoding', 'cdn caching', 'recommendation ranking'],
    ['codecs', 'quality of experience metrics', 'caching']],
  ['Warner Bros. Discovery', 'catalogue delivery and a merged technology estate',
    'delivery or migration work across systems',
    ['streaming pipeline', 'transcoding', 'legacy migration', 'cdn caching'],
    ['codecs', 'enterprise integration', 'caching']],

  /* ---------------------------- logistics ------------------------------ */
  ['UPS', 'routing, scanning and a network that runs overnight',
    'routing or throughput work with packages and time windows',
    ['route optimisation', 'tracking pipeline', 'forecasting', 'high-throughput ingestion'],
    ['operations research basics', 'sql', 'geospatial data']],
  ['FedEx', 'time-definite delivery and scan-level visibility',
    'tracking and reliability work with on-time percentages',
    ['tracking pipeline', 'route optimisation', 'anomaly detection', 'forecasting'],
    ['operations research basics', 'geospatial data', 'sql']],
  ['Union Pacific', 'rail network scheduling and asset utilisation',
    'scheduling and utilisation work with network-level numbers',
    ['scheduling model', 'predictive maintenance', 'route optimisation', 'dashboards'],
    ['operations research basics', 'reliability engineering', 'sql']],
  ['Delta Air Lines', 'operational recovery and on-time performance',
    'operations work with delay minutes and recovery times',
    ['scheduling model', 'forecasting', 'anomaly detection', 'dashboards'],
    ['operations research basics', 'statistics', 'sql']],

  /* --------------------- IT services and consulting -------------------- */
  ['Tata Consultancy Services', 'delivery against a client contract, documented as you go',
    'certifications, client-facing delivery, and dates you met',
    ['legacy migration', 'integration testing', 'reporting automation'],
    ['enterprise integration', 'estimation', 'client documentation']],
  ['Infosys', 'migration and integration work that has to land on a date',
    'certifications and a migration you delivered on schedule',
    ['legacy migration', 'schema migrations', 'contract testing'],
    ['enterprise integration', 'estimation', 'requirements traceability']],
  ['Accenture', 'client outcomes, industry depth and delivery at scale',
    'business outcomes for a client, in their language and their numbers',
    ['legacy migration', 'reporting automation', 'integration testing', 'dashboards'],
    ['enterprise integration', 'stakeholder interviews', 'estimation']],
  ['HCLTech', 'engineering and infrastructure services under SLA',
    'SLA-bound work with uptime and ticket figures',
    ['observability', 'legacy migration', 'integration testing', 'backup and restore'],
    ['enterprise integration', 'linux', 'estimation']],
  ['Wipro', 'managed services and process-led delivery',
    'process improvement in a delivery setting, with metrics',
    ['reporting automation', 'legacy migration', 'integration testing', 'contract testing'],
    ['enterprise integration', 'process mapping', 'estimation']],
  ['Tech Mahindra', 'telecom-heavy systems integration',
    'telecom or network integration work with the standard named',
    ['legacy migration', 'network monitoring', 'integration testing', 'api versioning'],
    ['networking', 'enterprise integration', 'estimation']],
  ['Cognizant', 'domain-led delivery in healthcare and financial services',
    'domain knowledge plus delivery, with compliance evidence',
    ['legacy migration', 'claims pipeline', 'data quality tests', 'reporting automation'],
    ['enterprise integration', 'hipaa basics', 'estimation']],
  ['Deloitte', 'a defensible recommendation, in a deck, on a deadline',
    'structured analysis with the recommendation stated up front',
    ['cost model', 'scenario modelling', 'dashboards', 'market sizing'],
    ['structured problem solving', 'excel modelling', 'stakeholder interviews']],
  ['McKinsey & Company', 'structured problem solving and evidence for every claim',
    'a problem broken into parts, each part answered with data',
    ['market sizing', 'cost model', 'scenario modelling', 'dashboards'],
    ['structured problem solving', 'excel modelling', 'statistics']],
  ['Boston Consulting Group', 'analytical depth with an implementable answer',
    'analysis that changed a decision, and what happened next',
    ['market sizing', 'scenario modelling', 'cost model', 'a/b testing'],
    ['structured problem solving', 'excel modelling', 'stakeholder interviews']],

  /* ---- the engineering-heavy employers and the AI labs ---- */
  ['Anthropic', 'safety and evaluation held ahead of capability',
    'what you measured, what you refused to ship, and why',
    ['prompt evaluation', 'retrieval augmented generation', 'model serving', 'data drift monitoring'],
    ['evaluation design', 'python', 'red-teaming', 'writing design documents']],
  ['DeepMind', 'research you can reproduce from the paper alone',
    'a result somebody else could reproduce, with the code and the seed',
    ['batch inference', 'model serving', 'prompt evaluation', 'data quality tests'],
    ['statistics', 'python', 'experiment design', 'writing papers']],
  ['LinkedIn', 'graphs, relevance and a feed that stays fast',
    'ranking or graph work with the relevance metric attached',
    ['recommendation ranking', 'search indexing', 'caching', 'a/b testing'],
    ['data structures', 'experiment design', 'jvm tuning']],
  ['Atlassian', 'developer tools where the workflow is the product',
    'a tool other engineers actually adopted, with the adoption number',
    ['api versioning', 'integration testing', 'webhooks', 'feature flags'],
    ['api design', 'writing documentation', 'java']],
  ['Cloudflare', 'the edge — every millisecond, everywhere at once',
    'latency and network work with p99 across regions',
    ['cdn caching', 'rate limiting', 'network monitoring', 'load testing'],
    ['networking', 'rust or go', 'protocol analysis']],
  ['Databricks', 'data at a scale where the query plan is the product',
    'pipeline work with data volumes and query times',
    ['warehouse design', 'partitioning', 'query optimisation', 'incremental loads'],
    ['spark', 'sql', 'jvm tuning', 'cost optimisation']],
  ['Palo Alto Networks', 'detection that fires on the attack, not on the noise',
    'security work with false-positive rates and detection latency',
    ['siem', 'anomaly detection', 'network policy', 'threat modelling'],
    ['networking', 'incident response', 'detection engineering']],
  ['CrowdStrike', 'endpoint telemetry at scale, and what you infer from it',
    'detection engineering with precision and recall stated',
    ['anomaly detection', 'high-throughput ingestion', 'siem', 'audit logging'],
    ['detection engineering', 'statistics', 'operating system internals']],
  ['Shopify', 'commerce that must not fall over on the busiest day of the year',
    'peak-traffic work with the load numbers behind it',
    ['load testing', 'caching', 'idempotency', 'schema migrations'],
    ['ruby or go', 'system design', 'capacity planning']],
  ['Spotify', 'recommendation and streaming, measured on what people play',
    'ranking or audio work with an engagement number',
    ['recommendation ranking', 'streaming pipeline', 'a/b testing', 'batch inference'],
    ['experiment design', 'data structures', 'audio basics']],
  ['TSMC', 'process yield measured in parts per million',
    'yield, tolerance and test-coverage work with the statistics',
    ['process simulation', 'anomaly detection', 'hardware testing', 'data quality tests'],
    ['process control', 'statistics', 'semiconductor physics']],
  ['Samsung', 'shipping hardware and software together, at volume',
    'embedded work that shipped to a device, with the constraint you met',
    ['firmware update', 'rtos', 'hardware testing', 'app performance'],
    ['embedded c', 'android internals', 'power budgeting']],
  ['ASML', 'physics at nanometre tolerances, in a machine that must not drift',
    'precision and calibration work with the tolerance stated',
    ['sensor calibration', 'process simulation', 'signal integrity', 'predictive maintenance'],
    ['physics fundamentals', 'process control', 'c++']],
  ['Arm Holdings', 'instruction sets and the power budget they run inside',
    'low-level work with cycle counts or power figures',
    ['verilog', 'timing analysis', 'profiling harness', 'firmware update'],
    ['computer architecture', 'c', 'assembly']],
  ['Sony', 'consumer hardware where latency and quality are felt, not measured',
    'media or device work with a quality number a user would notice',
    ['streaming pipeline', 'transcoding', 'app performance', 'sensor calibration'],
    ['codecs', 'embedded c', 'signal processing']],
  ['Zoho', 'building the whole stack in-house, cost-consciously',
    'end-to-end ownership: something you built alone, all the way',
    ['api versioning', 'schema migrations', 'reporting automation', 'integration testing'],
    ['java', 'sql', 'writing documentation']],
  ['Freshworks', 'SaaS that a small business can set up without a consultant',
    'a feature real customers adopted, with the adoption number',
    ['api versioning', 'webhooks', 'a/b testing', 'integration testing'],
    ['api design', 'sql', 'writing documentation']],
  ['Razorpay', 'payments that reconcile, under Indian regulation',
    'transaction work with volumes and the controls around it',
    ['idempotency', 'reconciliation', 'webhooks', 'fraud rules'],
    ['api design', 'currency handling', 'regulatory reporting']],
  ['Zerodha', 'trading systems where a millisecond and a rupee both matter',
    'low-latency or ledger work with the numbers behind it',
    ['low-latency messaging', 'reconciliation', 'time series storage', 'load testing'],
    ['c++ or go', 'market data basics', 'regulatory reporting']],
  ['Flipkart', 'sale-day traffic and a supply chain behind every order',
    'peak-scale work with order volumes and latency',
    ['load testing', 'inventory sync', 'caching', 'search indexing'],
    ['system design', 'sql', 'capacity planning']],
  ['Swiggy', 'real-time logistics where the customer is watching a map',
    'live routing or dispatch work with delivery-time numbers',
    ['route optimisation', 'tracking pipeline', 'high-throughput ingestion', 'forecasting'],
    ['operations research basics', 'geospatial data', 'system design']],
  ['Zomato', 'discovery and delivery in one product, at city scale',
    'search, ranking or logistics work with a measured outcome',
    ['search indexing', 'recommendation ranking', 'route optimisation', 'a/b testing'],
    ['experiment design', 'geospatial data', 'sql']],
  ['ByteDance', 'recommendation quality, measured relentlessly',
    'ranking work with an engagement metric and an experiment behind it',
    ['recommendation ranking', 'batch inference', 'a/b testing', 'high-throughput ingestion'],
    ['experiment design', 'python', 'distributed training']],
  ['Anduril', 'autonomy that has to work without a network',
    'systems work with the failure mode handled and proven',
    ['sensor fusion', 'rtos', 'redundancy design', 'hardware-in-the-loop testing'],
    ['embedded c++', 'real-time design', 'failure analysis']],
  ['Waymo', 'perception and safety cases you can argue line by line',
    'perception or safety work with the validation evidence',
    ['sensor fusion', 'batch inference', 'anomaly detection', 'hardware-in-the-loop testing'],
    ['c++', 'probability', 'safety analysis']],
];

const HOUSE = Object.fromEntries(HOUSES.map(([name, note, resume, projects, skills]) =>
  [name.toLowerCase(), { name, note, resume, projects, skills }]));

/*
 * What each DISCIPLINE is expected to be able to do.
 *
 * The archetypes are written per industry — what a bank screens on, what an
 * IT-services firm screens on — which is the right frame for a company and no
 * frame at all for a job. Every role at Google resolved to the software
 * archetype, so a data scientist, a designer and a security analyst were all
 * handed "data structures, concurrency, profiling" as the skills to put on
 * their page. A skills line is a claim about the person; a term from another
 * discipline is a keyword a recruiter will ask about and they cannot answer.
 *
 * Keyed by the same families benchFor uses, so the projects a role is offered
 * and the skills it is credited with come from one idea of what the job is.
 */
const ROLE_SKILLS = {
  software: ['data structures', 'system design', 'concurrency', 'profiling', 'code review', 'testing'],
  frontend: ['accessibility', 'core web vitals', 'component testing', 'responsive layout', 'design systems', 'browser debugging'],
  design: ['user research', 'usability testing', 'prototyping', 'information architecture', 'accessibility', 'design systems'],
  data: ['sql', 'statistics', 'data modelling', 'experiment design', 'dashboarding', 'python'],
  ml: ['statistics', 'model evaluation', 'feature engineering', 'experiment design', 'python', 'inference optimisation'],
  devops: ['linux', 'networking', 'infrastructure as code', 'observability', 'incident response', 'capacity planning'],
  security: ['threat modelling', 'incident response', 'network fundamentals', 'secure coding', 'log analysis', 'vulnerability triage'],
  mobile: ['platform guidelines', 'app performance', 'offline behaviour', 'release management', 'crash triage', 'accessibility'],
  hardware: ['embedded c', 'debugging with instruments', 'timing analysis', 'power budgeting', 'schematic reading', 'lab testing'],
  business: ['excel modelling', 'sql', 'stakeholder interviews', 'process mapping', 'forecasting', 'requirements writing'],
};

/** The discipline a title belongs to, by the same rules the bench uses. */
function familyFor(role) {
  const t = String(role || '');
  if (/front.?end|\bui\b|react|web developer/i.test(t)) return 'frontend';
  if (/design|\bux\b|user research|interaction|visual|content design/i.test(t)) return 'design';
  if (/\bml\b|machine learning|deep learning|\bai\b|llm|nlp|vision|research scientist/i.test(t)) return 'ml';
  if (/data (analyst|scientist|engineer)|analytics|business intelligence|warehouse|\betl\b|quant/i.test(t)) return 'data';
  if (/devops|\bsre\b|platform|reliability|cloud|infrastructure|systems admin|network/i.test(t)) return 'devops';
  if (/security|infosec|\bsoc\b|penetration|forensic|threat|cryptograph|privacy|grc/i.test(t)) return 'security';
  if (/android|\bios\b|mobile|flutter|react native/i.test(t)) return 'mobile';
  if (/embedded|firmware|vlsi|asic|\brf\b|hardware|electronic|robotics|iot/i.test(t)) return 'hardware';
  if (/analyst|consultant|manager|product owner|scrum|program|project/i.test(t)) return 'business';
  return 'software';
}

/**
 * The work a ROLE is built on, independent of who is hiring.
 *
 * Drawn from the same bench the project catalogue uses, so what a company
 * profile recommends and what the role's own catalogue offers are the same
 * vocabulary rather than two lists that happen to overlap.
 */
function benchFor(role) {
  // eslint-disable-next-line global-require
  const { DEEP_BENCH } = require('./skillPlan');
  const t = String(role || '');

  /*
   * The title's own bench, when we hold one, ahead of the family bucket.
   *
   * Nine buckets covered a hundred and twenty titles, so "Software Engineer",
   * "Backend Engineer", "Full-Stack Engineer", "Payments Engineer" and
   * "Compiler Engineer" all resolved to the same forty terms in the same
   * order — which meant the same projects, in the same order, on five pages
   * aimed at five different jobs at the same employer. A Data Analyst and a
   * Data Scientist were likewise one bucket, and a Technical Writer got the
   * software bench because nothing else claimed them.
   *
   * Each listed position now carries its own ordered terms, most central
   * first, so the projects a page leads with are the ones that title is
   * actually judged on. The family bucket follows behind rather than being
   * dropped: it is still the right vocabulary, just not the right order, and
   * the climb needs the depth when a student asks for a high number.
   */
  // eslint-disable-next-line global-require
  const { lensFor } = require('./projectMatrix');
  const own = lensFor(t);

  const pick = (...keys) => {
    const rest = keys.flatMap((k) => DEEP_BENCH[k] || []);
    return own ? [...own.terms, ...rest] : rest;
  };
  if (/front.?end|\bui\b|\bux\b|design|interaction|visual/i.test(t)) return pick('frontend', 'design');
  if (/\bml\b|machine learning|deep learning|\bai\b|llm|nlp|vision|research scientist/i.test(t)) return pick('ml', 'data');
  if (/data (analyst|scientist|engineer)|analytics|business intelligence|warehouse|\betl\b|quant/i.test(t)) return pick('data');
  if (/devops|\bsre\b|platform|reliability|cloud|infrastructure|systems admin|network/i.test(t)) return pick('devops');
  if (/security|infosec|\bsoc\b|penetration|forensic|threat|cryptograph|privacy|grc/i.test(t)) return pick('security');
  if (/android|\bios\b|mobile|flutter|react native/i.test(t)) return pick('mobile');
  if (/embedded|firmware|vlsi|asic|\brf\b|hardware|electronic|robotics|iot/i.test(t)) return pick('hardware');
  if (/analyst|consultant|manager|product owner|scrum|program|project/i.test(t)) return pick('business', 'data');
  return pick('software');
}

/** The archetype for a company, by name if we know it, by domain otherwise. */
function archetypeFor(company, role) {
  const { COMPANIES } = require('./aspirationalCompanies');
  const hit = COMPANIES.find(([n]) => n.toLowerCase() === String(company || '').toLowerCase());
  /*
   * An unknown employer is not a blank: whatever the role is, its domain says
   * how that kind of business screens. A bank we have never heard of is still
   * a bank, and a student tailoring for one should get the bank's bench.
   */
  /*
   * The company's domain says what kind of business it is. The ROLE's domain
   * says what the person does, and for skills that is the one that matters:
   * every role at Google resolved to the software archetype, so a designer
   * and a data scientist were both handed "data structures, concurrency,
   * profiling". Where the two disagree, the role wins for skills and the
   * company still colours the projects.
   */
  const companyDomain = hit ? hit[1] : null;
  const roleDomain = domainsFor(role)[0];
  const domain = ARCHETYPES[roleDomain] ? roleDomain : (companyDomain || roleDomain);
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
  /* Case-blind, first spelling kept: the house lists write "java" and the
     title's list writes "Java", and a SKILLS line carrying both looks like a
     page assembled by a machine, which it is and must not read as. */
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter(Boolean).map((s) => String(s)).filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  /*
   * The company sets the bar. The ROLE decides which work clears it.
   *
   * A house profile is written from what an employer's postings emphasise,
   * and those postings are mostly for engineers — so Google's list is
   * sharding, distributed tracing and search indexing. Handing that to a data
   * scientist applying to Google is wrong, and handing it to a UI/UX designer
   * applying to Google is absurd: all four roles were being told to build the
   * same four things, because the company was the only thing consulted.
   *
   * So the two are crossed. Work that is both the company's emphasis AND the
   * role's own leads, because that is the sharpest thing a candidate can
   * build. The rest of the role's bench follows, since a data scientist at
   * Google is a data scientist first. The company's remaining terms come last
   * rather than being dropped — they still say something true about the bar,
   * and a scientist who ships one of them is better for it.
   */
  const roleBench = benchFor(role);
  // eslint-disable-next-line global-require
  const { lensFor } = require('./projectMatrix');
  const own = lensFor(role);
  const roleSkills = own ? own.skills : [];
  /*
   * "Shared" means shared with the POSITION, not with its family.
   *
   * The role bench is the position's own terms followed by its family bucket,
   * and testing the house against the whole of it made almost everything
   * shared: Google's sharding is in the software bucket, so a Software
   * Engineer in Test and an Automation Test Engineer at Google both led with
   * sharding, tracing and search indexing and their first six projects came
   * out identical. Crossing against the position's own list keeps the promise
   * the crossing was written to make — the employer's emphasis leads only
   * where it is genuinely this job's work as well.
   */
  const inRole = new Set((own ? own.terms : roleBench).map((t) => t.toLowerCase()));
  const houseProjects = house ? house.projects : [];
  const shared = houseProjects.filter((t) => inRole.has(String(t).toLowerCase()));

  /*
   * The employer's remaining terms, split by whether this job could plausibly
   * do them at all.
   *
   * Interleaving the employer's list with the role's put Google's sharding
   * second on a page for a UI/UX Designer — which is the original fault in a
   * new costume: a designer does not ship a resharding path, and being told
   * to is worse than being told nothing. The family bench is the test. Work
   * inside it belongs to this kind of job even when it is not the first thing
   * this title does, so it interleaves; work outside it stays on the list,
   * behind everything, where somebody deliberately reaching for it can still
   * find it.
   */
  const inFamily = new Set(roleBench.map((t) => t.toLowerCase()));
  const rest = houseProjects.filter((t) => !inRole.has(String(t).toLowerCase()));
  const houseOnly = rest.filter((t) => inFamily.has(String(t).toLowerCase()));
  const houseFar = rest.filter((t) => !inFamily.has(String(t).toLowerCase()));

  return {
    company: company || '',
    known: Boolean(house),
    note: house ? house.note : arch.note,
    /* What the PAGE should lead with. Only a named house has one — a sector
       can say what the work is, but not which of your facts goes first. */
    resume: house ? house.resume : '',
    /*
     * Role first, employer visible, in that order.
     *
     * Putting the role's bench in front and the company's leftovers behind it
     * fixed the designer being told to build sharding and broke the other
     * half: every company then produced the identical list for one role,
     * because nothing of theirs was near the top. What actually distinguishes
     * a data scientist at Google from one anywhere else is that theirs works
     * at a scale the others do not — so the role's core leads, the company's
     * own emphasis sits right behind it where it is unmissable, and the rest
     * of the role's bench follows.
     */
    /*
     * Interleaved, because only the first three or four ever reach a page.
     *
     * Role-block-then-employer-block was right about precedence and wrong
     * about arithmetic: a one-page resume fits three or four projects, so the
     * employer's block never arrived. A page tailored for JPMorgan Chase came
     * back with no audit trail and no reconciliation on it — the two things
     * that employer's own engineering writing is about — because they sat at
     * positions five and six of a list that stopped at three.
     *
     * So they alternate. What both want still leads; after that the student
     * gets one of theirs, one of the employer's, one of theirs, and whatever
     * the page has room for is a mix rather than a prefix.
     */
    projects: dedupe([
      ...shared,
      ...[0, 1, 2, 3].flatMap((i) => [roleBench[i], houseOnly[i]]).filter(Boolean),
      ...roleBench.slice(4, 7),
      /*
       * Still on the list, just not in front of the work.
       *
       * Dropping the employer's foreign terms to the very bottom fixed the
       * designer and broke the other half: for most employers nothing of
       * theirs is inside a given family, so the top of every list became the
       * role's own terms and eight companies produced one page. They sit
       * here instead — past the three or four a page has room for, ahead of
       * the generic bench — so a designer is never told to shard a datastore
       * and a student deliberately reaching for what Google is known for can
       * still find it.
       */
      ...houseFar,
      ...roleBench.slice(7),
      ...houseOnly.slice(4),
      ...arch.projects,
    ]),
    /*
     * The employer's skills, minus the ones that belong to a different job.
     *
     * A data scientist tailoring for Google came back with "sharding" and
     * "c++ or go" on their skills line, because the house list is written
     * from postings that are mostly for engineers. A skills line is a claim
     * about the person, so a term that belongs to another discipline is worse
     * there than on a project list: it is a keyword a recruiter will ask
     * about and the candidate cannot answer.
     *
     * Anything the role's own bench recognises stays; the rest of the house
     * list is dropped rather than reordered, and the archetype fills in.
     */
    skills: dedupe([
      ...(house ? house.skills : []).filter((s) => {
        const k = String(s).toLowerCase();
        if (inRole.has(k)) return true;
        /* Judgement and communication travel between disciplines; specific
           technologies do not. */
        return /writing|documentation|review|practice|thinking|estimation|metrics|interviews/.test(k);
      }),
      /*
       * This title's own skills, ahead of its family's.
       *
       * The family list is right and blunt: every engineering title shares
       * "data structures, system design, concurrency", so a Payments
       * Engineer and a Compiler Engineer were credited with the same six
       * words. Each listed position carries its own — ISO 20022 and PCI DSS
       * for one, intermediate representation and register allocation for the
       * other — and those are the words the posting will actually name.
       */
      ...(roleSkills || []),
      /* The discipline's own skills, ahead of the industry's — the person is
         a data scientist first and a Google employee second. */
      ...(ROLE_SKILLS[familyFor(role)] || ROLE_SKILLS.software),
      ...arch.skills,
    ]),
  };
}

/**
 * What this employer looks for, and what to put at the top for them.
 *
 * Two sentences because they answer two different questions. The first is
 * what they screen on, which decides the projects. The second is what the
 * page should lead with, which is the only part that changes the resume
 * itself — and it is the part a student cannot look up anywhere useful.
 */
function noteFor(company, role) {
  const p = profileFor(company, role);
  const first = `${company} screens ${String(role || 'this role').toLowerCase()} on ${p.note}.`;
  return p.resume ? `${first} Lead the page with ${p.resume}.` : first;
}

/**
 * The skills a role is screened on, with no employer in the question.
 *
 * A page built from scratch when no opening could be found has no house to
 * take its vocabulary from, so its SKILLS line stayed at whatever the student
 * picked — one word, on a page aimed at a role with a dozen expected ones.
 * The role's own list is a true answer to "what does this job ask for".
 */
function skillsForRole(role) {
  /* The title's own list where there is one, the family's behind it — same
     order the profile uses, so a page built with no employer and a page
     tailored for one name the same skills in the same priority. */
  // eslint-disable-next-line global-require
  const { lensFor } = require('./projectMatrix');
  const own = lensFor(role);
  const family = ROLE_SKILLS[familyFor(role)] || ROLE_SKILLS.software;
  if (!own) return family;
  const seen = new Set();
  return [...own.skills, ...family].filter((s) => {
    const k = String(s).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = { profileFor, noteFor, skillsForRole, ARCHETYPES, HOUSE, HOUSES };
