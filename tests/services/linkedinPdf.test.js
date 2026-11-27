'use strict';

/**
 * LinkedIn's "Save to PDF" export, as pdf-parse reads it, turned into resume
 * text. The fixtures are invented people laid out the way two real exports
 * came out of pdf-parse: the sidebar first, then name, headline and location,
 * then the main column, with "Page 1 of 2" wherever a page breaks.
 */

const { toResume, convert } = require('../../services/v2/linkedinPdf');

/* Shaped like the first real export: a wrapped profile link, a sidebar line
   that reads only "Experience", a company name over two lines. */
const FIRST = [
    '', '', '',
    'Contact',
    '9876543210 (Mobile)',
    'meera.iyer@example.com',
    'www.linkedin.com/in/meera-',
    'iyer-4b2c19 (LinkedIn)',
    'Top Skills',
    'Product Management',
    'Python (Programming Language)',
    'SQL',
    'Languages',
    'English (Native or Bilingual)',
    'Tamil (Native or Bilingual)',
    'Certifications',
    'Google Project Management',
    'Certified Professional in User',
    'Experience',
    'Honors-Awards',
    'Dean\'s List 2019',
    'Publications',
    'Queues: Order, Delay and Fairness',
    'Meera Iyer',
    'Product Analyst at Kite Payments | SQL | Python',
    'Chennai, Tamil Nadu, India',
    'Summary',
    'I turn product questions into SQL and dashboards. I have',
    'shipped three analytics features.',
    'Experience',
    'Kite',
    'Product Analyst',
    'May 2023 - Present (1 year 7 months)',
    'Chennai, Tamil Nadu, India',
    'Indian Institute of',
    'Technology Madras',
    'Research Assistant',
    'June 2021 - April 2023 (1 year 11 months)',
    'Chennai Area',
    '- Built a churn model in Python that flagged 1,200 accounts a',
    'month for the success team',
    '- Cut a weekly report from 3 hours to 20 minutes with SQL',
    'Page 1 of 2',
    'Education',
    'Indian Institute of Technology Madras',
    'Bachelor of Technology - BTech, Computer Science · (2017 - 2021)',
    'Page 2 of 2',
].join('\n');

/* Shaped like the second: an email that lost its last letter to the next
   line, locations without commas, a lowercase company, a degree split by a
   page break. */
const SECOND = [
    'Contact',
    'arjun.menon.dev@example.co',
    'm',
    'www.linkedin.com/in/arjun-',
    'menon (LinkedIn)',
    'Top Skills',
    'Spring Boot',
    'Java',
    'Docker',
    'Arjun Menon',
    'Backend developer building payment APIs.',
    'Greater Bengaluru',
    'Summary',
    'Backend developer with two years of Java and Spring Boot. Built',
    'payment APIs used by 40 merchants.',
    'Experience',
    'Zeta Suite',
    'Backend Developer',
    'May 2023 - Present (1 year 7 months)',
    'Greater Bengaluru',
    'Built the refunds API in Java and Spring Boot, serving',
    '5,000 requests a day.',
    'Moved the service to Docker and cut deploys to 6 minutes.',
    'upwork',
    'Freelance Java Developer',
    'May 2022 - February 2023 (10 months)',
    'Remote',
    'Built REST APIs for three small shops.',
    'Education',
    'Kalinga Institute of Industrial Technology',
    'Page 1 of 2',
    'Bachelor of Technology - BTech, Computer Science and',
    'Engineering · (2018 - 2022)',
    'Page 2 of 2',
].join('\n');

