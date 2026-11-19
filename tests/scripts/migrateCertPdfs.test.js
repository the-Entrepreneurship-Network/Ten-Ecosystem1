'use strict';

/**
 * @jest-environment node
 *
 * The backfill, actually run.
 *
 * tests/routes/certificatePdfOnDisk.test.js reads this script's source and
 * checks the shape of it — that the unset comes after the size check, that
 * every failure path leaves before it. That is worth having and it is not the
 * same as knowing the thing runs, and this script had never been executed at
 * all: it clears columns on the production database, irreversibly, and the
 * first time it ran would have been against the only copy of ~778 students'
 * certificates.
 *
 * So it runs here, with mongoose and the Student model stubbed and a cursor
 * fed synthetic records. The filesystem is real — files are written under a
 * throwaway employee ID inside uploads/, which is gitignored — so the write,
 * the read-back and the size check are the real ones.
 */

const fs = require('fs');
const path = require('path');
const certFile = require('../../services/certificateFile');

const ID = 'ZZMIG/UNIT/0001';
const PDF = Buffer.from('%PDF-1.4 migration test\n');
const B64 = PDF.toString('base64');

const sweep = () => certFile.TYPES
    .flatMap((t) => certFile.candidates({ employeeId: ID, _id: 'zzmig0001' }, t))
    .forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });

/**
 * Load the script with a fake database behind it.
 *
 * @param {object} byColumn  base64 column -> the records a cursor should yield
 * @param {string[]} argv    flags, as the shell would pass them
 */
function load(byColumn, argv = []) {
    jest.resetModules();
    const updates = [];
    const Student = {
        find: (query) => {
            const col = Object.keys(query)[0];
            const queue = (byColumn[col] || []).map((d) => ({ ...d }));
            const chain = {
                select: () => chain,
                lean: () => chain,
                cursor: () => ({ next: async () => queue.shift() || null })
            };
            return chain;
        },
        updateOne: async (filter, update) => { updates.push({ filter, update }); }
    };

    jest.doMock('mongoose', () => ({
        connect: async () => {},
        disconnect: async () => {}
    }));
    jest.doMock('dotenv', () => ({ config: () => {} }));
    jest.doMock('../../models/Student', () => Student);

    process.env.MONGODB_URI = 'mongodb://stub/none';
    process.argv = ['node', 'migrate-cert-pdfs.js', ...argv];

    const out = [];
    const log = jest.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    const err = jest.spyOn(console, 'error').mockImplementation((...a) => out.push(a.join(' ')));

    const { run } = require('../../scripts/migrate-cert-pdfs');
    return { run, updates, out, restore: () => { log.mockRestore(); err.mockRestore(); } };
}

const record = (over = {}) => ({ _id: 'zzmig0001', employeeId: ID, ...over });

beforeEach(sweep);
afterEach(sweep);

describe('a dry run changes nothing', () => {
    it('writes no file and clears no column', async () => {
        const h = load({ locPdfBase64: [record({ locPdfBase64: B64 })] });
        await h.run();
        h.restore();

        expect(fs.existsSync(certFile.pathFor({ employeeId: ID }, 'LOC'))).toBe(false);
        expect(h.updates).toHaveLength(0);
        expect(h.out.join('\n')).toMatch(/DRY RUN/);
        expect(h.out.join('\n')).toMatch(/written to disk : 1/);
    });

    it('is what you get with no flags at all', async () => {
        // The whole safety of this script rests on --apply being opt-in.
        const h = load({ offerPdfBase64: [record({ offerPdfBase64: B64 })] }, []);
        await h.run();
        h.restore();
        expect(h.updates).toHaveLength(0);
    });
});

