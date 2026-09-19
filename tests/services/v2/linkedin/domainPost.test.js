'use strict';

/**
 * The text that goes on the company page, and the rotation that decides whose
 * turn it is.
 *
 * This module is a constant with a clock function attached, which makes it look
 * like a file nothing can go wrong in. The things that can go wrong in it are
 * all the expensive kind, because there is no human between it and a live job
 * advertisement read by freshers, and at twelve posts a day a mistake reaches
 * the feed twelve times before anybody is at a desk:
 *
 *   - a stipend figure appearing where the stipend is unpaid;
 *   - a paragraph arguing that unpaid is worth it anyway, which reads as an
 *     apology and is the one thing the team asked not to write;
 *   - a post about Python carrying the Business onboarding link, or carrying
 *     all six the way the hand-written posts used to;
 *   - the rotation depending on anything other than the clock, so that a
 *     restart, a second worker or a database restore posts a different domain
 *     than the one already queued.
 *
 * Each of those has a test below, and each is worth more than the coverage it
 * adds.
 */

const posts = require('../../../../services/v2/linkedin/domainPost');
const guard = require('../../../../services/v2/linkedin/contentGuard');

/* A fixed IST wall-clock instant, so no test straddles a slot boundary. */
const ist = (s) => new Date(`${s}+05:30`);

