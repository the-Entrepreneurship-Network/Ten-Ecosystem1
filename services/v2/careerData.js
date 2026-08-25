'use strict';

/**
 * The agent's career reference: the roles people apply for, the employers
 * hiring, where they are, and what the work pays.
 *
 * This exists because the agent kept asking open questions a student could
 * not answer well. "Which company is the letter for?" got "amazon", and a
 * letter was written knowing nothing else — not the position, not the
 * country, not one project to point at. Offering the answers turns a blank
 * prompt into a choice, and a choice into a fact the letter can use.
 *
 * Two honest limits, stated here rather than implied by the name:
 *
 *   1. This is a curated set, not an exhaustive one. It covers the roles,
 *      employers and markets students in this programme actually apply into.
 *      Anything missing is reachable through the free-text option that ends
 *      every list — a menu that cannot be escaped is worse than no menu.
 *   2. The pay figures are public-range indications by role, region and
 *      level, not offers and not a benchmark anyone should negotiate from.
 *      They are here so a student knows roughly what band a posting sits in.
 *      Every consumer of them must carry that caveat.
 */

/* ── the work ───────────────────────────────────────────────────────────── */

/**
 * Positions, grouped the way a person thinks about them rather than the way
 * a job board files them. `family` is what the resume agent scores against.
 */
const POSITION_GROUPS = [
  {
    group: 'Software engineering',
    roles: [
      'Software Engineer', 'Software Developer', 'Backend Engineer', 'Backend Developer',
      'Frontend Engineer', 'Frontend Developer', 'Full-Stack Engineer', 'Full Stack Developer',
      'Mobile Engineer (Android)', 'Mobile Engineer (iOS)', 'Mobile App Developer',
      'Application Developer', 'Embedded Systems Engineer', 'Embedded Systems Developer',
      'Game Developer', 'Video Game Designer', 'Graphics Engineer',
      'Systems Engineer', 'Compiler Engineer', 'Firmware Engineer',
      'API Engineer', 'Web Developer', 'Webmaster', 'Computer Programmer',
      'Computer Engineer', 'Software Engineer in Test',
      /*
       * The titles a large employer advertises that the generic list misses.
       *
       * "Backend Engineer" covers the work at a company of thirty. Past a
       * certain size the same team advertises for a Search Engineer, a
       * Payments Engineer and a Distributed Systems Engineer separately,
       * because those are different jobs with different interview loops — and
       * a student who picks "Backend Engineer" when the posting says "Search
       * Engineer" is tailoring against the wrong bench.
       */
      'Distributed Systems Engineer', 'Search Engineer',
      'Recommendation Systems Engineer', 'Payments Engineer',
      'Performance Engineer', 'Integration Engineer',
      'Developer Experience Engineer',
    ],
  },
  {
    group: 'Data and AI',
    roles: [
      'Data Analyst', 'Data Scientist', 'Data Engineer', 'Analytics Engineer',
      'Machine Learning Engineer', 'MLOps Engineer', 'Research Scientist',
      'AI Research Scientist', 'Knowledge Engineer',
      'Computer Vision Engineer', 'NLP Engineer', 'Applied Scientist',
      'Business Intelligence Analyst', 'Quantitative Analyst',
      'AI Engineer', 'Prompt Engineer', 'Data Architect',
      'ETL Developer', 'Streaming Data Engineer',
    ],
  },
  {
    group: 'Infrastructure and security',
    roles: [
      'DevOps Engineer', 'Site Reliability Engineer', 'Cloud Engineer',
      'Platform Engineer', 'Infrastructure Engineer', 'Network Engineer',
      'Computer Network Architect', 'Database Administrator',
      'Security Engineer', 'Security Analyst', 'Cybersecurity Analyst',
      'Information Security Analyst', 'Information Security Manager',
      'Penetration Tester', 'Cloud Security Engineer', 'Systems Administrator',
      'Solutions Architect', 'Cloud Architect',
      'Observability Engineer', 'Cloud FinOps Engineer',
      'Identity and Access Management Engineer', 'Data Privacy Engineer',
    ],
  },
  {
    group: 'Product and design',
    roles: [
      'Product Manager', 'Associate Product Manager', 'Project Manager',
      'Technical Program Manager', 'Computer and Information Systems Manager',
      'Product Designer', 'UX Designer', 'UI Designer', 'UI/UX Designer',
      'UX Researcher', 'Animator',
      'Design Engineer', 'Product Analyst', 'Program Manager',
      'Scrum Master', 'Business Analyst', 'Computer Systems Analyst',
    ],
  },
  {
    group: 'Quality and support',
    roles: [
      'QA Engineer', 'Automation Test Engineer', 'Manual Test Engineer',
      'Manual Tester', 'Software Test Engineer',
      'Release Engineer', 'Technical Support Engineer', 'Solutions Engineer',
      'IT Consultant', 'Sales Engineer', 'Implementation Engineer',
      'Customer Success Engineer', 'Technical Writer', 'Developer Advocate',
    ],
  },
  {
    group: 'Emerging and specialist',
    roles: [
      'Blockchain Developer', 'Smart Contract Engineer', 'AR/VR Engineer',
      'Robotics Engineer', 'Quantum Computing Researcher', 'Bioinformatics Engineer',
      'Health Information Technician', 'Hardware Engineer', 'Simulation Engineer',
      'Aerospace Software Engineer', 'Automotive Software Engineer',
      'Fintech Engineer', 'Healthtech Engineer',
      'Salesforce Developer', 'SAP Consultant',
    ],
  },
];

