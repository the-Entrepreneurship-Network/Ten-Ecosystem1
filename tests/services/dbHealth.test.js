'use strict';

const fs = require('fs');
const path = require('path');
const dbHealth = require('../../services/dbHealth');

const root = path.join(__dirname, '../..');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('why the database is not connected', () => {
  /*
   * Four realistic causes, four different fixes. The old handler printed one
   * warning for all of them — "Working in local runtime mode" — which names
   * nothing anybody can act on.
   */
  it.each([
    ['no MONGODB_URI at all',      new Error('whatever'), '',                    'no-uri'],
    ['a wrong password',           new Error('bad auth : authentication failed'), 'mongodb+srv://x', 'auth'],
    ['an IP that is not allowed',  new Error('Server at x is not allowed to connect'), 'mongodb+srv://x', 'ip-allowlist'],
    ['a hostname that will not resolve', new Error('querySrv ENOTFOUND _mongodb._tcp.x'), 'mongodb+srv://x', 'dns'],
    ['an address with nothing listening', new Error('connect ECONNREFUSED 127.0.0.1:27017'), 'mongodb://localhost:27017/internship', 'refused']
  ])('names %s', (_label, err, uri, id) => {
    const cause = dbHealth.diagnose(err, uri);
    expect(cause.id).toBe(id);
    expect(cause.fix).toBeTruthy();
  });

  it('names the failure that actually took the portal down', () => {
    /*
     * MONGODB_URI was missing from .env on the server and server.js defaulted to
     * mongodb://localhost:27017, so mongoose dialled a MongoDB nobody had ever
     * installed there. The error read `connect ECONNREFUSED 127.0.0.1:27017` —
     * which sounds like a database that is down, not like a missing line in a
     * config file. Nothing in the portal ever said the second thing.
     */
    const err = new Error('connect ECONNREFUSED 127.0.0.1:27017');
    err.name = 'MongooseServerSelectionError';   // how mongoose actually reports it
    const cause = dbHealth.diagnose(err, 'mongodb://localhost:27017/internship');
    expect(cause.id).toBe('refused');
    expect(cause.fix).toMatch(/MONGODB_URI/);
    expect(cause.fix).toMatch(/localhost/);
  });

  /*
   * REGRESSION. 'refused' was originally placed second in CAUSES, ahead of auth,
   * ip-allowlist and dns. ECONNREFUSED is a transport symptom that rides along
   * with more specific causes, and Array.find takes the first match — so it stole
   * them, and an operator chasing a DNS problem was told to start a local mongod.
   * It now sits last. These two cases are the ones that were actually wrong.
   */
  it('a blocked SRV lookup is a DNS fault, not a missing listener', () => {
    // Node's c-ares errors read "<syscall> <code> <hostname>", so a refused SRV
    // query literally contains ECONNREFUSED. server.js:3 repoints the resolver at
    // 8.8.8.8, which is the code path that makes this reachable in production.
    const err = new Error('querySrv ECONNREFUSED _mongodb._tcp.cluster0.abcde.mongodb.net');
    err.name = 'MongooseServerSelectionError';
    expect(dbHealth.diagnose(err, 'mongodb+srv://u:p@cluster0.abcde.mongodb.net/ten').id).toBe('dns');
  });

  it('a wrong password is a wrong password even when a replica node is also down', () => {
    // MongoSystemError takes its message from the FIRST server description
    // carrying an error, so one dead node puts ECONNREFUSED in front of the real
    // fault on the other two.
    const err = new Error('connect ECONNREFUSED 10.0.0.5:27017, bad auth : authentication failed');
    expect(dbHealth.diagnose(err, 'mongodb://u:p@a,b,c/ten').id).toBe('auth');
  });

  it('refused is the last cause, so it can only win when nothing else matched', () => {
    expect(dbHealth.CAUSES[dbHealth.CAUSES.length - 1].id).toBe('refused');
  });

  it('names a URI that is present but unusable', () => {
    // A stray newline or a comment on the .env line makes MONGODB_URI truthy and
    // unusable; this used to fall through to "the database refused the connection"
    // and send the operator to check the network.
    const cause = dbHealth.diagnose(
      new Error('Invalid scheme, expected connection string to start with "mongodb://"'),
      '\n mongodb+srv://x'
    );
    expect(cause.id).toBe('parse');
    expect(cause.fix).toMatch(/\.env/);
  });

  it('a missing URI is a missing URI, not a refused connection', () => {
    // With no URI at all the honest answer is "it is not set" — the ECONNREFUSED
    // that follows is a consequence, not the cause.
    expect(dbHealth.diagnose(new Error('connect ECONNREFUSED 127.0.0.1:27017'), '').id).toBe('no-uri');
  });

  it('stops retrying the one cause a retry can never fix', () => {
    // dotenv reads .env once, at boot. An unset MONGODB_URI stays unset for the
    // life of the process, so retrying forever only writes a connection error into
    // the log every minute — the log somebody is reading to find out what is wrong.
    const src = fs.readFileSync(path.join(root, 'services/dbHealth.js'), 'utf8');
    expect(strip(src)).toContain("if (cause.id === 'no-uri')");
    expect(strip(src)).toContain('stopped = true');
  });

  it('trims the URI so a stray newline in .env reads as unset, not as refused', () => {
    const server = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));
    expect(server).toContain('const mongoUri = (process.env.MONGODB_URI || "").trim()');
  });

  it('records the reason at boot, not five seconds later on the first retry', () => {
    // /api/health/db and the banner on every page read this, and they are asked
    // immediately. server.js used to write it as `status().cause = ...`, which
    // assigned to the throwaway object status() builds and did nothing at all.
    dbHealth.noteFailure(new Error('bad auth : authentication failed'), 'mongodb+srv://x');
    expect(dbHealth.status().cause).toMatch(/username or password/i);
    expect(dbHealth.status().fix).toMatch(/Database Access/);
  });

  it('still says something useful for a cause it does not recognise', () => {
    const cause = dbHealth.diagnose(new Error('kaboom'), 'mongodb://x');
    expect(cause.id).toBe('unknown');
    expect(cause.fix).toMatch(/MONGODB_URI/);
  });

  it('every cause carries a fix somebody can carry out', () => {
    dbHealth.CAUSES.forEach((c) => {
      expect(typeof c.summary).toBe('string');
      expect(c.fix.length).toBeGreaterThan(30);
    });
  });

  it('calls the disk low at 90 per cent and not at 89', () => {
    const spy = jest.spyOn(require('fs'), 'statfsSync');
    spy.mockReturnValue({ blocks: 100, bsize: 1, bavail: 10 });
    expect(dbHealth.diskHeadroom('/')).toMatchObject({ percentUsed: 90, low: true });
    spy.mockReturnValue({ blocks: 100, bsize: 1, bavail: 11 });
    expect(dbHealth.diskHeadroom('/')).toMatchObject({ percentUsed: 89, low: false });
    spy.mockRestore();
  });

  it('returns no number rather than throwing where statfs is unavailable', () => {
    // statfsSync needs Node 18.15+. The health endpoint must still answer.
    const spy = jest.spyOn(require('fs'), 'statfsSync').mockImplementation(() => {
      throw new Error('not implemented');
    });
    expect(dbHealth.diskHeadroom('/')).toBeNull();
    spy.mockRestore();
  });

  it('carries the disk number in the status the banner reads', () => {
    const s = dbHealth.status();
    expect(s).toHaveProperty('disk');
    if (s.disk) expect(typeof s.disk.percentUsed).toBe('number');
  });

  it('reports a status the banner and the health endpoint can both read', () => {
    const s = dbHealth.status();
    expect(s).toHaveProperty('connected');
    expect(s).toHaveProperty('cause');
    expect(s).toHaveProperty('fix');
    // Disconnected in this test process, so it must carry the warning text.
    expect(s.connected).toBe(false);
    expect(s.message).toMatch(/not connected/i);
  });
});

