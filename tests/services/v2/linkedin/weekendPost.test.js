'use strict';

/**
 * The text that goes on the company page every weekend, and the rotation that
 * decides whose turn it is.
 *
 * This module is a constant with a date function attached, which makes it look
 * like a file nothing can go wrong in. The things that can go wrong in it are
 * all the expensive kind, because there is no human between it and a live job
 * advertisement read by freshers:
 *
 *   - a stipend figure appearing where the stipend is unpaid;
 *   - a post about Python carrying the Business onboarding link, or carrying
 *     all six the way the hand-written posts used to;
 *   - the rotation depending on anything other than the date, so that a
 *     restart, a second worker or a database restore posts a different domain
 *     than the one already queued.
 *
 * Each of those has a test below, and each is worth more than the coverage it
 * adds.
 */

const weekend = require('../../../../services/v2/linkedin/weekendPost');
const guard = require('../../../../services/v2/linkedin/contentGuard');

/* Noon IST on a known day, so a test never straddles a date boundary. */
const at = (ymd) => new Date(`${ymd}T12:00:00+05:30`);

describe('weekendPost — the domains', () => {
  it('carries the fourteen the site advertises, once each', () => {
    expect(weekend.DOMAINS).toHaveLength(14);
    const names = weekend.DOMAINS.map((d) => d.name);
    expect(new Set(names).size).toBe(14);
    const slugs = weekend.DOMAINS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(14);
    expect(names).toContain('Python Development');
    expect(names).toContain('Vibe Coding');
    expect(names).toContain('Venture Capital');
  });

  it('gives every domain a role, a track with a live link, and its own hashtag', () => {
    weekend.DOMAINS.forEach((d) => {
      expect(d.role).toMatch(/Intern$/);
      expect(weekend.APPLY[d.track]).toMatch(/^https:\/\/lnkd\.in\//);
      expect(d.tag).toMatch(/^#[A-Za-z]+$/);
    });
  });

  it('finds a domain by name or by slug, case-insensitively, and nothing else', () => {
    expect(weekend.byName('Python Development').slug).toBe('python');
    expect(weekend.byName('python development').slug).toBe('python');
    expect(weekend.byName('cyber').slug).toBe('cyber');
    expect(weekend.byName('Underwater Basket Weaving')).toBeNull();
    expect(weekend.byName('')).toBeNull();
    expect(weekend.byName(undefined)).toBeNull();
  });
});

describe('weekendPost — the body', () => {
  const body = weekend.body(weekend.byName('Python Development'));

  it('names the role, the domain and nothing from another domain', () => {
    expect(body).toContain('Python Development Intern');
    expect(body).toContain('Domain: Python Development');
    expect(body).not.toContain('Business Development');
    expect(body).not.toContain('Venture Capital');
  });

  /*
   * The link test is the one that would have caught the actual complaint about
   * the hand-written posts: six onboarding links at the bottom of every one,
   * so an applicant had to work out which was theirs.
   */
  it('carries exactly one application link, the one for its own track', () => {
    const links = body.match(/https:\/\/lnkd\.in\/\w+/g) || [];
    expect(links).toEqual([weekend.APPLY.tech]);

    const hr = weekend.body(weekend.byName('HR'));
    expect(hr.match(/https:\/\/lnkd\.in\/\w+/g)).toEqual([weekend.APPLY.hr]);

    const space = weekend.body(weekend.byName('Space'));
    expect(space.match(/https:\/\/lnkd\.in\/\w+/g)).toEqual([weekend.APPLY.space]);
  });

  it('states the stipend as unpaid and puts no figure anywhere near it', () => {
    expect(body).toContain('Stipend: Unpaid');
    expect(body).toMatch(/internship is unpaid/i);
    expect(body).not.toMatch(/₹|Rs\.?\s*\d|INR|\d[\d,]*\s*(?:\/|per\s+)month/i);
    expect(body).not.toMatch(/\b5,?000\b/);
  });

  it('makes the argument it is supposed to make: projects first, no course ladder', () => {
    expect(body).toMatch(/industry-level project/i);
    expect(body).toMatch(/no course to sit through/i);
    expect(body).toMatch(/the project is the training/i);
  });

  it('states mode, duration and eligibility, and says freshers are welcome', () => {
    expect(body).toContain('Mode: Remote');
    expect(body).toContain('Duration: 2–6 Months (Flexible)');
    expect(body).toMatch(/Freshers Welcome/i);
  });

  it('fits well inside what LinkedIn will take', () => {
    weekend.DOMAINS.forEach((d) => {
      expect(weekend.body(d).length).toBeLessThan(3000);
    });
  });

  it('takes a name as readily as a domain object, and refuses an unknown one', () => {
    expect(weekend.body('Cyber Security')).toContain('Cyber Security Intern');
    expect(() => weekend.body('Underwater Basket Weaving')).toThrow(/no such domain/);
  });

  /*
   * Belt and braces against the file this module will one day be edited in by
   * somebody in a hurry. The guard is allowed to ask for a revision — the
   * house style opens with a rocket and it has opinions about that — but a
   * block means a slur, a threat, an individual's phone number or a
   * discriminatory restriction, none of which may reach the page.
   */
  it('passes the content guard for every domain', () => {
    weekend.DOMAINS.forEach((d) => {
      const verdict = guard.review(weekend.body(d), { kind: 'opening' });
      expect(verdict.verdict).not.toBe('block');
      const codes = verdict.issues.map((i) => i.code);
      expect(codes).not.toContain('personal_contact');
      expect(codes).not.toContain('discriminatory_hiring');
      expect(codes).not.toContain('unverifiable_claim');
    });
  });
});

describe('weekendPost — the rotation', () => {
  it('knows a Saturday and a Sunday from the rest of the week, in IST', () => {
    expect(weekend.isWeekend(at('2026-09-19'))).toBe(true);  // Saturday
    expect(weekend.isWeekend(at('2026-09-20'))).toBe(true);  // Sunday
    expect(weekend.isWeekend(at('2026-09-21'))).toBe(false); // Monday
    expect(weekend.isWeekend(at('2026-09-18'))).toBe(false); // Friday
  });

  /*
   * 18:30 UTC on a Friday is 00:00 IST on the Saturday. Reading the host's
   * calendar instead of IST is how the job would skip a weekend entirely on a
   * UTC server, and it is not the kind of thing anyone notices until Monday.
   */
  it('reads the IST calendar, not the host clock', () => {
    expect(weekend.isWeekend(new Date('2026-09-18T18:30:00Z'))).toBe(true);
    expect(weekend.istDateKey(new Date('2026-09-18T18:30:00Z'))).toBe('2026-09-19');
    expect(weekend.isWeekend(new Date('2026-09-18T18:29:00Z'))).toBe(false);
  });

  it('gives Saturday and Sunday of the same weekend different domains', () => {
    expect(weekend.pick(at('2026-09-19')).slug).not.toBe(weekend.pick(at('2026-09-20')).slug);
  });

  it('is a pure function of the date — the same day always gets the same domain', () => {
    const a = weekend.pick(at('2026-09-19'));
    const b = weekend.pick(new Date('2026-09-19T06:00:00+05:30'));
    const c = weekend.pick(new Date('2026-09-18T20:00:00Z'));
    expect(a.slug).toBe(b.slug);
    expect(a.slug).toBe(c.slug);
  });

  it('walks all fourteen before repeating any', () => {
    const seen = [];
    let day = at('2026-09-19');
    while (seen.length < 14) {
      if (weekend.isWeekend(day)) seen.push(weekend.pick(day).slug);
      day = new Date(day.getTime() + 86400000);
    }
    expect(new Set(seen).size).toBe(14);
  });

  it('keeps counting through a year without landing outside the list', () => {
    let day = at('2026-01-01');
    for (let i = 0; i < 400; i += 1) {
      if (weekend.isWeekend(day)) {
        const picked = weekend.pick(day);
        expect(weekend.DOMAINS).toContain(picked);
      }
      day = new Date(day.getTime() + 86400000);
    }
  });

  /* Dates before the epoch Saturday would give a negative slot index; a plain
     % would then index the array with a negative number and return undefined. */
  it('does not fall off the front of the list for a date before the epoch', () => {
    const picked = weekend.pick(at('2025-06-14'));
    expect(weekend.DOMAINS).toContain(picked);
    expect(weekend.pick(at('2020-01-04'))).toBeTruthy();
  });
});

describe('weekendPost — the poster and the alt text', () => {
  it('files each poster under its domain slug', () => {
    expect(weekend.posterFile('Python Development')).toBe('python.jpg');
    expect(weekend.posterFile(weekend.byName('Cyber Security'))).toBe('cyber.jpg');
    expect(weekend.posterFile('Underwater Basket Weaving')).toBe('');
  });

  it('describes the opening rather than the artwork, and repeats no figure', () => {
    const alt = weekend.altText('Python Development');
    expect(alt).toContain('Python Development Intern');
    expect(alt).toContain('Remote');
    expect(alt).toContain('stipend Unpaid');
    expect(alt).not.toMatch(/₹|\d[\d,]{2,}/);
  });
});
