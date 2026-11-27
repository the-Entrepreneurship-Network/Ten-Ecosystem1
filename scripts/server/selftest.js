'use strict';
/**
 * The live check: is the site working for every student, right now?
 *
 * Run on the production server by "Server ops" → selftest
 * (scripts/server/ops.sh), which emails this report to the team inbox. A fix
 * is not reported to a student as done until this passes after its deploy
 * (docs/bug-agent.md, "Before you tell a student it is fixed").
 *
 * Read-only, apart from one temporary file written to the uploads folder and
 * deleted again. It costs two small Gemini calls.
 *
 * The report can name students (the half-made accounts), so it is only ever
 * emailed. stderr gets the pass/fail count alone, for the workflow's public log.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '../..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const PORT = process.env.PORT || 5000;
const results = [];

function record(name, ok, detail) {
    results.push({ name, ok, detail });
}

async function check(name, fn) {
    const t0 = Date.now();
    try {
        const detail = await fn();
        record(name, true, (detail ? detail + ' ' : '') + `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
        record(name, false, String((err && err.message) || err).slice(0, 300));
    }
}

function get(urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: urlPath, timeout: 15000 }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('timeout', () => req.destroy(new Error('no answer within 15s')));
        req.on('error', reject);
    });
}

async function main() {
    await check('the app answers', async () => {
        const r = await get('/api/health/db');
        if (!/"connected":true/.test(r.body)) throw new Error('database not connected: ' + r.body.slice(0, 200));
        return 'database connected';
    });

    for (const page of ['/login.html', '/student-login', '/register', '/student-dashboard', '/learn']) {
        await check('page ' + page, async () => {
            const r = await get(page);
            if (r.status !== 200) throw new Error('HTTP ' + r.status);
            return 'HTTP 200';
        });
    }

    const gemini = require(path.join(ROOT, 'utils/gemini'));
    await check('Gemini answers', async () => {
        const out = await gemini.ask('Reply with {"ok":true}. Nothing else.',
            { type: gemini.Type.OBJECT, properties: { ok: { type: gemini.Type.BOOLEAN } }, required: ['ok'] });
        if (!out || out.ok !== true) throw new Error('unexpected answer');
        return 'main model ' + gemini.GEMINI_MODEL() + ', backup ' + gemini.GEMINI_FALLBACK_MODEL();
    });

    await check('an exam paper can be written', async () => {
        const curriculum = require(path.join(ROOT, 'config/learnCurriculum'));
        const mod = curriculum.getModules().find((m) => m.ready);
        if (!mod) throw new Error('no ready course module');
        const paper = await require(path.join(ROOT, 'services/learnExam')).generatePaper(mod, 1);
        return `${paper.length} questions for ${mod.name}, topic 1`;
    });

    await check('uploads can be saved', async () => {
        const dir = path.join(ROOT, 'uploads/documents');
        const probe = path.join(dir, '.selftest-' + process.pid);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return 'uploads/documents is writable';
    });

    // Student accounts with no internship record behind them: sign-in can only
    // tell them to finish registering (see /login and registerUser).
    const mongoose = require('mongoose');
    await check('half-made student accounts', async () => {
        if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
        const EcosystemUser = require(path.join(ROOT, 'models/EcosystemUser'));
        const Student = require(path.join(ROOT, 'models/Student'));
        const users = await EcosystemUser.find({ role: 'student' }).select('email createdAt').lean();
        const withRecord = new Set((await Student.find({}).select('email').lean())
            .map((s) => String(s.email || '').trim().toLowerCase()));
        const missing = users.filter((u) => !withRecord.has(String(u.email || '').trim().toLowerCase()));
        const list = missing.slice(0, 50).map((u) => '      ' + u.email + '  (since ' + new Date(u.createdAt).toISOString().slice(0, 10) + ')');
        return missing.length + ' of ' + users.length + ' student accounts have no internship record'
            + (list.length ? '\n' + list.join('\n') + (missing.length > 50 ? '\n      …' : '') : '');
    });

    // The 11:55 pm class auto-mark (services/automationCron
    // autoMarkCoordinatorAttendance) leaves no trace but its rows, so count
    // them: a run of empty nights means the job is not running.
    await check('nightly class auto-mark', async () => {
        const Attendance = require(path.join(ROOT, 'models/Attendance'));
        const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
        const nights = await Attendance.aggregate([
            { $match: { coordinatorId: 'AUTO_SYSTEM', dateKey: { $gte: since } } },
            { $group: { _id: '$dateKey', marked: { $sum: 1 } } },
            { $sort: { _id: -1 } }
        ]);
        return nights.length
            ? 'class marks made by the agent: ' + nights.map((n) => n._id + ' ' + n.marked).join(', ')
            : 'no automatic class marks in the last 7 days: check the job is running';
    });
    await mongoose.disconnect().catch(() => {});

    const failed = results.filter((r) => !r.ok);
    console.log(`Live self-test: ${results.length - failed.length} passed, ${failed.length} failed.\n`);
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
    console.error(`self-test: ${results.length - failed.length} passed, ${failed.length} failed`);
}

main().catch((err) => {
    console.log('The self-test itself crashed: ' + String((err && err.message) || err).slice(0, 300));
    console.error('self-test: crashed');
});
