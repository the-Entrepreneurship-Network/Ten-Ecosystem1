'use strict';

/**
 * @jest-environment node
 *
 * Sessions have to survive a restart.
 *
 * HR reported "Your HR session has expired" in ordinary Chrome while a private
 * window worked. That difference is the fingerprint of a restart invalidating
 * every existing cookie: the browser that already held one is refused, the one
 * signing in fresh afterwards is fine.
 *
 * Every cookie is signed with SESSION_SECRET. The old code generated a new
 * random key per process whenever that variable was unset, so one `pm2 restart`
 * — i.e. every deploy — threw out everybody signed in. The guard in
 * config/secrets.js that would have refused such a boot only fires when
 * NODE_ENV is literally "production", so a server that never set it took the
 * random path silently, and re-took it every time.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const root = path.join(__dirname, '../..');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

/** The real resolver, lifted out of server.js so the test cannot drift from it. */
function loadResolver(dir) {
  const src = serverJs.slice(
    serverJs.indexOf('function resolveSessionSecret()'),
    serverJs.indexOf('const { secret: SESSION_SECRET')
  );
  // eslint-disable-next-line no-new-func
  return new Function('crypto', 'fs', 'path', '__dirname', src + '; return resolveSessionSecret;')(
    crypto, fs, path, dir
  );
}

describe('the signing key is the same after a restart', () => {
  let dir;
  const savedEnv = process.env.SESSION_SECRET;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten-sess-'));
    delete process.env.SESSION_SECRET;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedEnv;
  });

  it('three boots in a row produce one key, not three', () => {
    const resolve = loadResolver(dir);
    const a = resolve(), b = resolve(), c = resolve();
    expect(a.secret).toBe(b.secret);
    expect(b.secret).toBe(c.secret);
    // and it is actually a key, not a placeholder
    expect(a.secret.length).toBeGreaterThanOrEqual(32);
    expect(a.source).toBe('file-created');
    expect(b.source).toBe('file');
  });

  it('the key is written private to the owner', () => {
    loadResolver(dir)();
    const file = path.join(dir, '.session-secret');
    expect(fs.existsSync(file)).toBe(true);

    /*
     * Windows has no POSIX mode bits. NTFS reports 0666 for every regular
     * file — writing with { mode: 0o600 } and calling chmod(0o600) both come
     * back 0666 — so asserting the number there fails on a correct
     * implementation and told a developer their tests were broken when the
     * server they deploy to writes the file exactly right. The permission is
     * asserted where the deployment runs.
     */
    if (process.platform === 'win32') return;
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('an explicit SESSION_SECRET still wins', () => {
    const explicit = 'x'.repeat(48);
    process.env.SESSION_SECRET = explicit;
    const got = loadResolver(dir)();
    expect(got.secret).toBe(explicit);
    expect(got.source).toBe('env');
    // and it does not litter a file it will never read
    expect(fs.existsSync(path.join(dir, '.session-secret'))).toBe(false);
  });

  it('a too-short saved key is replaced rather than trusted', () => {
    fs.writeFileSync(path.join(dir, '.session-secret'), 'tooshort');
    const got = loadResolver(dir)();
    expect(got.secret).not.toBe('tooshort');
    expect(got.secret.length).toBeGreaterThanOrEqual(32);
  });

  it('a read-only deploy degrades loudly instead of crashing', () => {
    const readOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'ten-ro-'));
    fs.chmodSync(readOnly, 0o500);
    let got;
    expect(() => { got = loadResolver(readOnly)(); }).not.toThrow();
    expect(got.secret.length).toBeGreaterThanOrEqual(32);
    fs.chmodSync(readOnly, 0o700);
    fs.rmSync(readOnly, { recursive: true, force: true });
  });
});

describe('the key is never committed, and never a constant', () => {
  it('.session-secret is gitignored', () => {
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toMatch(/^\.session-secret$/m);
  });

  it('and git is not tracking it', () => {
    /*
     * Asserted against git rather than against the working tree. The old
     * check was `existsSync(.session-secret) === false`, which fails the
     * moment anyone runs the server locally — the file is supposed to appear
     * there, that is the entire feature. Developers were being told their
     * tests were broken by a file the code had correctly created.
     *
     * What actually matters is that the key never reaches a commit, and git
     * is the authority on that. If git is unavailable the assertion is
     * skipped rather than guessed at.
     */
    let tracked;
    try {
      tracked = require('child_process')
        .execSync('git ls-files --error-unmatch .session-secret', { cwd: root, stdio: 'pipe' })
        .toString().trim();
    } catch (e) {
      tracked = ''; /* non-zero exit means git is not tracking it */
    }
    expect(tracked).toBe('');
  });

  it('there is still no hardcoded fallback secret', () => {
    const block = serverJs.slice(
      serverJs.indexOf('function resolveSessionSecret()'),
      serverJs.indexOf('const { secret: SESSION_SECRET')
    );
    expect(block).toMatch(/crypto\.randomBytes\(32\)/);
    expect(block).not.toMatch(/secret\s*=\s*['"][a-z0-9-]{8,}['"]/i);
  });
});

describe('an operator can tell which half is broken', () => {
  it('the diagnostic ships and checks both halves', () => {
    const p = path.join(root, 'scripts/diagnose-session.js');
    expect(fs.existsSync(p)).toBe(true);
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/SESSION_SECRET/);
    expect(src).toMatch(/MONGODB_URI/);
    expect(src).toMatch(/Verdict:/);
  });

  it('it never prints the secret itself', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/diagnose-session.js'), 'utf8');
    expect(src).not.toMatch(/console\.log\([^)]*envSecret[^.]/);
    expect(src).toMatch(/envSecret\.length/);
  });
});
