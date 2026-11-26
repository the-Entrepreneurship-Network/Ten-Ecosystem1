'use strict';

/**
 * scripts/server/apply-nginx.sh: the deploy installs deploy/nginx/*.conf into
 * nginx's conf.d. The check that matters: a file nginx rejects never stays
 * behind, because it would stop nginx at its next restart. Driven against
 * stub binaries, since there is no nginx in the test sandbox.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '../../scripts/server/apply-nginx.sh');
const SETTINGS = path.join(__dirname, '../../deploy/nginx/upload-size.conf');
let tmp, bin, confd, log;

const stub = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\n' + body + '\n', { mode: 0o755 });
const run = (nginxOk) => spawnSync('bash', [SCRIPT, confd], {
    encoding: 'utf8',
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, STUB_LOG: log, NGINX_OK: nginxOk ? '1' : '0' }
});

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten-nginx-'));
    bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
    confd = path.join(tmp, 'conf.d'); fs.mkdirSync(confd);
    log = path.join(tmp, 'calls.log');
    fs.writeFileSync(path.join(confd, 'ten.conf'), 'server { }\n');
    stub('sudo', '[ "$1" = -n ] && shift; exec "$@"');
    stub('nginx', 'echo "nginx $*" >> "$STUB_LOG"; [ "$NGINX_OK" = 1 ]');
    stub('systemctl', 'echo "systemctl $*" >> "$STUB_LOG"');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('the settings are installed and nginx reloaded once its test passes', () => {
    const r = run(true);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(confd, 'upload-size.conf'), 'utf8')).toBe(fs.readFileSync(SETTINGS, 'utf8'));
    expect(fs.readFileSync(log, 'utf8')).toBe('nginx -t\nsystemctl reload nginx\n');
});

test('when nginx rejects them, conf.d is put back exactly as it was and nothing is reloaded', () => {
    const r = run(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error::');
    expect(fs.readdirSync(confd)).toEqual(['ten.conf']);
    expect(fs.readFileSync(path.join(confd, 'ten.conf'), 'utf8')).toBe('server { }\n');
    expect(fs.readFileSync(log, 'utf8')).not.toContain('systemctl');
});
