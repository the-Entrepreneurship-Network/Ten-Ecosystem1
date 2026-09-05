'use strict';

/**
 * The server-side protections against the database staying down.
 *
 * The portal went down twice because mongod — running on the same EC2 box —
 * stopped and nothing restarted it. The application side already retries
 * forever (services/dbHealth.js); these two scripts are the half that lives
 * outside the process:
 *
 *   scripts/server/harden-mongod.sh   run once with sudo: enable-on-boot,
 *                                     Restart=always, swap, log rotation,
 *                                     the watchdog timer, pm2 startup
 *   scripts/server/watchdog.sh        every minute: start mongod if down,
 *                                     free disk at 90%, restart the app only
 *                                     if it is wedged
 *
 * There is no systemd in the test sandbox, so the watchdog is driven against
 * stub binaries that record what they were asked to do. That is the check
 * that matters: does it start mongod when mongod is down, and does it NOT
 * restart the app while the database is still down.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '../..');
const HARDEN = path.join(root, 'scripts/server/harden-mongod.sh');
const WATCHDOG = path.join(root, 'scripts/server/watchdog.sh');

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('both scripts parse', () => {
  it.each([HARDEN, WATCHDOG])('%s is valid bash', (file) => {
    const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('the hardening script is what installs the watchdog', () => {
    // If somebody renames one, the other must follow.
    expect(fs.readFileSync(HARDEN, 'utf8')).toContain('scripts/server/watchdog.sh');
  });
});

describe('harden-mongod.sh --check', () => {
  let tmp;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten-harden-'));
    fs.writeFileSync(path.join(tmp, 'server.js'), '');
    fs.writeFileSync(path.join(tmp, 'ecosystem.config.js'), '');
    fs.writeFileSync(path.join(tmp, '.env'),
      'MONGODB_URI=mongodb://tenuser:s3cr/et:pa@ss@db.internal:27017/ten_production?retryWrites=true\n'
      + 'PORT=5123\n');
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reports, changes nothing, and exits non-zero when protections are missing', () => {
    const r = spawnSync('bash', [HARDEN, '--check'], {
      encoding: 'utf8', env: { ...process.env, APP_DIR: tmp }
    });
    // No systemd here, so mongod is "not installed" and every protection is absent.
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('PROTECTIONS');
    expect(r.stdout).toMatch(/missing\. Install them with/);
    // It read the PORT line.
    expect(r.stdout).toContain('port: 5123');
  });

  it('never prints the database credentials', () => {
    /*
     * The host is useful during an outage; the password is the one thing this
     * output must never carry, because it is pasted into chat windows. The
     * password above contains / : and @ on purpose — the pattern that
     * extracts the host has to survive all three.
     */
    const r = spawnSync('bash', [HARDEN, '--check'], {
      encoding: 'utf8', env: { ...process.env, APP_DIR: tmp }
    });
    expect(r.stdout + r.stderr).toContain('db.internal:27017');
    expect(r.stdout + r.stderr).not.toContain('s3cr');
    expect(r.stdout + r.stderr).not.toContain('pa@ss');
    expect(r.stdout + r.stderr).not.toContain('tenuser');
  });

  it('refuses to install without root, but --check needs none', () => {
    const src = fs.readFileSync(HARDEN, 'utf8');
    expect(src).toContain('[ "$MODE" = apply ] && [ "$(id -u)" -ne 0 ]');
  });

  it('installs the four things that were missing on the server', () => {
    const src = fs.readFileSync(HARDEN, 'utf8');
    expect(src).toContain('systemctl enable mongod');
    expect(src).toContain('Restart=always');
    expect(src).toContain('StartLimitIntervalSec=0');
    expect(src).toContain('OOMScoreAdjust=-500');
    expect(src).toContain('pm2 install pm2-logrotate');
    expect(src).toContain('ten-watchdog.timer');
    expect(src).toContain('copytruncate');
  });
});