describe('domainPost — the domains', () => {
  it('carries the fourteen the site advertises, once each', () => {
    expect(posts.DOMAINS).toHaveLength(14);
    const names = posts.DOMAINS.map((d) => d.name);
    expect(new Set(names).size).toBe(14);
    expect(new Set(posts.DOMAINS.map((d) => d.slug)).size).toBe(14);
    expect(names).toContain('Python Development');
    expect(names).toContain('Vibe Coding');
    expect(names).toContain('Venture Capital');
  });

  it('gives every domain a role, a track with a live link, and its own hashtag', () => {
    posts.DOMAINS.forEach((d) => {
      expect(d.role).toMatch(/Intern$/);
      expect(posts.APPLY[d.track]).toMatch(/^https:\/\/lnkd\.in\//);
      expect(d.tag).toMatch(/^#[A-Za-z]+$/);
    });
  });

  /*
   * The projects are the post. A domain with a vague or missing `builds` list
   * produces a post that says nothing every other internship ad does not.
   */
  it('names three concrete things an intern builds, for every domain', () => {
    posts.DOMAINS.forEach((d) => {
      expect(d.builds).toHaveLength(3);
      d.builds.forEach((b) => {
        expect(typeof b).toBe('string');
        expect(b.length).toBeGreaterThan(25);
        expect(b).not.toMatch(/hands-on experience|learn a lot|exposure to/i);
      });
      /* No two domains share a project line — a copy-paste would make the feed
         read as one post with the nouns swapped. */
      expect(new Set(d.builds).size).toBe(3);
    });
    const all = posts.DOMAINS.flatMap((d) => d.builds);
    expect(new Set(all).size).toBe(all.length);
  });

  /*
   * The bug this whole list was rewritten to fix: "build your own Redis" was
   * filed under Python Development. It is a good project and it is genuinely
   * often written in Python — but on this list of fourteen domains it belongs
   * to Software Engineering, and a reader who knows the field can tell at a
   * glance that whoever wrote the post could not.
   *
   * There is no general test for "is this the right domain", so this tests the
   * specific thing that went wrong: a handful of terms that unmistakably
   * belong to one domain must not appear under any other. The table is short
   * on purpose — it is a tripwire on the mistake already made, not an attempt
   * to classify every project in advance.
   */
  it('does not file a project under a domain it does not belong to', () => {
    const OWNED = {
      'Software Engineering': [/\bredis\b/i, /\binterpreter\b/i, /\bcompiler\b/i, /from scratch/i],
      'Data Science': [/\bchurn\b/i, /\bforecast/i, /\bA\/B test\b/i],
      'MERN Stack Development': [/\bmongo/i, /socket\.io/i, /\bexpress\b/i],
      'Flutter Development': [/\bflutter\b/i, /\bfirestore\b/i, /\bdart\b/i],
      'Java Development': [/\bspring\b/i, /\bjpa\b/i],
      'DevOps with AWS': [/\bterraform\b/i, /\becs\b/i, /\bgrafana\b/i],
      'Cyber Security': [/\bwazuh\b/i, /pen-?test/i, /\bphishing\b/i],
      'Venture Capital': [/\bcap table\b/i, /investment memo/i],
    };

    posts.DOMAINS.forEach((d) => {
      const text = d.builds.join(' | ');
      Object.keys(OWNED).forEach((owner) => {
        if (owner === d.name) return;
        OWNED[owner].forEach((re) => {
          if (re.test(text)) {
            throw new Error(
              `${d.name} carries ${re} which belongs to ${owner}: ${text}`,
            );
          }
        });
      });
    });
  });

  it('finds a domain by name or by slug, case-insensitively, and nothing else', () => {
    expect(posts.byName('Python Development').slug).toBe('python');
    expect(posts.byName('python development').slug).toBe('python');
    expect(posts.byName('cyber').slug).toBe('cyber');
    expect(posts.byName('Underwater Basket Weaving')).toBeNull();
    expect(posts.byName('')).toBeNull();
    expect(posts.byName(undefined)).toBeNull();
  });
});

describe('domainPost — the body', () => {
  const body = posts.body(posts.byName('Python Development'));

  it('names the role, the batch and the domain, and nothing from another domain', () => {
    expect(body).toContain('Python Development Intern');
    expect(body).toContain('Domain: Python Development');
    expect(body).toContain('Batch: October 2026');
    expect(body).not.toContain('Business Development');
    expect(body).not.toContain('Venture Capital');
  });

  it('leads with what gets built, in that domain', () => {
    posts.byName('Python Development').builds.forEach((b) => {
      expect(body).toContain(b);
    });
    expect(body).toMatch(/Django job board/i);
    expect(body).toMatch(/no course to finish first/i);
  });

  /*
   * The link test is the one that would have caught the actual complaint about
   * the hand-written posts: six onboarding links at the bottom of every one,
   * so an applicant had to work out which was theirs.
   */
  it('carries exactly one application link, the one for its own track', () => {
    expect(body.match(/https:\/\/lnkd\.in\/\w+/g)).toEqual([posts.APPLY.tech]);
    expect(posts.body(posts.byName('HR')).match(/https:\/\/lnkd\.in\/\w+/g)).toEqual([posts.APPLY.hr]);
    expect(posts.body(posts.byName('Space')).match(/https:\/\/lnkd\.in\/\w+/g)).toEqual([posts.APPLY.space]);
  });

  it('states the stipend as unpaid and puts no figure anywhere near it', () => {
    expect(body).toContain('Stipend: Unpaid');
    expect(body).not.toMatch(/₹|Rs\.?\s*\d|INR|\d[\d,]*\s*(?:\/|per\s+)month/i);
    expect(body).not.toMatch(/\b5,?000\b/);
  });

  /*
   * The team was explicit: state it, do not argue with it. A sentence that
   * pairs the word "unpaid" with a justification reads as an apology and tells
   * the reader the company has nothing else worth mentioning.
   */
  it('never argues about the stipend, in any post', () => {
    posts.DOMAINS.forEach((d) => {
      const t = posts.body(d);
      expect(t).not.toMatch(/though|even though|although|despite|but it is unpaid/i);
      expect(t).not.toMatch(/unpaid[^\n]*(worth|still|instead|make up|compensat)/i);
      expect(t).not.toMatch(/(worth|still|instead|in return)[^\n]*unpaid/i);
      /* "Unpaid" appears once, in the fact block, and nowhere else. */
      expect((t.match(/unpaid/gi) || [])).toHaveLength(1);
    });
  });

  it('tells a fresher with no experience that they qualify', () => {
    expect(body).toMatch(/No prior knowledge needed/i);
    expect(body).toMatch(/never built anything before/i);
    expect(body).toMatch(/interview-ready and job-ready/i);
  });

  it('states mode, duration and eligibility', () => {
    expect(body).toContain(`Mode: ${posts.PROGRAMME.mode}`);
    expect(body).toContain(`Duration: ${posts.PROGRAMME.duration}`);
    expect(body).toMatch(/Eligibility:/);
  });

  it('is long, and still inside what LinkedIn will show', () => {
    posts.DOMAINS.forEach((d) => {
      const t = posts.body(d);
      /* Long on purpose — the projects are the argument — but under the 3,000
         at which LinkedIn truncates and the end of the post stops existing. */
      expect(t.length).toBeGreaterThan(1200);
      expect(t.length).toBeLessThan(3000);
    });
  });

  it('takes a name as readily as a domain object, and refuses an unknown one', () => {
    expect(posts.body('Cyber Security')).toContain('Cyber Security Intern');
    expect(() => posts.body('Underwater Basket Weaving')).toThrow(/no such domain/);
  });

  /*
   * Belt and braces against the file this module will one day be edited in by
   * somebody in a hurry. Notes are fine — the post is deliberately long and
   * the house style opens with a rocket. A block means a slur, a threat, an
   * individual's phone number or a discriminatory restriction, none of which
   * may reach the page.
   */
  it('passes the content guard for every domain, with nothing to revise', () => {
    posts.DOMAINS.forEach((d) => {
      const verdict = guard.review(posts.body(d), { kind: 'opening' });
      expect(verdict.verdict).not.toBe('block');
      const serious = verdict.issues.filter((i) => i.severity !== 'note').map((i) => i.code);
      expect(serious).toEqual([]);
    });
  });
});

/*
 * The post and the poster stapled to it are built by two different programs in
 * two different languages, and they print the same facts. Nothing stops them
 * drifting except this test — and drift here is not a subtle bug, it is a post
 * that says three months above an image that says six, read by everybody who
 * sees it.
 */
describe('domainPost — the post agrees with the poster', () => {
  const script = require('fs').readFileSync(
    require('path').join(__dirname, '../../../../poster-kit/build_domain_posters.py'),
    'utf8',
  );

  const factOnPoster = (label) => {
    const m = script.match(new RegExp(`"label":\\s*"${label}",\\s*"value":\\s*"([^"]*)"`));
    return m ? m[1].replace(/\\n/g, ' ') : null;
  };

  it('states the same mode, duration and batch as the poster', () => {
    expect(factOnPoster('Mode')).toBe(posts.PROGRAMME.mode);
    expect(factOnPoster('Duration')).toBe(posts.PROGRAMME.duration);
    expect(factOnPoster('Batch')).toBe(posts.PROGRAMME.batch);
  });

  it('states the same stipend as the poster, and neither carries a figure', () => {
    const salary = script.match(/"salary":\s*\{[^}]*"value":\s*"([^"]*)"/);
    expect(salary && salary[1]).toBe(posts.PROGRAMME.stipend);
    expect(script).not.toMatch(/₹|Rs\.?\s*\d|\b5,?000\b/);
  });

  it('offers a poster for every domain in the rotation', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../../../public/assets/linkedin-posters');
    posts.DOMAINS.forEach((d) => {
      const file = path.join(dir, posts.posterFile(d));
      expect(fs.existsSync(file)).toBe(true);
      /* A zero-byte or placeholder JPEG would pass an existence check and fail
         on LinkedIn's upload, at three in the morning, unattended. */
      expect(fs.statSync(file).size).toBeGreaterThan(20000);
    });
  });
});

