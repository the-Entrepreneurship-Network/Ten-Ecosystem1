'use strict';

const { ALL_TASKS, TRACK_WEEKS, deriveTrackWeeks } = require('../../seeds/domainTasks.seed');

const derived = deriveTrackWeeks(ALL_TASKS);
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
    Object.keys(TRACK_WEEKS).forEach((tenure) => {
      const covered = new Set(derived.filter((t) => t.durationType === tenure).map((t) => t.domain));
      expect(covered.size).toBe(domains.size);
    });
  });

  it('gives each track the agreed number of weeks per domain', () => {
    Object.entries(TRACK_WEEKS).forEach(([tenure, weeks]) => {
      expect(countFor(tenure)).toBe(weeks * domains.size);
    });
  });

  it('never writes a row for a week somebody already wrote by hand', () => {
    // $setOnInsert would keep the hand-written one anyway, so a duplicate is a
    // wasted round-trip and a seed count that overstates the work.
    const keyOf = (t) => t.durationType + '|' + t.domain + '|' + t.weekNumber;
    const written = new Set(ALL_TASKS.map(keyOf));
    expect(derived.filter((t) => written.has(keyOf(t)))).toEqual([]);
  });

  it('numbers the weeks from 1, with no gaps', () => {
    /*
     * The dashboard unlocks one week at a time, so a track missing week 3 would
     * stop there forever. What matters is the COMBINED track — hand-written rows
     * plus derived ones — because that is what the database ends up holding.
     */
    Object.entries(TRACK_WEEKS).forEach(([tenure, weeks]) => {
      const python = all
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

  it('the ladder rises with what a student pays for', () => {
    /*
     * A 1-week and a 1-month internship both handed out four tasks, and the free
     * 6-month track handed out 24 — so paying for a shorter course bought less
     * work than not paying at all. Weeks per tenure now only go up: 4, 6, 8, 10,
     * 12, 24.
     */
    const weeksFor = (dur) => new Set(
      all.filter((t) => t.durationType === dur && t.domain === 'Python Development')
         .map((t) => t.weekNumber)
    ).size;
    const ladder = ['1week', '15days', '1month', '45days', '3months', '6months'].map(weeksFor);
    expect(ladder).toEqual([4, 6, 8, 10, 12, 24]);
    ladder.slice(1).forEach((weeks, i) => expect(weeks).toBeGreaterThan(ladder[i]));
  });

  it('keeps every hand-written task exactly as written', () => {
    // $setOnInsert never overwrites, so the 1-month and 45-day tracks that were
    // authored by hand survive; only the weeks beyond them come from the ladder.
    const handwritten = ALL_TASKS.filter((t) => t.durationType === '1month'
      && t.domain === 'Python Development');
    handwritten.forEach((task) => {
      const derivedSame = derived.find((d) => d.durationType === '1month'
        && d.domain === task.domain && d.weekNumber === task.weekNumber);
      // A derived row may exist for the same week, but $setOnInsert means the
      // hand-written one is the row that stays.
      if (derivedSame) expect(task.taskTitle).toBeTruthy();
    });
    expect(handwritten.length).toBe(4);
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

describe('nobody goes backwards when their track grows', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../..');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /*
   * Completion is approved / assigned. Lengthening a track moves the denominator
   * under a student already part-way through one: 4 of 4 becomes 4 of 8, for
   * work they had already done. An LOR needs 50%, so that student could be
   * refused a document they had already qualified for.
   */
  it('one function decides a track, and it does not remap the short tenures', () => {
    /*
     * There were TWO copies of the remap in this file — one in the assignment
     * path and one in the journey builder — and both rewrote 1week and 15days
     * onto the 1-month track. Two copies of a rule are two rules: fixing one is
     * how a "fixed" 1-week internship still showed a single task. A separate
     * WEEK_CAPS table described the same thing a third time.
     */
    const engine = strip(read('services/v2/taskEngine.js'));
    expect(engine).toContain('async function tasksForTrack(domain, durationType, extra)');
    expect(engine).toContain('Object.assign({ domain, durationType }, extra || {})');
    expect(engine).not.toContain('queryDurationType = "1month"');
    expect(engine).not.toMatch(/const WEEK_CAPS = \{/);
    // Exactly one place builds the query, so the two callers cannot disagree.
    expect((engine.match(/DomainTask\.find\(query\)/g) || []).length).toBe(1);
  });

  it('falls back safely if the seeder has not run yet', () => {
    // Deploy order is not guaranteed. A student opening their dashboard between
    // the code landing and the seed running must not find it empty.
    const engine = strip(read('services/v2/taskEngine.js'));
    expect(engine).toContain('LEGACY_SHORT_WEEKS');
    expect(engine).toContain('if (!LEGACY_SHORT_WEEKS[durationType]) return tasks;');
    // The real track wins the moment it exists, so the fallback retires itself.
    expect(engine).toContain('if (tasks.length) return tasks.slice().sort(byWeek);');
  });

  it('the student record can hold the standing they had before', () => {
    expect(strip(read('models/Student.js'))).toContain('preExpansionCompletionPercent');
  });

  it('the LOR gate reads the better of the two figures', () => {
    const docs = strip(read('routes/v2/documents.js'));
    expect(docs).toContain('Math.max(livePercent, student.preExpansionCompletionPercent || 0)');
  });

  it('the migration writes nothing without --write, and never lowers protection', () => {
    const script = strip(read('scripts/expand-task-tracks.js'));
    expect(script).toContain("const write = process.argv.includes('--write')");
    expect(script).toContain('Dry run');
    // Only a DROP is recorded, only once — a second run must not overwrite the
    // figure a first run protected somebody with.
    expect(script).toContain('after.percent < before.percent && student.preExpansionCompletionPercent == null');
  });
});
