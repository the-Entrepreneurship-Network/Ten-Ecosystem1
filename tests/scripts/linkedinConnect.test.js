'use strict';

/**
 * The one-command way to put the token on the server.
 *
 * This script exists because the two easy ways to leak a LinkedIn access token
 * are pasting it into a chat window and putting it on a command line, where it
 * lands in shell history and in the process table for every other user on the
 * box. So it is typed into a hidden prompt instead, and these tests pin the
 * properties that make that true rather than the wording of the prompts:
 *
 *   - it refuses to read a piped secret, so nobody can "helpfully" turn it
 *     back into `echo $TOKEN | npm run linkedin:connect`;
 *   - it takes no token argument, so there is nothing to put on a command line;
 *   - it writes nothing until LinkedIn has confirmed the token works, so an
 *     abandoned or failed run leaves .env exactly as it was;
 *   - it rewrites only the two keys it owns and leaves the rest of .env —
 *     comments included — byte for byte.
 *
 * The last one matters more than it looks: a .env is hand-maintained and often
 * the only record of how a box is set up. A script that regenerates it from
 * parsed values quietly drops the comments that explain it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'linkedin-connect.js');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

describe('scripts/linkedin-connect.js', () => {
  it('refuses to run without an interactive terminal', () => {
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath, [SCRIPT], {
        input: 'a-token-that-is-long-enough-to-look-real-0123456789\n',
        encoding: 'utf8',
        timeout: 30000,
      });
    } catch (e) {
      code = e.status == null ? 1 : e.status;
      out = String(e.stdout || '');
    }
    expect(out).toMatch(/interactive terminal/i);
    expect(out).toMatch(/never piped/i);
    expect(code).toBe(1);
  });

  /*
   * If the token could be passed as an argument, somebody would — and then it
   * is in .bash_history and visible in `ps` to every other account on the
   * server for as long as the command runs.
   */
  it('takes no token from the command line at all', () => {
    expect(SOURCE).not.toMatch(/process\.argv\[\s*2\s*\]/);
    expect(SOURCE).not.toMatch(/argv.*token/i);
  });

  it('never echoes what is typed', () => {
    /* readline prints input by default; _writeToOutput is what stops it. */
    expect(SOURCE).toContain('_writeToOutput');
    expect(SOURCE).toMatch(/muted/);
  });

  it('never prints the token back out', () => {
    /* Every console line in the file, checked for anything that would
       interpolate the token variable into output. */
    const printed = SOURCE.match(/console\.log\([^\n]*\)/g) || [];
    printed.forEach((l) => {
      expect(l).not.toMatch(/\$\{\s*token\s*\}/);
      expect(l).not.toMatch(/,\s*token\s*[),]/);
    });
  });

  it('checks the token with LinkedIn before writing anything', () => {
    const probeAt = SOURCE.indexOf('client.probe()');
    const writeAt = SOURCE.indexOf('writeFileSync');
    expect(probeAt).toBeGreaterThan(0);
    expect(writeAt).toBeGreaterThan(probeAt);
  });

  it('locks the file down to the owner once it holds a credential', () => {
    expect(SOURCE).toMatch(/mode:\s*0o600/);
  });
});

/*
 * setEnv is the part that can quietly destroy a server's configuration, so it
 * is exercised directly rather than through the prompts.
 */
describe('writing into an existing .env', () => {
  /* Required, not re-evaluated from text: the script only prompts when it is
     the thing being run, so importing it is safe and gives the real function
     rather than a copy that can drift from it. */
  const { setEnv } = require('../../scripts/linkedin-connect');

  it('replaces a key that is already there, in place', () => {
    const out = setEnv(['A=1', 'LINKEDIN_ORG_ID=old', 'B=2'], 'LINKEDIN_ORG_ID', 'new');
    expect(out).toEqual(['A=1', 'LINKEDIN_ORG_ID=new', 'B=2']);
  });

  it('replaces a commented-out key rather than leaving two of them', () => {
    const out = setEnv(['# LINKEDIN_ORG_ID=', 'B=2'], 'LINKEDIN_ORG_ID', '123');
    expect(out).toEqual(['LINKEDIN_ORG_ID=123', 'B=2']);
    expect(out.filter((l) => l.indexOf('LINKEDIN_ORG_ID') >= 0)).toHaveLength(1);
  });

  it('appends a key that is missing, without eating the last line', () => {
    const out = setEnv(['A=1'], 'LINKEDIN_ORG_ID', '123');
    expect(out[0]).toBe('A=1');
    expect(out).toContain('LINKEDIN_ORG_ID=123');
  });

  /*
   * The property that matters most. Everything the script does not own has to
   * survive untouched — comments are often the only documentation a server's
   * configuration has.
   */
  it('leaves every other line exactly as it was', () => {
    const before = [
      '# Mail',
      'SMTP_HOST=smtp.example.com   # do not change',
      '',
      'MONGO_URI=mongodb://localhost/ten',
    ];
    const out = setEnv(before.slice(), 'LINKEDIN_ORG_ID', '123');
    before.forEach((line) => expect(out).toContain(line));
  });

  it('writes a file that dotenv reads back correctly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten-env-'));
    const file = path.join(dir, '.env');
    const lines = setEnv(['EXISTING=keep'], 'LINKEDIN_ORG_ID', '12345');
    setEnv(lines, 'LINKEDIN_ACCESS_TOKEN', 'AQX-not-a-real-token');
    fs.writeFileSync(file, lines.join('\n'));

    const parsed = require('dotenv').parse(fs.readFileSync(file));
    expect(parsed.EXISTING).toBe('keep');
    expect(parsed.LINKEDIN_ORG_ID).toBe('12345');
    expect(parsed.LINKEDIN_ACCESS_TOKEN).toBe('AQX-not-a-real-token');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
