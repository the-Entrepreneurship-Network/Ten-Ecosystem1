'use strict';

/**
 * Recruiter contacts. Half these tests are about what must NOT appear — a
 * guessed address wastes an application, and a scraped one is a complaint.
 */

const { collectRecruiters, contactsFromPosting } = require('../../services/v2/recruiterContacts');

const posting = (description, extra) => ({
  company: 'Acme', title: 'Backend Engineer', source: 'HN Who is Hiring',
  url: 'https://news.ycombinator.com/item?id=1', directUrl: '', postedAgo: 'last week',
  description, ...extra,
});

describe('contacts an advert published', () => {
  it('takes the address the posting invites you to write to', () => {
    const rows = contactsFromPosting(posting('We are hiring. Email your CV to careers@acme.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('careers@acme.com');
    expect(rows[0].sourceUrl).toBe('https://news.ycombinator.com/item?id=1');
  });

  it('keeps the name and role when the advert states them', () => {
    const rows = contactsFromPosting(posting(
      'Our Talent Partner will review everything. Contact Priya Sharma at priya@acme.com with your resume.'));
    expect(rows[0].name).toBe('Priya Sharma');
    expect(rows[0].role).toMatch(/Talent Partner/i);
  });

  it('keeps a phone number the advert offers', () => {
    const rows = contactsFromPosting(posting(
      'Send your CV to jobs@acme.com or WhatsApp us on +91 98765 43210.'));
    expect(rows[0].phone).toMatch(/98765/);
  });

  it('carries the posting as evidence for every row', () => {
    const rows = contactsFromPosting(posting('Email hiring@acme.com with your CV'));
    expect(rows[0].sourceTitle).toBe('Backend Engineer');
    expect(rows[0].postedAgo).toBe('last week');
  });
});

describe('what it refuses to list', () => {
  it('never invents an address from a company name', () => {
    const rows = contactsFromPosting(posting('Great team at Acme. Apply through our website.'));
    expect(rows).toHaveLength(0);   /* no hr@acme.com conjured out of the domain */
  });

  it('drops no-reply and other machine addresses', () => {
    const rows = contactsFromPosting(posting(
      'Email no-reply@acme.com — sent from notifications@acme.com. Send your CV to apply.'));
    expect(rows).toHaveLength(0);
  });

  it('drops the board’s own plumbing', () => {
    const rows = contactsFromPosting(posting(
      'Email jobs@greenhouse.io to apply, or write to team@example.com'));
    expect(rows).toHaveLength(0);
  });

  it('ignores an address with no invitation around it', () => {
    const rows = contactsFromPosting(posting(
      'Acme Ltd is registered in Delhi. Our privacy policy is at legal@acme.com. We build payments infrastructure for merchants across India and process millions of transactions every month for our customers.'));
    expect(rows).toHaveLength(0);
  });

  it('does not read salaries or headcounts as phone numbers', () => {
    const rows = contactsFromPosting(posting(
      'Send your CV. Salary 1200000 per year, team of 4500 people, founded 2015.'));
    expect(rows.every((r) => !r.phone)).toBe(true);
  });
});

describe('the shapes recruiters actually write', () => {
  it.each([
    ['Send me an email with your resume: pete+jobs@ambrahealth.com', 'pete+jobs@ambrahealth.com'],
    ['If this offer sounds interesting, email me directly at bartosz@diamontech.de', 'bartosz@diamontech.de'],
    ['Interested? Send your CV to hiring@interviewresources.app', 'hiring@interviewresources.app'],
    ['Freshers welcome — mail your resume to nicholas.hanson@govstar.us', 'nicholas.hanson@govstar.us'],
  ])('reads %j', (text, expected) => {
    const rows = contactsFromPosting(posting(text));
    expect(rows.map((r) => r.email)).toContain(expected);
  });

  it('keeps the plus-addressed inbox recruiters use for applications', () => {
    /* pete+jobs@ is the pattern people use precisely so applications are
       filterable — dropping it would discard the most deliberate contacts. */
    const rows = contactsFromPosting(posting('Email your CV to pete+jobs@ambrahealth.com'));
    expect(rows[0].email).toBe('pete+jobs@ambrahealth.com');
  });
});

describe('collecting across a hunt', () => {
  it('collapses one recruiter advertising several roles', () => {
    const rows = collectRecruiters([
      posting('Email your CV to priya@acme.com', { title: 'Backend Engineer' }),
      posting('Email your CV to priya@acme.com', { title: 'Frontend Engineer' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].alsoHiringFor).toContain('Frontend Engineer');
  });

  it('returns nothing rather than something when no advert published a contact', () => {
    expect(collectRecruiters([posting('Apply on our careers page.')])).toHaveLength(0);
    expect(collectRecruiters([])).toHaveLength(0);
  });
});
