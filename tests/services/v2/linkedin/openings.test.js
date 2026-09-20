'use strict';

/**
 * The fourteen openings: their data, their posters and their text.
 *
 * Everything in this module is a pure function of constants in the same file,
 * so this suite needs no database, no network and no mocks. The one thing it
 * does touch is the filesystem, because `posters()` reads it — and the poster
 * files are the part most likely to go missing, so reading them for real is
 * the point rather than an inconvenience.
 *
 * The assertions that matter most are the ones about what is NOT in the post.
 * The stipend was deliberately removed from the text while staying on the
 * poster, and that is the kind of decision somebody re-adds in six months
 * because the omission looks like an oversight. It is not one.
 */

const fs = require('fs');
const path = require('path');

const openings = require('../../../../services/v2/linkedin/openings');

const POSTER_DIR = path.join(__dirname, '..', '..', '..', '..', 'public', 'assets', 'linkedin-posters');

describe('openings — the fourteen domains', () => {
  test('there are exactly fourteen, which is what the public site advertises', () => {
    expect(openings.DOMAINS).toHaveLength(14);
  });

  test('every slug is unique, because the slug is the poster filename', () => {
    const slugs = openings.DOMAINS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('every domain carries the fields the section renders', () => {
    for (const d of openings.DOMAINS) {
      expect(typeof d.slug).toBe('string');
      expect(d.slug).toMatch(/^[a-z]+$/);
      expect(d.name.length).toBeGreaterThan(1);
      expect(d.role).toContain('Intern');
      expect(d.tag.startsWith('#')).toBe(true);
      /* Three builds, not two and not five: the post lists them as a block and
         a domain with one looks thinner than its neighbours on the same page. */
      expect(d.builds).toHaveLength(3);
      for (const b of d.builds) expect(b.length).toBeGreaterThan(20);
    }
  });

  test('every track resolves to a real apply link, so none falls back silently', () => {
    for (const d of openings.DOMAINS) {
      expect(Object.prototype.hasOwnProperty.call(openings.APPLY, d.track)).toBe(true);
      expect(openings.applyUrl(d)).toBe(openings.APPLY[d.track]);
      expect(openings.applyUrl(d)).toMatch(/^https:\/\//);
    }
  });

  test('byName finds a domain by display name or by slug, and nothing by nonsense', () => {
    expect(openings.byName('Python Development').slug).toBe('python');
    expect(openings.byName('python').slug).toBe('python');
    expect(openings.byName('PYTHON DEVELOPMENT').slug).toBe('python');
    expect(openings.byName('Underwater Basket Weaving')).toBeNull();
    expect(openings.byName('')).toBeNull();
    expect(openings.byName(null)).toBeNull();
  });
});

describe('openings — the posters on disk', () => {
  test('all fourteen domain plates exist and are not empty', () => {
    for (const d of openings.DOMAINS) {
      const file = path.join(POSTER_DIR, `${d.slug}.jpg`);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(1000);
    }
  });

  test('all fourteen TEN plates exist and are not empty', () => {
    for (const d of openings.DOMAINS) {
      const file = path.join(POSTER_DIR, `${d.slug}-ten.jpg`);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(1000);
    }
  });

  test('posters() gives every domain both plates, domain first', () => {
    for (const d of openings.DOMAINS) {
      const found = openings.posters(d);
      expect(found.map((p) => p.variant)).toEqual(['domain', 'ten']);
      expect(found[0].url).toBe(`/assets/linkedin-posters/${d.slug}.jpg`);
      expect(found[1].url).toBe(`/assets/linkedin-posters/${d.slug}-ten.jpg`);
    }
  });

  /*
   * Both sets are committed now, so this no longer guards a gap — it guards the
   * mechanism that closed it. posters() reads the directory rather than
   * trusting a hard-coded list, which is what let the second set deploy by
   * being copied in. A plate that goes missing must drop out of the list rather
   * than reach the browser as an <img> src that 404s.
   */
  test('never lists a plate that is not on disk', () => {
    for (const d of openings.DOMAINS) {
      for (const p of openings.posters(d)) {
        expect(fs.existsSync(path.join(POSTER_DIR, p.file))).toBe(true);
      }
    }
  });

  test('posters() is empty rather than throwing for a domain that does not exist', () => {
    expect(openings.posters('not-a-domain')).toEqual([]);
  });
});

describe('openings — the post text', () => {
  const python = openings.byName('python');

  test('carries the facts a reader needs to act', () => {
    const body = openings.text(python);
    expect(body).toContain('Python Development Intern');
    expect(body).toContain(openings.PROGRAMME.batch);
    expect(body).toContain(openings.PROGRAMME.mode);
    expect(body).toContain(openings.PROGRAMME.duration);
    expect(body).toContain(openings.applyUrl(python));
    expect(body).toContain('No prior knowledge needed');
    expect(body).toContain('interview-ready and job-ready');
  });

  /*
   * The stipend line, and what it may not turn into.
   *
   * This post used to omit the stipend entirely, because the internship was
   * unpaid and naming an absence then defending it is what makes a reader
   * decide the absence is the story. The team has since confirmed October 2026
   * interns are paid, so the line is back — stated once, qualified once, and
   * never elaborated.
   *
   * What the assertions below actually guard is the elaboration. "Competitive
   * salary" with the terms named is a claim the company stands behind; the same
   * line followed by a paragraph explaining the terms is a poster arguing with
   * itself, and a specific rupee figure nobody approved is the single most
   * expensive thing this file could print.
   */
  test('states the stipend once, qualified, with no figure', () => {
    for (const d of openings.DOMAINS) {
      const body = openings.text(d);
      expect(body).toContain('Stipend: Competitive salary along with terms and conditions');
      expect(body).toContain('• Competitive stipend');
      /* Exactly those two: the fact line and the perk. A third mention is an
         explanation starting, which is the thing this post must not do. */
      expect(body.toLowerCase().split('stipend').length - 1).toBe(2);
      /* No invented number, in either notation. */
      expect(body).not.toContain('₹');
      expect(body).not.toMatch(/\bRs\.?\s*\d/i);
      expect(body).not.toMatch(/\d[\d,]{3,}\s*(\/|per\b|a\b)?\s*(mo|month)/i);
      /* And no leftover from when it was unpaid. */
      expect(body.toLowerCase()).not.toContain('unpaid');
    }
  });

  test('lists that domain\'s own three builds and no other domain\'s', () => {
    for (const d of openings.DOMAINS) {
      const body = openings.text(d);
      for (const b of d.builds) expect(body).toContain(b);
    }
    /* The Redis clone belongs to Software Engineering. It reads well under
       Python too, which is exactly why this guards against it drifting there:
       a Python intern does not build Redis here, and saying so would be a
       claim the programme does not keep. */
    expect(openings.text('python')).not.toContain('Redis clone');
    expect(openings.text('softeng')).toContain('Redis clone');
  });

  test('keeps hashtags to five across the whole post', () => {
    for (const d of openings.DOMAINS) {
      const tags = openings.text(d).match(/#[A-Za-z][A-Za-z0-9]*/g) || [];
      expect(tags.length).toBeLessThanOrEqual(5);
      expect(tags).toContain(d.tag);
    }
  });

  test('throws on a domain that does not exist rather than posting a blank', () => {
    expect(() => openings.text('not-a-domain')).toThrow(/no such domain/);
  });
});

describe('openings — alt text', () => {
  test('describes the poster, stipend included, because the poster shows it', () => {
    const alt = openings.altText('python');
    expect(alt).toContain('Python Development Intern');
    expect(alt).toContain(openings.PROGRAMME.batch);
    /* The one place the stipend belongs in words: a screen reader must be told
       what a sighted reader can see on the plate. */
    expect(alt).toContain(openings.PROGRAMME.stipend);
  });

  test('is empty rather than throwing for an unknown domain', () => {
    expect(openings.altText('not-a-domain')).toBe('');
  });
});

describe('openings — the payload the section receives', () => {
  const list = openings.list();

  test('is fourteen entries in the declared order', () => {
    expect(list).toHaveLength(14);
    expect(list.map((o) => o.slug)).toEqual(openings.DOMAINS.map((d) => d.slug));
  });

  test('every entry carries text, an apply link, alt text and its posters', () => {
    for (const o of list) {
      expect(o.text.length).toBeGreaterThan(500);
      expect(o.applyUrl).toMatch(/^https:\/\//);
      expect(o.alt.length).toBeGreaterThan(20);
      expect(Array.isArray(o.posters)).toBe(true);
      for (const p of o.posters) {
        expect(['domain', 'ten']).toContain(p.variant);
        expect(p.url.startsWith('/assets/linkedin-posters/')).toBe(true);
      }
    }
  });

  /* Nothing in this feature holds a credential any more, and the payload goes
     to every signed-in role including students. Worth pinning. */
  test('leaks nothing operational', () => {
    const json = JSON.stringify(list).toLowerCase();
    for (const forbidden of ['token', 'urn:li:organization', 'client_secret', 'authorization', 'orgurn']) {
      expect(json).not.toContain(forbidden);
    }
  });
});