describe('a portal with no database says so', () => {
  const server = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));

  /*
   * THE BUG. mongoose.connect's failure was caught, logged as a warning, and
   * the process carried on. Every model fell through to the JSON engine, which
   * writes .data/local_db/db_<Model>.json — a file on one EC2 box, outside
   * every backup. Registrations kept succeeding, into that file, for days.
   */
  it('keeps trying instead of giving up after one attempt', () => {
    // The cause is almost always fixed in a console, not by a deploy: an
    // expired Atlas allowlist entry, a rotated password. Giving up leaves the
    // portal broken after the real problem is gone.
    expect(server).toContain('dbHealth.keepTrying(connectMongo, mongoUri)');
    expect(server).not.toContain('console.warn("MongoDB connection warning: Working in local runtime mode');
  });

  it('does not quietly point at a database on this server', () => {
    /*
     * `process.env.MONGODB_URI || "mongodb://localhost:27017/internship"`. A
     * missing line in .env became a connection attempt to a MongoDB that was
     * never installed on the box, and the portal reported it as a database
     * problem rather than a configuration one. There is no default now.
     */
    expect(server).toContain('const mongoUri = (process.env.MONGODB_URI || "").trim()');
    expect(server).not.toMatch(/MONGODB_URI\s*\|\|\s*["']mongodb:\/\/localhost/);
  });

  it('records why at boot rather than assigning to a throwaway object', () => {
    expect(server).toContain('dbHealth.noteFailure(err, mongoUri)');
    expect(server).not.toContain('dbHealth.status().cause =');
  });

  it('does not invent a student to fill the empty screen', () => {
    /*
     * getCollectionData used to write a "Scholar TEN" record the first time
     * db_Student.json was missing, so a portal with NO DATABASE looked like a
     * working portal with one student on it. HR opened All Students, saw a row,
     * and had no reason to think anything was wrong.
     */
    expect(server).not.toContain('firstName: "Scholar"');
    expect(server).not.toContain('TEN-STUDENT-001');
  });

  it('answers what is wrong without needing to authenticate anybody', () => {
    // It must answer when nothing can be read to authenticate anybody — that
    // is the state it exists to report.
    expect(server).toContain("app.get('/api/health/db'");
    expect(server).toContain('status.connected ? 200 : 503');
  });

  it('marks every response as real or fallback', () => {
    expect(server).toContain("res.set('X-TEN-Database', up ? 'connected' : 'fallback')");
  });

  it('the banner is on every page that shows or saves data', () => {
    const pages = ['student-dashboard', 'hr-portal', 'ten-admin', 'coordinator-dashboard',
                   'founder-os', 'investor-dashboard', 'contractor-dashboard', 'hr-ecosystem'];
    pages.forEach((p) => {
      const html = fs.readFileSync(path.join(root, 'public/' + p + '.html'), 'utf8');
      expect(html).toContain('/js/db-banner.js');
    });
  });

  it('the banner cannot be dismissed while the condition lasts', () => {
    // Comment-stripped: the file's own prose explains that it cannot be
    // dismissed, and matching on that would fail for saying so.
    const js = strip(fs.readFileSync(path.join(root, 'public/js/db-banner.js'), 'utf8'));
    expect(js).not.toMatch(/dismiss|localStorage\.setItem/);
    expect(js).toContain('setInterval(check');
  });

  it('a failed check does not itself claim the database is down', () => {
    // The network may be down for one request; crying wolf trains people to
    // ignore the banner that matters.
    const js = strip(fs.readFileSync(path.join(root, 'public/js/db-banner.js'), 'utf8'));
    const at = js.lastIndexOf('.catch(');
    expect(at).toBeGreaterThan(-1);
    expect(js.slice(at)).not.toContain('paint(');
  });

  it('says the disk is filling while the database is still up', () => {
    /*
     * The outage began here and nobody saw it. mongod aborted at 02:00 with
     * "Writing to log file failed" because the disk was full, and the first
     * anyone knew was a portal full of missing data the next morning. A number
     * on the screen the day before is the whole fix.
     */
    const js = strip(fs.readFileSync(path.join(root, 'public/js/db-banner.js'), 'utf8'));
    expect(js).toContain('d.disk && d.disk.low');
    expect(js).toContain('% full');
    expect(js).toContain('When it fills, the database stops.');
  });
});

