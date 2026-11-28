'use strict';

/**
 * @jest-environment node
 *
 * The AI pre-check of a submission (services/submissionPrecheck.js).
 *
 * Link checks run against a real HTTP server on this machine. The server's
 * address guard would refuse it — it is localhost, which is the point of the
 * guard — so those tests give the check their own lookup; one test runs the
 * real guard and shows it refusing.
 */

const http = require('http');

const mockSubs = new Map();
const mockNotes = [];
const mockGemini = { ready: false, ask: jest.fn() };

jest.mock('mongoose', () => ({
    model: () => ({
        findById: (id) => ({ lean: async () => (mockSubs.has(String(id)) ? Object.assign({}, mockSubs.get(String(id))) : null) }),
        updateOne: async (filter, update) => {
            const row = mockSubs.get(String(filter._id));
            if (!row || row.reviewedOnce) return { modifiedCount: 0 };
            Object.assign(row, update.$set);
            return { modifiedCount: 1 };
        }
    })
}));
jest.mock('../../utils/gemini', () => ({
    ready: () => mockGemini.ready,
    ask: (...a) => mockGemini.ask(...a),
    Type: { OBJECT: 'OBJECT', STRING: 'STRING' }
}));
jest.mock('../../models/new/DomainTask', () => ({
    findOne: () => ({ select: () => ({ lean: () => ({ catch: () => Promise.resolve({ taskDescription: 'Build a responsive landing page with HTML and CSS.' }) }) }) })
}));
jest.mock('../../models/Notification', () => function Note(doc) {
    Object.assign(this, doc);
    this.$locals = {};
    this.save = async () => { mockNotes.push(this); return this; };
});
const mockEngine = { name: 'gemini' };
jest.mock('../../services/aiCoordinator', () => ({
    SENDER: 'TEN Coordinator Team',
    scrub: (s) => String(s).replace(/\b[6-9]\d{9}\b/g, '[phone]'),
    // The admin portal's choice of AI (tested in aiCoordinator.test.js): Gemini here unless a test says otherwise.
    reviewerReady: () => mockGemini.ready,
    askReviewer: async (prompt, schema) => (mockGemini.ready ? { out: await mockGemini.ask(prompt, schema), engine: mockEngine.name } : null)
}));
const mockLogs = [];
jest.mock('../../models/AiCoordinatorLog', () => ({ create: async (row) => { mockLogs.push(row); return row; } }));
const mockReviewOne = jest.fn(async () => false);
jest.mock('../../services/aiCoordinatorJobs', () => ({ reviewOne: (...a) => mockReviewOne(...a) }));
const mockFetch = jest.fn();
jest.mock('../../services/v2/httpFetch', () => ({ httpFetch: (...a) => mockFetch(...a) }));

const precheck = require('../../services/submissionPrecheck');

describe('which addresses the server will open', () => {
    it.each(['127.0.0.1', '10.0.0.5', '172.16.4.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0',
        '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])('%s is refused', (ip) => {
        expect(precheck.isPublicAddress(ip)).toBe(false);
    });
    it.each(['8.8.8.8', '140.82.112.3', '2606:4700::1111'])('%s is allowed', (ip) => {
        expect(precheck.isPublicAddress(ip)).toBe(true);
    });
});

describe('reading the link', () => {
    it('finds GitHub repositories and profiles', () => {
        expect(precheck.parseGitHub('https://github.com/priya/landing-page.git')).toEqual({ owner: 'priya', repo: 'landing-page' });
        expect(precheck.parseGitHub('github.com/priya/landing-page/tree/main/src')).toEqual({ owner: 'priya', repo: 'landing-page' });
        expect(precheck.parseGitHub('https://github.com/priya')).toEqual({ owner: 'priya' });
        expect(precheck.parseGitHub('https://gitlab.com/priya/x')).toBeNull();
    });
    it('takes the first address from the link box or the note, including a bare site name', () => {
        expect(precheck.firstUrl('', 'my work: https://priya.netlify.app/. thanks')).toBe('https://priya.netlify.app/');
        expect(precheck.firstUrl('priya.netlify.app')).toBe('https://priya.netlify.app');
        expect(precheck.firstUrl('done', 'see attached')).toBe('');
    });
});

