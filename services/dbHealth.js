'use strict';

/**
 * Why the database is not connected, and keeping trying until it is.
 *
 * WHAT WENT WRONG IN PRODUCTION
 *
 * The initial mongoose.connect() failure was caught and logged as a warning:
 *
 *     .catch(err => { console.warn("MongoDB connection warning: Working in
 *                     local runtime mode…"); global.isMongoUnhealthy = true; })
 *
 * and the process carried on. Every model then fell through to the JSON engine
 * in server.js, which writes to .data/local_db/db_<Model>.json — a file on one
 * EC2 box, outside every backup.
 *
 * Three things made that invisible rather than obvious:
 *
 *   - There was no retry. One failed attempt at boot and the process stayed in
 *     fallback until somebody restarted it, however long the database had been
 *     healthy again.
 *   - The JSON engine INVENTED a student ("Scholar TEN", TEN-STUDENT-001) the
 *     first time the file was missing, so a portal with no database looked like
 *     a portal with one student in it.
 *   - Nothing on any screen said the data was not real. Registrations kept
 *     succeeding, into a file.
 *
 * This module fixes the half that is in the code: it says exactly WHY the
 * connection failed, in words that name the fix, and it keeps trying so the
 * portal recovers on its own the moment the cause is dealt with.
 */

const mongoose = require('mongoose');
const fs = require('fs');

/*
 * A disk this full is how the last outage started. mongod aborted because it
 * could not write its own log file, and nothing anywhere had said the disk was
 * filling. 90% leaves room to notice.
 */
const DISK_WARN_PERCENT = 90;

/**
 * How much room is left where this server writes.
 *
 * The database did not fail because of anything in this application: the disk
 * filled, mongod could not write its log, and it aborted. This is the number
 * that would have said so the day before.
 */
function diskHeadroom(mountPoint = '/') {
    try {
        const st = fs.statfsSync(mountPoint);
        const total = st.blocks * st.bsize;
        const free = st.bavail * st.bsize;
        if (!total) return null;
        const percentUsed = Math.round(((total - free) / total) * 100);
        return {
            percentUsed,
            freeBytes: free,
            totalBytes: total,
            low: percentUsed >= DISK_WARN_PERCENT
        };
    } catch (_e) {
        // statfsSync needs Node 18.15+. An older runtime simply gets no number
        // rather than an endpoint that throws.
        return null;
    }
}

/** The four realistic causes, each with a different fix. */
const CAUSES = [
    {
        id: 'no-uri',
        test: (_err, uri) => !uri,
        summary: 'MONGODB_URI is not set',
        fix: 'Add MONGODB_URI to the .env file on the server, then restart with '
           + '`pm2 restart ecosystem.config.js --update-env`.'
    },
    {
        /*
         * The one that actually happened. MONGODB_URI was missing from .env and
         * server.js defaulted to mongodb://localhost:27017 — so the failure read
         * as "a database refused me" rather than "a line is missing from .env".
         * That default is gone, but this stays: a URI can still name a host that
         * is not listening.
         */
        id: 'refused',
        test: (err) => /ECONNREFUSED/i.test(err.message || ''),
        summary: 'nothing is listening at the address in MONGODB_URI',
        fix: 'If that address is 127.0.0.1 or localhost, the .env on this server is missing the '
           + 'real connection string: put the MongoDB Atlas URI in MONGODB_URI and restart with '
           + '`pm2 restart ecosystem.config.js --update-env`. If a MongoDB is genuinely meant to '
           + 'run on this box, start it with `sudo systemctl start mongod`.'
    },
    {
        id: 'auth',
        test: (err) => /authentication failed|bad auth|not authorized/i.test(err.message || ''),
        summary: 'the username or password in MONGODB_URI is wrong',
        fix: 'Check the database user and password in MongoDB Atlas under Database Access. '
           + 'A password containing @ : / ? # [ ] must be percent-encoded in the URI.'
    },
    {
        id: 'ip-allowlist',
        test: (err) => /is not allowed to connect|IP address .* whitelist|connection .* closed/i.test(err.message || '')
                    || (/ServerSelection/i.test(err.name || '') && /TLS|SSL|closed/i.test(err.message || '')),
        summary: "this server's IP address is not allowed to connect",
        fix: 'In MongoDB Atlas, Network Access → Add IP Address, and add this EC2 box\'s public IP. '
           + 'An Elastic IP is worth having here: without one the address changes when the instance stops.'
    },
    {
        id: 'dns',
        test: (err) => /querySrv|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(err.message || ''),
        summary: 'the cluster hostname could not be resolved',
        fix: 'Check the hostname in MONGODB_URI. If DNS SRV lookups are blocked on this network, '
           + 'use the non-SRV mongodb:// connection string Atlas offers under "Connect → Drivers → older version".'
    }
];

