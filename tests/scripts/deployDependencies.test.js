'use strict';

/**
 * A deploy reinstalls packages only when they changed.
 *
 * `npm ci` deletes node_modules and rebuilds it under the running app, and
 * whatever the app loads on first use fails while it does: on 26 Nov, mid
 * deploy, "[help desk] Cannot find module './types/ArraySubdocument'", and a
 * student's upload errored twice minutes after deploys. These run the real
 * step from the workflow in a throwaway git repo, with npm stubbed, so the
 * branch taken is observed rather than read off the YAML.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const WORKFLOW = fs.readFileSync(path.join(__dirname, '../../.github/workflows/deploy-production.yml'), 'utf8');

/** The dependency step exactly as the workflow has it, de-indented. */
function step() {
    const start = WORKFLOW.indexOf('            if [ ! -d node_modules ]');
    const end = WORKFLOW.indexOf('            fi', start) + '            fi'.length;
    expect(start).toBeGreaterThan(-1);
    return WORKFLOW.slice(start, end).split('\n').map((l) => l.replace(/^ {12}/, '')).join('\n');
}

function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-deps-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString().trim();
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3}\n');
    fs.writeFileSync(path.join(dir, 'server.js'), '// v1\n');
    git('add', '.');
    git('commit', '-qm', 'v1');
    // A stand-in npm that records being called.
    const bin = path.join(dir, '.bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "npm $*" >> "$NPM_LOG"\n', { mode: 0o755 });
    return { dir, git, bin, log: path.join(dir, 'npm.log') };
}

function deploy(r, change) {
    const old = r.git('rev-parse', 'HEAD');
    change();
    r.git('add', '.');
    r.git('commit', '-qm', 'next');
    const script = 'set -euo pipefail\nOLD_REV="' + old + '"\n' + step();
    execFileSync('bash', ['-c', script], {
        cwd: r.dir, stdio: 'pipe',
        env: { ...process.env, PATH: r.bin + ':' + process.env.PATH, NPM_LOG: r.log }
    });
    return fs.existsSync(r.log) ? fs.readFileSync(r.log, 'utf8') : '';
}

describe('deploy: npm ci only when the dependencies changed', () => {
    test('a code-only deploy keeps node_modules and does not reinstall', () => {
        const r = repo();
        fs.mkdirSync(path.join(r.dir, 'node_modules'));
        expect(deploy(r, () => fs.writeFileSync(path.join(r.dir, 'server.js'), '// v2\n'))).toBe('');
    });

    test('a changed lockfile reinstalls', () => {
        const r = repo();
        fs.mkdirSync(path.join(r.dir, 'node_modules'));
        const log = deploy(r, () => fs.writeFileSync(path.join(r.dir, 'package-lock.json'), '{"lockfileVersion":3,"x":1}\n'));
        expect(log).toContain('npm ci --legacy-peer-deps --omit=dev');
    });

    test('a changed package.json reinstalls', () => {
        const r = repo();
        fs.mkdirSync(path.join(r.dir, 'node_modules'));
        const log = deploy(r, () => fs.writeFileSync(path.join(r.dir, 'package.json'), '{"name":"x","version":"1.0.1"}\n'));
        expect(log).toContain('npm ci');
    });

    test('a server with no node_modules at all always installs', () => {
        const r = repo();
        expect(deploy(r, () => fs.writeFileSync(path.join(r.dir, 'server.js'), '// v2\n'))).toContain('npm ci');
    });

    test('the old revision is taken before the reset, not after', () => {
        expect(WORKFLOW.indexOf('OLD_REV="$(git rev-parse HEAD)"'))
            .toBeLessThan(WORKFLOW.indexOf('git reset --hard origin/main'));
    });
});
