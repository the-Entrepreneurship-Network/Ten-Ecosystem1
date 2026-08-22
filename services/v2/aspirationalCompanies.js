'use strict';

/**
 * The employers worth aiming at, across every domain — not just the ten.
 *
 * The list used to be Google, Meta, Amazon, Microsoft, Apple, Netflix, OpenAI,
 * Nvidia, Tesla, SpaceX. That is the whole world if you are a backend engineer
 * and none of it if you are an actuary, a supply-chain analyst, a mechanical
 * engineer or a bank's risk quant — and those students were being shown ten
 * companies that would never hire for their title. Every large employer hires
 * engineers, analysts and designers; which ones matter depends on the domain
 * the person is in.
 *
 * So: large-cap employers from the S&P 500 and the Nifty 50, tagged by domain,
 * with the domains of the target role surfaced first and the rest following so
 * somebody can aim outside their sector on purpose.
 *
 * None of these is a posting. They carry no link and are never presented as
 * openings — they are a bar to tailor a page against before a posting exists.
 * Index membership changes; this is a stable working list of large employers,
 * not a live index feed, and nothing downstream depends on it being either.
 */

/* domain keys used for matching, deliberately coarse — a role maps to a few */
const COMPANIES = [
  /* ---- software, cloud, consumer internet ---- */
  ['Google', 'software'], ['Microsoft', 'software'], ['Amazon', 'software'],
  ['Meta', 'software'], ['Apple', 'software'], ['Netflix', 'software'],
  ['OpenAI', 'software'], ['Nvidia', 'semiconductor'], ['Tesla', 'automotive'],
  ['SpaceX', 'aerospace'],
  ['Salesforce', 'software'], ['Adobe', 'software'], ['Oracle', 'software'],
  ['IBM', 'software'], ['Intuit', 'software'], ['ServiceNow', 'software'],
  ['Workday', 'software'], ['Snowflake', 'software'], ['Palantir', 'software'],
  ['Uber', 'software'], ['Airbnb', 'software'], ['Booking Holdings', 'software'],
  ['PayPal', 'fintech'], ['Block', 'fintech'], ['Stripe', 'fintech'],
  ['Cisco', 'networking'], ['Dell Technologies', 'hardware'],
  ['Hewlett Packard Enterprise', 'hardware'],

  /* ---- semiconductors and hardware ---- */
  ['Intel', 'semiconductor'], ['AMD', 'semiconductor'],
  ['Qualcomm', 'semiconductor'], ['Broadcom', 'semiconductor'],
  ['Texas Instruments', 'semiconductor'], ['Micron Technology', 'semiconductor'],
  ['Applied Materials', 'semiconductor'], ['Analog Devices', 'semiconductor'],
  ['Lam Research', 'semiconductor'], ['KLA', 'semiconductor'],

  /* ---- banking, financial services, insurance ---- */
  ['JPMorgan Chase', 'finance'], ['Goldman Sachs', 'finance'],
  ['Morgan Stanley', 'finance'], ['Bank of America', 'finance'],
  ['Citigroup', 'finance'], ['Wells Fargo', 'finance'],
  ['BlackRock', 'finance'], ['American Express', 'finance'],
  ['Visa', 'fintech'], ['Mastercard', 'fintech'],
  ['Charles Schwab', 'finance'], ['S&P Global', 'finance'],
  ['Moody’s', 'finance'], ['Chubb', 'insurance'],
  ['Progressive', 'insurance'], ['MetLife', 'insurance'],
  ['HDFC Bank', 'finance'], ['ICICI Bank', 'finance'],
  ['State Bank of India', 'finance'], ['Axis Bank', 'finance'],
  ['Kotak Mahindra Bank', 'finance'], ['Bajaj Finance', 'finance'],
  ['SBI Life Insurance', 'insurance'], ['HDFC Life Insurance', 'insurance'],
  ['Shriram Finance', 'finance'], ['Jio Financial Services', 'fintech'],

  /* ---- healthcare, pharma, life sciences ---- */
  ['Johnson & Johnson', 'healthcare'], ['Pfizer', 'healthcare'],
  ['Merck', 'healthcare'], ['Eli Lilly', 'healthcare'],
  ['AbbVie', 'healthcare'], ['Amgen', 'healthcare'],
  ['Thermo Fisher Scientific', 'healthcare'], ['Danaher', 'healthcare'],
  ['Medtronic', 'healthcare'], ['UnitedHealth Group', 'healthcare'],
  ['Abbott', 'healthcare'], ['Gilead Sciences', 'healthcare'],
  ['Sun Pharmaceutical', 'healthcare'], ['Dr. Reddy’s Laboratories', 'healthcare'],
  ['Cipla', 'healthcare'], ['Divi’s Laboratories', 'healthcare'],
  ['Apollo Hospitals', 'healthcare'],

  /* ---- retail, consumer, FMCG ---- */
  ['Walmart', 'retail'], ['Costco', 'retail'], ['Target', 'retail'],
  ['Home Depot', 'retail'], ['Nike', 'retail'], ['Starbucks', 'retail'],
  ['McDonald’s', 'retail'], ['Procter & Gamble', 'fmcg'],
  ['Coca-Cola', 'fmcg'], ['PepsiCo', 'fmcg'], ['Unilever', 'fmcg'],
  ['Colgate-Palmolive', 'fmcg'], ['Mondelez International', 'fmcg'],
  ['Hindustan Unilever', 'fmcg'], ['ITC', 'fmcg'], ['Nestlé India', 'fmcg'],
  ['Britannia Industries', 'fmcg'], ['Titan Company', 'retail'],
  ['Asian Paints', 'chemicals'], ['Trent', 'retail'],

  /* ---- energy, utilities, chemicals ---- */
  ['ExxonMobil', 'energy'], ['Chevron', 'energy'],
  ['ConocoPhillips', 'energy'], ['NextEra Energy', 'energy'],
  ['Schlumberger', 'energy'], ['Linde', 'chemicals'],
  ['Dow', 'chemicals'], ['Air Products', 'chemicals'],
  ['Reliance Industries', 'energy'], ['ONGC', 'energy'],
  ['NTPC', 'energy'], ['Power Grid Corporation', 'energy'],
  ['Coal India', 'energy'], ['BPCL', 'energy'],
  ['Adani Enterprises', 'infrastructure'], ['Adani Ports', 'infrastructure'],

  /* ---- industrial, aerospace, defence, manufacturing ---- */
  ['Boeing', 'aerospace'], ['Lockheed Martin', 'aerospace'],
  ['RTX', 'aerospace'], ['Northrop Grumman', 'aerospace'],
  ['General Electric', 'industrial'], ['Honeywell', 'industrial'],
  ['Caterpillar', 'industrial'], ['3M', 'industrial'],
  ['Emerson Electric', 'industrial'], ['Eaton', 'industrial'],
  ['Larsen & Toubro', 'infrastructure'], ['Siemens', 'industrial'],
  ['Bharat Electronics', 'aerospace'], ['Hindustan Aeronautics', 'aerospace'],
  ['UltraTech Cement', 'infrastructure'], ['Grasim Industries', 'infrastructure'],
  ['JSW Steel', 'metals'], ['Tata Steel', 'metals'],
  ['Hindalco Industries', 'metals'],

  /* ---- automotive and mobility ---- */
  ['Ford', 'automotive'], ['General Motors', 'automotive'],
  ['Rivian', 'automotive'], ['Maruti Suzuki', 'automotive'],
  ['Tata Motors', 'automotive'], ['Mahindra & Mahindra', 'automotive'],
  ['Bajaj Auto', 'automotive'], ['Hero MotoCorp', 'automotive'],
  ['Eicher Motors', 'automotive'],

  /* ---- telecom, media, entertainment ---- */
  ['Verizon', 'telecom'], ['AT&T', 'telecom'], ['T-Mobile', 'telecom'],
  ['Comcast', 'media'], ['Walt Disney', 'media'],
  ['Warner Bros. Discovery', 'media'], ['Bharti Airtel', 'telecom'],

  /* ---- logistics and transport ---- */
  ['UPS', 'logistics'], ['FedEx', 'logistics'],
  ['Union Pacific', 'logistics'], ['Delta Air Lines', 'logistics'],

  /* ---- IT services and consulting ---- */
  ['Accenture', 'itservices'], ['Tata Consultancy Services', 'itservices'],
  ['Infosys', 'itservices'], ['HCLTech', 'itservices'],
  ['Wipro', 'itservices'], ['Tech Mahindra', 'itservices'],
  ['Cognizant', 'itservices'], ['Deloitte', 'consulting'],
  ['McKinsey & Company', 'consulting'], ['Boston Consulting Group', 'consulting'],
];