describe('watchdog.sh', () => {
  let tmp, bin, state, log;

  /** Stub binaries that record every call and answer from the environment. */
  function stub(name, body) {
    const f = path.join(bin, name);
    fs.writeFileSync(f, '#!/usr/bin/env bash\necho "' + name + ' $*" >> "$STUB_LOG"\n' + body + '\n');
    fs.chmodSync(f, 0o755);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten-watchdog-'));
    bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
    state = path.join(tmp, 'state');
    log = path.join(tmp, 'calls.log');

    stub('systemctl', `
case "$1" in
  cat)       [ "\${MONGOD_INSTALLED:-1}" = 1 ] && exit 0 || exit 1 ;;
  is-active) [ "\${MONGOD_ACTIVE:-1}" = 1 ] && exit 0 || exit 1 ;;
  show)      if [ "\${MONGOD_JUST_STARTED:-0}" = 1 ]; then awk '{print int($1*1000000)}' /proc/uptime; else echo 0; fi ;;
esac
exit 0`);
    stub('df', `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/xvda1 8000000 1 7000000 %s%% /\\n' "\${DISK_USED:-40}"`);
    stub('curl', `printf '{"connected":%s,"cause":null}' "\${APP_CONNECTED:-true}"`);
    stub('sudo', 'exit 0');
    stub('journalctl', 'exit 0');
    stub('find', 'exit 0');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function run(env) {
    fs.writeFileSync(log, '');
    const r = spawnSync('bash', [WATCHDOG], {
      encoding: 'utf8',
      env: {
        PATH: bin + ':' + process.env.PATH,
        STUB_LOG: log,
        TEN_PORTAL_CONF: '/nonexistent',
        TEN_WATCHDOG_STATE: state,
        ...env
      }
    });
    return { ...r, calls: fs.readFileSync(log, 'utf8') };
  }
  const counter = () => (fs.existsSync(path.join(state, 'app-disconnected'))
    ? fs.readFileSync(path.join(state, 'app-disconnected'), 'utf8').trim() : null);

  it('is silent when everything is fine', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    // A stub that mis-answers shows up here as a bash error, not as a pass.
    expect(r.stderr).toBe('');
    expect(r.calls).not.toContain('systemctl start');
    expect(r.calls).not.toContain('pm2');
  });

  it('starts mongod when it is not running', () => {
    // The whole outage, both times: mongod stopped and nothing started it.
    const r = run({ MONGOD_ACTIVE: '0' });
    expect(r.calls).toContain('systemctl start mongod');
    expect(r.stdout).toContain('mongod is not running');
    expect(r.stdout).toContain('mongod started');
  });

  it('does not touch the app while the database is still down', () => {
    // Restarting the app cannot help then, and would loop every minute.
    const r = run({ MONGOD_ACTIVE: '0', APP_CONNECTED: 'false' });
    expect(r.calls).not.toContain('pm2 restart');
    expect(counter()).toBeNull();
  });

  it('frees log space when the disk is nearly full', () => {
    const r = run({ DISK_USED: '95' });
    expect(r.stdout).toContain('disk is 95% full');
    expect(r.calls).toContain('sudo -n -u ec2-user -H bash -lc pm2 flush');
    expect(r.calls).toContain('journalctl --vacuum-size=100M');
    expect(r.calls).not.toContain('pm2 restart');
  });

  it('restarts the app only after it has been stuck for three checks', () => {
    /*
     * The database has been up for ages (ActiveEnterTimestampMonotonic=0) but
     * the app keeps answering "connected": false. One bad answer could be a
     * blip mid-reconnect; three in a row, a minute apart, is wedged.
     */
    let r = run({ APP_CONNECTED: 'false' });
    expect(r.calls).not.toContain('pm2 restart'); expect(counter()).toBe('1');
    r = run({ APP_CONNECTED: 'false' });
    expect(r.calls).not.toContain('pm2 restart'); expect(counter()).toBe('2');
    r = run({ APP_CONNECTED: 'false' });
    expect(r.calls).toContain('pm2 restart ten-portal-production --update-env');
    expect(r.stdout).toContain('said disconnected 3 times in a row');
    expect(counter()).toBe('0');
  });

  it('a healthy answer clears the count, so two blips a day never add up', () => {
    run({ APP_CONNECTED: 'false' });
    expect(counter()).toBe('1');
    run({ APP_CONNECTED: 'true' });
    expect(counter()).toBeNull();
  });

  it('gives a freshly started mongod two minutes before judging the app', () => {
    // Right after step 1 starts mongod, the app is mid-reconnect. Counting
    // those minutes would restart an app that was about to recover anyway.
    for (let i = 0; i < 3; i++) run({ MONGOD_JUST_STARTED: '1', APP_CONNECTED: 'false' });
    expect(counter()).toBeNull();
  });

  it('with no local mongod, still watches the app', () => {
    // A hosted database means nothing to start here, but a wedged app is
    // still a wedged app.
    for (let i = 0; i < 3; i++) run({ MONGOD_INSTALLED: '0', APP_CONNECTED: 'false' });
    const r = run({ MONGOD_INSTALLED: '0', APP_CONNECTED: 'false' });
    expect(fs.readFileSync(log, 'utf8')).not.toContain('systemctl start');
    expect(r.calls.includes('pm2 restart') || counter() === '1').toBe(true);
  });

  it('honours the port and app name from the conf file', () => {
    const conf = path.join(tmp, 'ten-portal.conf');
    fs.writeFileSync(conf, 'PORT=5001\nAPP_NAME=ten-portal-staging\nAPP_USER=deploy\n');
    for (let i = 0; i < 3; i++) run({ TEN_PORTAL_CONF: conf, APP_CONNECTED: 'false' });
    const calls = fs.readFileSync(log, 'utf8');
    expect(calls).toContain('127.0.0.1:5001/api/health/db');
    expect(calls).toContain('sudo -n -u deploy -H bash -lc pm2 restart ten-portal-staging');
  });
});

describe('the application side agrees with the scripts', () => {
  it('the "nothing is listening" advice now says to start mongod, not to look for Atlas', () => {
    /*
     * MONGODB_URI on this server is mongodb://localhost:27017/… and that is
     * correct: the database runs on the box. The old text told the operator
     * that a localhost address meant .env was missing "the real connection
     * string" and sent them to MongoDB Atlas — for a database that was simply
     * not running. That is the message on the banner during exactly this
     * outage, so it has to point at the fix.
     */
    const src = strip(read('services/dbHealth.js'));
    expect(src).not.toContain('missing the real connection string');
    expect(src).toContain('sudo systemctl start mongod');
    expect(src).toContain('scripts/server/harden-mongod.sh');
  });

  it('a mid-life connection error records its cause for the banner', () => {
    // The listener set a flag and logged; /api/health/db then had no `cause`
    // for a failure that happened after boot.
    const src = strip(read('server.js'));
    const at = src.indexOf("mongoose.connection.on('error'");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toContain('noteFailure(err, mongoUri)');
  });

  it('a deploy warns when the app comes up without its database', () => {
    const wf = read('.github/workflows/deploy-production.yml');
    expect(wf).toContain('/api/health/db');
    expect(wf).toContain('harden-mongod.sh --check');
  });
});