describe('recovering what was captured offline', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/import-fallback-db.js'), 'utf8');

  it('registers every model a populate depends on', () => {
    /*
     * scripts/list-unverified-studio-access.js died on a live run with
     * "Schema hasn't been registered for model \"Student\"". Requiring Payment
     * is not enough: mongoose resolves a ref by NAME at query time, so the
     * referenced model has to have been loaded too.
     */
    const listing = fs.readFileSync(path.join(root, 'scripts/list-unverified-studio-access.js'), 'utf8');
    const at = listing.indexOf(".populate('studentId'");
    expect(at).toBeGreaterThan(-1);
    expect(listing.slice(0, at)).toContain("require('../models/Student')");
  });

  it('writes nothing without --write', () => {
    expect(script).toContain("const write = process.argv.includes('--write')");
    expect(script).toContain('Dry run');
  });

  it('never overwrites a row the database already has', () => {
    // The database is the authority. A file written during an outage must not
    // roll back something saved after it.
    expect(script).toContain('const exists = await Model.exists(filter)');
    expect(script).toContain('if (!exists) missing.push(doc)');
    expect(script).not.toContain('findOneAndUpdate');
    expect(script).not.toContain('upsert');
  });

  it('looks in both model directories', () => {
    /*
     * Models live in models/ AND models/new/. Looking only in models/ made a
     * real import silently skip seven collections, including 260 rows of
     * StudentTaskProgress — a student's entire task history — reported as
     * "no models/StudentTaskProgress.js, skipped".
     */
    expect(script).toContain("for (const dir of ['models', 'models/new'])");
  });

  it('knows the key each collection is actually unique on', () => {
    /*
     * Matching on _id alone declared rows "missing" that were already in the
     * database under a different _id, and the insert then bounced off the real
     * unique index. A live run produced 26 of these on BadgeAward alone.
     */
    const fs2 = require('fs');
    [
      ['BadgeAward',          ['employeeId', 'badgeId']],
      ['StudentTaskProgress', ['studentId', 'taskId']],
      ['StudentCoin',         ['studentId']],
      ['TalentProfile',       ['userId']]
    ].forEach(([model, keys]) => {
      expect(script).toMatch(new RegExp(model + ':\\s*\\[' + keys.map((k) => "'" + k + "'").join(', ')));
      // And the key is the one the schema really enforces.
      const file = ['models/' + model + '.js', 'models/new/' + model + '.js']
        .map((f) => path.join(root, f)).find((f) => fs2.existsSync(f));
      expect(file).toBeTruthy();
      const schema = fs2.readFileSync(file, 'utf8');
      keys.forEach((k) => expect(schema).toContain(k));
    });
  });

  it('treats a duplicate-key rejection as proof the row is already there', () => {
    // E11000 means a unique index refused it, which is the database telling us
    // the row exists. Counting that as a failure made a clean run look broken.
    expect(script).toContain('if (e.code === 11000)');
    expect(script).toContain('already++');
  });

  it('matches on a natural key, not only on _id', () => {
    // The JSON engine minted its own ids, so the same student can exist under
    // two of them and _id alone would import a duplicate.
    expect(script).toContain("Student:            ['employeeId', 'email']");
    expect(script).toContain('delete clean._id');
  });
});