/* Which domains a title plausibly belongs to. Order matters — the first match
   wins, so the specific patterns sit above the catch-alls. */
const ROLE_DOMAINS = [
  [/quant|actuar|risk|trading|invest|portfolio|banking|credit|treasur|audit|account/i,
    ['finance', 'fintech', 'insurance', 'consulting']],
  [/clinical|biolog|pharma|medical|health|genom|bioinformat|nurse|drug/i,
    ['healthcare', 'consulting']],
  [/aerospace|avionic|satellite|defence|defense|propulsion|flight/i,
    ['aerospace', 'industrial']],
  [/automotive|vehicle|autonomous|mechatronic|powertrain/i,
    ['automotive', 'industrial', 'semiconductor']],
  [/vlsi|asic|rf |semiconductor|chip|fpga|embedded|firmware|hardware/i,
    ['semiconductor', 'hardware', 'industrial']],
  [/supply chain|logistic|procurement|warehouse|operations manager/i,
    ['logistics', 'retail', 'industrial']],
  [/energy|petroleum|renewable|power|grid|solar|nuclear/i,
    ['energy', 'industrial', 'infrastructure']],
  [/chemical|process engineer|materials|metallurg/i,
    ['chemicals', 'metals', 'industrial']],
  [/civil|structural|construction|infrastructure/i,
    ['infrastructure', 'industrial']],
  [/network|telecom|5g|rf/i, ['telecom', 'networking', 'hardware']],
  [/content|editor|journal|media|video|audio|game/i, ['media', 'software']],
  [/marketing|growth|brand|sales|revenue|community/i,
    ['retail', 'fmcg', 'software', 'consulting']],
  [/consultant|strategy|business analyst|chief of staff/i,
    ['consulting', 'finance', 'itservices']],
  [/recruit|human resource|\bhr\b|people ops/i, ['itservices', 'consulting', 'retail']],
  /* Everything left is a software-shaped role, and software is hired
     everywhere — so the spread stays wide rather than collapsing to ten. */
  [/./, ['software', 'semiconductor', 'fintech', 'itservices']],
];