/** Every position, flat, for matching what a student types. */
const POSITIONS = POSITION_GROUPS.flatMap((g) => g.roles);

/** Seniority, which changes the pay band far more than the employer does. */
const LEVELS = [
  { id: 'intern', label: 'Intern / trainee', years: '0' },
  { id: 'entry', label: 'Entry level (0–2 years)', years: '0-2' },
  { id: 'mid', label: 'Mid level (2–5 years)', years: '2-5' },
  { id: 'senior', label: 'Senior (5–10 years)', years: '5-10' },
  { id: 'staff', label: 'Staff / principal (10+ years)', years: '10+' },
];

/* ── the employers ──────────────────────────────────────────────────────── */

/**
 * Employers students in this programme actually apply to, with the country
 * of the head office. `hiring` lists the markets each one recruits into for
 * these roles — not every office, just the ones with graduate pipelines.
 */
const COMPANIES = [
  { name: 'Google', country: 'United States', hiring: ['India', 'United States', 'Ireland', 'Poland', 'Singapore'] },
  { name: 'Microsoft', country: 'United States', hiring: ['India', 'United States', 'Ireland', 'United Kingdom'] },
  { name: 'Amazon', country: 'United States', hiring: ['India', 'United States', 'Germany', 'United Kingdom', 'Canada'] },
  { name: 'Apple', country: 'United States', hiring: ['United States', 'India', 'Germany', 'Singapore'] },
  { name: 'Meta', country: 'United States', hiring: ['United States', 'United Kingdom', 'Ireland', 'India'] },
  { name: 'Netflix', country: 'United States', hiring: ['United States', 'Netherlands', 'India'] },
  { name: 'Nvidia', country: 'United States', hiring: ['United States', 'India', 'Taiwan', 'Germany'] },
  { name: 'Adobe', country: 'United States', hiring: ['India', 'United States', 'Romania'] },
  { name: 'Salesforce', country: 'United States', hiring: ['United States', 'India', 'Ireland'] },
  { name: 'Oracle', country: 'United States', hiring: ['India', 'United States', 'Romania'] },
  { name: 'IBM', country: 'United States', hiring: ['India', 'United States', 'Poland'] },
  { name: 'Intel', country: 'United States', hiring: ['India', 'United States', 'Israel', 'Ireland'] },
  { name: 'Qualcomm', country: 'United States', hiring: ['India', 'United States', 'Taiwan'] },
  { name: 'Cisco', country: 'United States', hiring: ['India', 'United States', 'Poland'] },
  { name: 'Uber', country: 'United States', hiring: ['India', 'United States', 'Netherlands'] },
  { name: 'Airbnb', country: 'United States', hiring: ['United States', 'India', 'Ireland'] },
  { name: 'Stripe', country: 'United States', hiring: ['United States', 'Ireland', 'India', 'Singapore'] },
  { name: 'Atlassian', country: 'Australia', hiring: ['Australia', 'India', 'United States', 'Poland'] },
  { name: 'Canva', country: 'Australia', hiring: ['Australia', 'Philippines', 'United Kingdom'] },
  { name: 'Shopify', country: 'Canada', hiring: ['Canada', 'United States', 'India'] },
  { name: 'Spotify', country: 'Sweden', hiring: ['Sweden', 'United Kingdom', 'United States', 'Poland'] },
  { name: 'Klarna', country: 'Sweden', hiring: ['Sweden', 'Germany', 'United Kingdom'] },
  { name: 'SAP', country: 'Germany', hiring: ['Germany', 'India', 'Poland'] },
  { name: 'Siemens', country: 'Germany', hiring: ['Germany', 'India', 'Czech Republic'] },
  { name: 'Zalando', country: 'Germany', hiring: ['Germany', 'Ireland', 'Finland'] },
  { name: 'Booking.com', country: 'Netherlands', hiring: ['Netherlands', 'United Kingdom', 'India'] },
  { name: 'ASML', country: 'Netherlands', hiring: ['Netherlands', 'Belgium', 'United States'] },
  { name: 'Revolut', country: 'United Kingdom', hiring: ['United Kingdom', 'Poland', 'Portugal', 'India'] },
  { name: 'Monzo', country: 'United Kingdom', hiring: ['United Kingdom'] },
  { name: 'Deliveroo', country: 'United Kingdom', hiring: ['United Kingdom', 'Poland'] },
  { name: 'Arm', country: 'United Kingdom', hiring: ['United Kingdom', 'India', 'United States'] },
  { name: 'Infosys', country: 'India', hiring: ['India', 'United States', 'United Kingdom', 'Germany'] },
  { name: 'Tata Consultancy Services', country: 'India', hiring: ['India', 'United States', 'United Kingdom'] },
  { name: 'Wipro', country: 'India', hiring: ['India', 'United States', 'United Kingdom'] },
  { name: 'HCLTech', country: 'India', hiring: ['India', 'United States', 'Poland'] },
  { name: 'Tech Mahindra', country: 'India', hiring: ['India', 'United States'] },
  { name: 'Zoho', country: 'India', hiring: ['India', 'United States', 'Japan'] },
  { name: 'Freshworks', country: 'India', hiring: ['India', 'United States', 'Germany'] },
  { name: 'Razorpay', country: 'India', hiring: ['India', 'Singapore'] },
  { name: 'Zerodha', country: 'India', hiring: ['India'] },
  { name: 'Swiggy', country: 'India', hiring: ['India'] },
  { name: 'Zomato', country: 'India', hiring: ['India', 'United Arab Emirates'] },
  { name: 'Flipkart', country: 'India', hiring: ['India'] },
  { name: 'Paytm', country: 'India', hiring: ['India'] },
  { name: 'PhonePe', country: 'India', hiring: ['India'] },
  { name: 'CRED', country: 'India', hiring: ['India'] },
  { name: 'Meesho', country: 'India', hiring: ['India'] },
  { name: 'Ola', country: 'India', hiring: ['India'] },
  { name: 'Postman', country: 'India', hiring: ['India', 'United States'] },
  { name: 'BrowserStack', country: 'India', hiring: ['India', 'United States'] },
  { name: 'Shopify Plus Partners', country: 'Canada', hiring: ['Canada', 'India'] },
  { name: 'Goldman Sachs', country: 'United States', hiring: ['India', 'United States', 'United Kingdom', 'Poland'] },
  { name: 'JPMorgan Chase', country: 'United States', hiring: ['India', 'United States', 'United Kingdom'] },
  { name: 'Morgan Stanley', country: 'United States', hiring: ['India', 'United States', 'United Kingdom'] },
  { name: 'Deutsche Bank', country: 'Germany', hiring: ['India', 'Germany', 'United Kingdom'] },
  { name: 'Barclays', country: 'United Kingdom', hiring: ['India', 'United Kingdom'] },
  { name: 'Accenture', country: 'Ireland', hiring: ['India', 'United States', 'Ireland', 'Philippines'] },
  { name: 'Deloitte', country: 'United Kingdom', hiring: ['India', 'United States', 'United Kingdom'] },
  { name: 'Capgemini', country: 'France', hiring: ['India', 'France', 'Poland'] },
  { name: 'Dassault Systèmes', country: 'France', hiring: ['France', 'India', 'Germany'] },
  { name: 'Ubisoft', country: 'France', hiring: ['France', 'Canada', 'India'] },
  { name: 'Ericsson', country: 'Sweden', hiring: ['Sweden', 'India', 'Poland'] },
  { name: 'Nokia', country: 'Finland', hiring: ['Finland', 'India', 'Poland'] },
  { name: 'Samsung', country: 'South Korea', hiring: ['South Korea', 'India', 'United States'] },
  { name: 'Sony', country: 'Japan', hiring: ['Japan', 'United States', 'India'] },
  { name: 'Rakuten', country: 'Japan', hiring: ['Japan', 'India', 'Singapore'] },
  { name: 'Mercari', country: 'Japan', hiring: ['Japan'] },
  { name: 'Grab', country: 'Singapore', hiring: ['Singapore', 'India', 'Indonesia', 'Vietnam'] },
  { name: 'Sea Group', country: 'Singapore', hiring: ['Singapore', 'Indonesia', 'Taiwan'] },
  { name: 'Shopee', country: 'Singapore', hiring: ['Singapore', 'Indonesia', 'Brazil'] },
  { name: 'Careem', country: 'United Arab Emirates', hiring: ['United Arab Emirates', 'Pakistan', 'Egypt'] },
  { name: 'Talabat', country: 'United Arab Emirates', hiring: ['United Arab Emirates', 'Egypt'] },
  { name: 'Nubank', country: 'Brazil', hiring: ['Brazil', 'Mexico', 'Colombia'] },
  { name: 'Mercado Libre', country: 'Argentina', hiring: ['Argentina', 'Brazil', 'Mexico', 'Colombia'] },
  { name: 'Globant', country: 'Argentina', hiring: ['Argentina', 'Colombia', 'Spain', 'India'] },
  { name: 'Atlassian Labs', country: 'Australia', hiring: ['Australia', 'India'] },
  { name: 'Xero', country: 'New Zealand', hiring: ['New Zealand', 'Australia', 'United Kingdom'] },
];

