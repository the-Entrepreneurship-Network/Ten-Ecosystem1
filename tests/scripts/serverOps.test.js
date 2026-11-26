'use strict';

/**
 * scripts/server/ops.sh, run by the "Server ops" workflow so the bug agent can
 * act on the production server without a login. What must hold: only the
 * fixed menu runs, and the app's logs (students' data) are emailed, never
 * printed into the workflow's public log.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '../..');
const OPS = path.join(root, 'scripts/server/ops.sh');
let tmp, bin, captured;

const stub = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\n' + body + '\n', { mode: 0o755 });
const run = (...args) => spawnSync('bash', [OPS, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, CAPTURED: captured }
});

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten-ops-'));
    bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
    captured = path.join(tmp, 'mailed.txt');
    stub('pm2', 'echo "POST /submit-task 500 for asha@gmail.com TEN/WEB/1001"');
    stub('node', 'cat > "$CAPTURED"; echo "Emailed to the team inbox."');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('logs are emailed to the team, never printed into the public job log', () => {
    const r = run('logs');
    expect(r.status).toBe(0);
    expect(fs.readFileSync(captured, 'utf8')).toContain('asha@gmail.com');
    expect(r.stdout + r.stderr).not.toContain('asha@gmail.com');
    expect(r.stdout).toContain('Emailed to the team inbox.');
});

test('only the menu runs: anything else is refused', () => {
    const r = run('rm -rf /');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Usage: ops.sh status|logs|restart|nginx');
    expect(fs.existsSync(captured)).toBe(false);
});

test('the workflow hands the choice over as data, never pasted into the script', () => {
    const wf = fs.readFileSync(path.join(root, '.github/workflows/server-ops.yml'), 'utf8');
    expect(wf).toContain('bash scripts/server/ops.sh "$OPS_ACTION"');
    expect(wf.split('script: |')[1]).not.toContain('${{');
    expect(spawnSync('bash', ['-n', OPS]).status).toBe(0);
});

/*
 * The live self-test names students (accounts with no internship record), so
 * like the logs it is emailed, and only the pass/fail count reaches the
 * public job log.
 */
test('the self-test report is emailed; the job log gets only the count', () => {
    stub('node', [
        'if [ "$1" = "scripts/server/selftest.js" ]; then',
        '  echo "PASS  half-made student accounts: 1 of 9 — ravi.k@gmail.com"',
        '  echo "self-test: 9 passed, 0 failed" >&2',
        'else cat > "$CAPTURED"; echo "Emailed to the team inbox."; fi'
    ].join('\n'));
    const r = run('selftest');
    expect(r.status).toBe(0);
    expect(fs.readFileSync(captured, 'utf8')).toContain('ravi.k@gmail.com');
    expect(r.stdout + r.stderr).not.toContain('ravi.k@gmail.com');
    expect(r.stderr).toContain('self-test: 9 passed, 0 failed');
    expect(fs.readFileSync(path.join(root, '.github/workflows/server-ops.yml'), 'utf8'))
        .toContain('options: [status, logs, restart, nginx, selftest]');
});
