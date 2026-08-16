'use strict';

/**
 * The rules a student must meet to apply for a certificate:
 *
 *   LOC  — internship complete AND attendance above 75%
 *   LOR  — performance above 70%
 *   STAR — HR has accepted the student's contribution
 *
 * They live in one module so the student portal, the apply route and the HR
 * approval route cannot disagree — the tenure tables in this project once
 * existed in five places, drifted apart, and silently made every student a
 * 30-day intern.
 */

jest.mock('../../models/new/StudentTaskProgress', () => ({
  countDocuments: jest.fn()
}));

const StudentTaskProgress = require('../../models/new/StudentTaskProgress');
const { evaluate, evaluateOne, THRESHOLDS } = require('../../services/certificateEligibility');

/** total tasks, approved tasks */
function withTasks(total, approved) {
  StudentTaskProgress.countDocuments.mockImplementation((q) =>
    Promise.resolve(q && q.status === 'approved' ? approved : total));
}

beforeEach(() => {
  StudentTaskProgress.countDocuments.mockReset();
  withTasks(0, 0);
});

const student = (over = {}) => ({ _id: 'stu1', employeeId: 'TEN/WEB/1', ...over });

describe('LOC — completed internship AND attendance above 75%', () => {
  it('is granted at 76% with the internship complete', async () => {
    const r = await evaluate(student({ internshipCompleted: true, attendancePercentage: 76 }));
    expect(r.LOC.eligible).toBe(true);
  });

  it('is refused at exactly 75% — the rule is ABOVE 75', async () => {
    const r = await evaluate(student({ internshipCompleted: true, attendancePercentage: 75 }));
    expect(r.LOC.eligible).toBe(false);
    expect(r.LOC.reason).toMatch(/75%/);
  });

  it('is refused when attendance is high but the internship is unfinished', async () => {
    const r = await evaluate(student({ internshipCompleted: false, attendancePercentage: 90 }));
    expect(r.LOC.eligible).toBe(false);
    expect(r.LOC.reason).toMatch(/complete/i);
  });

  it('names the actual attendance so the student knows the gap', async () => {
    const r = await evaluate(student({ internshipCompleted: true, attendancePercentage: 68 }));
    expect(r.LOC.reason).toContain('68%');
  });

  it('accepts a fully-approved task journey as completion evidence', async () => {
    // internshipCompleted exists twice on the schema, written by different
    // paths; a student who finished everything must not be blocked by a flag
    // nobody set.
    withTasks(10, 10);
    const r = await evaluate(student({ attendancePercentage: 90 }));
    expect(r.LOC.eligible).toBe(true);
  });

  it('accepts the milestones date form of completion', async () => {
    const r = await evaluate(student({ milestones: { internshipCompleted: new Date() }, attendancePercentage: 80 }));
    expect(r.LOC.eligible).toBe(true);
  });
});

describe('LOR — performance above 70%', () => {
  it('is granted at 71%', async () => {
    const r = await evaluate(student({ performanceScore: 71 }));
    expect(r.LOR.eligible).toBe(true);
  });

  it('is refused at exactly 70% — the rule is ABOVE 70', async () => {
    const r = await evaluate(student({ performanceScore: 70 }));
    expect(r.LOR.eligible).toBe(false);
  });

  it('does not depend on attendance or completion', async () => {
    const r = await evaluate(student({ performanceScore: 85, attendancePercentage: 0, internshipCompleted: false }));
    expect(r.LOR.eligible).toBe(true);
  });

  it('names the shortfall', async () => {
    const r = await evaluate(student({ performanceScore: 55 }));
    expect(r.LOR.reason).toContain('55%');
  });
});

describe('STAR — only after HR accepts the contribution', () => {
  it.each([
    ['not_submitted',  false, /submit a contribution/i],
    ['pending_review', false, /with HR/i],
    ['rejected',       false, /not accepted/i],
    ['approved',       true,  /accepted/i],
    ['issued',         true,  /accepted/i]
  ])('starStatus %p → eligible %p', async (starStatus, expected, reasonRe) => {
    const r = await evaluate(student({ starStatus }));
    expect(r.STAR.eligible).toBe(expected);
    expect(r.STAR.reason).toMatch(reasonRe);
  });
});

describe('measured values', () => {
  it('reports the figures the decision was made on', async () => {
    withTasks(4, 2);
    const r = await evaluate(student({ attendancePercentage: 80, performanceScore: 65, internshipCompleted: true }));
    expect(r.measured).toMatchObject({
      attendancePercentage: 80,
      performanceScore: 65,
      internshipCompleted: true,
      taskCompletionPercent: 50
    });
  });

  it('clamps nonsense percentages instead of trusting them', async () => {
    const r = await evaluate(student({ attendancePercentage: 9999, performanceScore: -5 }));
    expect(r.measured.attendancePercentage).toBe(100);
    expect(r.measured.performanceScore).toBe(0);
  });
});

describe('evaluateOne', () => {
  it('returns the single verdict the apply route checks', async () => {
    const v = await evaluateOne(student({ performanceScore: 90 }), 'LOR');
    expect(v.eligible).toBe(true);
  });

  it('refuses an unknown certificate type rather than defaulting to allowed', async () => {
    const v = await evaluateOne(student(), 'SOMETHING');
    expect(v.eligible).toBe(false);
  });

  it('refuses when there is no student at all', async () => {
    const r = await evaluate(null);
    expect(r.LOC.eligible).toBe(false);
    expect(r.LOR.eligible).toBe(false);
    expect(r.STAR.eligible).toBe(false);
  });
});

describe('thresholds are stated once', () => {
  it('matches the specified rules', () => {
    expect(THRESHOLDS.LOC_MIN_ATTENDANCE).toBe(75);
    expect(THRESHOLDS.LOR_MIN_PERFORMANCE).toBe(70);
  });
});
