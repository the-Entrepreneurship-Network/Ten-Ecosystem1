'use strict';

/**
 * A WhatsApp joiner's dashboard and onboarding questions.
 *
 * Reported: a new intern picks "WhatsApp joiner", types their Employee ID and
 * a joining date, and the attendance then reads wrong for good. Three causes
 * on this page, each held here:
 *
 *   - the attendance percentage was student.calculatedAttendance, which is a
 *     DAY COUNT taken once at onboarding (17 days read as "17%", "Below 75%"
 *     beside a real 94%) and never moved however many days they attended;
 *   - a typed Employee ID replaced the real one with no check of its shape and
 *     no "are you sure";
 *   - a joining date on or after registering saved silently, crediting none of
 *     their WhatsApp days, and the question cannot be answered again.
 *
 * Checked in a browser against the real server as well; these hold the shape.
 */

const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(path.join(__dirname, '../../public/student-dashboard.html'), 'utf8');
const fn = (name) => {
    const start = PAGE.indexOf('function ' + name + '(');
    expect(start).toBeGreaterThan(-1);
    return PAGE.slice(start, PAGE.indexOf('\n}\n', start));
};

describe('the attendance panel', () => {
    it('shows the server\'s percentage for a WhatsApp joiner, not the onboarding day count', () => {
        const body = fn('loadAttendance').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(body).not.toMatch(/calculatedAttendance/);
        expect(body).toContain('const finalCombinedPct = s.combinedPct || 0;');
        expect(body).toContain('const finalSelfPct = s.selfPct || 0;');
    });
});

describe('the Employee ID question', () => {
    const body = () => fn('wizardUpdateEmpId');

    it('tidies the ID and refuses one that is not shaped like a TEN ID before asking the server', () => {
        const b = body();
        expect(b).toContain(".toUpperCase().replace(/\\s+/g, '')");
        const shape = b.indexOf('/^TEN\\/[A-Z]{2,10}\\/\\d{3,10}$/');
        expect(shape).toBeGreaterThan(-1);
        expect(shape).toBeLessThan(b.indexOf("fetch('/api/employee-id/available"));
    });

    it('asks before the typed ID replaces the real one', () => {
        const b = body();
        const ask = b.indexOf("title: 'Change your Employee ID to '");
        expect(ask).toBeGreaterThan(-1);
        expect(b).toContain('if (!sure || !sure.isConfirmed)');
        expect(ask).toBeLessThan(b.indexOf('_onboardingState.updatedEmployeeId = newId;'));
    });

    it('matches the server\'s rule', () => {
        const { typedEmployeeId } = require('../../utils/employeeId');
        expect(typedEmployeeId(' ten/sde/1266 ')).toEqual({ ok: true, id: 'TEN/SDE/1266' });
        expect(typedEmployeeId('TEN/SDE/12A6').ok).toBe(false);
        expect(body()).toContain(String(/^TEN\/[A-Z]{2,10}\/\d{3,10}$/));
    });
});

describe('the joining date question', () => {
    it('warns before saving a date that credits no WhatsApp days', () => {
        const b = fn('wizardConfirmJoiningDate');
        const warn = b.indexOf("title: 'No WhatsApp days will be counted'");
        expect(warn).toBeGreaterThan(-1);
        expect(b).toContain('dateVal >= registeredOn');
        expect(b).toContain('if (!keep || !keep.isConfirmed) return;');
        expect(warn).toBeLessThan(b.indexOf("fetch('/api/v2/student/complete-onboarding'"));
    });
});