describe('--apply writes the file, then clears the column', () => {
    it('does both, in that order, for a record with no file yet', async () => {
        const h = load({ lorPdfBase64: [record({ lorPdfBase64: B64 })] }, ['--apply']);
        await h.run();
        h.restore();

        const written = certFile.pathFor({ employeeId: ID }, 'LOR');
        expect(fs.readFileSync(written).equals(PDF)).toBe(true);
        expect(h.updates).toEqual([{
            filter: { _id: 'zzmig0001' },
            update: { $unset: { lorPdfBase64: '' } }
        }]);
    });

    it('clears the column without rewriting a file that is already there', async () => {
        certFile.save({ employeeId: ID }, 'STAR', Buffer.from('the file already on disk'));
        const before = fs.statSync(certFile.pathFor({ employeeId: ID }, 'STAR')).mtimeMs;

        const h = load({ starPdfBase64: [record({ starPdfBase64: B64 })] }, ['--apply']);
        await h.run();
        h.restore();

        // Untouched — the file on disk is what the download route serves, and
        // the column is the copy being removed, not the other way round.
        expect(fs.readFileSync(certFile.pathFor({ employeeId: ID }, 'STAR')).toString())
            .toBe('the file already on disk');
        expect(fs.statSync(certFile.pathFor({ employeeId: ID }, 'STAR')).mtimeMs).toBe(before);
        expect(h.updates).toHaveLength(1);
        expect(h.out.join('\n')).toMatch(/already on disk : 1/);
    });

    it('handles every type in one pass', async () => {
        const h = load({
            locPdfBase64:   [record({ locPdfBase64: B64 })],
            lorPdfBase64:   [record({ lorPdfBase64: B64 })],
            starPdfBase64:  [record({ starPdfBase64: B64 })],
            offerPdfBase64: [record({ offerPdfBase64: B64 })],
            lopPdfBase64:   [record({ lopPdfBase64: B64 })]
        }, ['--apply']);
        await h.run();
        h.restore();

        expect(h.updates).toHaveLength(5);
        for (const t of certFile.TYPES) {
            expect(fs.existsSync(certFile.pathFor({ employeeId: ID }, t))).toBe(true);
        }
    });

    it('--type does one and leaves the rest alone', async () => {
        const h = load({
            locPdfBase64: [record({ locPdfBase64: B64 })],
            lorPdfBase64: [record({ lorPdfBase64: B64 })]
        }, ['--apply', '--type', 'LOC']);
        await h.run();
        h.restore();

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].update).toEqual({ $unset: { locPdfBase64: '' } });
        expect(fs.existsSync(certFile.pathFor({ employeeId: ID }, 'LOR'))).toBe(false);
    });
});

describe('nothing is cleared that was not safely written', () => {
    it('keeps the column when the employee ID yields no path', async () => {
        // An ID holding '..' or a slash-stripped oddity produces no path at
        // all. Clearing anyway would destroy the only remaining copy.
        const h = load({ locPdfBase64: [record({ employeeId: '../../etc/passwd', locPdfBase64: B64 })] },
                       ['--apply']);
        await h.run();
        h.restore();

        expect(h.updates).toHaveLength(0);
        expect(h.out.join('\n')).toMatch(/no usable path/);
        expect(h.out.join('\n')).toMatch(/1 left untouched/);
    });

    it('keeps the column, and removes the file, after a short write', async () => {
        const target = certFile.pathFor({ employeeId: ID }, 'LOP');
        const realStat = fs.statSync;
        const spy = jest.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
            if (p === target) return { size: 3 };          // truncated on disk
            return realStat(p, ...rest);
        });

        const h = load({ lopPdfBase64: [record({ lopPdfBase64: B64 })] }, ['--apply']);
        await h.run();
        h.restore();
        spy.mockRestore();

        expect(h.updates).toHaveLength(0);
        expect(fs.existsSync(target)).toBe(false);          // the bad file is cleaned up
        expect(h.out.join('\n')).toMatch(/wrote 3 of \d+ bytes/);
    });

    it('carries on past a bad record instead of abandoning the batch', async () => {
        const h = load({
            locPdfBase64: [
                record({ employeeId: '..', locPdfBase64: B64 }),
                record({ locPdfBase64: B64 })
            ]
        }, ['--apply']);
        await h.run();
        h.restore();

        expect(h.updates).toHaveLength(1);                  // the good one still went through
        expect(fs.existsSync(certFile.pathFor({ employeeId: ID }, 'LOC'))).toBe(true);
    });
});

describe('running it twice is safe', () => {
    it('does nothing the second time, because the column is gone', async () => {
        const first = load({ locPdfBase64: [record({ locPdfBase64: B64 })] }, ['--apply']);
        await first.run();
        first.restore();
        expect(first.updates).toHaveLength(1);

        // Second pass: the column no longer matches { $ne: null, $exists: true },
        // so the cursor yields nothing.
        const second = load({ locPdfBase64: [] }, ['--apply']);
        await second.run();
        second.restore();

        expect(second.updates).toHaveLength(0);
        expect(fs.existsSync(certFile.pathFor({ employeeId: ID }, 'LOC'))).toBe(true);
    });
});

describe('a bad --type is refused before anything connects', () => {
    it('exits rather than silently migrating nothing', async () => {
        const h = load({}, ['--apply', '--type', 'NOPE']);
        const exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exited'); });
        await expect(h.run()).rejects.toThrow('exited');
        exit.mockRestore();
        h.restore();
        expect(h.out.join('\n')).toMatch(/--type must be one of/);
    });
});
