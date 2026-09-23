'use strict';

/**
 * The greeting rule, run for real.
 *
 * This is the one piece of the mail path that is pure string work, so it is
 * tested by calling it rather than by reading it. The property that matters:
 * a name we were GIVEN is always used, and a name GUESSED from an address is
 * used only when guessing produced something a person would recognise.
 */

const { deriveStudentName, greetingNameFor, isUsableName } = require('../../utils/studentName');

describe('deriveStudentName still behaves as models/Student.js always did', () => {
    test('an explicit name wins over everything', () => {
        expect(deriveStudentName({ name: 'Anita Rao', firstName: 'X', email: 'z@q.com' })).toBe('Anita Rao');
    });
    test('first and last names are joined', () => {
        expect(deriveStudentName({ firstName: 'Rahul', lastName: 'Verma' })).toBe('Rahul Verma');
    });
    test('the address is the last resort', () => {
        expect(deriveStudentName({ email: 'anita.rao@gmail.com' })).toBe('Anita Rao');
    });
    test.each(['undefined', 'null', 'NaN', '-', '—'])('%p is not treated as a name', (junk) => {
        // These reached the database as literal strings and were rendered as
        // names before the original fix; that must not regress.
        expect(isUsableName(junk)).toBe(false);
        expect(deriveStudentName({ name: junk, firstName: 'Priya' })).toBe('Priya');
    });
    test('nothing usable yields an empty string', () => {
        expect(deriveStudentName({})).toBe('');
    });
});

describe('greetingNameFor uses a given name whatever shape it is', () => {
    test.each([
        [{ name: 'K D Sharma', email: 'kdsharma21@x.com' }, 'K D Sharma'],
        [{ name: 'Ram', email: 'xyz123@x.com' }, 'Ram'],
        [{ firstName: 'Priya', lastName: 'Nair' }, 'Priya Nair'],
        [{ firstName: 'Arjun' }, 'Arjun']
    ])('%o → %p', (student, expected) => {
        // A name the student typed is their choice, not our guess, so the
        // human-shape test must never be applied to it.
        expect(greetingNameFor(student)).toBe(expected);
    });
});

describe('greetingNameFor guesses from an address only when it reads like a name', () => {
    test.each([
        ['anita.rao@gmail.com', 'Anita Rao'],
        ['rahul_verma@yahoo.in', 'Rahul Verma'],
        ['priya.s.nair@gmail.com', 'Priya S Nair'],
        ['ravi-kumar@x.org', 'Ravi Kumar']
    ])('%s greets "%s"', (email, expected) => {
        expect(greetingNameFor({ email })).toBe(expected);
    });

    test.each([
        ['kdsharma21@gmail.com'],   // digits glued on
        ['xyz123@gmail.com'],       // digits glued on
        ['admin@college.edu'],      // single word, no separator
        ['ten.intern2026@x.com'],   // two words but numeric
        ['a@b.com']
    ])('%s greets nobody', (email) => {
        // "Dear Kdsharma21," reads as a script wrote it. A missing greeting is
        // invisible; a mangled one gets the message marked as spam, and that
        // costs the sending domain far more.
        expect(greetingNameFor({ email })).toBe('');
    });

    test('no input at all is safe', () => {
        expect(greetingNameFor()).toBe('');
        expect(greetingNameFor({})).toBe('');
    });

    test('it never returns a name it would not also greet with', () => {
        // Guards the invariant rather than a case: whatever comes back must
        // satisfy the same shape test the function applies.
        ['a.b@x.com', 'q1@x.com', 'zz@x.com', 'jo.anne.smith@x.com'].forEach((email) => {
            const g = greetingNameFor({ email });
            if (g) expect(/\s/.test(g) && !/\d/.test(g)).toBe(true);
        });
    });
});