describe('a page the server was deployed under reloads itself', () => {
  const server = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));
  const guard = fs.readFileSync(path.join(root, 'public/js/build-guard.js'), 'utf8');

  /*
   * The attendance card printed an old sentence around a new number: "you need
   * 20 of them … Attend 48 more". 20 was the page's arithmetic, 48 the
   * server's. Both right alone, nonsense together, because the page predated
   * the deploy and the reply did not.
   */
  it('stamps every response with the build', () => {
    expect(server).toContain("res.set('X-TEN-Build', BUILD_ID)");
  });

  it('the build is the same in every worker', () => {
    // PM2 can run several. A per-process value (boot time) would make them
    // disagree and bounce a page between them forever.
    expect(server).toContain('const st = require(\'fs\').statSync(__filename)');
    expect(server).not.toMatch(/BUILD_ID\s*=\s*Date\.now/);
  });

  it('reloads once per build, not in a loop', () => {
    expect(guard).toContain("sessionStorage");
    expect(guard).toContain('window.location.reload()');
    expect(guard).toContain("write('localStorage', SEEN, build)");
  });

  it('does not reload on the very first page a browser ever loads', () => {
    // Nothing to compare against yet; reloading would be a pointless flash.
    expect(guard).toContain("if (!previous) { write('localStorage', SEEN, build); return; }");
  });
});

describe('the number and its explanation travel together', () => {
  const api = strip(fs.readFileSync(path.join(root, 'routes/v2/studentPortal.js'), 'utf8'));
  const page = strip(fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8'));

  it('the server writes the sentence', () => {
    expect(api).toContain('message: say');
    expect(api).toContain('Attend ${summary.stillNeedsByEnd} more of the ${summary.workingDaysRemaining}');
  });

  it('the page prints it rather than composing its own', () => {
    expect(page).toContain('if (p.message) {');
  });
});