describe('opening the link', () => {
    let server;
    let port;
    const lookup = (host, opts, cb) => (opts && opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4));
    const at = (p, host = 'site.test') => `http://${host}:${port}${p}`;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/ok') { res.writeHead(200); return res.end('hello'); }
            if (req.url === '/moved') { res.writeHead(302, { Location: '/ok' }); return res.end(); }
            if (req.url === '/private') { res.writeHead(302, { Location: 'https://accounts.google.com/ServiceLogin?continue=x' }); return res.end(); }
            if (req.url === '/inside') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
            if (req.url === '/locked') { res.writeHead(403); return res.end(); }
            if (req.url === '/busy') { res.writeHead(503); return res.end(); }
            res.writeHead(404); return res.end();
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        port = server.address().port;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    const check = (url) => precheck.checkLink(url, { lookup, anyPort: true, timeoutMs: 3000 });

    it('a page that opens', async () => {
        expect(await check(at('/ok'))).toMatchObject({ verdict: 'opens', status: 200 });
    });
    it('follows a redirect to where it lands', async () => {
        expect(await check(at('/moved'))).toMatchObject({ verdict: 'opens', url: at('/ok') });
    });
    it('a page that is not there', async () => {
        expect(await check(at('/gone'))).toMatchObject({ verdict: 'broken', status: 404 });
    });
    it('a file shared only with its owner: Google asks the reader to sign in', async () => {
        expect((await check(at('/private'))).verdict).toBe('login');
    });
    it('a page behind a sign-in', async () => {
        expect((await check(at('/locked'))).verdict).toBe('login');
    });
    it('a site that is down is not called broken', async () => {
        expect((await check(at('/busy'))).verdict).toBe('down');
    });
    it('a redirect into the server\'s own network is refused', async () => {
        expect(await check(at('/inside'))).toMatchObject({ verdict: 'broken', error: 'points inside a private network' });
    });
    it('with the real guard, localhost is refused outright', async () => {
        expect(await precheck.checkLink(`http://localhost:${port}/ok`, { anyPort: true })).toMatchObject({ verdict: 'broken', error: 'points inside a private network' });
        expect(await precheck.checkLink(`http://127.0.0.1:${port}/ok`, { anyPort: true })).toMatchObject({ verdict: 'broken', error: 'points inside a private network' });
    });
    it('an address that does not exist reads as a sentence the student can act on', async () => {
        const missing = (host, opts, cb) => cb(Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND' }));
        const link = await precheck.checkLink('https://no-such-site.example.in/', { lookup: missing });
        expect(link).toMatchObject({ verdict: 'broken', error: 'points to an address that does not exist' });
        expect(precheck._internal.problemsOf({ link, github: null, repo: null, screenshot: { expected: false } }))
            .toEqual(['The link does not open: it points to an address that does not exist.']);
    });

    it('an unusual port is not opened', async () => {
        expect(await precheck.checkLink('http://example.com:8080/')).toMatchObject({ verdict: 'broken', error: 'uses an unusual port' });
    });
});