describe('domainPost — the rotation', () => {
  it('puts a post in every two-hour bucket, round the clock', () => {
    expect(posts.SLOT_HOURS).toBe(2);
    expect(posts.slotKey(ist('2026-09-19T00:05:00'))).toBe('2026-09-19T00');
    expect(posts.slotKey(ist('2026-09-19T01:59:00'))).toBe('2026-09-19T00');
    expect(posts.slotKey(ist('2026-09-19T02:00:00'))).toBe('2026-09-19T02');
    expect(posts.slotKey(ist('2026-09-19T23:30:00'))).toBe('2026-09-19T22');
    /* Tuesdays and 3am are slots like any other — there is no day or hour the
       rotation skips, which is the whole change from the weekend job. */
    expect(posts.slotKey(ist('2026-09-22T03:10:00'))).toBe('2026-09-22T02');
  });

  /*
   * 18:30 UTC is 00:00 IST the next day. Reading the host's calendar instead
   * of IST would put the post in a bucket a day out, and it is not the kind of
   * thing anyone notices from a log line.
   */
  it('reads the IST clock, not the host clock', () => {
    expect(posts.slotKey(new Date('2026-09-18T18:30:00Z'))).toBe('2026-09-19T00');
    expect(posts.slotKey(new Date('2026-09-18T18:29:00Z'))).toBe('2026-09-18T22');
    expect(posts.istDateKey(new Date('2026-09-18T18:30:00Z'))).toBe('2026-09-19');
  });

  it('gives the start of the bucket, whatever minute it is asked at', () => {
    const a = posts.slotStart(ist('2026-09-19T14:01:00')).toISOString();
    const b = posts.slotStart(ist('2026-09-19T15:59:00')).toISOString();
    expect(a).toBe(b);
    expect(posts.slotKey(new Date(a))).toBe('2026-09-19T14');
  });

  it('is a pure function of the clock — the same bucket always gets the same domain', () => {
    const a = posts.pick(ist('2026-09-19T14:00:00'));
    const b = posts.pick(ist('2026-09-19T15:45:00'));
    const c = posts.pick(new Date('2026-09-19T09:30:00Z'));
    expect(a.slug).toBe(b.slug);
    expect(a.slug).toBe(c.slug);
  });

  it('changes domain at every bucket boundary', () => {
    const at14 = posts.pick(ist('2026-09-19T14:00:00'));
    const at16 = posts.pick(ist('2026-09-19T16:00:00'));
    expect(at14.slug).not.toBe(at16.slug);
  });

  it('walks all fourteen before repeating any', () => {
    const seen = [];
    let t = ist('2026-09-19T00:00:00').getTime();
    for (let i = 0; i < 14; i += 1) {
      seen.push(posts.pick(new Date(t)).slug);
      t += posts.SLOT_HOURS * 3600000;
    }
    expect(new Set(seen).size).toBe(14);
  });

  /*
   * Twelve slots a day against fourteen domains is deliberate: a lap is 28
   * hours, so a domain that went out at 08:00 goes out at 12:00 next time
   * rather than at 08:00 every day forever.
   */
  it('does not land the same domain at the same hour two days running', () => {
    const day1 = posts.pick(ist('2026-09-19T08:00:00'));
    const day2 = posts.pick(ist('2026-09-20T08:00:00'));
    expect(day1.slug).not.toBe(day2.slug);
  });

  it('keeps counting through a year without landing outside the list', () => {
    let t = ist('2026-01-01T00:00:00').getTime();
    for (let i = 0; i < 500; i += 1) {
      expect(posts.DOMAINS).toContain(posts.pick(new Date(t)));
      t += posts.SLOT_HOURS * 3600000;
    }
  });

  /* Instants before the epoch give a negative slot index; a plain % would then
     index the array with a negative number and return undefined. */
  it('does not fall off the front of the list for an instant before the epoch', () => {
    expect(posts.DOMAINS).toContain(posts.pick(ist('2025-06-14T10:00:00')));
    expect(posts.pick(ist('2020-01-04T02:00:00'))).toBeTruthy();
  });
});

describe('domainPost — the poster and the alt text', () => {
  it('files each poster under its domain slug', () => {
    expect(posts.posterFile('Python Development')).toBe('python.jpg');
    expect(posts.posterFile(posts.byName('Cyber Security'))).toBe('cyber.jpg');
    expect(posts.posterFile('Underwater Basket Weaving')).toBe('');
  });

  it('describes the opening rather than the artwork, and repeats no figure', () => {
    const alt = posts.altText('Python Development');
    expect(alt).toContain('Python Development Intern');
    expect(alt).toContain('October 2026');
    expect(alt).toContain(posts.PROGRAMME.mode);
    expect(alt).toContain('stipend Unpaid');
    /* The year is a figure and belongs here; money is not. Matching on
       currency rather than on digits, so "October 2026" does not read as a
       stipend to the test the way a bare digit rule made it. */
    expect(alt).not.toMatch(/₹|Rs\.?\s*\d|INR|\d[\d,]*\s*(?:\/|per\s+)(?:mo|month)/i);
  });
});