const state = {
    connected: false,
    since: null,
    attempts: 0,
    lastError: null,
    cause: null,
    fix: null,
    /** Set once the process has served a request while disconnected. */
    servedFromFallback: false
};

/** Classify a connection failure into something somebody can act on. */
function diagnose(err, uri) {
    const found = CAUSES.find((c) => {
        try { return c.test(err || {}, uri); } catch (_e) { return false; }
    });
    return found || {
        id: 'unknown',
        summary: 'the database refused the connection',
        fix: 'Check the server can reach MongoDB at all: '
           + '`node -e "require(\'mongoose\').connect(process.env.MONGODB_URI).then(()=>console.log(\'ok\'))"`.'
    };
}

/**
 * Record a failure so status() — and therefore /api/health/db and the banner on
 * every page — can say why. Called at boot as well as on every retry: the first
 * failure is the one somebody is staring at a blank portal about.
 */
function noteFailure(err, uri) {
    const cause = diagnose(err || {}, uri);
    state.lastError = (err && err.message) || String(err);
    state.cause = cause.summary;
    state.fix = cause.fix;
    return cause;
}

/** The banner text every screen shows while the database is down. */
function bannerMessage() {
    return 'The database is not connected. Anything you see or save right now is being held in a '
         + 'temporary file on the server and is NOT in the database.';
}

/**
 * Keep trying to connect, forever, with backoff.
 *
 * Forever on purpose. The cause is almost always something changed outside this
 * process — an expired Atlas IP allowlist entry, a rotated password — and it is
 * fixed by somebody in a console, not by a deploy. Giving up means the portal
 * stays broken after the real problem is gone.
 *
 * @param {(uri: string) => Promise} connect  the connect function to retry
 * @param {string} uri
 */
function keepTrying(connect, uri, log = console) {
    const FIRST_DELAY_MS = 5000;
    const MAX_DELAY_MS = 60 * 1000;
    let delay = FIRST_DELAY_MS;

    async function attempt() {
        if (mongoose.connection.readyState === 1) return;   // somebody else got there
        state.attempts += 1;
        try {
            await connect(uri);
            // The 'connected' event handler marks the state; nothing to do here.
        } catch (err) {
            const cause = noteFailure(err, uri);

            // Loud on the first failure, then quiet — a retry every minute must
            // not bury the rest of the log.
            const line = `[Database] NOT CONNECTED — ${cause.summary}.`;
            if (state.attempts === 1) {
                log.error('');
                log.error('  ' + '='.repeat(72));
                log.error('  ' + line);
                log.error('  ');
                log.error('  ' + cause.fix);
                log.error('  ');
                log.error('  Until then the portal is running on .data/local_db/*.json — a file on');
                log.error('  this server. Registrations still succeed and are NOT in the database.');
                log.error('  Recover them with: node scripts/import-fallback-db.js --write');
                log.error('  ' + '='.repeat(72));
                log.error('');
            } else if (state.attempts % 10 === 0) {
                log.warn(`${line} Attempt ${state.attempts}; still retrying.`);
            }

            delay = Math.min(delay * 2, MAX_DELAY_MS);
            setTimeout(attempt, delay).unref?.();
        }
    }

    setTimeout(attempt, FIRST_DELAY_MS).unref?.();
}

/** Wire the mongoose events onto this module's state. */
function watch(log = console) {
    mongoose.connection.on('connected', () => {
        const wasDown = !state.connected;
        state.connected = true;
        state.since = new Date();
        state.lastError = null;
        state.cause = null;
        state.fix = null;
        if (wasDown && state.attempts > 0) {
            log.log(`[Database] Connected after ${state.attempts} attempt(s).`);
            if (state.servedFromFallback) {
                log.warn('[Database] This process served requests from the local file while it was '
                       + 'down. Run `node scripts/import-fallback-db.js` to see what is only there.');
            }
        }
    });
    mongoose.connection.on('disconnected', () => { state.connected = false; });
    mongoose.connection.on('reconnected', () => { state.connected = true; state.since = new Date(); });
}

/** Note that a request was answered without a database behind it. */
function noteFallbackUse() {
    state.servedFromFallback = true;
}

/** The shape both the health endpoint and the UI banner read. */
function status() {
    const connected = mongoose.connection.readyState === 1;
    return {
        connected,
        state: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown',
        since: state.since,
        attempts: state.attempts,
        cause: connected ? null : state.cause,
        fix: connected ? null : state.fix,
        lastError: connected ? null : state.lastError,
        servedFromFallback: state.servedFromFallback,
        disk: diskHeadroom(),
        message: connected ? null : bannerMessage()
    };
}

module.exports = { diagnose, noteFailure, keepTrying, watch, status, noteFallbackUse, bannerMessage, diskHeadroom, DISK_WARN_PERCENT, CAUSES };
