/**
 * Registration must not be capped by the login limit.
 *
 * They shared one budget, and 10 per address per 15 minutes is a login number
 * — it exists to stop password guessing. Applied to signup it caps an intake
 * day instead: a campus is one public address, so the 11th student to register
 * from the college wifi was refused while the server was idle.
 *
 * These assert the two are separate and that registration is the looser of the
 * two, so a future edit to the login limit cannot silently drag signup down
 * with it again.
 */

const fs = require('fs');
const path = require('path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

describe('registration rate limit', () => {
    test('has its own config block, separate from auth', () => {
        expect(SERVER).toMatch(/register:\s*\{[\s\S]{0,400}?RATE_REGISTER_MAX/);
    });

    test('registerLimiter reads the register budget, not the auth one', () => {
        const block = SERVER.slice(SERVER.indexOf('const registerLimiter = rateLimit({'));
        const body = block.slice(0, block.indexOf('});'));
        expect(body).toContain('RATE_LIMIT_CONFIG.register.windowMs');
        expect(body).toContain('RATE_LIMIT_CONFIG.register.max');
        expect(body).not.toContain('RATE_LIMIT_CONFIG.auth.max');
    });

    test('the default is looser than the login limit', () => {
        const authMax = Number(/RATE_AUTH_MAX[\s\S]{0,80}?:\s*(\d+)/.exec(SERVER)[1]);
        const regMax = Number(/RATE_REGISTER_MAX[\s\S]{0,80}?:\s*(\d+)/.exec(SERVER)[1]);
        expect(regMax).toBeGreaterThan(authMax);
    });

    test('POST /register is still rate limited at all', () => {
        expect(SERVER).toMatch(/app\.post\("\/register",\s*registerLimiter/);
    });
});
