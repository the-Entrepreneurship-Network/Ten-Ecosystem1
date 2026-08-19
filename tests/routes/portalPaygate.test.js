'use strict';

/**
 * @jest-environment node
 *
 * The "Unlock your access" paygate is gone from all four portals.
 *
 * It gated a whole portal behind a localStorage flag — which is not a payment,
 * only a note the browser writes to itself — and it stood in front of flows
 * that take money properly further in. On the hackathon portal it was the first
 * thing a visitor met, in front of a registration form that collects the entry
 * fee itself.
 *
 * The build outputs AND the source templates are both asserted: cleaning only
 * the output means the next `vite build` quietly puts it back.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

const BUILT = [
  'public/student-portal/index.html',
  'public/hackathon-portal/index.html',
  'public/job-portal/index.html',
  'public/resume-portal/index.html',
];
const SOURCES = [
  'hackathon-portal-app/index.html',
  'job-portal-app/index.html',
  'resume-portal-app/index.html',
];

describe('no portal is gated by the localStorage paygate', () => {
  it.each(BUILT)('%s does not load it', (rel) => {
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).not.toContain('portal-paygate');
  });

  it.each(SOURCES.filter((s) => fs.existsSync(path.join(root, s))))(
    '%s will not restore it on the next build', (rel) => {
      expect(fs.readFileSync(path.join(root, rel), 'utf8')).not.toContain('portal-paygate.js');
    });

  it('the hackathon portal still collects its entry fee, properly', () => {
    const routes = fs.readFileSync(path.join(root, 'routes/v2/hackathons.js'), 'utf8');
    expect(routes).toMatch(/register-public/);
    expect(routes).toMatch(/paymentStatus: 'pending'/);
  });

  it('the internship fee is still enforced server-side, not by a browser flag', () => {
    expect(fs.existsSync(path.join(root, 'middleware/tenurePaymentGate.js'))).toBe(true);
    const gate = fs.readFileSync(path.join(root, 'middleware/tenurePaymentGate.js'), 'utf8');
    expect(gate).toMatch(/Fails CLOSED|402/);
  });
});

describe('the hackathon board is alive, not a printed date', () => {
  const board = fs.readFileSync(path.join(root, 'hackathon-portal-app/src/components/EventBoard.tsx'), 'utf8');

  it('a live countdown ticks to the registration deadline', () => {
    expect(board).toMatch(/function useCountdown/);
    expect(board).toMatch(/setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
    expect(board).toMatch(/REGISTRATION CLOSES IN/);
  });

  it('the timer stops itself rather than ticking forever', () => {
    const block = board.slice(board.indexOf('function useCountdown'), board.indexOf('function Countdown'));
    expect(block).toMatch(/clearInterval\(id\)/);
    expect(block).toMatch(/end <= Date\.now\(\)/);   // never starts for a past date
  });

  it('a passed deadline says so instead of counting backwards', () => {
    expect(board).toMatch(/REGISTRATION CLOSED/);
    expect(board).toMatch(/if \(left <= 0\)/);
  });

  it('filters appear only when there is something to filter', () => {
    expect(board).toMatch(/new Set\(events\.map\(\(e\) => e\.mode\)\)\.size > 1/);
    expect(board).toMatch(/events\.filter\(\(e\) => filter === 'all' \|\| e\.mode === filter\)/);
  });

  it('the built bundle carries it', () => {
    const idx = fs.readFileSync(path.join(root, 'public/hackathon-portal/index.html'), 'utf8');
    const m = idx.match(/assets\/(index-[\w-]+\.js)/);
    expect(m).not.toBeNull();
    const bundle = fs.readFileSync(path.join(root, 'public/hackathon-portal/assets', m[1]), 'utf8');
    expect(bundle).toContain('REGISTRATION CLOSES IN');
  });
});
