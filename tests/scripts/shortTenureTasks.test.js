'use strict';

const { ALL_TASKS, SHORT_TRACKS, deriveShortTracks } = require('../../seeds/domainTasks.seed');

const derived = deriveShortTracks(ALL_TASKS);
const all = ALL_TASKS.concat(derived);
const countFor = (durationType) => all.filter((t) => t.durationType === durationType).length;
const domains = new Set(ALL_TASKS.map((t) => t.domain));

describe('the short internships have work in them', () => {
  /*
   * A student can pick 1 week or 15 days, and this seed described only 1month,
   * 45days, 3months and 6months. routes/v2/studentPortal.js looks tasks up with
   * DomainTask.find({ domain, durationType }), so those students got an empty
   * list: they registered, opened the dashboard, and there was nothing to do.
   *
   * The free 6-month track has 24 tasks, so the shortest tracks — the paid ones
   * — offered less work than the long free one. Backwards, for a product whose
   * promise is "earn it, then claim it".
   */
  it('every tenure a student can pick has tasks', () => {
    const { TENURE_DAYS } = require('../../utils/tenure');
    Object.keys(TENURE_DAYS).forEach((tenure) => {
      expect(countFor(tenure)).toBeGreaterThan(0);
    });
  });

  it('covers every domain, not just the ones somebody remembered', () => {
    Object.keys(SHORT_TRACKS).forEach((tenure) => {
      const covered = new Set(derived.filter((t) => t.durationType === tenure).map((t) => t.domain));
      expect(covered.size).toBe(domains.size);
    });
  });

  it('gives each short track the agreed number of weeks per domain', () => {
    Object.entries(SHORT_TRACKS).forEach(([tenure, weeks]) => {
      expect(countFor(tenure)).toBe(weeks * domains.size);
    });
  });

  it('numbers the weeks from 1, with no gaps', () => {
    // The dashboard unlocks week by week; a track starting at week 3 would
    // never open.
    Object.entries(SHORT_TRACKS).forEach(([tenure, weeks]) => {
      const python = derived
        .filter((t) => t.durationType === tenure && t.domain === 'Python Development')
        .map((t) => t.weekNumber)
        .sort((a, b) => a - b);
      expect(python).toEqual(Array.from({ length: weeks }, (_, i) => i + 1));
    });
  });

  it('is cut from the real 3-month ladder, not invented filler', () => {
    // The 3-month track is already ordered easy -> expert, so a one-week intern
    // gets the first four weeks of real work rather than four throwaway
    // exercises. It also means editing the 3-month track carries through.
    const source = ALL_TASKS
      .filter((t) => t.domain === 'Python Development' && t.durationType === '3months')
      .sort((a, b) => a.weekNumber - b.weekNumber);
    const week = derived.find((t) => t.domain === 'Python Development'
      && t.durationType === '1week' && t.weekNumber === 1);
    expect(week.taskTitle).toBe(source[0].taskTitle);
    expect(week.taskDescription).toBe(source[0].taskDescription);
    expect(week.coinReward).toBe(source[0].coinReward);
  });

  it('does not touch the tracks students are already part-way through', () => {
    /*
     * Extending 1month or 45days would change the denominator under a student
     * who is already on one: 4 of 4 becomes 4 of 8, and somebody who had passed
     * the certificate threshold could fall back below it. Those two need a
     * recalculation pass and a decision, not a quiet seed.
     */
    expect(Object.keys(SHORT_TRACKS).sort()).toEqual(['15days', '1week']);
    expect(countFor('1month')).toBe(ALL_TASKS.filter((t) => t.durationType === '1month').length);
    expect(countFor('45days')).toBe(ALL_TASKS.filter((t) => t.durationType === '45days').length);
  });

  it('the seeder can be loaded without connecting to a database', () => {
    // It used to call seed() at require time, so nothing could test the shape
    // of what it was about to write.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../seeds/domainTasks.seed.js'), 'utf8');
    expect(src).toContain('if (require.main === module)');
  });
});