describe('the first export\'s shape', () => {
    const doc = toResume(FIRST);
    const lines = doc.split('\n');

    it('puts the name, the headline and the contact line on top', () => {
        expect(lines[0]).toBe('Meera Iyer');
        expect(lines[1]).toBe('Product Analyst at Kite Payments | SQL | Python');
        expect(lines[2]).toBe('meera.iyer@example.com | 9876543210 | linkedin.com/in/meera-iyer-4b2c19 | Chennai, Tamil Nadu, India');
    });

    it('keeps the sidebar where a resume keeps it', () => {
        expect(doc).toMatch(/SKILLS\nProduct Management, Python \(Programming Language\), SQL\nLanguages: English \(Native or Bilingual\), Tamil \(Native or Bilingual\)/);
        expect(doc).toMatch(/CERTIFICATIONS\nGoogle Project Management\nCertified Professional in User\nExperience/);
        expect(doc).toMatch(/ACHIEVEMENTS\nDean's List 2019\nQueues: Order, Delay and Fairness/);
    });

    it('reads each role as title | company | dates, with its bullets whole', () => {
        expect(doc).toContain('SUMMARY\nI turn product questions into SQL and dashboards. I have shipped three analytics features.');
        expect(doc).toContain('Product Analyst | Kite | May 2023 - Present');
        expect(doc).toContain('Research Assistant | Indian Institute of Technology Madras | June 2021 - April 2023');
        expect(doc).toContain('- Built a churn model in Python that flagged 1,200 accounts a month for the success team');
        expect(doc).toContain('- Cut a weekly report from 3 hours to 20 minutes with SQL');
        expect(doc).not.toMatch(/Chennai Area/);   // a role's location is not a bullet
        expect(doc).not.toMatch(/Page \d of \d/);
    });

    it('reads education as degree | school | years', () => {
        expect(doc).toContain('EDUCATION\nBachelor of Technology - BTech, Computer Science | Indian Institute of Technology Madras | 2017 - 2021');
    });
});

describe('the second export\'s shape', () => {
    const doc = toResume(SECOND);

    it('puts a wrapped email and link back together', () => {
        expect(doc.split('\n')[2]).toBe('arjun.menon.dev@example.com | linkedin.com/in/arjun-menon | Greater Bengaluru');
    });

    it('reads roles whose places have no comma, and a company written in lowercase', () => {
        expect(doc).toContain('Backend Developer | Zeta Suite | May 2023 - Present\n- Built the refunds API in Java and Spring Boot, serving 5,000 requests a day.\n- Moved the service to Docker and cut deploys to 6 minutes.');
        expect(doc).toContain('Freelance Java Developer | upwork | May 2022 - February 2023\n- Built REST APIs for three small shops.');
        expect(doc).not.toMatch(/^Greater Bengaluru$/m);
    });

    it('joins a degree that a page break split', () => {
        expect(doc).toContain('Bachelor of Technology - BTech, Computer Science and Engineering | Kalinga Institute of Industrial Technology | 2018 - 2022');
    });

    it('reads as a resume to the job agent', () => {
        const p = require('../../routes/v2/jobAgent').profileFromResume(doc);
        expect(p.name).toBe('Arjun Menon');
        expect(p.skills).toEqual(expect.arrayContaining(['java', 'spring boot', 'docker']));
        expect(p.college).toBe('Kalinga Institute of Industrial Technology');
    });
});

it('gives several roles at one company that company', () => {
    const text = ['Contact', 'www.linkedin.com/in/ravi-kumar (LinkedIn)', 'Top Skills', 'Go',
        'Ravi Kumar', 'Engineer', 'Pune', 'Experience',
        'Acme Corp', '3 years 2 months',
        'Senior Engineer', 'January 2023 - Present (2 years)', 'Pune', 'Led the billing rewrite.',
        'Engineer', 'October 2021 - December 2022 (1 year 3 months)', 'Pune', 'Built the invoicing service.',
        'Page 1 of 1'].join('\n');
    const doc = convert(text);
    expect(doc).toContain('Senior Engineer | Acme Corp | January 2023 - Present\n- Led the billing rewrite.');
    expect(doc).toContain('Engineer | Acme Corp | October 2021 - December 2022\n- Built the invoicing service.');
});

it('leaves anything that is not LinkedIn\'s export exactly as it was', () => {
    const resume = 'Priya Nair\npriya@example.com | linkedin.com/in/priya-nair\n\nEXPERIENCE\nIntern | Zeta | Jan 2025 - Jun 2025\n- Built an API';
    expect(toResume(resume)).toBe(resume);
    expect(toResume('')).toBe('');
    expect(toResume('Contact\nwww.linkedin.com/in/x (LinkedIn)\nno main column at all\nPage 1 of 1')).toBe('Contact\nwww.linkedin.com/in/x (LinkedIn)\nno main column at all\nPage 1 of 1');
});
