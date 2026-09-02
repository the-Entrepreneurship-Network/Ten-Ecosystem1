'use strict';

/**
 * Stop one repeating log line from filling the disk.
 *
 * WHAT HAPPENED
 *
 * MongoDB aborted at 02:00 with "Writing to log file failed, aborting
 * application" — the disk was full. The portal then logged one line per
 * request for the next eight hours:
 *
 *     [notifications] unread-count failed: Cannot call messages.distinct()
 *     before initial connection is complete if bufferCommands = false.
 *
 * Those lines went to pm2's log files on the same full disk, which is what kept
 * mongod from ever restarting. The outage fed itself: the database died because
 * the disk was full, and the complaint about the dead database is what kept it
 * full.
 *
 * So: an identical line prints once, then is counted rather than written, and
 * the count is reported the next time one is allowed through. Different lines
 * are never suppressed and a first occurrence always prints — nothing is lost,
 * only the repetition. This is what syslog has always done.
 */

const WINDOW_MS = 60 * 1000;
const MAX_KEYS = 500;

/**
 * @param {Console} target      the console to wrap
 * @param {() => number} clock  injectable so a test does not have to wait a minute
 * @returns {() => void}        restores the original methods
 */
function install(target = console, clock = Date.now) {
    if (target.__tenLogThrottle) return target.__tenLogThrottle;

    const seen = new Map();          // key -> { at, suppressed }
    const original = {};

    /*
     * ponytail: the key is the first 200 characters of the message, so two lines
     * differing only after that count as one. Every flood seen in production put
     * its stable text first and the varying part (an id, a stack) after, so this
     * is the cheap thing that works. If a future flood varies early, key on a
     * hash of the format string instead.
     */
    const keyOf = (method, args) => method + ' ' + args
        .map((a) => (typeof a === 'string' ? a : (a && a.message) || String(a)))
        .join(' ')
        .slice(0, 200);

    for (const method of ['log', 'warn', 'error']) {
        original[method] = target[method].bind(target);
        target[method] = (...args) => {
            let key;
            try { key = keyOf(method, args); } catch (_e) { return original[method](...args); }

            const now = clock();
            const previous = seen.get(key);

            if (previous && now - previous.at < WINDOW_MS) {
                previous.suppressed += 1;
                return undefined;
            }

            if (previous && previous.suppressed > 0) {
                original[method](
                    '[repeated ' + previous.suppressed + 'x in the last '
                    + Math.round(WINDOW_MS / 1000) + 's, not written]'
                );
            }

            // Bounded. Map iterates in insertion order, so the first key is the
            // oldest; evict it rather than letting this grow without limit.
            if (!previous && seen.size >= MAX_KEYS) seen.delete(seen.keys().next().value);
            seen.set(key, { at: now, suppressed: 0 });

            return original[method](...args);
        };
    }

    const restore = () => {
        for (const method of Object.keys(original)) target[method] = original[method];
        delete target.__tenLogThrottle;
        seen.clear();
    };
    target.__tenLogThrottle = restore;
    return restore;
}

module.exports = { install, WINDOW_MS, MAX_KEYS };
