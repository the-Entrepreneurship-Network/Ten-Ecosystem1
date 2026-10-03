'use strict';

/**
 * The queue bookkeeping must never stall the crawl.
 *
 * The crawl awaits two database writes per college: rememberSites() for the
 * links a page gave up, and markVisited() to take the college off the queue.
 * Mongoose does not fail fast when it has no connection — it BUFFERS the
 * command and only rejects ten seconds later. A caught rejection is harmless;
 * the ten-second wait is not. It is paid per call, inside the loop.
 *
 * CI caught this the honest way: every runBulk test in collegeAgent.test.js
 * timed out at once, because five colleges became more than a minute of
 * waiting on a database that suite never connected to. The sandbox hid it,
 * since require('mongoose') simply throws there.
 *
 * So each of these tests hands the module a mongoose that is INSTALLED but
 * DISCONNECTED, and a model whose write never settles. They pass only while
 * the bookkeeping checks the connection before issuing the command: delete
 * any one `if (!dbReady())` and that test hangs until Jest kills it.
 */

/**
 * Load a fresh copy of the module with 'mongoose' reporting `readyState` and
 * the CollegeSite model answering every command with a promise that never
 * settles, the way a buffered one behaves until it rejects. doMock is used
 * rather than mock because it is not hoisted, so each test picks its own state.
 */
function load(readyState) {
    jest.resetModules();
    const writes = [];
    const hang = () => new Promise(() => {});
    jest.doMock('mongoose', () => ({ connection: { readyState } }), { virtual: true });
    jest.doMock('../../models/CollegeSite', () => ({
        updateOne: (...a) => { writes.push(['updateOne', a]); return hang(); },
        bulkWrite: (...a) => { writes.push(['bulkWrite', a]); return hang(); },
        countDocuments: (...a) => { writes.push(['countDocuments', a]); return hang(); },
        find: () => { writes.push(['find', []]); return { sort: () => ({ limit: () => ({ lean: hang }) }) }; },
    }), { virtual: true });
    return { discovery: require('../../services/collegeDiscovery'), writes };
}

afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

describe('with mongoose installed but not connected', () => {
    test('markVisited returns at once instead of waiting out the buffer', async () => {
        const { discovery, writes } = load(0);
        await discovery.markVisited('nitk.ac.in', 4, true);
        expect(writes).toEqual([]);                      // nothing was even issued
    });

    test('rememberSites returns at once and reports nothing stored', async () => {
        const { discovery, writes } = load(0);
        await expect(discovery.rememberSites(['vtu.ac.in'], 'https://nitk.ac.in/')).resolves.toBe(0);
        expect(writes).toEqual([]);
    });

    test('nextBatch gives back an empty queue rather than hanging', async () => {
        const { discovery } = load(0);
        await expect(discovery.nextBatch(400)).resolves.toEqual([]);
    });

    test('queueDepth answers with zeroes rather than hanging', async () => {
        const { discovery } = load(0);
        await expect(discovery.queueDepth()).resolves.toEqual({
            waiting: 0, visited: 0, dead: 0, total: 0,
        });
    });

    test('a whole run of five colleges finishes well inside one second', async () => {
        const { discovery } = load(0);
        const sites = ['a.ac.in', 'b.ac.in', 'c.ac.in', 'd.ac.in', 'e.ac.in'];
        const started = process.hrtime.bigint();
        await discovery.runBulk(sites, { discover: async () => [], save: async () => 0 });
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const st = discovery.runStatus();
        expect(st.processed).toBe(5);
        expect(st.finishedAt).toBeInstanceOf(Date);      // the assertion CI failed on
        expect(st.running).toBe(false);
        expect(ms).toBeLessThan(1000);                   // was ~100s: 5 colleges x 2 buffered writes
    });
});

describe('when the connection is up the bookkeeping still runs', () => {
    test('markVisited issues the write', () => {
        const { discovery, writes } = load(1);
        discovery.markVisited('nitk.ac.in', 4, true);    // not awaited: the write hangs
        expect(writes.map((w) => w[0])).toEqual(['updateOne']);
    });

    test('rememberSites issues the write', () => {
        const { discovery, writes } = load(1);
        discovery.rememberSites(['vtu.ac.in'], 'https://nitk.ac.in/');
        expect(writes.length).toBeGreaterThan(0);
    });

    test('dbReady tells the three states apart', () => {
        expect(load(1).discovery.dbReady()).toBe(true);
        expect(load(0).discovery.dbReady()).toBe(false);
        expect(load(2).discovery.dbReady()).toBe(false);  // connecting is not connected
    });
});
