'use strict';

/**
 * Run a wrapped Mongoose `exec`, catching its errors without breaking callers
 * that pass a callback.
 *
 * Mongoose 6 runs `exec` two ways. Awaited, it returns a promise. Given a
 * callback, it returns undefined, and populate always calls it that way on the
 * populated model's query. server.js wraps every model's `find`, `findOne`
 * and the rest to fall back to the file store on a network error, and that
 * wrapper used to chain `.catch` on whatever `exec` returned. So every
 * `.populate()` threw "Cannot read properties of undefined (reading 'catch')"
 * while MongoDB was up, and the mentor and founder directories answered 500.
 *
 * A callback call is passed straight through; only the promise form gets
 * `onError`.
 */
module.exports = function guardedExec(exec, query, args, onError) {
    if (typeof args[args.length - 1] === 'function') return exec.apply(query, args);
    return exec.apply(query, args).catch(onError);
};