/* ── the markets ────────────────────────────────────────────────────────── */

/**
 * Hiring markets, with the currency a package is quoted in and the cities
 * these roles concentrate in. Kept to the markets this programme's students
 * apply into rather than a gazetteer — a list of 195 countries would bury
 * the twenty that matter to them.
 */
const MARKETS = [
  { country: 'India', currency: 'INR', symbol: '₹', unit: 'LPA', cities: ['Bengaluru', 'Hyderabad', 'Pune', 'Chennai', 'Gurugram', 'Noida', 'Mumbai', 'Kolkata', 'Ahmedabad', 'Remote (India)'] },
  { country: 'United States', currency: 'USD', symbol: '$', unit: 'per year', cities: ['San Francisco', 'Seattle', 'New York', 'Austin', 'Boston', 'Denver', 'Remote (US)'] },
  { country: 'United Kingdom', currency: 'GBP', symbol: '£', unit: 'per year', cities: ['London', 'Manchester', 'Edinburgh', 'Cambridge', 'Bristol', 'Remote (UK)'] },
  { country: 'Canada', currency: 'CAD', symbol: 'C$', unit: 'per year', cities: ['Toronto', 'Vancouver', 'Montreal', 'Ottawa', 'Remote (Canada)'] },
  { country: 'Germany', currency: 'EUR', symbol: '€', unit: 'per year', cities: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Remote (Germany)'] },
  { country: 'Netherlands', currency: 'EUR', symbol: '€', unit: 'per year', cities: ['Amsterdam', 'Eindhoven', 'Utrecht', 'Rotterdam'] },
  { country: 'Ireland', currency: 'EUR', symbol: '€', unit: 'per year', cities: ['Dublin', 'Cork', 'Galway'] },
  { country: 'France', currency: 'EUR', symbol: '€', unit: 'per year', cities: ['Paris', 'Lyon', 'Toulouse', 'Nantes'] },
  { country: 'Poland', currency: 'PLN', symbol: 'zł', unit: 'per month', cities: ['Warsaw', 'Kraków', 'Wrocław', 'Gdańsk'] },
  { country: 'Sweden', currency: 'SEK', symbol: 'kr', unit: 'per month', cities: ['Stockholm', 'Gothenburg', 'Malmö'] },
  { country: 'Switzerland', currency: 'CHF', symbol: 'CHF', unit: 'per year', cities: ['Zurich', 'Geneva', 'Lausanne'] },
  { country: 'Singapore', currency: 'SGD', symbol: 'S$', unit: 'per year', cities: ['Singapore'] },
  { country: 'United Arab Emirates', currency: 'AED', symbol: 'AED', unit: 'per year', cities: ['Dubai', 'Abu Dhabi'] },
  { country: 'Australia', currency: 'AUD', symbol: 'A$', unit: 'per year', cities: ['Sydney', 'Melbourne', 'Brisbane', 'Remote (Australia)'] },
  { country: 'New Zealand', currency: 'NZD', symbol: 'NZ$', unit: 'per year', cities: ['Auckland', 'Wellington'] },
  { country: 'Japan', currency: 'JPY', symbol: '¥', unit: 'per year', cities: ['Tokyo', 'Osaka', 'Kyoto'] },
  { country: 'South Korea', currency: 'KRW', symbol: '₩', unit: 'per year', cities: ['Seoul', 'Pangyo'] },
  { country: 'Israel', currency: 'ILS', symbol: '₪', unit: 'per month', cities: ['Tel Aviv', 'Herzliya', 'Haifa'] },
  { country: 'Brazil', currency: 'BRL', symbol: 'R$', unit: 'per month', cities: ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte'] },
  { country: 'Spain', currency: 'EUR', symbol: '€', unit: 'per year', cities: ['Madrid', 'Barcelona', 'Valencia'] },
  { country: 'Portugal', currency: 'EUR', symbol: '€', unit: 'per year', cities: ['Lisbon', 'Porto'] },
  { country: 'Remote (worldwide)', currency: 'USD', symbol: '$', unit: 'per year', cities: ['Remote'] },
];

const COUNTRIES = MARKETS.map((m) => m.country);

/* ── the money ──────────────────────────────────────────────────────────── */

/**
 * Indicative total-compensation bands, as [low, high] in each market's own
 * currency and unit.
 *
 * These are public-range indications for the entry point of each level, not
 * offers, not survey medians, and not a number to negotiate from. They exist
 * so a student can tell whether a posting is roughly where they expect. Every
 * caller must repeat that: `payCaveat` is exported for exactly that purpose,
 * and `payBand` refuses to answer for a market it has no data for rather than
 * interpolating one.
 */
const PAY = {
  India:                  { intern: [15000, 60000], entry: [4, 12], mid: [12, 28], senior: [28, 60], staff: [60, 120] },
  'United States':        { intern: [6000, 10000], entry: [95000, 150000], mid: [140000, 210000], senior: [200000, 320000], staff: [300000, 500000] },
  'United Kingdom':       { intern: [1800, 3500], entry: [35000, 55000], mid: [55000, 85000], senior: [85000, 130000], staff: [120000, 180000] },
  Canada:                 { intern: [3500, 6500], entry: [70000, 95000], mid: [95000, 135000], senior: [130000, 180000], staff: [175000, 250000] },
  Germany:                { intern: [1200, 2200], entry: [50000, 68000], mid: [68000, 90000], senior: [90000, 120000], staff: [115000, 160000] },
  Netherlands:            { intern: [1000, 2000], entry: [45000, 62000], mid: [62000, 85000], senior: [85000, 115000], staff: [110000, 150000] },
  Ireland:                { intern: [1800, 3000], entry: [40000, 58000], mid: [58000, 82000], senior: [82000, 115000], staff: [110000, 155000] },
  France:                 { intern: [1000, 1800], entry: [38000, 50000], mid: [50000, 70000], senior: [70000, 95000], staff: [92000, 130000] },
  Poland:                 { intern: [3000, 6000], entry: [8000, 14000], mid: [14000, 22000], senior: [22000, 32000], staff: [30000, 45000] },
  Sweden:                 { intern: [18000, 26000], entry: [38000, 48000], mid: [48000, 62000], senior: [62000, 80000], staff: [78000, 100000] },
  Switzerland:            { intern: [2000, 3500], entry: [90000, 115000], mid: [115000, 145000], senior: [145000, 185000], staff: [180000, 240000] },
  Singapore:              { intern: [1200, 2500], entry: [60000, 85000], mid: [85000, 130000], senior: [130000, 190000], staff: [185000, 280000] },
  'United Arab Emirates': { intern: [3000, 6000], entry: [120000, 180000], mid: [180000, 280000], senior: [280000, 420000], staff: [400000, 600000] },
  Australia:              { intern: [4000, 7000], entry: [70000, 95000], mid: [95000, 135000], senior: [135000, 180000], staff: [175000, 240000] },
  'New Zealand':          { intern: [3500, 6000], entry: [65000, 85000], mid: [85000, 120000], senior: [120000, 160000], staff: [155000, 200000] },
  Japan:                  { intern: [200000, 350000], entry: [4500000, 6500000], mid: [6500000, 9500000], senior: [9500000, 14000000], staff: [13000000, 20000000] },
  'South Korea':          { intern: [2000000, 3000000], entry: [40000000, 60000000], mid: [60000000, 85000000], senior: [85000000, 120000000], staff: [115000000, 170000000] },
  Israel:                 { intern: [5000, 9000], entry: [18000, 26000], mid: [26000, 38000], senior: [38000, 55000], staff: [52000, 75000] },
  Brazil:                 { intern: [1500, 3000], entry: [6000, 11000], mid: [11000, 18000], senior: [18000, 28000], staff: [26000, 40000] },
  Spain:                  { intern: [800, 1500], entry: [28000, 40000], mid: [40000, 58000], senior: [58000, 80000], staff: [78000, 105000] },
  Portugal:               { intern: [700, 1300], entry: [24000, 35000], mid: [35000, 50000], senior: [50000, 70000], staff: [68000, 92000] },
  'Remote (worldwide)':   { intern: [500, 2000], entry: [30000, 60000], mid: [60000, 100000], senior: [100000, 150000], staff: [145000, 220000] },
};

const PAY_CAVEAT = 'Indicative public ranges by role, level and market — not offers, not a benchmark, and not advice on what to ask for. Check the posting and levels.fyi or Glassdoor for the specific team.';

/* Roles that sit above or below the general band for their level. */
const PAY_MULTIPLIER = [
  { match: /machine learning|ml engineer|applied scientist|research scientist|ai engineer|quantitative/i, factor: 1.25 },
  { match: /site reliability|security engineer|platform engineer|infrastructure|devops|cloud architect|solutions architect/i, factor: 1.1 },
  { match: /data scientist|data engineer|product manager|technical program/i, factor: 1.05 },
  { match: /qa|manual test|technical support|technical writer|customer success/i, factor: 0.8 },
  { match: /intern|trainee/i, factor: 1 },
];

/* ── lookups ────────────────────────────────────────────────────────────── */

const norm = (s) => String(s || '').toLowerCase().trim();

/** The market record for a country, or null — never a guessed one. */
function market(country) {
  const n = norm(country);
  return MARKETS.find((m) => norm(m.country) === n) ||
    MARKETS.find((m) => norm(m.country).includes(n) && n.length > 2) || null;
}

/** Cities a market hires these roles into. Empty when the market is unknown. */
function citiesIn(country) {
  const m = market(country);
  return m ? m.cities.slice() : [];
}

/** Employers with a graduate pipeline into a country. */
function companiesHiringIn(country) {
  const n = norm(country);
  return COMPANIES.filter((c) => c.hiring.some((h) => norm(h) === n) || norm(c.country) === n);
}

/** The country a company is headquartered in, or null if it is not listed. */
function companyCountry(name) {
  const n = norm(name);
  const hit = COMPANIES.find((c) => norm(c.name) === n) ||
    COMPANIES.find((c) => norm(c.name).startsWith(n) && n.length >= 3);
  return hit ? hit.country : null;
}

/** The closest listed position to what someone typed, or null. */
function matchPosition(text) {
  const n = norm(text);
  if (!n) return null;
  return POSITIONS.find((p) => norm(p) === n) ||
    POSITIONS.find((p) => norm(p).includes(n) && n.length >= 4) ||
    POSITIONS.find((p) => n.includes(norm(p))) || null;
}

/**
 * The indicative band for a role, level and market.
 *
 * Returns null when the market is not one we hold figures for. Inventing a
 * range for an unlisted country would be inventing the one number a student
 * is most likely to repeat in a negotiation.
 */
function payBand(role, level, country) {
  const m = market(country);
  const table = m && PAY[m.country];
  const lvl = LEVELS.find((l) => l.id === norm(level)) ? norm(level) : 'entry';
  if (!table || !table[lvl]) return null;

  const factor = (PAY_MULTIPLIER.find((p) => p.match.test(String(role || ''))) || { factor: 1 }).factor;
  const [lo, hi] = table[lvl];
  const round = (v) => (v >= 1000 ? Math.round((v * factor) / 1000) * 1000 : Math.round(v * factor * 10) / 10);
  const unit = lvl === 'intern' && m.unit === 'LPA' ? 'per month' : m.unit;

  return {
    country: m.country,
    currency: m.currency,
    symbol: m.symbol,
    unit,
    low: round(lo),
    high: round(hi),
    level: lvl,
    text: `${m.symbol}${round(lo).toLocaleString('en-US')}–${m.symbol}${round(hi).toLocaleString('en-US')} ${unit}`,
    caveat: PAY_CAVEAT,
  };
}

module.exports = {
  POSITION_GROUPS,
  POSITIONS,
  LEVELS,
  COMPANIES,
  MARKETS,
  COUNTRIES,
  PAY_CAVEAT,
  market,
  citiesIn,
  companiesHiringIn,
  companyCountry,
  matchPosition,
  payBand,
};