describe('checking a submission', () => {
    const real = { checkLink: precheck.checkLink, githubRepo: precheck.githubRepo };
    beforeEach(() => {
        mockSubs.clear();
        mockNotes.length = 0;
        mockLogs.length = 0;
        mockReviewOne.mockClear();
        mockReviewOne.mockImplementation(async () => false);
        mockGemini.ready = false;
        mockGemini.ask.mockReset();
    });
    afterEach(() => Object.assign(precheck, real));

    const add = (id, row) => mockSubs.set(id, Object.assign({ _id: id, employeeId: 'TEN/WEB/1005', domain: 'Web Development', task: 'Week 1: Landing page', status: 'Pending', reviewedOnce: false, feedback: 'No Feedback Yet' }, row));

    it('a private repository and no screenshot: both said, the student told in the portal only, nothing approved', async () => {
        precheck.checkLink = async () => ({ url: 'https://github.com/priya/landing', verdict: 'broken', status: 404, error: 'is not there (404)' });
        precheck.githubRepo = async () => ({ public: false });
        add('s1', { githubLink: 'https://github.com/priya/landing', note: 'done' });
        const c = await precheck.run('s1');
        expect(c.problems).toEqual([
            'The link does not open: it is not there (404).',
            'The GitHub repository is private or does not exist. Make it public.',
            'No screenshot is attached.'
        ]);
        expect(c).toMatchObject({ decision: 'changes', by: 'rules', match: 'unclear' });
        expect(c.draft).toContain('Before it can be approved');
        const row = mockSubs.get('s1');
        expect(row.status).toBe('Pending');
        expect(row.feedback).toBe('No Feedback Yet');
        expect(row.aiCheck).toBe(c);
        expect(mockNotes).toHaveLength(1);
        expect(mockNotes[0]).toMatchObject({ targetType: 'student', targetEmployeeId: 'TEN/WEB/1005', from: 'TEN Coordinator Team' });
        expect(mockNotes[0].message).not.toMatch(/\bAI\b|will (check|review|message)/i);
        expect(mockNotes[0].$locals.skipEmail).toBe(true);
        // Logged for the daily report.
        expect(mockLogs).toEqual([expect.objectContaining({
            kind: 'precheck', employeeId: 'TEN/WEB/1005', domain: 'Web Development', question: 'Week 1: Landing page',
            source: 'changes', reason: 'rules'
        })]);
        expect(mockLogs[0].reply).toContain('Make it public.');
    });

    it('a good submission with Gemini: its match and draft are kept, and nobody is notified', async () => {
        precheck.checkLink = async () => ({ url: 'https://priya.netlify.app', verdict: 'opens', status: 200 });
        mockGemini.ready = true;
        mockGemini.ask.mockResolvedValue({ match: 'yes', reason: 'A landing page in HTML and CSS.', draft: 'Clean, responsive page. Next time add alt text to images.', decision: 'approve' });
        add('s2', { githubLink: 'priya.netlify.app', note: 'call me on 9876543210', image: '/uploads/does-not-matter' });
        const c = await precheck.run('s2', { screenshotExpected: false });
        expect(c).toMatchObject({ match: 'yes', decision: 'approve', by: 'ai', problems: [] });
        expect(c.draft).toBe('Clean, responsive page. Next time add alt text to images.');
        const prompt = mockGemini.ask.mock.calls[0][0];
        expect(prompt).toContain('Build a responsive landing page with HTML and CSS.');
        expect(prompt).toContain('The link opens for anyone.');
        expect(prompt).not.toContain('9876543210');
        expect(mockNotes).toHaveLength(0);
    });

    it('Gemini cannot turn a failed check into "approve"', async () => {
        precheck.checkLink = async () => ({ url: 'https://drive.google.com/file/x', verdict: 'login', status: 200 });
        mockGemini.ready = true;
        mockGemini.ask.mockResolvedValue({ match: 'yes', reason: 'ok', draft: 'Looks great!', decision: 'approve' });
        add('s3', { githubLink: 'https://drive.google.com/file/x' });
        const c = await precheck.run('s3', { screenshotExpected: false });
        expect(c.decision).toBe('changes');
        expect(c.problems[0]).toMatch(/asks for a sign-in/);
        // Nor say it matches the task: nobody could open the work.
        expect(c.match).toBe('unclear');
        expect(c.reason).toBe('The work could not be opened, so it was not compared with the task.');
        // Its "Looks great!" is not left in the coordinator's feedback box.
        expect(c.draft).toContain('Before it can be approved: The link asks for a sign-in');
    });

    it('a reviewed submission is left alone, and a re-check does not notify the student again', async () => {
        precheck.checkLink = async () => ({ verdict: 'missing' });
        add('s4', { githubLink: '', reviewedOnce: true });
        expect(await precheck.run('s4')).toBeNull();
        expect(mockLogs).toHaveLength(0);
        add('s5', { githubLink: '' });
        await precheck.run('s5', { screenshotExpected: false, notify: false });
        expect(mockSubs.get('s5').aiCheck.problems).toEqual(['There is no link to the work.']);
        expect(mockNotes).toHaveLength(0);
    });

    it('a student\'s hand-in is handed to the AI Coordinator for its decision; decided, the student hears that instead', async () => {
        precheck.checkLink = async () => ({ verdict: 'missing' });
        add('s7', { githubLink: '' });
        mockReviewOne.mockImplementation(async () => true);
        const c = await precheck.run('s7', { review: true });
        expect(mockReviewOne).toHaveBeenCalledWith('s7', c);
        expect(mockNotes).toHaveLength(0);

        // Not a clear case: the pre-check's own notice goes out as before.
        add('s8', { githubLink: '' });
        mockReviewOne.mockImplementation(async () => false);
        await precheck.run('s8', { review: true });
        expect(mockNotes).toHaveLength(1);

        // A coordinator's re-check never asks for a decision.
        add('s9', { githubLink: '' });
        await precheck.run('s9', { notify: false });
        expect(mockReviewOne).toHaveBeenCalledTimes(2);
    });

    it('the feedback is the review itself: a promise of a later check or message is taken out', async () => {
        precheck.checkLink = async () => ({ url: 'https://priya.netlify.app', verdict: 'opens', status: 200 });
        mockGemini.ready = true;
        mockEngine.name = 'claude';
        mockGemini.ask.mockResolvedValue({ match: 'yes', reason: 'ok', decision: 'approve',
            draft: "Thanks for the landing page! I'll go through your GitHub link and check it from my side. " +
                'Your index.html is clean and the layout holds on a phone. I will send you a message once I am done.' });
        add('p1', { githubLink: 'priya.netlify.app' });
        const c = await precheck.run('p1', { screenshotExpected: false });
        mockEngine.name = 'gemini';
        expect(c.draft).toBe('Thanks for the landing page! Your index.html is clean and the layout holds on a phone.');
        const prompt = mockGemini.ask.mock.calls[0][0];
        expect(prompt).toContain('no other message follows it');
        expect(prompt).toContain('never claim to be a person');
        // Which AI wrote it is kept, and logged: Claude's reviews count towards the month's limit.
        expect(c.engine).toBe('claude');
        expect(mockLogs[0]).toMatchObject({ kind: 'precheck', engine: 'claude' });
    });

    it('an answer that is only promises, or calls the work "not this task" while approving it, waits for a person', async () => {
        precheck.checkLink = async () => ({ url: 'https://priya.netlify.app', verdict: 'opens', status: 200 });
        mockGemini.ready = true;
        mockGemini.ask
            .mockResolvedValueOnce({ match: 'yes', decision: 'approve', draft: "I'll review it from my side and get back to you." })
            .mockResolvedValueOnce({ match: 'no', decision: 'approve', draft: 'Great work on this page.' });
        add('p2', { githubLink: 'priya.netlify.app' });
        add('p3', { githubLink: 'priya.netlify.app' });
        expect(await precheck.run('p2', { screenshotExpected: false })).toMatchObject({ by: 'rules' });
        expect(await precheck.run('p3', { screenshotExpected: false })).toMatchObject({ by: 'rules' });
    });

    it('switched off, it does nothing', async () => {
        process.env.AI_COORDINATOR = 'off';
        add('s6', { githubLink: 'x' });
        expect(await precheck.run('s6')).toBeNull();
        delete process.env.AI_COORDINATOR;
    });
});

