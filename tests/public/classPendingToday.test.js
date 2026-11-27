'use strict';

/**
 * Today's class attendance reads "Pending", not a red "Absent".
 *
 * The coordinator marks the Class column, and the 11:55 pm agent marks it
 * Present for a student who marked their own attendance (or was active) when
 * the coordinator did not. Until then the day is not over, but the table
 * painted it red "Absent" from the first look: the "I attended and filled the
 * form but it shows class absent" email. Past unmarked days stay "Absent".
 *
 * Checked in a browser against the real server and the real job as well:
 * Pending -> self-mark -> agent runs -> Present.
 */

const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(path.join(__dirname, '../../public/student-dashboard.html'), 'utf8');
const fn = (name) => {
    const start = PAGE.indexOf('function ' + name + '(');
    expect(start).toBeGreaterThan(-1);
    return PAGE.slice(start, PAGE.indexOf('\n}\n', start));
};

it('today, unmarked, is Pending (class) and Not yet (self); earlier days are still Absent', () => {
    const body = fn('renderAttendanceHistory');
    expect(body).toContain('const isToday = day.dateKey === keyOf(nowZero);');
    expect(body).toContain('(isToday ? "Pending" : "Absent")');
    expect(body).toContain('(isToday ? "Not yet" : "Absent")');
    expect(body).toMatch(/marked Present ' \+\s*'automatically/);
});

it('shows Pending and Not yet in amber, not the red of Absent', () => {
    const pill = new Function(fn('attPill') + '\n}; return attPill;')();
    expect(pill('Pending')).toContain('#f59e0b');
    expect(pill('Not yet')).toContain('#f59e0b');
    expect(pill('Absent')).toContain('#f43f5e');
    expect(pill('Present')).toContain('#10b981');
});