/** The domains a target title belongs to, most relevant first. */
function domainsFor(target) {
  const t = String(target || '');
  const hit = ROLE_DOMAINS.find(([re]) => re.test(t));
  return hit ? hit[1] : ['software'];
}

/**
 * Companies worth aiming at for a title.
 *
 * The role's own domains come first — that is who would actually hire them —
 * and the remaining large employers follow, because a mechanical engineer
 * applying to a bank's automation team is a real path and cutting the list to
 * one sector hides it.
 */
function aspirationalFor(target, limit = 30) {
  const domains = domainsFor(target);
  const rank = (d) => {
    const i = domains.indexOf(d);
    return i === -1 ? domains.length : i;
  };
  const rows = COMPANIES.map(([name, domain], i) => ({ name, domain, rank: rank(domain), i }));

  /*
   * Relevance first, then breadth — sorting by relevance alone gave thirty
   * software companies to a software engineer, which is the same wall of ten
   * names in a longer coat. The role's own domains fill the head of the list,
   * because that is who would actually hire them; the tail is taken one per
   * domain in rotation, so a mechanical engineer looking for an automation
   * team at a bank can see the bank without scrolling past forty peers.
   */
  const HEAD = 10;
  const head = rows.filter((r) => r.rank < domains.length)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, HEAD);

  const taken = new Set(head.map((r) => r.name));
  const byDomain = new Map();
  rows.filter((r) => !taken.has(r.name)).forEach((r) => {
    if (!byDomain.has(r.domain)) byDomain.set(r.domain, []);
    byDomain.get(r.domain).push(r);
  });
  const queues = [...byDomain.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1][0].i - b[1][0].i)
    .map(([, list]) => list);

  const tail = [];
  for (let round = 0; queues.some((q) => q.length > round); round += 1) {
    queues.forEach((q) => { if (q[round]) tail.push(q[round]); });
  }

  return [...head, ...tail]
    .slice(0, Math.max(1, limit))
    .map(({ name, domain }) => ({ name, domain }));
}

module.exports = { COMPANIES, aspirationalFor, domainsFor };