describe('the feedback promises nothing', () => {
    const { withoutPromises } = precheck._internal;
    it.each([
        "I'll check it from my side.",
        'I will go through your GitHub link and confirm.',
        'We will review it and get back to you.',
        "I'm checking the repository now.",
        'You will hear from us soon.',
        'Your work will be reviewed shortly.',
        'Stay tuned!'
    ])('drops "%s"', (said) => expect(withoutPromises('Good page. ' + said)).toBe('Good page.'));

    it('keeps advice, file names and the ask to submit again', () => {
        const t = 'The form in contact.html posts nowhere yet. Wire it to a backend, then submit it again. You will need a README too.';
        expect(withoutPromises(t)).toBe(t);
        expect(withoutPromises('')).toBe('');
    });
});

describe('GitHub', () => {
    const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => String(body) });
    afterEach(() => { mockFetch.mockReset(); delete process.env.GITHUB_TOKEN; });

    it('reads a public repository: name, language, top-level files and the README', async () => {
        mockFetch.mockImplementation(async (url) => (
            /\/contents$/.test(url) ? reply(200, [{ name: 'index.html', type: 'file' }, { name: 'css', type: 'dir' }])
                : /raw\.githubusercontent/.test(url) ? reply(200, '# My landing page')
                    : reply(200, { full_name: 'priya/landing', private: false, language: 'HTML', default_branch: 'main', size: 12 })));
        const r = await precheck.githubRepo({ owner: 'priya', repo: 'landing' });
        expect(r).toMatchObject({ public: true, fullName: 'priya/landing', language: 'HTML', files: ['index.html', 'css/'], readme: '# My landing page' });
    });

    it('a private or missing repository reads as not public', async () => {
        mockFetch.mockResolvedValue(reply(404, {}));
        expect(await precheck.githubRepo({ owner: 'priya', repo: 'secret' })).toEqual({ public: false });
    });

    it('a refused GITHUB_TOKEN does not stop the check: it asks again without it', async () => {
        process.env.GITHUB_TOKEN = 'expired';
        mockFetch.mockImplementation(async (url, opts) => (opts.headers.Authorization ? reply(401, {})
            : /\/contents$|raw\./.test(url) ? reply(404, '') : reply(200, { full_name: 'priya/landing', private: false, size: 3 })));
        const r = await precheck.githubRepo({ owner: 'priya', repo: 'landing' });
        expect(r.public).toBe(true);
        expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer expired');
        expect(mockFetch.mock.calls[1][1].headers.Authorization).toBeUndefined();
    });

    it('a repository pushed minutes ago, whose size GitHub still says is 0, is not called empty', async () => {
        mockFetch.mockImplementation(async (url) => (
            /\/contents$/.test(url) ? reply(200, [{ name: 'index.html', type: 'file' }, { name: 'package.json', type: 'file' }])
                : /raw\.githubusercontent/.test(url) ? reply(404, '')
                    : reply(200, { full_name: 'priya/landing', private: false, default_branch: 'main', size: 0 })));
        const r = await precheck.githubRepo({ owner: 'priya', repo: 'landing' });
        expect(r).toMatchObject({ public: true, empty: false, files: ['index.html', 'package.json'] });
        expect(r.filesUnread).toBeUndefined();
    });

    it('a repository with no commits at all is empty', async () => {
        mockFetch.mockImplementation(async (url) => (
            /\/contents$/.test(url) ? reply(404, { message: 'This repository is empty.' })
                : /raw\.githubusercontent/.test(url) ? reply(404, '')
                    : reply(200, { full_name: 'priya/landing', private: false, size: 0 })));
        expect(await precheck.githubRepo({ owner: 'priya', repo: 'landing' })).toMatchObject({ public: true, empty: true });
    });

    it('a file list GitHub would not give (its hourly limit) is "not read", never "empty"', async () => {
        mockFetch.mockImplementation(async (url) => (
            /\/contents$/.test(url) ? reply(403, {})
                : /raw\.githubusercontent/.test(url) ? reply(404, '')
                    : reply(200, { full_name: 'priya/landing', private: false, size: 0 })));
        const r = await precheck.githubRepo({ owner: 'priya', repo: 'landing' });
        expect(r).toMatchObject({ public: true, empty: false, filesUnread: true, files: [] });
    });

    it("over GitHub's hourly limit, the repository is reported as not checked, not as private", async () => {
        mockFetch.mockResolvedValue(reply(403, {}));
        expect(await precheck.githubRepo({ owner: 'priya', repo: 'landing' })).toEqual({ unknown: "GitHub's hourly limit was reached" });
    });
});
