'use strict';

/**
 * "Login successful", then straight back to the login page (26 Nov).
 *
 * A student account can exist without the internship record the dashboard
 * runs on: registerUser makes the account first and the record later, and a
 * failure in between (Employee ID allocation giving up, for one) used to leave
 * the account behind. Sign-in then said "Access Granted", the dashboard's
 * first call was refused as an expired session, and the page sent the student
 * back to sign in, every time. Registering again said "Email already
 * registered". There was no way out.
 *
 * Reproduced and checked end to end against a local MongoDB: the loop before,
 * and after the fix a "Finish your registration" answer, a re-registration by
 * the owner that lands on a working dashboard, a refusal for anyone without
 * the password, and nothing left behind by a sign-up that fails part way.
 * These tests hold the shape of that fix.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SERVER = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));
const CTRL = strip(fs.readFileSync(path.join(root, 'controllers/registerHubController.js'), 'utf8'));

describe('sign-in never claims success for a student with no internship record', () => {
    const login = SERVER.slice(SERVER.indexOf('app.post("/login"'));

    it('answers "finish your registration" before any student session is made', () => {
        const refuse = login.indexOf("if (user.role === 'student' && !student)");
        const session = login.indexOf('establishStudentSession(req, studentPayload)');
        expect(refuse).toBeGreaterThan(-1);
        expect(refuse).toBeLessThan(session);
        expect(login.slice(refuse, refuse + 600)).toMatch(/success: false,\s*noInternship: true,\s*registerUrl: '\/register'/);
    });

    it.each(['public/login.html', 'public/student-login.html'])('%s offers the way to finish', (page) => {
        const src = fs.readFileSync(path.join(root, page), 'utf8');
        expect(src).toContain('if (data.noInternship)');
        expect(src).toContain('Finish your registration');
        expect(src).toContain('window.location.href = data.registerUrl || "/register"');
    });
});

describe('a sign-up that fails part way leaves nothing behind', () => {
    it('remembers what it made, and the catch undoes it', () => {
        expect(CTRL).toMatch(/const user = await EcosystemUser\.create\(\{[\s\S]*?\}\);\s*createdUserId = user\._id;/);
        expect(CTRL).toContain('createdStudentId = studentDocId;');
        const catchAt = CTRL.indexOf('} catch (err) {', CTRL.indexOf('createdUserId = user._id;'));
        expect(CTRL.slice(catchAt, catchAt + 400)).toContain('await removeHalfMadeAccount(createdUserId, createdStudentId)');
    });

    it('only calls a duplicate key "already registered" when the key is the email', () => {
        expect(CTRL).toMatch(/err\.code === 11000 && \/email\/i\.test\(/);
    });

    /*
     * Mongoose 6 drops a filter on a field the schema does not have, and
     * deleteMany({}) empties the whole collection. StartupProfile is keyed by
     * founderId, not userId; a userId filter on it would have wiped every
     * startup. Every pair the cleanup uses must name a real field.
     */
    it('deletes each profile by a field its schema really has', () => {
        const pairs = [...CTRL.matchAll(/\[(\w+), '(\w+)'\]/g)].map((m) => [m[1], m[2]]);
        expect(pairs.length).toBeGreaterThanOrEqual(8);
        for (const [model, field] of pairs) {
            const M = require(path.join(root, 'models', model));
            expect([model, field, !!M.schema.path(field)]).toEqual([model, field, true]);
        }
        expect(pairs).toContainEqual(['StartupProfile', 'founderId']);
    });
});

describe('the owner of a half-made account can register again', () => {
    const check = CTRL.slice(CTRL.indexOf('if (existingEco && !existingStudent'), CTRL.indexOf("} else if (existingEco || existingStudent || existingHR || existingCoord)"));

    it('needs the same password, a student account, and no internship record anywhere', () => {
        expect(check).toContain('role === ROLES.STUDENT && existingEco.role === ROLES.STUDENT');
        expect(check).toContain('!(await findStudentByEmail(Student, trimmedEmail))');
        expect(check).toContain('await bcrypt.compare(password, existingEco.password');
        expect(check).toContain('await removeHalfMadeAccount(existingEco._id, null)');
    });

    it('otherwise still answers "Email already registered"', () => {
        expect(CTRL).toMatch(/\} else if \(existingEco \|\| existingStudent \|\| existingHR \|\| existingCoord\) \{\s*return res\.status\(409\)/);
    });
});
