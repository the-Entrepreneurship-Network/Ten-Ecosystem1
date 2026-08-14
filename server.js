
require("dotenv").config();
const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

// Monkeypatch Intl.DateTimeFormat to prevent crashes on environments with small-icu (like some EC2/AWS instances)
// where 'shortOffset' or 'longOffset' for timeZoneName are not supported by the local ICU data and throw RangeError.
const OriginalDateTimeFormat = Intl.DateTimeFormat;
function PatchedDateTimeFormat(locales, options) {
  const isNew = this instanceof PatchedDateTimeFormat;
  const tryInstantiate = (opts) => {
    return isNew ? new OriginalDateTimeFormat(locales, opts) : OriginalDateTimeFormat(locales, opts);
  };
  try {
    return tryInstantiate(options);
  } catch (e) {
    if (e instanceof RangeError && options && options.timeZoneName) {
      const fallbackOptions = { ...options };
      if (fallbackOptions.timeZoneName === 'shortOffset') {
        fallbackOptions.timeZoneName = 'short';
      } else if (fallbackOptions.timeZoneName === 'longOffset') {
        fallbackOptions.timeZoneName = 'long';
      } else {
        delete fallbackOptions.timeZoneName;
      }
      try {
        return tryInstantiate(fallbackOptions);
      } catch (err) {
        const safeOptions = { ...options };
        delete safeOptions.timeZoneName;
        try {
          return tryInstantiate(safeOptions);
        } catch (finalErr) {
          throw e;
        }
      }
    }
    throw e;
  }
}
PatchedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
PatchedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf;
Intl.DateTimeFormat = PatchedDateTimeFormat;

const fs = require("fs");
const path = require("path");
const cors = require("cors");
const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const {
  validate,
  studentRegisterSchema,
  studentLoginSchema
} = require("./middleware/validationSchemas");

const attendanceUtils = require("./utils/attendanceUtils");
// Scopes attendance to one domain. A student may hold two, and the two are
// separate internships — see utils/attendanceDomain.js.
const attendanceDomain = require("./utils/attendanceDomain");
const tenureUtils = require("./utils/tenure");
const { istNow, istDateKey } = require("./utils/dateKey");
const tenurePaymentConfig = require("./config/tenurePayment");
// Keeps the rest of the product in step when a student's core fields change.
const studentPropagation = require("./services/studentPropagation");

// ================= RATE LIMIT CONFIGURATION =================
const RATE_LIMIT_CONFIG = {
  // Auth routes — strictest
  auth: {
    windowMs: process.env.RATE_AUTH_WINDOW_MS
      ? parseInt(process.env.RATE_AUTH_WINDOW_MS)
      : 15 * 60 * 1000,  // 15 minutes
    max: process.env.RATE_AUTH_MAX
      ? parseInt(process.env.RATE_AUTH_MAX)
      : 10,
    backoffBase: process.env.RATE_AUTH_BACKOFF_BASE
      ? parseInt(process.env.RATE_AUTH_BACKOFF_BASE)
      : 2,
  },
  // Public/unauthenticated endpoints — moderate
  public: {
    windowMs: process.env.RATE_PUBLIC_WINDOW_MS
      ? parseInt(process.env.RATE_PUBLIC_WINDOW_MS)
      : 15 * 60 * 1000,
    max: process.env.RATE_PUBLIC_MAX
      ? parseInt(process.env.RATE_PUBLIC_MAX)
      : 100,
  },
  // Authenticated user actions — looser
  authenticated: {
    windowMs: process.env.RATE_AUTH_USER_WINDOW_MS
      ? parseInt(process.env.RATE_AUTH_USER_WINDOW_MS)
      : 15 * 60 * 1000,
    max: process.env.RATE_AUTH_USER_MAX
      ? parseInt(process.env.RATE_AUTH_USER_MAX)
      : 300,
  },
  // Payment endpoints — strict
  payment: {
    windowMs: process.env.RATE_PAYMENT_WINDOW_MS
      ? parseInt(process.env.RATE_PAYMENT_WINDOW_MS)
      : 60 * 60 * 1000,
    max: process.env.RATE_PAYMENT_MAX
      ? parseInt(process.env.RATE_PAYMENT_MAX)
      : 20,
  },
};

// ================= MONGOOSE LOCAL FALLBACK ENGINE =================
// Automatically intercept all model calls if MongoDB isn't connected.
// This allows the app to store, fetch, and authenticate users/records
// in a single-file or multi-file local storage database.
// The fallback store lives OUTSIDE the statically served tree. It used to sit
// at uploads/local_db, and `app.use('/uploads', express.static('uploads'))`
// meant the whole user table — including password hashes, emails and phone
// numbers — was downloadable at /uploads/local_db/db_Student.json by anyone.
// LOCAL_DB_DIR is gitignored; see .gitignore.
const DB_DIR = process.env.LOCAL_DB_DIR
    ? path.resolve(process.env.LOCAL_DB_DIR)
    : path.join(__dirname, '.data', 'local_db');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// One-time migration: if a previous deploy left data at the old public path,
// move it into the private directory rather than silently starting empty.
(function migrateLegacyLocalDb() {
    const legacyDir = path.join(__dirname, 'uploads', 'local_db');
    if (legacyDir === DB_DIR || !fs.existsSync(legacyDir)) return;
    try {
        for (const name of fs.readdirSync(legacyDir)) {
            if (!name.endsWith('.json')) continue;
            const target = path.join(DB_DIR, name);
            if (!fs.existsSync(target)) fs.copyFileSync(path.join(legacyDir, name), target);
            fs.unlinkSync(path.join(legacyDir, name));
        }
        fs.rmdirSync(legacyDir);
        console.warn('[local-db] Moved the fallback database out of the public uploads/ tree into ' + DB_DIR + '.');
    } catch (err) {
        console.error('[local-db] Could not migrate uploads/local_db — delete it by hand, it is publicly served: ' + err.message);
    }
})();

global.isMongoUnhealthy = false;
global.lastMongoCheckTime = 0;

/**
 * How long a "Mongo looks unhealthy" observation is trusted before it is
 * re-tested. Without an expiry the flag was a ONE-WAY DOOR: any query error
 * whose message merely contained "connection" or "network" set it, and nothing
 * cleared it except a mongoose 'connected'/'reconnected' event — which never
 * fires when the socket did not actually drop. A single slow query therefore
 * put the whole process into fallback mode until someone restarted it, which
 * is what moved every session into memory and signed the portal out.
 */
const MONGO_UNHEALTHY_TTL_MS = 30 * 1000;

/** Record that a query failed in a way that looks like a connection problem. */
function markMongoUnhealthy() {
    global.isMongoUnhealthy = true;
    global.lastMongoCheckTime = Date.now();
}

/**
 * Is the database usable right now?
 *
 * `mongoose.connection.readyState` is the authority — it reflects the live
 * socket and recovers on its own. A recent unhealthy observation is honoured
 * for MONGO_UNHEALTHY_TTL_MS so a burst of failures does not hammer a database
 * that is genuinely down, and is then discarded so the process recovers
 * without needing a restart.
 */
function isMongoHealthy() {
    if (mongoose.connection.readyState !== 1) return false;
    if (!global.isMongoUnhealthy) return true;
    if (Date.now() - (global.lastMongoCheckTime || 0) > MONGO_UNHEALTHY_TTL_MS) {
        global.isMongoUnhealthy = false;   // the observation has expired; re-test
        return true;
    }
    return false;
}

function checkMongoStatus() {
    return isMongoHealthy();
}


// ── Unique-index enforcement for the JSON fallback engine ───────────────────
// The fallback had no concept of an index: every write path was a bare append.
// While degraded, /register cheerfully wrote duplicate employeeId AND duplicate
// email rows, and Student.findOne({employeeId}) then returned whichever
// duplicate happened to be first in the file — so two students could share one
// login identity. These helpers read the real schema and emulate MongoDB's
// E11000 so behaviour matches whichever backend is live.

function getUniqueIndexPaths(schema) {
    const paths = [];
    if (!schema) return paths;
    try {
        // Field-level `unique: true`
        schema.eachPath((name, type) => {
            if (name === '_id') return;
            const opts = (type && type.options) || {};
            if (opts.unique) paths.push({ fields: [name], sparse: !!opts.sparse });
        });
        // Compound indexes declared with schema.index({...}, {unique:true})
        for (const [spec, options] of schema.indexes()) {
            if (!options || !options.unique) continue;
            const fields = Object.keys(spec).filter(f => f !== '_id');
            if (fields.length) paths.push({ fields, sparse: !!options.sparse });
        }
    } catch (_) { /* schema shape unavailable — enforce nothing */ }
    return paths;
}

function makeDuplicateKeyError(fields, doc) {
    const keyValue = {};
    for (const f of fields) keyValue[f] = doc[f];
    const err = new Error(
        'E11000 duplicate key error collection: ' + JSON.stringify(keyValue)
    );
    err.code = 11000;
    err.keyPattern = fields.reduce((a, f) => { a[f] = 1; return a; }, {});
    err.keyValue = keyValue;
    return err;
}

/**
 * Throw an E11000-shaped error if `doc` would violate a unique index.
 * @param {object} schema      the Mongoose schema
 * @param {Array}  items       rows already stored
 * @param {object} doc         the row being written
 * @param {string} [ignoreId]  existing _id to skip (updates)
 */
function assertNoDuplicate(schema, items, doc, ignoreId) {
    for (const index of getUniqueIndexPaths(schema)) {
        const values = index.fields.map(f => doc[f]);
        // Sparse indexes ignore documents missing the field — this is what
        // makes `employeeId: {unique:true, sparse:true}` allow many nulls.
        if (values.some(v => v === undefined || v === null || v === '')) {
            if (index.sparse) continue;
        }
        const clash = items.some(item => {
            if (ignoreId && String(item._id) === String(ignoreId)) return false;
            return index.fields.every((f, i) => {
                const a = item[f];
                const b = values[i];
                if (a === undefined || a === null) return b === undefined || b === null;
                return String(a) === String(b);
            });
        });
        if (clash) throw makeDuplicateKeyError(index.fields, doc);
    }
}

function getCollectionData(modelName) {
    const file = path.join(DB_DIR, `db_${modelName}.json`);
    if (!fs.existsSync(file)) {
        if (modelName === 'Student') {
            const defaultRecords = [
                {
                    _id: "60c72b2f9b1d8b2badcd88a1",
                    firstName: "Scholar",
                    lastName: "TEN",
                    name: "Scholar TEN",
                    email: "student@entrepreneurshipnetwork.net",
                    whatsapp: "1234567890",
                    college: "The Entrepreneurship Network University",
                    collegeName: "The Entrepreneurship Network University",
                    domain: "Web Development",
                    tenure: "3 Months",
                    joiningDate: "2026-06-01",
                    employeeId: "TEN-STUDENT-001",
                    password: "intern123",
                    currentStreak: 5,
                    bestStreak: 12,
                    lastAttendanceDate: new Date().toISOString(),
                    lastActiveDate: new Date().toISOString(),
                    v2Onboarded: true,
                    v2DurationType: "3months",
                    locStatus: "not_eligible",
                    lorStatus: "not_eligible",
                    starStatus: "not_submitted",
                    offerLetterStatus: "approved"
                }
            ];
            fs.writeFileSync(file, JSON.stringify(defaultRecords, null, 2), 'utf8');
            return defaultRecords;
        }
        if (modelName === 'DomainTask') {
            const seedFile = path.join(__dirname, 'seeds', 'domainTasks.seed.js');
            if (fs.existsSync(seedFile)) {
                try {
                    const text = fs.readFileSync(seedFile, 'utf8');
                    const startIdx = text.indexOf('const ALL_TASKS = [');
                    if (startIdx !== -1) {
                        let endIdx = text.indexOf('// ─────────────────────────────────────────────\n// SEEDER FUNCTION', startIdx);
                        if (endIdx === -1) {
                            endIdx = text.indexOf('async function seed()', startIdx);
                        }
                        if (endIdx !== -1) {
                            let arrayStr = text.substring(startIdx + 'const ALL_TASKS ='.length, endIdx).trim();
                            if (arrayStr.endsWith(';')) {
                                arrayStr = arrayStr.substring(0, arrayStr.length - 1);
                            }
                            let evaluated = (new Function(`return ${arrayStr}`))();
                            if (Array.isArray(evaluated)) {
                                evaluated = evaluated.map(t => {
                                    if (!t._id) {
                                        t._id = crypto.randomBytes(12).toString('hex');
                                    }
                                    return t;
                                });
                                fs.writeFileSync(file, JSON.stringify(evaluated, null, 2), 'utf8');
                                return evaluated;
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error auto-seeding DomainTasks fallback:', e);
                }
            }
        }
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
    } catch (e) {
        return [];
    }
}

function saveCollectionData(modelName, data) {
    const file = path.join(DB_DIR, `db_${modelName}.json`);
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save local fallback DB:', e);
    }
}

function generateId() {
    try {
        return new mongoose.Types.ObjectId().toString();
    } catch (e) {
        return crypto.randomBytes(12).toString('hex');
    }
}

function matchQuery(item, query) {
    if (!query) return true;
    for (const key of Object.keys(query)) {
        if (key === '$or') {
            if (!Array.isArray(query.$or)) continue;
            let anyMatch = false;
            for (const subQuery of query.$or) {
                if (matchQuery(item, subQuery)) {
                    anyMatch = true;
                    break;
                }
            }
            if (!anyMatch) return false;
            continue;
        }
        
        const val = query[key];
        if (val && typeof val === 'object' && '$ne' in val) {
            const itemVal = item[key];
            if (itemVal === val.$ne) return false;
            continue;
        }

        if (val && typeof val === 'object' && ('$regex' in val)) {
            const itemVal = item[key];
            const regex = val.$regex instanceof RegExp ? val.$regex : new RegExp(val.$regex, val.$options || '');
            if (!regex.test(String(itemVal == null ? '' : itemVal))) return false;
            continue;
        }

        if (val && typeof val === 'object' && '$in' in val) {
            const itemVal = item[key];
            const inArr = val.$in;
            const matched = inArr.some(v => String(v) === String(itemVal) || v === itemVal);
            if (!matched) return false;
            continue;
        }

        if (val && typeof val === 'object' && '$exists' in val) {
            const exists = key in item && item[key] !== undefined && item[key] !== null;
            if (val.$exists && !exists) return false;
            if (!val.$exists && exists) return false;
            continue;
        }

        if (val && typeof val === 'object' && ('$gte' in val || '$lte' in val || '$gt' in val || '$lt' in val)) {
            const itemVal = item[key];
            if ('$gte' in val && !(itemVal >= val.$gte)) return false;
            if ('$lte' in val && !(itemVal <= val.$lte)) return false;
            if ('$gt'  in val && !(itemVal >  val.$gt))  return false;
            if ('$lt'  in val && !(itemVal <  val.$lt))  return false;
            continue;
        }
        
        const itemVal = item[key];
        const valStr = (val && val._id) ? String(val._id) : String(val);
        const itemValStr = (itemVal && itemVal._id) ? String(itemVal._id) : String(itemVal);
        
        if (itemValStr !== valStr) {
            if (item[key] !== val) {
                return false;
            }
        }
    }
    return true;
}

// Update operators supported by the JSON fallback engine.
//
// $inc and $unset were previously MISSING and silently ignored — an update
// using them appeared to succeed while changing nothing. That broke the
// atomic employee-ID counter (models/Counter.js), which relies on $inc:
// the sequence never advanced, so every registration in fallback mode would
// have been handed the same employee ID.
function applyUpdate(item, update) {
    if (!update) return;
    if (update.$set) {
        Object.assign(item, update.$set);
    }
    if (update.$inc) {
        for (const k of Object.keys(update.$inc)) {
            const delta = Number(update.$inc[k]) || 0;
            item[k] = (Number(item[k]) || 0) + delta;
        }
    }
    if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
            delete item[k];
        }
    }
    if (update.$push) {
        for (const k of Object.keys(update.$push)) {
            if (!Array.isArray(item[k])) item[k] = [];
            const value = update.$push[k];
            // { $push: { arr: { $each: [...] } } }
            if (value && typeof value === 'object' && Array.isArray(value.$each)) {
                item[k].push(...value.$each);
            } else {
                item[k].push(value);
            }
        }
    }
    if (update.$addToSet) {
        for (const k of Object.keys(update.$addToSet)) {
            if (!Array.isArray(item[k])) item[k] = [];
            const value = update.$addToSet[k];
            const candidates = (value && typeof value === 'object' && Array.isArray(value.$each))
                ? value.$each
                : [value];
            for (const candidate of candidates) {
                const exists = item[k].some(existing => String(existing) === String(candidate));
                if (!exists) item[k].push(candidate);
            }
        }
    }
    if (update.$pull) {
        for (const k of Object.keys(update.$pull)) {
            if (!Array.isArray(item[k])) continue;
            const value = update.$pull[k];
            item[k] = item[k].filter(existing => String(existing) !== String(value));
        }
    }
    for (const key of Object.keys(update)) {
        if (!key.startsWith('$')) {
            item[key] = update[key];
        }
    }
    item.updatedAt = new Date();
}

class FallbackQuery {
    constructor(promiseFn) {
        this.promiseFn = promiseFn;
        this._sort = null;
        this._limit = null;
        this._skip = 0;
        this._select = null;
    }
    sort(s) { this._sort = s; return this; }
    limit(l) { this._limit = l; return this; }
    // `skip()` was missing entirely, so any paginated query threw
    // "….sort(...).skip is not a function" the moment the fallback engine was
    // active — including the admin panel's student and audit-log lists.
    skip(n) { this._skip = n; return this; }
    populate() { return this; }
    // `select()` used to be a no-op that returned `this`. Callers use it as a
    // security projection — e.g. `.select('name employeeId')` to avoid shipping
    // the password hash — so while the fallback was active those projections
    // silently returned the FULL document. It now actually projects.
    select(fields) { this._select = fields; return this; }
    lean() { return this; }

    _applySelect(result) {
        if (!this._select || result == null) return result;

        // Mongoose accepts "a b -c" or { a: 1, c: 0 }.
        const include = new Set();
        const exclude = new Set();
        if (typeof this._select === 'string') {
            for (const token of this._select.split(/\s+/).filter(Boolean)) {
                if (token.startsWith('-')) exclude.add(token.slice(1));
                else include.add(token);
            }
        } else if (typeof this._select === 'object') {
            for (const [key, value] of Object.entries(this._select)) {
                if (value) include.add(key); else exclude.add(key);
            }
        }
        if (!include.size && !exclude.size) return result;

        const project = (doc) => {
            if (!doc || typeof doc !== 'object') return doc;
            const raw = doc.toObject ? doc.toObject() : doc;
            if (include.size) {
                const out = {};
                if (!exclude.has('_id')) out._id = raw._id;
                for (const field of include) {
                    if (raw[field] !== undefined) out[field] = raw[field];
                }
                return out;
            }
            const out = { ...raw };
            for (const field of exclude) delete out[field];
            return out;
        };

        return Array.isArray(result) ? result.map(project) : project(result);
    }

    exec() {
        // Skip must be applied BEFORE limit, the way MongoDB does: ask the
        // underlying reader for skip+limit rows, then drop the skipped ones.
        const fetchLimit = (this._limit != null && this._skip)
            ? this._limit + this._skip
            : this._limit;
        return this.promiseFn(this._sort, fetchLimit).then(r => {
            const sliced = (this._skip && Array.isArray(r)) ? r.slice(this._skip) : r;
            return this._applySelect(sliced);
        });
    }
    then(onResolve, onReject) {
        return this.exec().then(onResolve, onReject);
    }
    catch(onReject) {
        return this.exec().catch(onReject);
    }
}

function wrapModelWithFileFallback(model) {
    function isNetworkError(err) {
        if (!err) return false;
        const name = err.name || '';
        const msg = err.message || '';
        const isNet = name === 'MongoNetworkTimeoutError' ||
               name === 'MongoNetworkError' ||
               name === 'MongoTimeoutError' ||
               name === 'MongooseError' ||
               msg.toLowerCase().includes('timeout') ||
               msg.toLowerCase().includes('timed out') ||
               msg.toLowerCase().includes('connection') ||
               msg.toLowerCase().includes('network') ||
               msg.toLowerCase().includes('retryable') ||
               msg.toLowerCase().includes('failed to connect');
        if (isNet) {
            // Advisory, and it expires — see markMongoUnhealthy / isMongoHealthy.
            markMongoUnhealthy();
        }
        return isNet;
    }

    function runFindFallback(query, sortVal, limitVal) {
        let items = getCollectionData(model.modelName);
        let matched = items.filter(item => matchQuery(item, query));
        if (sortVal) {
            const sortKeys = Object.keys(sortVal);
            if (sortKeys.length > 0) {
                const key = sortKeys[0];
                const direction = sortVal[key];
                matched.sort((a, b) => {
                    const valA = a[key];
                    const valB = b[key];
                    if (valA < valB) return direction === -1 ? 1 : -1;
                    if (valA > valB) return direction === -1 ? -1 : 1;
                    return 0;
                });
            }
        }
        if (typeof limitVal === 'number') {
            matched = matched.slice(0, limitVal);
        }
        return matched.map(item => new model(item));
    }

    function runFindOneFallback(query) {
        let items = getCollectionData(model.modelName);
        let matched = items.find(item => matchQuery(item, query));
        return matched ? new model(matched) : null;
    }

    function runFindByIdFallback(id) {
        let items = getCollectionData(model.modelName);
        let matched = items.find(item => String(item._id) === String(id));
        return matched ? new model(matched) : null;
    }

    function runCountDocumentsFallback(query) {
        let items = getCollectionData(model.modelName);
        let matched = items.filter(item => matchQuery(item, query));
        return matched.length;
    }

    function runFindOneAndUpdateFallback(query, update, options) {
        let items = getCollectionData(model.modelName);
        let index = items.findIndex(item => matchQuery(item, query));
        if (index === -1) {
            if (options && options.upsert) {
                // MongoDB seeds an upserted document from the query's equality
                // conditions. Without this, findOneAndUpdate({_id: "employeeId"},
                // ..., {upsert:true}) created a row with a RANDOM _id, so the
                // next call did not find it and inserted another one — the
                // employee-ID counter could never advance.
                const newItem = { createdAt: new Date() };
                for (const [key, value] of Object.entries(query || {})) {
                    if (key.startsWith('$')) continue;
                    if (value !== null && typeof value === 'object') continue; // operator, not a literal
                    newItem[key] = value;
                }
                if (!newItem._id) newItem._id = generateId();
                applyUpdate(newItem, update);
                assertNoDuplicate(model.schema, items, newItem);
                items.push(newItem);
                saveCollectionData(model.modelName, items);
                return new model(newItem);
            }
            return null;
        }
        let item = items[index];
        applyUpdate(item, update);
        items[index] = item;
        saveCollectionData(model.modelName, items);
        return new model(item);
    }

    function runFindByIdAndUpdateFallback(id, update, options) {
        let items = getCollectionData(model.modelName);
        let index = items.findIndex(item => String(item._id) === String(id));
        if (index === -1) {
            if (options && options.upsert) {
                const newItem = { _id: String(id), createdAt: new Date() };
                applyUpdate(newItem, update);
                items.push(newItem);
                saveCollectionData(model.modelName, items);
                return new model(newItem);
            }
            return null;
        }
        let item = items[index];
        applyUpdate(item, update);
        items[index] = item;
        saveCollectionData(model.modelName, items);
        return new model(item);
    }

    function runCreateFallback(docOrDocs) {
        let items = getCollectionData(model.modelName);
        const isArray = Array.isArray(docOrDocs);
        const docs = isArray ? docOrDocs : [docOrDocs];
        const createdDocs = docs.map(d => {
            // Hydrate through the model so SCHEMA DEFAULTS are applied. The
            // raw object passed to create() only carries the fields the caller
            // supplied, so anything with a default — status, enums, counters —
            // was stored as undefined, and later queries filtering on those
            // fields silently matched nothing.
            let raw;
            try {
                raw = new model(d.toObject ? d.toObject() : d).toObject();
            } catch (_) {
                raw = d.toObject ? d.toObject() : { ...d };
            }
            return { ...raw, _id: raw._id || generateId(), createdAt: raw.createdAt || new Date(), updatedAt: new Date() };
        });
        // Enforce unique indexes, which the fallback previously ignored.
        for (const doc of createdDocs) {
            assertNoDuplicate(model.schema, items, doc);
            items.push(doc);
        }
        saveCollectionData(model.modelName, items);
        return isArray ? createdDocs.map(c => new model(c)) : new model(createdDocs[0]);
    }

    function runDeleteOneFallback(query) {
        let items = getCollectionData(model.modelName);
        let index = items.findIndex(item => matchQuery(item, query));
        if (index !== -1) {
            items.splice(index, 1);
            saveCollectionData(model.modelName, items);
            return { acknowledged: true, deletedCount: 1 };
        }
        return { acknowledged: true, deletedCount: 0 };
    }

    function runDeleteManyFallback(query) {
        let items = getCollectionData(model.modelName);
        const originalLength = items.length;
        items = items.filter(item => !matchQuery(item, query));
        saveCollectionData(model.modelName, items);
        return { acknowledged: true, deletedCount: originalLength - items.length };
    }

    function runUpdateManyFallback(query, update, options) {
        let items = getCollectionData(model.modelName);
        let count = 0;
        for (let item of items) {
            if (matchQuery(item, query)) {
                applyUpdate(item, update);
                count++;
            }
        }
        saveCollectionData(model.modelName, items);
        return { acknowledged: true, modifiedCount: count };
    }

    function runUpdateOneFallback(query, update, options) {
        let items = getCollectionData(model.modelName);
        let index = items.findIndex(item => matchQuery(item, query));
        if (index === -1) {
            if (options && options.upsert) {
                const newItem = { _id: generateId(), createdAt: new Date() };
                applyUpdate(newItem, update);
                items.push(newItem);
                saveCollectionData(model.modelName, items);
                return { acknowledged: true, matchedCount: 0, modifiedCount: 1, upsertedId: newItem._id };
            }
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
        let item = items[index];
        applyUpdate(item, update);
        items[index] = item;
        saveCollectionData(model.modelName, items);
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }

    function runInsertManyFallback(docs) {
        let items = getCollectionData(model.modelName);
        const newDocs = (Array.isArray(docs) ? docs : [docs]).map(d => {
            const raw = d.toObject ? d.toObject() : { ...d };
            return { ...raw, _id: raw._id || generateId(), createdAt: new Date() };
        });
        items.push(...newDocs);
        saveCollectionData(model.modelName, items);
        return newDocs;
    }

    function runBulkWriteFallback(ops) {
        let items = getCollectionData(model.modelName);
        for (const op of ops) {
            if (op.updateOne) {
                const { filter, update, upsert } = op.updateOne;
                let index = items.findIndex(item => matchQuery(item, filter));
                if (index === -1) {
                    if (upsert) {
                        const newItem = { _id: generateId(), createdAt: new Date() };
                        applyUpdate(newItem, update);
                        items.push(newItem);
                    }
                } else {
                    applyUpdate(items[index], update);
                }
            }
        }
        saveCollectionData(model.modelName, items);
        return { ok: 1, nModified: ops.length };
    }

    function runAggregateFallback(pipeline) {
        let items = getCollectionData(model.modelName);
        let result = JSON.parse(JSON.stringify(items)); // deep copy

        for (const stage of pipeline) {
            if (stage.$match) {
                result = result.filter(item => matchQuery(item, stage.$match));
            } else if (stage.$unwind) {
                let path = stage.$unwind;
                if (typeof path === 'object' && path.path) path = path.path;
                if (typeof path === 'string' && path.startsWith('$')) path = path.slice(1);
                
                const unwound = [];
                for (const item of result) {
                    const val = item[path];
                    if (Array.isArray(val)) {
                        for (const elem of val) {
                            unwound.push({ ...item, [path]: elem });
                        }
                    } else if (val !== undefined && val !== null) {
                        unwound.push(item);
                    }
                }
                result = unwound;
            } else if (stage.$group) {
                const groupById = stage.$group._id;
                const groups = {}; // key string -> values
                
                for (const item of result) {
                    let idVal = null;
                    if (typeof groupById === 'string' && groupById.startsWith('$')) {
                        const key = groupById.slice(1);
                        idVal = item[key];
                    } else if (typeof groupById === 'object' && groupById !== null) {
                        idVal = {};
                        for (const k of Object.keys(groupById)) {
                            let pathVal = groupById[k];
                            if (typeof pathVal === 'string' && pathVal.startsWith('$')) {
                                idVal[k] = item[pathVal.slice(1)];
                            } else {
                                idVal[k] = pathVal;
                            }
                        }
                    } else {
                        idVal = groupById;
                    }
                    
                    const groupKey = (typeof idVal === 'object' && idVal !== null) ? JSON.stringify(idVal) : String(idVal);
                    if (!groups[groupKey]) {
                        groups[groupKey] = { _id: idVal, _items: [] };
                        // Add extra custom accumulators
                        for (const field of Object.keys(stage.$group)) {
                            if (field === '_id') continue;
                            const acc = stage.$group[field];
                            if (acc.$sum !== undefined) {
                                groups[groupKey][field] = 0;
                            }
                        }
                    }
                    groups[groupKey]._items.push(item);
                    
                    for (const field of Object.keys(stage.$group)) {
                        if (field === '_id') continue;
                        const acc = stage.$group[field];
                        if (acc.$sum !== undefined) {
                            let addVal = 0;
                            if (typeof acc.$sum === 'number') {
                                addVal = acc.$sum;
                            } else if (typeof acc.$sum === 'string' && acc.$sum.startsWith('$')) {
                                addVal = Number(item[acc.$sum.slice(1)]) || 0;
                            }
                            groups[groupKey][field] += addVal;
                        }
                    }
                }
                
                result = Object.values(groups).map(g => {
                    const { _items, ...rest } = g;
                    return rest;
                });
            } else if (stage.$sort) {
                const sortKeys = Object.keys(stage.$sort);
                if (sortKeys.length > 0) {
                    const key = sortKeys[0];
                    const direction = stage.$sort[key];
                    result.sort((a, b) => {
                        let valA = a[key];
                        let valB = b[key];
                        if (typeof valA === 'object' && valA !== null) valA = JSON.stringify(valA);
                        if (typeof valB === 'object' && valB !== null) valB = JSON.stringify(valB);
                        if (valA < valB) return direction === -1 ? 1 : -1;
                        if (valA > valB) return direction === -1 ? -1 : 1;
                        return 0;
                    });
                }
            } else if (stage.$limit) {
                result = result.slice(0, stage.$limit);
            } else if (stage.$project) {
                result = result.map(item => {
                    const projected = {};
                    for (const k of Object.keys(stage.$project)) {
                        const pVal = stage.$project[k];
                        if (pVal === 1) {
                            projected[k] = item[k];
                        } else if (typeof pVal === 'string' && pVal.startsWith('$')) {
                            projected[k] = item[pVal.slice(1)];
                        }
                    }
                    // handle _id: 0
                    if (stage.$project._id === 0) {
                        delete projected._id;
                    } else if (projected._id === undefined && item._id !== undefined) {
                        projected._id = item._id;
                    }
                    return projected;
                });
            }
        }
        return result;
    }

    // find
    const originalFind = model.find;
    model.find = function(query) {
        if (!checkMongoStatus()) {
            return new FallbackQuery(async (sortVal, limitVal) => {
                return runFindFallback(query, sortVal, limitVal);
            });
        }
        const mongooseQuery = originalFind.apply(this, arguments);
        const originalExec = mongooseQuery.exec;
        mongooseQuery.exec = function() {
            return originalExec.apply(this, arguments).catch(err => {
                if (isNetworkError(err)) {
                    console.warn(`[DB FALLBACK] find failed with network error: "${err.message}". Falling back to file DB...`);
                    return runFindFallback(query, mongooseQuery._sort, mongooseQuery._limit);
                }
                throw err;
            });
        };
        mongooseQuery.then = function(onResolve, onReject) {
            return this.exec().then(onResolve, onReject);
        };
        mongooseQuery.catch = function(onReject) {
            return this.exec().catch(onReject);
        };
        return mongooseQuery;
    };

    // findOne
    const originalFindOne = model.findOne;
    model.findOne = function(query) {
        if (!checkMongoStatus()) {
            return new FallbackQuery(async () => {
                return runFindOneFallback(query);
            });
        }
        const mongooseQuery = originalFindOne.apply(this, arguments);
        const originalExec = mongooseQuery.exec;
        mongooseQuery.exec = function() {
            return originalExec.apply(this, arguments).catch(err => {
                if (isNetworkError(err)) {
                    console.warn(`[DB FALLBACK] findOne failed with network error: "${err.message}". Falling back...`);
                    return runFindOneFallback(query);
                }
                throw err;
            });
        };
        mongooseQuery.then = function(onResolve, onReject) {
            return this.exec().then(onResolve, onReject);
        };
        mongooseQuery.catch = function(onReject) {
            return this.exec().catch(onReject);
        };
        return mongooseQuery;
    };

    // findById
    const originalFindById = model.findById;
    model.findById = function(id) {
        if (!checkMongoStatus()) {
            return new FallbackQuery(async () => {
                return runFindByIdFallback(id);
            });
        }
        const mongooseQuery = originalFindById.apply(this, arguments);
        const originalExec = mongooseQuery.exec;
        mongooseQuery.exec = function() {
            return originalExec.apply(this, arguments).catch(err => {
                if (isNetworkError(err)) {
                    console.warn(`[DB FALLBACK] findById failed with network error: "${err.message}". Falling back...`);
                    return runFindByIdFallback(id);
                }
                throw err;
            });
        };
        mongooseQuery.then = function(onResolve, onReject) {
            return this.exec().then(onResolve, onReject);
        };
        mongooseQuery.catch = function(onReject) {
            return this.exec().catch(onReject);
        };
        return mongooseQuery;
    };

    // countDocuments
    const originalCountDocuments = model.countDocuments;
    model.countDocuments = function(query) {
        if (!checkMongoStatus()) {
            return new FallbackQuery(async () => {
                return runCountDocumentsFallback(query);
            });
        }
        const mongooseQuery = originalCountDocuments.apply(this, arguments);
        const originalExec = mongooseQuery.exec;
        mongooseQuery.exec = function() {
            return originalExec.apply(this, arguments).catch(err => {
                if (isNetworkError(err)) {
                    console.warn(`[DB FALLBACK] countDocuments failed with network error: "${err.message}". Falling back...`);
                    return runCountDocumentsFallback(query);
                }
                throw err;
            });
        };
        mongooseQuery.then = function(onResolve, onReject) {
            return this.exec().then(onResolve, onReject);
        };
        mongooseQuery.catch = function(onReject) {
            return this.exec().catch(onReject);
        };
        return mongooseQuery;
    };

    // findOneAndUpdate
    const originalFindOneAndUpdate = model.findOneAndUpdate;
    model.findOneAndUpdate = function(query, update, options) {
        if (!checkMongoStatus()) {
            return new FallbackQuery(async () => {
                return runFindOneAndUpdateFallback(query, update, options);
            });
        }
        const mongooseQuery = originalFindOneAndUpdate.apply(this, arguments);
        const originalExec = mongooseQuery.exec;
        mongooseQuery.exec = function() {
            return originalExec.apply(this, arguments).catch(err => {
                if (isNetworkError(err)) {
                    console.warn(`[DB FALLBACK] findOneAndUpdate failed with network error: "${err.message}". Falling back...`);
                    return runFindOneAndUpdateFallback(query, update, options);
                }
                throw err;
            });
        };
        mongooseQuery.then = function(onResolve, onReject) {
            return this.exec().then(onResolve, onReject);
        };
        mongooseQuery.catch = function(onReject) {
            return this.exec().catch(onReject);
        };
        return mongooseQuery;
    };

    // findByIdAndUpdate
    const originalFindByIdAndUpdate = model.findByIdAndUpdate;
    model.findByIdAndUpdate = function(id, update, options) {
        if (!checkMongoStatus()) {
            return new FallbackQuery(async () => {
                return runFindByIdAndUpdateFallback(id, update, options);
            });
        }
        const mongooseQuery = originalFindByIdAndUpdate.apply(this, arguments);
        const originalExec = mongooseQuery.exec;
        mongooseQuery.exec = function() {
            return originalExec.apply(this, arguments).catch(err => {
                if (isNetworkError(err)) {
                    console.warn(`[DB FALLBACK] findByIdAndUpdate failed with network error: "${err.message}". Falling back...`);
                    return runFindByIdAndUpdateFallback(id, update, options);
                }
                throw err;
            });
        };
        mongooseQuery.then = function(onResolve, onReject) {
            return this.exec().then(onResolve, onReject);
        };
        mongooseQuery.catch = function(onReject) {
            return this.exec().catch(onReject);
        };
        return mongooseQuery;
    };

    // create
    const originalCreate = model.create;
    model.create = function(docOrDocs) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runCreateFallback(docOrDocs));
        }
        return originalCreate.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] create failed with network error: "${err.message}". Falling back...`);
                return runCreateFallback(docOrDocs);
            }
            throw err;
        });
    };

    // deleteOne
    const originalDeleteOne = model.deleteOne;
    model.deleteOne = function(query) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runDeleteOneFallback(query));
        }
        return originalDeleteOne.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] deleteOne failed with network error: "${err.message}". Falling back...`);
                return runDeleteOneFallback(query);
            }
            throw err;
        });
    };

    // deleteMany
    const originalDeleteMany = model.deleteMany;
    model.deleteMany = function(query) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runDeleteManyFallback(query));
        }
        return originalDeleteMany.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] deleteMany failed with network error: "${err.message}". Falling back...`);
                return runDeleteManyFallback(query);
            }
            throw err;
        });
    };

    // updateMany
    const originalUpdateMany = model.updateMany;
    model.updateMany = function(query, update, options) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runUpdateManyFallback(query, update, options));
        }
        return originalUpdateMany.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] updateMany failed with network error: "${err.message}". Falling back...`);
                return runUpdateManyFallback(query, update, options);
            }
            throw err;
        });
    };

    // updateOne
    const originalUpdateOne = model.updateOne;
    model.updateOne = function(query, update, options) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runUpdateOneFallback(query, update, options));
        }
        return originalUpdateOne.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] updateOne failed with network error: "${err.message}". Falling back...`);
                return runUpdateOneFallback(query, update, options);
            }
            throw err;
        });
    };

    // insertMany
    const originalInsertMany = model.insertMany;
    model.insertMany = function(docs) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runInsertManyFallback(docs));
        }
        return originalInsertMany.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] insertMany failed with network error: "${err.message}". Falling back...`);
                return runInsertManyFallback(docs);
            }
            throw err;
        });
    };

    // bulkWrite
    const originalBulkWrite = model.bulkWrite;
    model.bulkWrite = function(ops) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runBulkWriteFallback(ops));
        }
        return originalBulkWrite.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] bulkWrite failed with network error: "${err.message}". Falling back...`);
                return runBulkWriteFallback(ops);
            }
            throw err;
        });
    };

    // aggregate
    const originalAggregate = model.aggregate;
    model.aggregate = function(pipeline) {
        if (!checkMongoStatus()) {
            return Promise.resolve(runAggregateFallback(pipeline));
        }
        return originalAggregate.apply(this, arguments).catch(err => {
            if (isNetworkError(err)) {
                console.warn(`[DB FALLBACK] aggregate failed with network error: "${err.message}". Falling back...`);
                return runAggregateFallback(pipeline);
            }
            throw err;
        });
    };
}

const originalSave = mongoose.Model.prototype.save;
mongoose.Model.prototype.save = function() {
    const modelName = this.constructor.modelName;
    function runSaveFallback(instance) {
        let items = getCollectionData(modelName);
        const obj = instance.toObject ? instance.toObject() : { ...instance };
        if (!obj._id) {
            obj._id = generateId();
        } else {
            obj._id = String(obj._id);
        }
        
        const idx = items.findIndex(item => String(item._id) === String(obj._id));
        if (idx !== -1) {
            const merged = { ...items[idx], ...obj, updatedAt: new Date() };
            assertNoDuplicate(instance.schema || (instance.constructor && instance.constructor.schema), items, merged, obj._id);
            items[idx] = merged;
        } else {
            obj.createdAt = obj.createdAt || new Date();
            obj.updatedAt = obj.updatedAt || new Date();
            assertNoDuplicate(instance.schema || (instance.constructor && instance.constructor.schema), items, obj);
            items.push(obj);
        }
        saveCollectionData(modelName, items);
        return instance;
    }

    if (!checkMongoStatus()) {
        return Promise.resolve(runSaveFallback(this));
    }
    return originalSave.apply(this, arguments).catch(err => {
        function isNetworkError(e) {
            if (!e) return false;
            const name = e.name || '';
            const msg = e.message || '';
            const isNet = name === 'MongoNetworkTimeoutError' ||
                   name === 'MongoNetworkError' ||
                   name === 'MongoTimeoutError' ||
                   name === 'MongooseError' ||
                   msg.toLowerCase().includes('timeout') ||
                   msg.toLowerCase().includes('timed out') ||
                   msg.toLowerCase().includes('connection') ||
                   msg.toLowerCase().includes('network') ||
                   msg.toLowerCase().includes('retryable') ||
                   msg.toLowerCase().includes('failed to connect');
            if (isNet) {
                markMongoUnhealthy();   // advisory, expires — see isMongoHealthy
            }
            return isNet;
        }
        if (isNetworkError(err)) {
            console.warn(`[DB FALLBACK] save failed with network error: "${err.message}". Falling back...`);
            return runSaveFallback(this);
        }
        throw err;
    });
};

const originalModel = mongoose.model;
mongoose.model = function(name, schema, collection) {
    const model = originalModel.apply(this, arguments);
    wrapModelWithFileFallback(model);
    return model;
};
const multer = require("multer");
const nodemailer = require("nodemailer");

const Student = require("./models/Student");
if(!Student.schema.path("lastActiveDate"))    Student.schema.add({ lastActiveDate:    { type: Date } });
// NEW FEATURE: V2 student portal fields — added early so findOne() recognises them
if(!Student.schema.path("v2Onboarded"))    Student.schema.add({ v2Onboarded:    { type: Boolean, default: false } });
if(!Student.schema.path("v2DurationType")) Student.schema.add({ v2DurationType: { type: String,  default: null  } });
const DocumentHistory = require("./models/DocumentHistory");
const { generateDocumentNumber, normalizeDocumentNumber } = require("./utils/documentNumber");
const MailHistory = require("./models/MailHistory");
const Notice = require("./models/Notice");
const Notification = require("./models/Notification");
const Attendance = require("./models/Attendance");
const AutoTask = require("./models/AutoTask");
const TaskAssignment = require("./models/TaskAssignment");
const Message = require("./models/Message");
const HR = require("./models/HR");
const Coordinator = require("./models/Coordinator");
const Promotion = require("./models/Promotion");
const BadgeAward = require("./models/BadgeAward");
const BlockList = require("./models/BlockList");
// Personal blocks (any role, everywhere) and abuse reports for the admin desk.
// BlockList above is the older per-room staff mute; the two are different
// tools and both are kept.
const UserBlock = require("./models/UserBlock");
const ChatReport = require("./models/ChatReport");
const EcosystemUser = require("./models/EcosystemUser");

const autoMailLogSchema = new mongoose.Schema({
  studentName:  String,
  studentEmail: String,
  employeeId:   String,
  mailType:     String,
  sentAt:       { type: Date, default: Date.now }
});
const AutoMailLog = mongoose.model('AutoMailLog', autoMailLogSchema);

// Tenure interpretation lives in utils/tenure.js. This wrapper is kept only
// because several call sites still ask for a day count by name.
function getTenureTotalDays(tenure) {
  return tenureUtils.getTenureDays(tenure);
}

/**
 * Legacy shape, computed from the shared attendance module.
 *
 * The original implementation here divided by ELAPSED CALENDAR days —
 * Sundays included — while utils/attendanceUtils excluded them and two other
 * copies in this file used the full tenure as the denominator. The same student
 * therefore had up to four different attendance percentages depending on which
 * endpoint was asked. The numbers below now come from one calculation.
 */
function calcAttendancePercentage(student, presentCount) {
  const summary = attendanceUtils.getAttendanceSummary([], student);
  const elapsed = summary.workingDaysElapsed;
  const present = Math.min(Number(presentCount) || 0, elapsed);
  return {
    percentage: elapsed > 0 ? Math.min(Math.round((present / elapsed) * 100), 100) : 0,
    totalDays: elapsed,
    tenureTotalDays: summary.totalCalendarDays,
    presentDays: present,
    absentDays: Math.max(elapsed - present, 0),
    requiredDays: Math.ceil(elapsed * attendanceUtils.ATTENDANCE_THRESHOLD)
  };
}

const bcrypt = require("bcryptjs");
const { requireAdminAPI } = require("./middleware/adminAuth");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const QRCode = require("qrcode");
const cron = require("node-cron");
const http = require("http");
const { Server: SocketIOServer } = require("socket.io");

// All domains supported by the system (Requirement 5: HR Management included).
// Anywhere the backend filters or iterates domains, it should reference this list.
const ALL_DOMAINS = [
    "DevOps with AWS","Python Development","Java Development","Web Development",
    "MERN Stack Development","Artificial Intelligence","Data Science",
    "Cyber Security","Software Engineering","Flutter Development",
    "HR Management",
    "Venture Capital","Vibe Coding","Space Research","Business Analyst","HR"
];

// Shared credential maps (legacy hardcoded accounts).
// Used by /hr-login, /coordinator-login, and chat handshake auth.
// New DB-backed accounts (created via the promotion flow) are stored in the
// `HR` and `Coordinator` collections and looked up alongside these maps.
// SECURITY: these credential maps were hardcoded in source with cleartext
// passwords, so every HR and coordinator account was public to anyone with
// repository access. They are now loaded from the HR_CREDENTIALS /
// COORDINATOR_CREDENTIALS environment variables (JSON, same shape). The
// literals below are retained ONLY as a non-production dev fallback and the
// process refuses to start in production without the env vars.
//
// There are NO passwords in this file. The roster below carries only the
// non-secret org structure — display name, contact email, seniority level for
// HR; assigned domain for coordinators. Every password is supplied at runtime
// via the HR_CREDENTIALS / COORDINATOR_CREDENTIALS environment variables, as
// bcrypt hashes:
//
//   HR_CREDENTIALS={"jrhr@ten.com":{"passwordHash":"$2b$12$..."}, ...}
//
// Generate that value with:  node scripts/generate-credentials-env.js
//
// An account in the roster with no matching env entry simply cannot log in.

const HR_ROSTER = {
    "jrhr@ten.com":       { name: "Jr HR Associate",                    email: "jrhr@ten.com",       level: 1 },
    "srhr@ten.com":       { name: "Sr HR Associate",                    email: "srhr@ten.com",       level: 2 },
    "jrmanager@ten.com":  { name: "Jr HR Manager",                      email: "jrmanager@ten.com",  level: 3 },
    "srmanager@ten.com":  { name: "Sr HR Manager",                      email: "srmanager@ten.com",  level: 4 },
    "hrad@ten.com":       { name: "HR Associate Director",              email: "hrad@ten.com",       level: 5 },
    "jrdir@ten.com":      { name: "Jr HR Director",                     email: "jrdir@ten.com",      level: 6 },
    "hrdirector@ten.com": { name: "HR Director & HRBP",                 email: "hrdirector@ten.com", level: 7 },
    "vp@ten.com":         { name: "Vice President",                     email: "vp@ten.com",         level: 8 }
};
// Eight levels, and level 8 is the Vice President. There is no ninth level and
// no CHRO account: the portal's own level switcher, its hrLevelDetails map and
// the position selector on the landing page all stop at 8, and the account list
// runs jrhr → vp with nothing in between. A chro@ten.com entry at level 8 had
// pushed vp to a level 9 that no part of the UI can select, so the highest HR
// account could never match the privileges meant for the top of the hierarchy.

const COORDINATOR_ROSTER = {
    "devops_aws_admin":      { domain: "DevOps with AWS" },
    "python_admin":          { domain: "Python Development" },
    "java_admin":            { domain: "Java Development" },
    "web_admin":             { domain: "Web Development" },
    "mern_admin":            { domain: "MERN Stack Development" },
    "ai_admin":              { domain: "Artificial Intelligence" },
    "datascience_admin":     { domain: "Data Science" },
    "cyber_admin":           { domain: "Cyber Security" },
    "software_admin":        { domain: "Software Engineering" },
    "flutter_admin":         { domain: "Flutter Development" },
    "hrmgmt_admin":          { domain: "HR Management" },
    "venturecapital_admin":  { domain: "Venture Capital" },
    "vibecoding_admin":      { domain: "Vibe Coding" },
    "spaceresearch_admin":   { domain: "Space Research" },
    "businessanalyst_admin": { domain: "Business Analyst" },
    "hr_domain_admin":       { domain: "HR" }
};

/**
 * Merge a non-secret roster with the password material in `envName`.
 * Entries in the env var may also override roster metadata (name/email/level/
 * domain), so a new account can be added without a code change.
 */
function loadCredentialMap(envName, roster) {
    const merged = {};
    let secrets = {};

    const raw = process.env[envName];
    if (raw && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                secrets = parsed;
            } else {
                console.error('[credentials] ' + envName + ' is not a JSON object; ignoring it.');
            }
        } catch (e) {
            console.error('[credentials] ' + envName + ' is not valid JSON: ' + e.message);
        }
    }

    for (const username of new Set([...Object.keys(roster), ...Object.keys(secrets)])) {
        const entry = { ...(roster[username] || {}), ...(secrets[username] || {}) };
        if (!entry.passwordHash && !entry.password) continue; // no credential → no account
        if (entry.password && !entry.passwordHash) {
            console.warn('[credentials] ' + envName + '.' + username +
                ' uses a cleartext "password". Switch it to "passwordHash" — run scripts/generate-credentials-env.js.');
        }
        merged[username] = entry;
    }

    const configured = Object.keys(merged).length;
    if (configured === 0) {
        const msg = '[credentials] ' + envName + ' provides no usable accounts. ' +
            'Nobody can log in through this map.';
        if (process.env.NODE_ENV === 'production') {
            console.error('\n' + msg + ' Refusing to start.\n');
            process.exit(1);
        }
        console.warn(msg);
    } else {
        console.log('[credentials] ' + envName + ': ' + configured + ' account(s) configured.');
    }
    return merged;
}

/**
 * Constant-time-ish password check for a roster account. Prefers the bcrypt
 * hash; falls back to a length-safe comparison for legacy cleartext entries.
 */
async function verifyCredentialPassword(account, submitted) {
    if (!account || typeof submitted !== 'string' || !submitted) return false;
    if (account.passwordHash) {
        try {
            return await bcrypt.compare(submitted, account.passwordHash);
        } catch (_) {
            return false;
        }
    }
    if (typeof account.password === 'string' && account.password.length === submitted.length) {
        return crypto.timingSafeEqual(Buffer.from(account.password), Buffer.from(submitted));
    }
    return false;
}

// NOTE: `HR_ACCOUNTS` and `COORDINATORS` were referenced in the login, chat and
// promotion handlers but never actually declared anywhere, so every legacy
// lookup threw a ReferenceError into the enclosing try/catch and surfaced as a
// generic server error. They are declared here.
const HR_ACCOUNTS  = loadCredentialMap('HR_CREDENTIALS', HR_ROSTER);
const COORDINATORS = loadCredentialMap('COORDINATOR_CREDENTIALS', COORDINATOR_ROSTER);

// ─── Session identity ────────────────────────────────────────────────────────
//
// Handlers used to resolve the acting user like this:
//
//   req.body.employeeId || req.headers['x-employee-id'] || req.session.student...
//
// which lets a caller act as ANY student just by setting a header — the
// client-supplied value won over the session. The helpers below are the only
// sanctioned way to answer "who is making this request": they read the session
// and nothing else.

// Fields that must never leave the server in an API response. Login used to
// return `student.toObject()` wholesale, which shipped the bcrypt password
// hash and the live password-reset token to the browser (and into anything
// that logged the response). The base64 PDF blobs are stripped too: they are
// megabytes each and the client fetches documents through their own routes.
const STUDENT_PRIVATE_FIELDS = [
    "password", "plainPassword",
    "passwordResetToken", "passwordResetExpiry",
    "locPdfBase64", "lorPdfBase64", "starPdfBase64", "offerPdfBase64", "lopPdfBase64"
];

/**
 * Strip private fields from a Student document/object before returning it.
 * Adds `has*Pdf` booleans so the UI can still tell which documents exist.
 */
function sanitizeStudent(student) {
    if (!student) return student;
    const obj = student.toObject ? student.toObject() : { ...student };
    const safe = {
        ...obj,
        hasLocPdf:   !!obj.locPdfBase64,
        hasLorPdf:   !!obj.lorPdfBase64,
        hasStarPdf:  !!obj.starPdfBase64,
        hasOfferPdf: !!obj.offerPdfBase64,
        hasLopPdf:   !!obj.lopPdfBase64
    };
    for (const field of STUDENT_PRIVATE_FIELDS) delete safe[field];
    return safe;
}

function establishStudentSession(req, student) {
    if (!req.session || !student) return;
    // Student sessions get the longer window — see STUDENT_SESSION_MS.
    if (req.session.cookie) req.session.cookie.maxAge = STUDENT_SESSION_MS;
    req.session.student = {
        _id:        String(student._id || ""),
        employeeId: student.employeeId || "",
        email:      student.email || "",
        name:       student.name || "",
        domain:     student.domain || ""
    };
}

/** @returns {string} the session student's employeeId, or "" when unauthenticated. */
function sessionEmployeeId(req) {
    return (req.session && req.session.student && req.session.student.employeeId) || "";
}

function requireStudentSession(req, res, next) {
    if (!sessionEmployeeId(req)) {
        return res.status(401).json({ success: false, message: "Please sign in to continue." });
    }
    next();
}

function requireCoordinatorSession(req, res, next) {
    if (!req.session || !req.session.coordinator) {
        return res.status(401).json({ success: false, message: "Coordinator sign-in required." });
    }
    next();
}

/**
 * Is this request carrying an HR (or admin) session?
 *
 * The legacy HR endpoints used to gate on
 * `req.headers.authorization.startsWith("Bearer hr_")` — a prefix check with
 * no token validation, so the literal string "Bearer hr_" passed. Every one of
 * those checks now calls this instead.
 */
function isHRSession(req) {
    return !!(req.session && (req.session.hr || req.session.adminUser));
}

function requireHRSession(req, res, next) {
    if (!req.session || !req.session.hr) {
        return res.status(401).json({ success: false, message: "HR sign-in required." });
    }
    next();
}

/**
 * Editing and removing student records: HR staff or an admin.
 *
 * `PUT`/`DELETE /students/:id` were unauthenticated, and closing that hole by
 * putting them behind `requireAdminAPI` overshot — that guard wants
 * `req.session.adminUser`, which only a /ten-admin sign-in creates. HR signs in
 * through /hr-login and gets `req.session.hr`, so every Save Changes and
 * Delete Student in the HR portal's side panel came back 401 and the panel
 * reported a flat "Update failed."
 *
 * Managing student records is the HR portal's core job, so HR belongs on this
 * endpoint. The guard still requires a real server-side session — it is not a
 * return to the anonymous access these routes had before.
 */
function requireHROrAdminAPI(req, res, next) {
    if (isHRSession(req)) return next();
    return res.status(401).json({ success: false, message: "HR or admin sign-in required." });
}

/** Coordinators and HR both review student work; admins can do anything. */
function requireStaffSession(req, res, next) {
    if (req.session && (req.session.coordinator || req.session.hr || req.session.adminUser)) return next();
    return res.status(401).json({ success: false, message: "Staff sign-in required." });
}

const app = express();

const compression = require('compression');
app.use(compression({
    level: 6,
    threshold: 1024
}));

// ===== Production config =====
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://virtualinternships.entrepreneurshipnetwork.net";

// Ensure uploads directory exists (multer writes to it)
const uploadsAbs = path.join(__dirname, "uploads");
try { fs.mkdirSync(uploadsAbs, { recursive: true }); } catch(_) {}
try { fs.mkdirSync(path.join(uploadsAbs, "documents"), { recursive: true }); } catch(_) {}
try { fs.mkdirSync(path.join(uploadsAbs, "certificates"), { recursive: true }); } catch(_) {}
try { fs.mkdirSync(path.join(uploadsAbs, "offer-letters"), { recursive: true }); } catch(_) {}

// Validate required secrets before anything is wired up. In production a
// missing secret aborts the boot rather than silently falling back to a value
// that is public in this repository.
const { assertSecrets, IS_PRODUCTION } = require('./config/secrets');
assertSecrets();

app.set('trust proxy', 1);

// CORS: an explicit origin allowlist in production. Credentials ride these
// requests (the session cookie), so a wildcard origin is never acceptable
// there. Outside production an empty allowlist means "reflect any origin" so
// local development against file:// and localhost ports keeps working.
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Same-origin / curl / server-to-server requests send no Origin header.
        if (!origin) return callback(null, true);
        if (CORS_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        if (!IS_PRODUCTION && CORS_ALLOWED_ORIGINS.length === 0) return callback(null, true);
        return callback(null, false);
    },
    credentials: true
}));
app.use(express.json());

const session = require('express-session');

// No fallback secret: a committed signing key lets anyone mint a session for
// any role. config/secrets.js has already refused the boot in production if
// this is unset; outside production we generate a throwaway key per process so
// sessions simply do not survive a restart.
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim()
    || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.warn('[session] SESSION_SECRET is unset; using a random per-process key. Sessions will not survive a restart.');
}

const sessionOptions = {
    name: 'ten.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // Refresh the cookie's expiry on every request. Without this, maxAge counts
    // from LOGIN, not from last activity, so a student working through a task
    // journey was signed out 30 minutes in — mid-video, mid-submission — and
    // got "Please sign in to continue" with no warning. Now the 30 minutes is
    // 30 minutes of inactivity, which is what it was always meant to be.
    rolling: true,
    cookie: {
        secure: IS_PRODUCTION,
        sameSite: IS_PRODUCTION ? 'none' : 'lax',
        httpOnly: true,
        // The base lifetime. Staff sessions keep this; a student's is extended
        // to STUDENT_SESSION_MS below, once they sign in.
        maxAge: 30 * 60 * 1000 // 30 minutes of inactivity
    }
};

/**
 * How long a student stays signed in.
 *
 * A push notification is only useful if tapping it lands the student IN the
 * portal. With a 30-minute window that essentially never happened: the
 * notification arrived hours later, the session was long gone, and the tap
 * dropped them on a login screen — which defeats the point of notifying them.
 *
 * So a student's cookie lives for 24 hours of inactivity. Tap a notification
 * within a day of last using the portal and you are already signed in; leave it
 * longer and the session has expired, the page 401s, and session-guard.js sends
 * you to the login screen carrying ?next= so you land where you were going.
 * That is precisely the behaviour asked for, and it needs no new mechanism.
 *
 * What it deliberately is NOT: a sign-in token embedded in the notification
 * URL. A notification's URL is written to the operating system's notification
 * log and to browser history, so a credential placed there is readable by
 * anyone who picks up the phone — a worse trade than a longer cookie, which at
 * least stays httpOnly and server-revocable.
 *
 * HR, coordinator and admin sessions keep the 30-minute window. They hold far
 * more authority than a student account, they work from shared machines, and
 * they are not the ones being notified about a chat message.
 */
const STUDENT_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * Where sessions live.
 *
 * MongoDB when it is reachable, an in-process MemoryStore only when it is not.
 * Which one is in use decides whether people stay signed in, so the rules are
 * written out here rather than inferred.
 *
 * THREE THINGS THIS CLASS GOT WRONG, each of which signed everybody out:
 *
 * 1. It consulted `global.isMongoUnhealthy`, a flag that LATCHES. Any query
 *    error whose message merely contains the word "connection" or "network"
 *    sets it (see isNetworkError), and nothing clears it except a mongoose
 *    'connected' or 'reconnected' event — which never fires if the socket
 *    never actually dropped. One slow query that timed out therefore moved
 *    every session in the portal to memory permanently: sessions already in
 *    Mongo became unreadable, so everyone was signed out at once, and every
 *    session created afterwards died at the next deploy. That is the "the HR
 *    section is down again" report.
 *
 *    `mongoose.connection.readyState` is the authority and recovers on its
 *    own. The flag is no longer consulted here.
 *
 * 2. `ttl: 1800` hard-capped EVERY session at 30 minutes in the store,
 *    whatever its cookie said. The 24-hour student session added for
 *    notification links was silently reduced to 30 minutes — the cookie
 *    promised a day, the store deleted the document after half an hour. With
 *    no `ttl`, connect-mongo takes each session's own `cookie.expires`, so HR
 *    keeps 30 minutes and a student keeps 24 hours, per session, correctly.
 *
 * 3. `get()` treated a store ERROR as "no such session". A transient Mongo
 *    error therefore looked exactly like a signed-out user, and the portal
 *    reads that as a sign-out. An error is now propagated: the request fails
 *    honestly and the session survives.
 */
class FallbackStore extends session.Store {
    constructor() {
        super();
        this.memoryStore = new session.MemoryStore();
        this.mongoStore = null;
        this.warnedAboutMemory = false;
    }

    /** True when Mongo is genuinely available for session storage. */
    _mongoReady() {
        return !!process.env.MONGODB_URI && mongoose.connection.readyState === 1;
    }

    _getStore() {
        if (this._mongoReady()) {
            if (!this.mongoStore) {
                try {
                    console.log("[FallbackStore] MongoDB is connected. Initializing MongoStore for session persistence...");
                    const MongoStore = require('connect-mongo').MongoStore;
                    this.mongoStore = MongoStore.create({
                        mongoUrl: process.env.MONGODB_URI,
                        // No `ttl`: each session document expires at its own
                        // cookie.expires. See note 2 above.
                        collectionName: 'sessions',
                        // Refresh the stored expiry at most once every 10
                        // minutes for an unchanged session, instead of on every
                        // single request. Rolling sessions still extend; this
                        // only avoids a write per API call.
                        touchAfter: 10 * 60,
                        mongoOptions: {
                            serverSelectionTimeoutMS: 5000,
                            connectTimeoutMS: 5000
                        }
                    });
                    this.mongoStore.on('error', (err) => {
                        console.warn("[FallbackStore] MongoStore connection error:", err.message);
                    });
                } catch (e) {
                    console.error("[FallbackStore] Failed to create MongoStore:", e.message);
                }
            }
            if (this.mongoStore) return this.mongoStore;
        }

        // Said once, loudly. Sessions in memory do not survive a restart and
        // are not shared between PM2 workers, so if this is the steady state
        // people will be signed out apparently at random.
        if (!this.warnedAboutMemory) {
            this.warnedAboutMemory = true;
            console.warn("[FallbackStore] Sessions are in MEMORY — they will NOT survive a restart " +
                "and are NOT shared between PM2 workers. Check the MongoDB connection.");
        }
        return this.memoryStore;
    }

    get(sid, callback) {
        const store = this._getStore();
        if (store !== this.mongoStore) return this.memoryStore.get(sid, callback);

        this.mongoStore.get(sid, (err, sess) => {
            // A store error is NOT a signed-out user. Reporting it as one is
            // what turned a momentary database hiccup into "everyone please
            // log in again".
            if (err) return callback(err);
            if (sess) return callback(null, sess);

            // Genuinely absent from Mongo. It may still be a session created
            // while Mongo was unavailable, so memory is worth one look — but
            // only as a miss, never as an error handler.
            this.memoryStore.get(sid, (memErr, memSess) => callback(null, memSess || null));
        });
    }

    set(sid, sess, callback) {
        const store = this._getStore();
        if (store === this.mongoStore) {
            // Mongo only. The old code ALSO wrote every session to memory as a
            // "cache", which never expired and grew for the lifetime of the
            // process — MemoryStore is documented as leaking by design — while
            // hiding whether Mongo was actually working.
            return this.mongoStore.set(sid, sess, callback);
        }
        return this.memoryStore.set(sid, sess, callback);
    }

    destroy(sid, callback) {
        // Both, always: signing out must remove the session wherever it is.
        this.memoryStore.destroy(sid, () => {
            if (this.mongoStore) return this.mongoStore.destroy(sid, callback);
            if (callback) callback(null);
        });
    }

    touch(sid, sess, callback) {
        const store = this._getStore();
        if (store === this.mongoStore && this.mongoStore.touch) {
            return this.mongoStore.touch(sid, sess, callback);
        }
        return this.memoryStore.touch(sid, sess, callback);
    }
}

sessionOptions.store = new FallbackStore();

// Kept in a named binding so the Socket.IO handshake can run the same session
// parser: admin chat oversight is authorised by the /ten-admin session cookie,
// never by what the socket claims about itself.
const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);

// Put the signed-in ecosystem user on req.user, for every request.
//
// This is why the founder, mentor, investor and contractor portals did nothing.
// requireRole() reads req.user and answers 401 "Authentication required" when
// it is absent — and attachEcosystemUser, the only thing that sets it, was
// written, exported, unit-tested, and then never mounted. Every route behind a
// requireRole guard in the whole application therefore returned 401 to a
// correctly signed-in founder, which is exactly what "the founder portal
// doesn't work" looked like from the outside.
//
// It reads the session and nothing else, so mounting it grants no access on its
// own: a request with no session still arrives at requireRole with no req.user
// and is still refused.
{
    const { attachEcosystemUser } = require("./middleware/roleGuard");
    app.use(attachEcosystemUser);
}

// NOTE: the session cookie's `secure` / `sameSite` flags are fixed at
// configuration time from NODE_ENV (see sessionOptions above). They used to be
// recomputed per request from `x-forwarded-proto`, which is client-controlled —
// sending `x-forwarded-proto: http` cleared the Secure flag and the session
// cookie was then transmitted in plaintext. Do not reintroduce that.

/**
 * Session-scoped API responses are never cacheable.
 *
 * Express attaches an ETag to every JSON response and nothing set a
 * Cache-Control header, so browsers applied *heuristic* caching to API GETs.
 * The visible symptom: the HR dashboard showed "Total Students: 774" from a
 * cached /hr/stats while the session behind it had already expired and every
 * live call was returning 401 — a page that looks signed in, reporting real
 * numbers, backed by nothing. Any two people looking at that screen disagree
 * about whether the portal works.
 *
 * These responses depend on who is asking, so they must not be stored by the
 * browser or by any proxy in between. `Vary: Cookie` is belt-and-braces for
 * caches that ignore no-store.
 */
app.use((req, res, next) => {
    if (/^\/(api|hr|coordinator|students|attendance)\b/.test(req.path)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Vary", "Cookie");
    }
    next();
});

// The service worker and the web app manifest.
//
// Registered BEFORE express.static, because whichever handler comes first wins
// and the static mount would otherwise answer both with its own headers.
//
// Two headers matter here:
//   - Service-Worker-Allowed lets the worker claim "/" as its scope.
//   - no-store on the worker. A cached service worker is a worker that cannot
//     be updated — it would keep serving the old push and notification-click
//     logic after a deploy, with no way to tell.
app.get("/sw.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Service-Worker-Allowed", "/");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(__dirname, "public", "sw.js"));
});

// The correct type is application/manifest+json. Served as anything else, some
// browsers ignore the manifest and the app silently stops being installable.
//
// There are three installable apps, and each needs its own manifest with its
// own `id` — a browser decides "is this the same app I already installed?" from
// the id, so two manifests sharing one would be a single install that simply
// changed its start page.
//
//   manifest.json                    "TEN Portal"             starts at /
//   manifest.webmanifest             "TEN Internship Portal"  starts at /student-dashboard
//   manifest-notifications.webmanifest "TEN Notifications"    starts at /notifications
app.get("/manifest.webmanifest", (req, res) => {
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(path.join(__dirname, "public", "manifest.webmanifest"));
});

app.get("/manifest-notifications.webmanifest", (req, res) => {
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(path.join(__dirname, "public", "manifest-notifications.webmanifest"));
});

// Custom route to serve the logo with the correct JPEG Content-Type since the file has a .png extension but is actually a JPEG (JFIF format)
app.get(/.*ten-logo\.png$/, (req, res) => {
    res.setHeader("Content-Type", "image/jpeg");
    res.sendFile(path.join(__dirname, "public", "ten-logo.png"));
});

// maxAge: '7d' was applied to EVERY file in public/, including the HTML.
//
// That sends `Cache-Control: public, max-age=604800` on a page, so a browser
// that once loaded v2-tasks.html keeps using its copy for a week without ever
// asking the server whether it changed. Deploying a fix did nothing visible:
// the server ran the new code while students kept running last week's page.
// It is why several fixes this week were reported as "still broken" while the
// server-side half of the same fix was demonstrably live — the new API replies
// were arriving at old markup.
//
// HTML is the entry point to everything else; it names the CSS and JS to load,
// so one stale page pins the whole view. It now revalidates on every request.
// `no-cache` does not mean "do not store" — the browser keeps the file and
// checks its ETag, so an unchanged page still returns 304 with no body. The
// cost is one conditional request per page load.
//
// JavaScript revalidates for the same reason: it carries behaviour, so a stale
// chat-widget.js or session-guard.js reproduces exactly this class of bug. A
// stylesheet or an image going a week out of date is cosmetic, so those keep
// the long max-age. None of these filenames are content-hashed, which is what
// would otherwise let them be cached indefinitely and safely.
app.use(express.static("public", {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
        if (/\.(html?|js)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));
// Defence in depth: the fallback database no longer lives under uploads/, but
// refuse to serve anything that looks like it regardless, so a stray copy left
// by an older deploy can never be downloaded.
app.use('/uploads', (req, res, next) => {
    if (/(^|\/)(local_db|\.env)/i.test(req.path)) {
        return res.status(404).end();
    }
    next();
});
app.use('/uploads', express.static('uploads', {
    maxAge: '30d',
    etag: true,
    lastModified: true,
    dotfiles: 'ignore'
}));

// Unauthenticated health check endpoint
app.get('/health', (req, res) => {
    const isMongoConnected = checkMongoStatus();
    const uptime = process.uptime();
    const timestamp = new Date().toISOString();
    
    if (isMongoConnected) {
        return res.json({
            status: "ok",
            uptime,
            timestamp,
            mongodb: "connected"
        });
    } else {
        return res.json({
            status: "degraded",
            uptime,
            timestamp,
            mongodb: global.isMongoUnhealthy ? "unhealthy" : "disconnected"
        });
    }
});

// NOTE: GET /api/secrets-status and POST /api/save-secrets used to live here.
// Both were unauthenticated. The first returned HR_CREDENTIALS and
// COORDINATOR_CREDENTIALS (username -> password maps) in cleartext to any
// caller; the second rewrote .env on disk and repointed MONGODB_URI at an
// arbitrary host from an anonymous request body. They have been removed.
// Secrets belong in the deploy environment - see .env.example and
// config/secrets.js, which validates them at boot.


// ===== Feature 14: security hardening =====
// helmet sets secure HTTP headers; we keep CSP off so the existing inline
// scripts and external CDNs (sweetalert2, socket.io.js) keep working.
// We also strip Mongo operator keys ($, .) from req.body to block NoSQL
// injection. We do not touch req.query because Express 5 makes it a
// read-only getter; this is fine because all routes that use ?params read
// strings, not objects.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
}));
function _sanitizeKeys(obj){
    if(!obj || typeof obj !== "object") return;
    for(const k of Object.keys(obj)){
        if(k.startsWith("$") || k.indexOf(".") !== -1){
            delete obj[k];
        } else if(obj[k] && typeof obj[k] === "object"){
            _sanitizeKeys(obj[k]);
        }
    }
}
app.use((req, _res, next) => { _sanitizeKeys(req.body); _sanitizeKeys(req.params); next(); });

// Bounded, self-expiring counter for the escalating back-off. The previous
// plain Map was never pruned and was keyed by attacker-controlled strings, so
// it grew without limit.
const consecutiveLimitHits = new Map();
const LIMIT_HIT_TTL_MS = 60 * 60 * 1000;
const LIMIT_HIT_MAX_ENTRIES = 10000;

function bumpLimitHits(key) {
    const now = Date.now();
    const existing = consecutiveLimitHits.get(key);
    const hits = (existing && (now - existing.at) < LIMIT_HIT_TTL_MS) ? existing.hits + 1 : 1;
    consecutiveLimitHits.set(key, { hits, at: now });

    if (consecutiveLimitHits.size > LIMIT_HIT_MAX_ENTRIES) {
        for (const [k, v] of consecutiveLimitHits) {
            if ((now - v.at) >= LIMIT_HIT_TTL_MS) consecutiveLimitHits.delete(k);
        }
        // Still oversized after expiry sweep: drop the oldest insertions.
        while (consecutiveLimitHits.size > LIMIT_HIT_MAX_ENTRIES) {
            consecutiveLimitHits.delete(consecutiveLimitHits.keys().next().value);
        }
    }
    return hits;
}

// The account portion of the rate-limit key MUST be derived the same way the
// login handlers derive the account they look up. It used to prefer
// `body.email` while POST /login resolves `employeeId || email` — so sending a
// fixed employeeId with a random email on each request minted a fresh bucket
// every time and the limit never applied. This helper is now the single
// definition, used by both the key generator and the handler.
function loginRateLimitAccount(req) {
    const body = req.body || {};
    const parts = [body.employeeId, body.email, body.username]
        .map((v) => (v == null ? "" : String(v).toLowerCase().trim()))
        .filter(Boolean)
        .sort();
    return parts.join("|");
}

// req.ip alone is the wrong key for IPv6. A single household is routinely
// handed a /64, so keying on the full /128 address lets one attacker rotate
// through billions of distinct keys and never hit the limit. ipKeyGenerator
// collapses an address to its subnet; IPv4 passes through unchanged.
function loginRateLimitKey(req) {
    return ipKeyGenerator(req.ip) + ":" + loginRateLimitAccount(req);
}

// Login rate limit, keyed per IP *and* per account identifier. Keying on the
// account means one student's failed attempts never rate-limit a different
// student sharing the same college wifi or hostel network.
const loginLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
    max: RATE_LIMIT_CONFIG.auth.max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: loginRateLimitKey,
    handler: (req, res, next, options) => {
        const hits = bumpLimitHits(loginRateLimitKey(req));
        const backoffBase = RATE_LIMIT_CONFIG.auth.backoffBase || 2;
        const retryAfterSeconds = Math.min(Math.pow(backoffBase, hits), 3600);
        res.setHeader('Retry-After', retryAfterSeconds.toString());
        return res.status(429).json({
            success: false,
            message: `Too many login attempts. Please wait ${retryAfterSeconds} seconds.`
        });
    }
});

// Second, independent cap on the source address alone. Without this, keying by
// account means an attacker credential-stuffing N different accounts from one
// address gets `max` attempts per account with no overall ceiling.
const loginIpLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
    max: Math.max(RATE_LIMIT_CONFIG.auth.max * 6, 60),
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, message: "Too many login attempts from this network. Please wait." }
});

// Registration rate limit
const registerLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
    max: RATE_LIMIT_CONFIG.auth.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        const hits = bumpLimitHits("register:" + req.ip);
        const backoffBase = RATE_LIMIT_CONFIG.auth.backoffBase || 2;
        const retryAfterSeconds = Math.min(Math.pow(backoffBase, hits), 3600);
        res.setHeader('Retry-After', retryAfterSeconds.toString());
        return res.status(429).json({
            success: false,
            message: `Too many registration attempts. Please wait ${retryAfterSeconds} seconds.`
        });
    }
});

// General API rate limit — applied broadly to /api but the project has very
// few endpoints under /api today, so we also expose it for any future use.
const apiLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.authenticated.windowMs,
    max: RATE_LIMIT_CONFIG.authenticated.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please slow down." }
});
app.use('/api', apiLimiter);

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// ================= MAIL =================

const { createEmailTransporter } = require("./utils/mailer");
const transporter = createEmailTransporter();

const smtpUser = process.env.SMTP_USER || process.env.SES_SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL_US;
const smtpPass = process.env.SMTP_PASS || process.env.SES_SMTP_PASS || process.env.EMAIL_PASS;
if (smtpUser && smtpPass) {
    transporter.verify((error)=>{
        if(error){ console.log("SMTP verification status: OFFLINE —", error.message); }
        else{ console.log("Email Server Ready"); }
    });
} else {
    console.log("Email not configured — skipping SMTP verify.");
}

// Sends one activity-cycle HR mail (appreciation or re-engagement), records it
// in MailHistory and mirrors it as an in-app student notification.
const ACTIVITY_MAILS = {
    "active-appreciation": {
        subject: "Keep it up! You're doing great 🌟",
        html: (name) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">Hi ${name||"Intern"},<br><br>Great work staying active this week. Keep it up!<br><br>— TEN HR Team</div>`,
        notifTitle: "🌟 Appreciation from HR",
        notifMessage: (name) => `Hi ${name || "Intern"}, great work staying active this week. Keep it up! — TEN HR Team`,
        notifType: "success"
    },
    "inactive-reengagement": {
        subject: "We miss you! Come back and keep growing 💪",
        html: (name) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">Hi ${name||"Intern"},<br><br>We noticed you haven’t been active recently. Jump back in whenever you’re ready — we’re here to help you keep growing.<br><br>— TEN HR Team</div>`,
        notifTitle: "💪 Inactivity Alert",
        notifMessage: (name) => `Hi ${name || "Intern"}, we noticed you haven't been active recently. Jump back in whenever you're ready — we're here to help you keep growing. — TEN HR Team`,
        notifType: "warning"
    }
};

async function sendActivityMail(student, studentName, mailType){
    const spec = ACTIVITY_MAILS[mailType];
    const email = student.email;
    let mailStatus = "sent";
    let mailError = "";
    try {
        await transporter.sendMail({
            from: '"TEN HR Department" <hr@entrepreneurshipnetwork.net>',
            to: email,
            subject: spec.subject,
            html: spec.html(studentName)
        });
    } catch (err) {
        mailStatus = "failed";
        mailError = err && err.message ? String(err.message) : "";
    } finally {
        try {
            await MailHistory.create({
                recipientEmail: email,
                recipientName: studentName || "Intern",
                studentId: student._id,
                subject: spec.subject,
                mailType,
                sentAt: new Date(),
                status: mailStatus,
                errorMessage: mailError
            });
        } catch (_) {}
    }
    await Notification.notifyStudent(student, {
        title: spec.notifTitle,
        message: spec.notifMessage(studentName),
        type: spec.notifType
    });
    await AutoMailLog.create({ studentName, studentEmail: email, employeeId: student.employeeId || "", mailType });
}

async function runActivityMailer(){
    try{
        if (!checkMongoStatus()) {
            console.warn('[ACTIVITY-MAILER] Mongoose is not connected. Skipping.');
            return;
        }
        const students = await Student.find();
        const now = new Date();
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const fourteenDaysAgo = new Date(now);
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        for(const student of students){
            try{
                const email = student.email;
                if(!email) continue;
                const lastActive = student.lastActiveDate ? new Date(student.lastActiveDate) : null;
                const studentName = (student.name || ((student.firstName||"") + " " + (student.lastName||"")).trim()).trim();
                if(lastActive && lastActive >= sevenDaysAgo){
                    await sendActivityMail(student, studentName, "active-appreciation");
                } else if(!lastActive || lastActive < fourteenDaysAgo){
                    await sendActivityMail(student, studentName, "inactive-reengagement");
                }
            }catch(error){
                console.log(error);
            }
        }
    }catch(error){
        console.log(error);
    }
}
cron.schedule('0 9 * * 1', runActivityMailer);

// ======= AUTO DOCUMENT EMAIL HELPERS =======
function tenureToDays(tenure) {
    if (!tenure) return 30;
    const t = tenure.toLowerCase();
    if (t.includes("45")) return 45;
    if (t.includes("6"))  return 180;
    if (t.includes("3"))  return 90;
    return 30;
}

function getInternshipEndDate(joiningDate, tenure) {
    if (!joiningDate) return null;
    const start = new Date(joiningDate);
    if (isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setDate(end.getDate() + tenureToDays(tenure));
    return end;
}

async function sendAutoDocumentsToStudent(student, docType, sentBy = "System") {
    try {
        const v2Certificates = require("./routes/v2/certificates");
        if (docType === 'offer') {
            await v2Certificates.generateAndSaveCert(student._id.toString(), 'OFFER', student, sentBy);
        } else if (docType === 'loc') {
            await v2Certificates.generateAndSaveCert(student._id.toString(), 'LOC', student, sentBy);
        } else if (docType === 'lor') {
            await v2Certificates.generateAndSaveCert(student._id.toString(), 'LOR', student, sentBy);
        } else if (docType === 'star') {
            await v2Certificates.generateAndSaveCert(student._id.toString(), 'STAR', student, sentBy);
        } else if (docType === 'all') {
            await v2Certificates.generateAndSaveCert(student._id.toString(), 'OFFER', student, sentBy);
            await v2Certificates.generateAndSaveCert(student._id.toString(), 'LOC', student, sentBy);
            await v2Certificates.generateAndSaveCert(student._id.toString(), 'LOR', student, sentBy);
        }
        console.log(`[AUTO-DOCS] Successfully generated and synced document type ${docType} for student ${student._id} (sentBy: ${sentBy})`);
    } catch(err) {
        console.error('[AUTO-DOCS] Error:', err.message);
    }
}

async function runAutoDocumentCheck() {
    try {
        if (!checkMongoStatus()) {
            console.warn('[AUTO-DOCS] Mongoose is not connected. Skipping check.');
            return;
        }
        const students = await Student.find({ documentsAutoSent: { $ne: true } });
        const now = new Date();
        let count = 0;
        for (const student of students) {
            if (!student.joiningDate || !student.tenure || !student.email) continue;
            const endDate = getInternshipEndDate(student.joiningDate, student.tenure);
            if (endDate && now >= endDate) {
                await sendAutoDocumentsToStudent(student, 'all', "System Automation");
                count++;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        if (count > 0) console.log('[AUTO-DOCS] Sent to ' + count + ' students.');
    } catch(err) {
        console.error('[AUTO-DOCS] Scheduler error:', err.message);
    }
}
setTimeout(runAutoDocumentCheck, 30000);
setInterval(runAutoDocumentCheck, 6 * 60 * 60 * 1000);
// ======= END AUTO DOCUMENT EMAIL =======

// ================= MONGODB =================

mongoose.set('bufferCommands', false); // CRITICAL: fail fast, don't hang

mongoose.connection.on('connected', () => {
  console.log("MongoDB connected successfully");
  global.isMongoUnhealthy = false;
});
mongoose.connection.on('disconnected', () => {
  console.log("MongoDB disconnected — attempting to reconnect...");
  global.isMongoUnhealthy = true;
});
mongoose.connection.on('reconnected', () => {
  console.log("MongoDB reconnected successfully");
  global.isMongoUnhealthy = false;
});
mongoose.connection.on('error', (err) => {
  console.warn("[Database] Connection offline (working in memory-fallback mode):", err.message);
  global.isMongoUnhealthy = true;
});

async function runWithRetry(fn, retries = 3, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            const isRetryable = err.name === 'MongoNetworkTimeoutError' || 
                                err.name === 'MongoNetworkError' ||
                                err.message.includes('timeout') || 
                                err.message.includes('timed out') || 
                                (err.errorLabels && err.errorLabels.includes('RetryableWriteError')) ||
                                err.message.includes('RetryableWriteError');
            if (isRetryable && i < retries - 1) {
                console.warn(`[DB RETRY] Attempt ${i + 1} failed due to network: "${err.message}". Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            } else {
                throw err;
            }
        }
    }
}

let mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/internship";

function connectMongo(uri) {
  return mongoose.connect(uri, {
    family: 4,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 20,
    minPoolSize: 2,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000
  });
}

connectMongo(mongoUri)
.catch(err => {
  if (mongoUri.includes("mongodb+srv://") && mongoUri.includes(".mongodb.net")) {
    const match = mongoUri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/?(.*)/);
    if (match) {
      const [, user, pass, host, rest] = match;
      const domainParts = host.split('.');
      const clusterPrefix = domainParts[0];
      const domainSuffix = domainParts.slice(1).join('.');
      const dbName = (rest && rest.split('?')[0]) || 'ten_ecosystem';
      const directUri = `mongodb://${user}:${pass}@${clusterPrefix}-shard-00-00.${domainSuffix}:27017,${clusterPrefix}-shard-00-01.${domainSuffix}:27017,${clusterPrefix}-shard-00-02.${domainSuffix}:27017/${dbName}?ssl=true&replicaSet=atlas-${clusterPrefix}-shard-0&authSource=admin&retryWrites=true&w=majority`;
      console.warn("[Database] Local network SRV DNS lookup blocked. Connecting directly to cluster shards...");
      return connectMongo(directUri);
    }
  }
  throw err;
})
.then(async () => {
  console.log("MongoDB Connected");
  // Trigger AutoTask seeding asynchronously on startup
  try {
    const autoTaskCount = await runWithRetry(() => AutoTask.countDocuments({}));
    if (autoTaskCount > 100) {
      console.log("AutoTask data already seeded, skipping...");
      return;
    }

    // We always force upgrade schemas and contents on startup to ensure your systems have the real domain-specific tasks!
    console.log("Upgrading AutoTask schemas... Seeding real domain-specific tasks...");
    await runWithRetry(() => AutoTask.deleteMany({}));

    const DOMAINS_TECH = [
      "DevOps with AWS", "Python Development", "Java Development",
      "Web Development", "MERN Stack", "MERN Stack Development", "Artificial Intelligence",
      "Data Science", "Cyber Security", "Software Engineering",
      "Flutter Development"
    ];
    const DOMAINS_BUSINESS = [
      "Business Development", "Human Resources", "HR Management",
      "Space Intern", "Space Research", "Venture Capital", "Finance", "HR",
      "Business Analyst", "Vibe Coding"
    ];

    const DOMAIN_TEMPLATES = {
      "DevOps with AWS": [
        { t1: "AWS Console & CLI Setup", d1: "Install and configure AWS CLI. Set up IAM users and define programmatic access keys." },
        { t1: "Virtual Private Cloud Config", d1: "Build custom VPC with public/private subnets, Internet Gateways, and Route tables." },
        { t1: "EC2 & Security Groups", d1: "Provision an EC2 instance with custom security group rules and SSH key pair keys." },
        { t1: "Dockerize an Application", d1: "Create a Dockerfile, build an image, and deploy a container to local or ECS environment." },
        { t1: "CI/CD Setup with GitHub Actions", d1: "Design a pipeline to auto-test and build your Docker images on code push." },
        { t1: "Infrastructure as Code", d1: "Create Terraform configurations to provision an S3 bucket and DynamoDB table safely." },
        { t1: "Kubernetes Basics (EKS)", d1: "Deploy a multi-pod application on Kubernetes/EKS using deployment and service manifests." },
        { t1: "Monitoring CloudWatch Logs", d1: "Set up CloudWatch alarms, custom metric dashboards, and CPU threshold-based logs." }
      ],
      "Python Development": [
        { t1: "Python Env & Git Hub Setup", d1: "Set up pyenv/venv, write initial script, handle requirements.txt, and link to GitHub." },
        { t1: "Data Structure Filtering", d1: "Parse complex JSON/CSV data files, transform records, and write summary audits to disk." },
        { t1: "OOP Library Management System", d1: "Design an elegant OOP class hierarchy representing library inventory or asset management." },
        { t1: "API Engine with Flask REST", d1: "Build a light RESTful API server with Flask offering GET, POST with raw json payloads." },
        { t1: "Asynchronous IO with asyncio", d1: "Implement non-blocking async IO file downloaders fetching API resources concurrently." },
        { t1: "ORM Integration SQLAlchemy", d1: "Configure SQLAlchemy ORM, run database migrations, and handle relationships." },
        { t1: "Unit Testing Suites pytest", d1: "Write pytest suites covering edge cases. Achieve > 85% coverage and generate reports." },
        { t1: "Pandas Exploratory Analysis", d1: "Perform exploratory data analysis on a messy dataset, clean null values, and group analytics indicators." }
      ],
      "Java Development": [
        { t1: "JDK Tooling Setup", d1: "Configure Maven/Gradle project in IntelliJ, run simple main entry point, and setup Git tracking." },
        { t1: "OOP Business Hierarchy", d1: "Demonstrate inheritance, encapsulation, polymorphism, and interfaces with a business logic model." },
        { t1: "Collections Framework API", d1: "Implement custom generic repositories of data utilizing Map, Set, and sorted List implementations." },
        { t1: "Spring Boot Web REST API", d1: "Build a Spring Boot Web API controller featuring query parameters, request validation, and proper CORS." },
        { t1: "JPA Hibernate SQL Connect", d1: "Establish hibernate entities, repository interfaces, and custom JPQL queries for relational databases." },
        { t1: "Global Error Handlers", d1: "Implement global custom exception handler with @ControllerAdvice using Logback or SLF4J." },
        { t1: "JUnit Test Suites Mockito", d1: "Write comprehensive unit tests mocking DB responses with Mockito to guarantee service layer safety." },
        { t1: "Spring Security Auth JWT", d1: "Secure API endpoints using JSON Web Tokens (JWT) and configure roles-based middleware controls." }
      ],
      "Web Development": [
        { t1: "Semantic Layouts & Styling", d1: "Design a responsive landing page layout utilizing clean Flexbox, Grid, and proper typography." },
        { t1: "Interactivity with Vanilla JS", d1: "Build an interactive dynamic dashboard component with zero libraries, filtering data in real-time." },
        { t1: "Asynchronous Fetch Operations", d1: "Consume external public APIs like Weather API or Rick and Morty API to render card lists." },
        { t1: "Aesthetic CSS Micro-effects", d1: "Add subtle loading transitions, custom toast animation panels, and modular micro-interactions." },
        { t1: "Vite Configuration Environments", d1: "Set up compile configurations, absolute imports, build optimization, and assets processing." },
        { t1: "Mobile Breakpoint Layouts", d1: "Enforce mobile-first CSS breakpoint adjustments and touch gesture hover adaptations." },
        { t1: "State Persistence Local Storage", d1: "Keep track of filters, bookmarks, and inputs using localStorage/sessionStorage APIs." },
        { t1: "Web Accessibility a11y Audit", d1: "Implement aria-labels, keyboard-navigable tabs, contrast guidelines, and run Lighthouse checks." }
      ],
      "MERN Stack": [
        { t1: "MERN Concurrently Setup", d1: "Create sibling client/ and server/ projects, configure concurrently, and wire baseline environmental proxies." },
        { t1: "Express Routers & Payload Check", d1: "Craft Express.js core routes, validation middleware, and global server-side error handlers." },
        { t1: "Mongoose Models Creation", d1: "Establish structured collections, validation, and virtuals in Mongoose data models." },
        { t1: "React Functional Components", d1: "Draft a modular UI passing state down through functional components with Tailwind styling." },
        { t1: "JWT Cookie Logins Flow", d1: "Store user session state in React Context and protect Express API routes via JWT cookie headers." },
        { t1: "Axios Client Sync Hook", d1: "Connect frontend hooks (useEffect/Axios) to proxy calls, handling clean loaders and errors." },
        { t1: "MERN Relational CRM CRUD", d1: "Combine React state and Express/Mongo queries to represent a complete relational real-time listing." },
        { t1: "Dockerized Node Production", d1: "Deploy web client and server to platforms with proper environment variables mapping." }
      ],
      "MERN Stack Development": [
        { t1: "Full MERN Project Init", d1: "Create sibling client/ and server/ projects, configure concurrently, and wire baseline environmental proxies." },
        { t1: "Express Server Architecture", d1: "Craft Express.js core routes, validation middleware, and global server-side error handlers." },
        { t1: "Schemas Design Mongoose", d1: "Establish structured collections, validation, and virtuals in Mongoose data models." },
        { t1: "React Dashboard Modular Views", d1: "Draft a modular UI passing state down through functional components with Tailwind styling." },
        { t1: "JWT Auth Middleware Guard", d1: "Store user session state in React Context and protect Express API routes via JWT cookie headers." },
        { t1: "Context State & Hook Sync", d1: "Connect frontend hooks (useEffect/Axios) to proxy calls, handling clean loaders and errors." },
        { t1: "Interactive REST CRM Model", d1: "Combine React state and Express/Mongo queries to represent a complete relational real-time listing." },
        { t1: "Production Bundler Optimize", d1: "Deploy web client and server to platforms with proper environment variables mapping." }
      ],
      "Artificial Intelligence": [
        { t1: "Conda & Jupyter Notebook setup", d1: "Install Conda, create fresh virtual environments, and boot Jupyter Lab for data pipelines." },
        { t1: "NumPy Vector Calculations", d1: "Perform linear algebra transformations, dot products, and multi-dimensional array operations." },
        { t1: "Pandas Data Pre-processing", d1: "Pre-process training tabular data, clean outliers, encode categorical features, and split datasets." },
        { t1: "Exploratory Data Visualizations", d1: "Plot visual correlations, feature heatmaps, distribution curves, and save charts." },
        { t1: "Scikit-Learn Regression", d1: "Train a simple linear regression model to predict housing prices and measure MSE metrics." },
        { t1: "Classification Sentiments", d1: "Implement support vector machines (SVM) or decision trees to classify text sentiments." },
        { t1: "PyTorch Multilayer Perceptron", d1: "Design a light multilayer perceptron (MLP) for digit classification using MNIST dataset." },
        { t1: "Transformers Pipeline Usage", d1: "Integrate a local transformer or HuggingFace hub pipeline to execute sequence generation." }
      ],
      "Data Science": [
        { t1: "DS Tooling Environment Setup", d1: "Establish environment containing pandas, numpy, scipy, and scikit-learn libraries." },
        { t1: "BeautifulSoup Web Sourcing", d1: "Write BeautifulSoup routines to pull structural tables from target public web portals." },
        { t1: "Missing Values Imputation", d1: "Examine dirty datasets, evaluate standard deviation, and execute forward/backward fill strategy." },
        { t1: "Relational Joins Queries", d1: "Write structured SQL inner and outer joins to query multi-million record test tables." },
        { t1: "Exploratory Statistics Inference", d1: "Plot scatter trends, boxplots identifying skewness, and run ANOVA verification studies." },
        { t1: "Feature Extraction Engineering", d1: "Engineer synthetic helper variables (ratios, dates, components) to improve model R-squared." },
        { t1: "Clustering Algorithms K-Means", d1: "Segment customer clusters utilizing silhouette plotting to determine the optimal group sizing." },
        { t1: "Streamlit Dashboard App", d1: "Deploy a quick Streamlit page rendering interactive charts for historical sales analysis." }
      ],
      "Cyber Security": [
        { t1: "Offensive Virtual Lab Env", d1: "Assemble secure sandboxed guest virtualization environments containing specialized offensive OS systems." },
        { t1: "Nmap Host Reconnaissance", d1: "Run scan types to map port state, detect host service versions, and identify target OS fingerprinting." },
        { t1: "OWASP Top-10 Audit Checks", d1: "Inspect sample insecure templates to locate typical injection points, XSS inputs, and IDOR flaws." },
        { t1: "Wireshark Packet Analysis", d1: "Decode PCAP streams to spot plain text auth passwords, ARP spoof indicators, and odd DNS traffic." },
        { t1: "Cryptography Checksums Verify", d1: "Verify SHA256 checksums, generate GPG signing credentials, and crack MD5 cipher text strings." },
        { t1: "Burp Intercepting Proxy Labs", d1: "Proxy local browse sessions using intercepting proxies to perform granular parameter tampering." },
        { t1: "Hardening System SSH Access", d1: "Generate SSH config rules, configure SSH key authorization, and close unrequested services." },
        { t1: "Post-Incident Forensic Briefing", d1: "Formulate exhaustive post-incident checklists outlining indicators of compromise and defense." }
      ],
      "Software Engineering": [
        { t1: "Git Branching Workflows", d1: "Master feature branches, merge conflicts, pull request reviews, and semantic version tagging." },
        { t1: "Structural Design Patterns", d1: "Demonstrate the Singleton, Factory, and Observer patterns inside a clean software component." },
        { t1: "Refactoring Nested Controllers", d1: "Refactor a bloated, nested-conditional backend router into a modular class-based system." },
        { t1: "UML Architecture Mapping", d1: "Graph class boundaries, database entity relations, and sequence event pathways." },
        { t1: "OpenAPI Spec Contracts", d1: "Draft complete Swagger/YAML representation files describing path variables and response objects." },
        { t1: "Docker-Compose Stack Orchestrate", d1: "Establish multi-container docker-compose files linking client, api, and postgres databases." },
        { t1: "TDD Red-Green Refactoring", d1: "Write failing tests first, code the bare minimum to pass, refactor, and repeat for dynamic functions." },
        { t1: "Sprint Backlogs Mapping Scrum", d1: "Structure detailed user stories, configure story points, and chart a sprint burndown path." }
      ],
      "Flutter Development": [
        { t1: "Flutter SDK Init & Emulator Run", d1: "Install Flutter toolkit, set up Android Emulator or iOS Simulator, and run launch template." },
        { t1: "Row Column Visual Compositions", d1: "Assemble nesting structures of Row, Column, Container, and Stack widgets to match Figma mocks." },
        { t1: "Stateful Widget Lifecycle setState", d1: "Manipulate dynamic component configurations safely using setState hook triggers." },
        { t1: "Named Routing Navigation", d1: "Construct push/pop transitions and define nested app bar routing structures." },
        { t1: "HTTP Service Call Integration", d1: "Utilize pub.dev HTTP packages to compile network response strings into custom Dart models." },
        { t1: "Provider Global State Listeners", d1: "Isolate state from views, configuring clean reactive listen structures." },
        { t1: "Client Storage Shared Preferences", d1: "Store lightweight profile information and login keys safely via shared_preferences." },
        { t1: "Release Gradle Bundle Compiling", d1: "Configure build gradle settings, clean project modules, and verify production app bundles." }
      ],
      "Business Development": [
        { t1: "ICP Target Sourcing Sheet", d1: "Locate 10 qualified prospective target partner profiles, documenting active needs and contact info." },
        { t1: "Cold Sequence Outbox Scripting", d1: "Draft high-converting follow-up sequence templates targeting decision-maker corporate directors." },
        { t1: "Positioning Matrices & Pitch Deck", d1: "Create structured presentation slides outlining competitive value props and delivery models." },
        { t1: "B2B Funnel Lifecycle Stages", d1: "Model sales progression funnel stages from discovery and demos to contract closure." },
        { t1: "Objections Rebuttals Playbook", d1: "Compile structured response points handling pricing, competition, and timeline blockers." },
        { t1: "SLA Deliverables Draft", d1: "Formulate baseline non-disclosure agreements, work deliverables schedules, and payment terms." },
        { t1: "Quarterly Sales Forecast Plan", d1: "Assemble target sheets detailing expected monthly transaction flow weights and conversions." },
        { t1: "Channel Partnership Marketing", d1: "Outline joint marketing programs designed to deploy third-party reseller packages." }
      ],
      "Human Resources": [
        { t1: "Sourcing Posts Job Listings", d1: "Structure highly engaging open-role job description posts optimizing for search." },
        { t1: "Interview Rubrics & Score Cards", d1: "Engineer a standardized 6-question initial interview rubric template score sheet." },
        { t1: "Onboarding Flow Schedules", d1: "Establish complete checklist processes spanning compliance documentation to technical handoff." },
        { t1: "Corporate Training Curriculums", d1: "Design multi-session employee instruction curriculums for modern workspace alignment." },
        { t1: "Peer Appraisals Review Matrix", d1: "Formulate constructive peer-evaluation rubrics encouraging clear career objectives." },
        { t1: "Mediation Path Dispute Mapping", d1: "Map structural mediation dialogue roadmaps prioritizing psychological workplace safety." },
        { t1: "Engagement Feedback Audits", d1: "Draft comprehensive corporate feedback questionnaires focused on retention markers." },
        { t1: "Compliance Audits Walkthroughs", d1: "Examine regional legal code obligations, workspace safety standards, and offboarding files." }
      ],
      "HR Management": [
        { t1: "HR Management Sourcing", d1: "Structure highly engaging open-role job description posts optimizing for search." },
        { t1: "Structured Interview Systems", d1: "Engineer a standardized 6-question initial interview rubric template score sheet." },
        { t1: "New Hire Path Onboarding", d1: "Establish complete checklist processes spanning compliance documentation to technical handoff." },
        { t1: "Corporate Development Plans", d1: "Design multi-session employee instruction curriculums for modern workspace alignment." },
        { t1: "Appraisal Rubrics Development", d1: "Formulate constructive peer-evaluation rubrics encouraging clear career objectives." },
        { t1: "Dispute Mediation Rules", d1: "Map structural mediation dialogue roadmaps prioritizing workplace safety." },
        { t1: "Retention Engagement Metrics", d1: "Draft comprehensive corporate feedback questionnaires focused on retention markers." },
        { t1: "Regulatory Compliance Audit", d1: "Examine regional legal code obligations, workspace safety standards, and offboarding files." }
      ],
      "HR": [
        { t1: "JD Formulating Recruitment", d1: "Structure highly engaging open-role job description posts optimizing for search." },
        { t1: "Standard Interview Rubrics", d1: "Engineer a standardized 6-question initial interview rubric template score sheet." },
        { t1: "Employee Lifecycle Systems", d1: "Establish complete checklist processes spanning compliance documentation to technical handoff." },
        { t1: "Training Operations Program", d1: "Design multi-session employee instruction curriculums for modern workspace alignment." },
        { t1: "Structured Appraisal Loops", d1: "Formulate constructive peer-evaluation rubrics encouraging clear career objectives." },
        { t1: "Conflict Resolution Protocol", d1: "Map structural mediation dialogue roadmaps prioritizing workplace safety." },
        { t1: "Employee Opinion Climate Survey", d1: "Draft comprehensive corporate feedback questionnaires focused on retention markers." },
        { t1: "HR Compliance Risk Register", d1: "Examine regional legal code obligations, workspace safety standards, and offboarding files." }
      ],
      "Space Intern": [
        { t1: "Orbital Gravity Vectors Plan", d1: "Calculate planetary escape velocity parameters and classify trajectory ellipse elements." },
        { t1: "Constellations Signal Coverage", d1: "Graph functional communication coverages using standard coordinates databases." },
        { t1: "Thrust Propulsion Specific Impulse", d1: "Compare liquid propellant specific impulses against alternative ion thrust motors." },
        { t1: "Stars Spectral Chemistry Analysis", d1: "Analyze emission wave lengths to list likely chemical markers found on remote planetoids." },
        { t1: "Signal Noise Reduction Filters", d1: "Implement standard algorithmic approaches to clean stellar broadcast data feeds." },
        { t1: "Life Supports Suit Schematics", d1: "Map thermal air-circulation requirements required inside extravehicular mobility suits." },
        { t1: "Safe Landing Elevation Plot", d1: "Examine digital terrain elevation maps to choose optimal safe low-slope landing sites." },
        { t1: "Probe Mission Trajectory Draft", d1: "Author a formal 1000-word research abstract detailing deep-space probe trajectory designs." }
      ],
      "Space Research": [
        { t1: "Orbital Mechanics Elements", d1: "Calculate planetary escape velocity parameters and classify trajectory ellipse elements." },
        { t1: "Satellite Coverage Maps", d1: "Graph functional communication coverages using standard coordinates databases." },
        { t1: "Propulsion Motor Comparison", d1: "Compare liquid propellant specific impulses against alternative ion thrust motors." },
        { t1: "Remote Spectral Chemistry Analysis", d1: "Analyze emission wave lengths to list likely chemical markers found on remote planetoids." },
        { t1: "Stellar Broadcast Noise Clean", d1: "Implement standard algorithmic approaches to clean stellar broadcast data feeds." },
        { t1: "Environmental Mobility Suit life", d1: "Map thermal air-circulation requirements required inside extravehicular mobility suits." },
        { t1: "Landing Site Slopes Study", d1: "Examine digital terrain elevation maps to choose optimal safe low-slope landing sites." },
        { t1: "Stellar Trajectory Research Abstract", d1: "Author a formal 1000-word research abstract detailing deep-space probe trajectory designs." }
      ],
      "Venture Capital": [
        { t1: "Deals Sourcing Discovery", d1: "Filter 5 promising early-stage companies inside specific industry landscapes." },
        { t1: "Pitch Deck Slicing Analysis", d1: "Evaluate early startup funding decks, pinpointing customer acquisition cost concerns." },
        { t1: "Cap Tables Dilution Models", d1: "Draft share allocation calculations illustrating series-A dilution outcomes." },
        { t1: "Technical Governance Audit Sheet", d1: "Compile exhaustive checklist templates detailing technical and corporate governance risk." },
        { t1: "TAM SAM SOM Segment Estimates", d1: "Run TAM, SAM, and SOM analyses to confirm addressable monetization spaces." },
        { t1: "Startup Evaluation Metrics List", d1: "Formulate scorecard valuations explaining pre-money vs post-money agreements." },
        { t1: "Investment Thesis Proposal Memo", d1: "Draft standard investment proposals detailing the core entry deal thesis." },
        { t1: "Recent Exit Multiples Comparative", d1: "Examine recent acquisitions to determine realistic multiples." }
      ],
      "Finance": [
        { t1: "EBITDA Margin Analytics", d1: "Examine operational revenue, trace cost of goods sold, and check EBITDA margins." },
        { t1: "NPV Models Discounted Forecast", d1: "Create structural templates calculating current NPV valuations via future cash flows." },
        { t1: "Modern Portfolio Risk Allocation", d1: "Calculate historical yields to model optimal target-risk assets weight balances." },
        { t1: "Amortization Debts Structuring", d1: "Examine amortization schedules, comparing senior secure issues against mezzanine notes." },
        { t1: "Cash Cycles Days Sales Outstanding", d1: "Analyze days sales outstanding to identify cash collection process improvements." },
        { t1: "Statistical Fraud Forensic Audit", d1: "Deploy standard statistical assays to spot outliers in cost reporting files." },
        { t1: "Derivative Swaps Risk Hedge", d1: "Diagram complex puts and options setups mapped against commodity price movements." },
        { t1: "Multi-entity Consolidate Balance", d1: "Prepare multi-entity balance sheets, factoring currency translation rates." }
      ],
      "Business Analyst": [
        { t1: "BRD System Specifications", d1: "Formulate core specifications translating complex user needs to technical workflows." },
        { t1: "As-Is Flow charts Mapped Futures", d1: "Visualize current inefficient operational states mapped against streamlined futures." },
        { t1: "Querying Warehouse Performance SQL", d1: "Create queries parsing product performance indicators from warehouse tables." },
        { t1: "Acceptance Testing Stories Epics", d1: "Map detailed feature specifications complete with user acceptance tests." },
        { t1: "System Upgrade Dependencies Deck", d1: "Outline prospective software changes, listing risk trade-offs and dependencies." },
        { t1: "UAT Release Checks Checklist", d1: "Establish step-by-step validator checksheets to confirm correct system releases." },
        { t1: "Root Cause Fishbone Diagrams", d1: "Deploy standard Ishikawa diagram structures to trace persistent customer delays." },
        { t1: "Efficiency Recommendation ROI", d1: "Compile executive recommendation summaries illustrating process ROI projections." }
      ],
      "Vibe Coding": [
        { t1: "Few-Shot Prompt Engineering Labs", d1: "Craft zero-shot and few-shot instruction strings to build simple app components." },
        { t1: "Web Audio Canvas Sequencers", d1: "Wire generative prompt steps to assemble highly responsive interactive particle grids." },
        { t1: "CSS Tailwinds Card Aesthetics", d1: "Instruct AI generators to format elegant web cards complete with fluid hover animations." },
        { t1: "Unified API Integrations Glue", d1: "Formulate pipeline routines that link disjoint data APIs with simple clean displays." },
        { t1: "Diagnostics & Prompt Error Fix", d1: "Locate and resolve performance bottlenecks by loading error logs as prompt contexts." },
        { t1: "Live Web Instruments Synth Grid", d1: "Synthesize virtual instruments or grid panels utilizing Web Audio API nodes." },
        { t1: "Local IndexedDB State Persistence", d1: "Assemble full client lists persisting to browser environments with zero servers." },
        { t1: "AI Prompted Capstone Masterpiece", d1: "Build and release a signature interactive app that demonstrates the agility of prompt-driven coding." }
      ]
    };

    const tenures = ["1 Week", "15 Days", "1 Month", "45 Days", "3 Months", "6 Months"];
    const tenureDays = { "1 Week": 7, "15 Days": 15, "1 Month": 30, "45 Days": 45, "3 Months": 90, "6 Months": 180 };
    const allTasks = [];

    for (const tenure of tenures) {
      const totalDays = tenureDays[tenure];

      // Seed Tech Domains
      for (const domain of DOMAINS_TECH) {
        const pool = DOMAIN_TEMPLATES[domain] || DOMAIN_TEMPLATES["Web Development"];
        for (let day = 1; day <= totalDays; day++) {
          const taskA = pool[(day * 2 - 2) % pool.length];
          const taskB = pool[(day * 2 - 1) % pool.length];
          allTasks.push({
            domain, tenure, dayNumber: day, taskNumber: 1,
            title: `[Day ${day}] ${taskA.t1}`, description: taskA.d1,
            difficulty: day <= 7 ? "Beginner" : (day <= 20 ? "Intermediate" : "Advanced"),
            taskType: "coding", isActive: true
          });
          allTasks.push({
            domain, tenure, dayNumber: day, taskNumber: 2,
            title: `[Day ${day}] ${taskB.t1}`, description: taskB.d1,
            difficulty: day <= 7 ? "Beginner" : (day <= 20 ? "Intermediate" : "Advanced"),
            taskType: "coding", isActive: true
          });
        }
      }

      // Seed Business Domains
      for (const domain of DOMAINS_BUSINESS) {
        const pool = DOMAIN_TEMPLATES[domain] || DOMAIN_TEMPLATES["Business Development"];
        for (let day = 1; day <= totalDays; day++) {
          const taskA = pool[(day * 2 - 2) % pool.length];
          const taskB = pool[(day * 2 - 1) % pool.length];
          allTasks.push({
            domain, tenure, dayNumber: day, taskNumber: 1,
            title: `[Day ${day}] ${taskA.t1}`, description: taskA.d1,
            difficulty: day <= 7 ? "Beginner" : (day <= 20 ? "Intermediate" : "Advanced"),
            taskType: "research", isActive: true
          });
          allTasks.push({
            domain, tenure, dayNumber: day, taskNumber: 2,
            title: `[Day ${day}] ${taskB.t1}`, description: taskB.d1,
            difficulty: day <= 7 ? "Beginner" : (day <= 20 ? "Intermediate" : "Advanced"),
            taskType: "presentation", isActive: true
          });
        }
      }
    }

    for (let i = 0; i < allTasks.length; i += 500) {
      const chunk = allTasks.slice(i, i + 500);
      await runWithRetry(() => AutoTask.insertMany(chunk));
    }
    console.log("Auto seeding complete! Total unique seeded: " + allTasks.length);

    // Seed default daily Coding Questions for Tech domains
    try {
        const CodingQuestionModel = mongoose.model("CodingQuestion");
        // Always recreate the coding questions on startup to ensure latest rich questions
        console.log("Upgrading CodingQuestion schemas... Seeding real domain-specific coding problems...");
        await runWithRetry(() => CodingQuestionModel.deleteMany({}));
        
        const domains = [
            "DevOps with AWS", "Python Development", "Java Development",
            "Web Development", "MERN Stack", "MERN Stack Development", "Artificial Intelligence",
            "Data Science", "Cyber Security", "Software Engineering", "Flutter Development"
        ];
        
        const questionsToSeed = [];
        
        // Let's seed 10 highly detailed, domain-specific coding questions for each tech domain!
        const domainSpecs = {
            "DevOps with AWS": [
                { title: "Validate IPv4 CIDR Blocks", desc: "Validate if a given CIDR string (e.g. '192.168.1.0/24') is a valid IPv4 network block.\nInput format: CIDR string\nOutput format: 'Valid' or 'Invalid'", difficulty: "Easy", input: "192.168.1.0/24", output: "Valid", cases: [ { i: "192.168.1.0/24", e: "Valid", h: false }, { i: "300.1.1.0/16", e: "Invalid", h: false }, { i: "10.0.0.0/33", e: "Invalid", h: true } ] },
                { title: "Nginx Error Logs Filter", desc: "Find how many 5xx server errors are recorded in a space-separated log list of HTTP status codes.\nInput: Space-separated codes\nOutput: Count of 5xx errors", difficulty: "Easy", input: "200 404 500 502 301 503", output: "3", cases: [ { i: "200 404 500 502 301 503", e: "3", h: false }, { i: "200 302 401", e: "0", h: false }, { i: "500 502 503 504", e: "4", h: true } ] },
                { title: "AWS IAM Policy Resource Linter", desc: "Determine if an IAM Policy Statement has unsafe wildcards '*' in its actions.\nInput: Space-separated actions\nOutput: 'Unsafe' or 'Safe'", difficulty: "Medium", input: "s3:GetObject iam:* ec2:DescribeInstances", output: "Unsafe", cases: [ { i: "s3:GetObject iam:* ec2:DescribeInstances", e: "Unsafe", h: false }, { i: "s3:ListBucket s3:PutObject", e: "Safe", h: false }, { i: "ec2:* s3:*", e: "Unsafe", h: true } ] },
                { title: "Parse Docker Port Mappings", desc: "Parse a Docker host-to-container port mapping string (e.g. '80:8080') and output 'Host: <port> Container: <port>'.\nInput: Port string\nOutput: Formatted host and container", difficulty: "Medium", input: "80:8080", output: "Host: 80 Container: 8080", cases: [ { i: "80:8080", e: "Host: 80 Container: 8080", h: false }, { i: "443:443", e: "Host: 443 Container: 443", h: false }, { i: "8080:3000", e: "Host: 8080 Container: 3000", h: true } ] },
                { title: "YAML Indentation Checker", desc: "Given space counts on each line, ensure no odd indent counts exist (every indentation must be a multiple of 2 spaces).\nInput: Space-separated integers representing spaces\nOutput: 'Valid' or 'Invalid'", difficulty: "Medium", input: "0 2 4 4 2 0", output: "Valid", cases: [ { i: "0 2 4 4 2 0", e: "Valid", h: false }, { i: "0 1 3 2", e: "Invalid", h: false }, { i: "0 2 3 4 2 0", e: "Invalid", h: true } ] },
                { title: "S3 Bucket Name Rule Validator", desc: "Validate if an S3 bucket name is between 3 and 63 characters, contains only lowercase letters, numbers, and hyphens.\nInput: Bucket name string\nOutput: 'Valid' or 'Invalid'", difficulty: "Medium", input: "my-aws-bucket-123", output: "Valid", cases: [ { i: "my-aws-bucket-123", e: "Valid", h: false }, { i: "MyAwsBucket", e: "Invalid", h: false }, { i: "ab", e: "Invalid", h: true } ] },
                { title: "Kubernetes Pod Status Parser", desc: "Parse space-separated Pod names and status values and count how many Pods are 'Running'.\nInput: Space-separated name-status pairs (e.g. 'pod1 Running pod2 Pending pod3 Running')\nOutput: Count of Running Pods", difficulty: "Medium", input: "pod1 Running pod2 Pending pod3 Running", output: "2", cases: [ { i: "pod1 Running pod2 Pending pod3 Running", e: "2", h: false }, { i: "pod1 Failed pod2 Pending", e: "0", h: false }, { i: "a Running b Running c Running d Failed", e: "3", h: true } ] },
                { title: "Terraform Resource Sorter", desc: "Given space-separated Terraform resource blocks, sort them alphabetically.\nInput: Space-separated words\nOutput: Sorted space-separated words", difficulty: "Hard", input: "aws_s3_bucket aws_instance aws_vpc", output: "aws_instance aws_s3_bucket aws_vpc", cases: [ { i: "aws_s3_bucket aws_instance aws_vpc", e: "aws_instance aws_s3_bucket aws_vpc", h: false }, { i: "z y x", e: "x y z", h: false }, { i: "vpc s3 ec2 iam db", e: "db ec2 iam s3 vpc", h: true } ] },
                { title: "IP Address Ping Latency Average", desc: "Given ping latency output logs (e.g. 'time=12ms time=15ms time=9ms'), extract the numbers and output their average rounded to the nearest integer.\nInput: Text containing latency numbers\nOutput: Average integer", difficulty: "Hard", input: "time=12ms time=15ms time=9ms", output: "12", cases: [ { i: "time=12ms time=15ms time=9ms", e: "12", h: false }, { i: "time=100ms time=50ms", e: "75", h: false }, { i: "time=5ms time=6ms time=5ms time=8ms", e: "6", h: true } ] },
                { title: "CloudWatch Metric Alarm threshold Checker", desc: "Given space-separated CPU utilization numbers, verify if any reading has breached a critical threshold of 85.0% for three consecutive times.\nInput: Space-separated numbers\nOutput: 'Alarm' or 'OK'", difficulty: "Hard", input: "50 82 86 89 87 60", output: "Alarm", cases: [ { i: "50 82 86 89 87 60", e: "Alarm", h: false }, { i: "90 90 40 90 90", e: "OK", h: false }, { i: "10 20 85.1 86 87 30", e: "Alarm", h: true } ] }
            ],
            "Python Development": [
                { title: "Sort Python List Comprehension", desc: "Take a comma-and-space separated 2D array representation and output a flat, sorted, space-separated list.\nInput: Comma and space grid\nOutput: Sorted flat integers", difficulty: "Easy", input: "3 1,2 4", output: "1 2 3 4", cases: [ { i: "3 1,2 4", e: "1 2 3 4", h: false }, { i: "9 5,1 3 2", e: "1 2 3 5 9", h: false }, { i: "10,5 6", e: "5 6 10", h: true } ] },
                { title: "Find Maximum & Mean Temperatures", desc: "Given temperature readings, find the maximum reading and the average rounded to 1 decimal place.\nInput: Space-separated numbers\nOutput: Max average", difficulty: "Easy", input: "32 30.5 35 28", output: "35 31.4", cases: [ { i: "32 30.5 35 28", e: "35 31.4", h: false }, { i: "10 10 10", e: "10 10.0", h: false }, { i: "15.5 22.1 19 33.4", e: "33.4 22.5", h: true } ] },
                { title: "Count Unique Words in Paragraph", desc: "Given a space-separated paragraph, count how many unique words it contains (case-insensitive).\nInput: Space-separated words\nOutput: Unique count", difficulty: "Medium", input: "Python is great and python is fun", output: "5", cases: [ { i: "Python is great and python is fun", e: "5", h: false }, { i: "hello hello hello", e: "1", h: false }, { i: "The Quick Brown Fox Jumps Over The Lazy Dog", e: "8", h: true } ] },
                { title: "Python Dictionary Key Inverter", desc: "Invert simple space-separated key-value pairs (e.g. 'a:1 b:2') and output value-key pairs alphabetically.\nInput: Key-value string\nOutput: Inverted string", difficulty: "Medium", input: "a:1 b:2", output: "1:a 2:b", cases: [ { i: "a:1 b:2", e: "1:a 2:b", h: false }, { i: "x:9 y:9", e: "9:x 9:y", h: false }, { i: "m:5 n:6 o:7", e: "5:m 6:n 7:o", h: true } ] },
                { title: "Check Valid Python Variable Names", desc: "Verify if a given string represents a valid Python variable name (starts with a letter or underscore, contains only alphanumeric and underscores).\nInput: String\nOutput: 'Valid' or 'Invalid'", difficulty: "Medium", input: "_myVar123", output: "Valid", cases: [ { i: "_myVar123", e: "Valid", h: false }, { i: "123var", e: "Invalid", h: false }, { i: "var-name", e: "Invalid", h: true } ] },
                { title: "Count Python Decorators", desc: "Identify how many decorators (lines starting with '@') exist in a space-separated code representation.\nInput: Code lines separated by space\nOutput: Count of decorators", difficulty: "Medium", input: "class MyClass: @decorator1 def method(): @decorator2 def test():", output: "2", cases: [ { i: "class MyClass: @decorator1 def method(): @decorator2 def test():", e: "2", h: false }, { i: "def test(): pass", e: "0", h: false }, { i: "@dec1 @dec2 @dec3", e: "3", h: true } ] },
                { title: "Verify JSON Payload Keys", desc: "Parse a basic colon-and-comma string of keys/values (e.g. 'name:john,age:30') and check if the key 'id' exists.\nInput: Properties string\nOutput: 'Found' or 'Not Found'", difficulty: "Medium", input: "name:john,age:30,id:101", output: "Found", cases: [ { i: "name:john,age:30,id:101", e: "Found", h: false }, { i: "name:mary,age:25", e: "Not Found", h: false }, { i: "id:abc,title:dev", e: "Found", h: true } ] },
                { title: "Calculate Palindrome Number Range", desc: "Given space-separated start and end integers, count how many palindromic integers exist in that range (inclusive).\nInput: Start End integers\nOutput: Count of palindromes", difficulty: "Hard", input: "10 100", output: "9", cases: [ { i: "10 100", e: "9", h: false }, { i: "1 9", e: "9", h: false }, { i: "100 120", e: "2", h: true } ] },
                { title: "Longest Consecutive Sequence Length", desc: "Given unsorted space-separated integers, find the length of the longest consecutive elements sequence.\nInput: Space-separated integers\nOutput: Sequence length integer", difficulty: "Hard", input: "100 4 200 1 3 2", output: "4", cases: [ { i: "100 4 200 1 3 2", e: "4", h: false }, { i: "0", e: "1", h: false }, { i: "10 5 12 6 11 7 8 1", e: "4", h: true } ] },
                { title: "Calculate Fibonacci Term", desc: "Given a 0-indexed integer N, calculate the Nth term in the Fibonacci sequence (F0=0, F1=1, F2=1, F3=2).\nInput: Integer N\nOutput: Nth Fibonacci number", difficulty: "Hard", input: "6", output: "8", cases: [ { i: "6", e: "8", h: false }, { i: "0", e: "0", h: false }, { i: "10", e: "55", h: true } ] }
            ],
            "Java Development": [
                { title: "Format Bank Currency", desc: "Format a balance prefixed with the correct currency symbol ('$' for USD, '€' for EUR, '₹' for INR). Defaults to '$'.\nInput: Balance and currency separated by space\nOutput: Formatted string", difficulty: "Easy", input: "25000 INR", output: "₹25000", cases: [ { i: "25000 INR", e: "₹25000", h: false }, { i: "120 USD", e: "$120", h: false }, { i: "500 EUR", e: "€500", h: true } ] },
                { title: "Spring Path Bracket Linter", desc: "Validate that all curly bracket parameters '{' in a Spring REST path have matching '}'.\nInput: Path URL string\nOutput: 'Valid' or 'Invalid'", difficulty: "Easy", input: "/api/v1/users/{userId}/tasks/{taskId}", output: "Valid", cases: [ { i: "/api/v1/users/{userId}/tasks/{taskId}", e: "Valid", h: false }, { i: "/api/v1/users/{userId/tasks", e: "Invalid", h: false }, { i: "/users/{id}}", e: "Invalid", h: true } ] },
                { title: "Extract Class Package Name", desc: "Extract the package name from a Java package declaration statement.\nInput: Package line\nOutput: Package path", difficulty: "Medium", input: "package com.example.ims.controller;", output: "com.example.ims.controller", cases: [ { i: "package com.example.ims.controller;", e: "com.example.ims.controller", h: false }, { i: "package my.app;", e: "my.app", h: false }, { i: "package org.spring.framework.context.annotation;", e: "org.spring.framework.context.annotation", h: true } ] },
                { title: "Check Valid Java Identifiers", desc: "Determine if a string represents a valid Java class identifier (starts with uppercase, contains only alphanumeric, no spaces).\nInput: Identifier string\nOutput: 'Valid' or 'Invalid'", difficulty: "Medium", input: "MyAccountController", output: "Valid", cases: [ { i: "MyAccountController", e: "Valid", h: false }, { i: "mycontroller", e: "Invalid", h: false }, { i: "My Controller", e: "Invalid", h: true } ] },
                { title: "Count Java Annotations", desc: "Count how many annotations (words starting with '@') are declared in a class stub string.\nInput: Space-separated words\nOutput: Annotation count", difficulty: "Medium", input: "@RestController @RequestMapping class Test {}", output: "2", cases: [ { i: "@RestController @RequestMapping class Test {}", e: "2", h: false }, { i: "public class Test {}", e: "0", h: false }, { i: "@Service @Autowired @Transactional void run()", e: "3", h: true } ] },
                { title: "Filter Array of Null Values", desc: "Given space-separated strings where some represent null objects ('null'), remove all nulls and output the remaining space-separated items.\nInput: Space-separated strings\nOutput: Filtered space-separated strings", difficulty: "Medium", input: "user1 null user2 null null user3", output: "user1 user2 user3", cases: [ { i: "user1 null user2 null null user3", e: "user1 user2 user3", h: false }, { i: "null null", e: "", h: false }, { i: "a b c", e: "a b c", h: true } ] },
                { title: "Spring Boot Port Matcher", desc: "Parse server.port properties and extract the port number integer.\nInput: Property string (e.g. 'server.port=8080')\nOutput: Port number", difficulty: "Medium", input: "server.port=8080", output: "8080", cases: [ { i: "server.port=8080", e: "8080", h: false }, { i: "server.port=3000", e: "3000", h: false }, { i: "server.port=9090", e: "9090", h: true } ] },
                { title: "Check Balanced XML Tags", desc: "Validate basic balance of opening and closing XML tags (e.g. '<tag></tag>').\nInput: XML-like string\nOutput: 'Valid' or 'Invalid'", difficulty: "Hard", input: "<user><id>123</id></user>", output: "Valid", cases: [ { i: "<user><id>123</id></user>", e: "Valid", h: false }, { i: "<user><id>123</user>", e: "Invalid", h: false }, { i: "<a><b></b>", e: "Invalid", h: true } ] },
                { title: "Integer to Roman Numeral", desc: "Convert an integer between 1 and 10 to Roman Numerals (I, II, III, IV, V, VI, VII, VIII, IX, X).\nInput: Integer\nOutput: Roman numeral string", difficulty: "Hard", input: "9", output: "IX", cases: [ { i: "9", e: "IX", h: false }, { i: "3", e: "III", h: false }, { i: "5", e: "V", h: true } ] },
                { title: "Verify Password Strength Rules", desc: "Verify if a password is at least 8 characters, has at least one digit and one capital letter.\nInput: Password string\nOutput: 'Strong' or 'Weak'", difficulty: "Hard", input: "P@ssword123", output: "Strong", cases: [ { i: "P@ssword123", e: "Strong", h: false }, { i: "weak", e: "Weak", h: false }, { i: "NoDigitsHere", e: "Weak", h: true } ] }
            ],
            "Web Development": [
                { title: "Convert HEX Color to RGB", desc: "Convert a hex color code string (e.g. '#ffffff') into its CSS rgb format 'rgb(r, g, b)'.\nInput: Hex code string\nOutput: CSS rgb string", difficulty: "Easy", input: "#ffffff", output: "rgb(255, 255, 255)", cases: [ { i: "#ffffff", e: "rgb(255, 255, 255)", h: false }, { i: "#ff0000", e: "rgb(255, 0, 0)", h: false }, { i: "#00ff00", e: "rgb(0, 255, 0)", h: true } ] },
                { title: "Secure HTML Anchors", desc: "Add 'rel=\"noopener\"' to any basic HTML anchor tag structure to prevent security risks on external tabs.\nInput: HTML anchor tag\nOutput: Secured HTML anchor tag", difficulty: "Easy", input: "<a href=\"https://google.com\">Google</a>", output: "<a href=\"https://google.com\" rel=\"noopener\">Google</a>", cases: [ { i: "<a href=\"https://google.com\">Google</a>", e: "<a href=\"https://google.com\" rel=\"noopener\">Google</a>", h: false }, { i: "<a>Link</a>", e: "<a rel=\"noopener\">Link</a>", h: false }, { i: "<a href=\"url\">Text</a>", e: "<a href=\"url\" rel=\"noopener\">Text</a>", h: true } ] },
                { title: "Parse CSS Unit Pixels", desc: "Convert CSS pixel dimensions into standard integer value numbers (e.g. '15px' -> 15).\nInput: Pixel size string\nOutput: Integer number value", difficulty: "Medium", input: "24px", output: "24", cases: [ { i: "24px", e: "24", h: false }, { i: "0px", e: "0", h: false }, { i: "1280px", e: "1280", h: true } ] },
                { title: "Format CSS Style Class Names", desc: "Sanitize camelCase class names into kebab-case standards.\nInput: camelCase string\nOutput: kebab-case string", difficulty: "Medium", input: "submitButtonContainer", output: "submit-button-container", cases: [ { i: "submitButtonContainer", e: "submit-button-container", h: false }, { i: "activeNav", e: "active-nav", h: false }, { i: "myAwesomeWebComponent", e: "my-awesome-web-component", h: true } ] },
                { title: "Extract Anchor URL Location", desc: "Pull out the href attribute destination string from a basic anchor link tag.\nInput: Anchor tag string\nOutput: Link path", difficulty: "Medium", input: "<a href=\"/dashboard\">Go</a>", output: "/dashboard", cases: [ { i: "<a href=\"/dashboard\">Go</a>", e: "/dashboard", h: false }, { i: "<a href=\"https://google.com\">", e: "https://google.com", h: false }, { i: "<a href=\"#top\">", e: "#top", h: true } ] },
                { title: "Generate Flexbox CSS Class", desc: "Output the required CSS classes given row/column and alignments (e.g. 'row center center' -> 'flex flex-row justify-center items-center').\nInput: Format direction justify align\nOutput: CSS utilities class", difficulty: "Medium", input: "row center center", output: "flex flex-row justify-center items-center", cases: [ { i: "row center center", e: "flex flex-row justify-center items-center", h: false }, { i: "col start end", e: "flex flex-col justify-start items-end", h: false }, { i: "row between start", e: "flex flex-row justify-between items-start", h: true } ] },
                { title: "HTML Image Tag Alt Linter", desc: "Check if an HTML image tag includes the mandatory 'alt' attribute.\nInput: Image tag string\nOutput: 'Pass' or 'Fail'", difficulty: "Medium", input: "<img src=\"avatar.png\" alt=\"User Profile\">", output: "Pass", cases: [ { i: "<img src=\"avatar.png\" alt=\"User Profile\">", e: "Pass", h: false }, { i: "<img src=\"logo.png\">", e: "Fail", h: false }, { i: "<img alt=\"test\" src=\"\">", e: "Pass", h: true } ] },
                { title: "Validate Hex Color String", desc: "Validate if a given hex color string starts with #, is followed by exactly 3 or 6 hex characters.\nInput: Hex string\nOutput: 'Valid' or 'Invalid'", difficulty: "Hard", input: "#C0C0C0", output: "Valid", cases: [ { i: "#C0C0C0", e: "Valid", h: false }, { i: "#abc", e: "Valid", h: false }, { i: "#abcd", e: "Invalid", h: true } ] },
                { title: "CSS Margins Shorthand Expander", desc: "Given shorthand padding (e.g. '10px 5px'), expand it to top-right-bottom-left format.\nInput: Padding string\nOutput: Top Right Bottom Left format", difficulty: "Hard", input: "10px 5px", output: "top:10px right:5px bottom:10px left:5px", cases: [ { i: "10px 5px", e: "top:10px right:5px bottom:10px left:5px", h: false }, { i: "10px", e: "top:10px right:10px bottom:10px left:10px", h: false }, { i: "1px 2px 3px 4px", e: "top:1px right:2px bottom:3px left:4px", h: true } ] },
                { title: "Extract CSS Query Breakpoints", desc: "Parse a media query string (e.g. '@media (max-width: 768px)') and extract the screen breakpoint dimension in pixels.\nInput: Media query\nOutput: Pixel dimension integer", difficulty: "Hard", input: "@media (max-width: 768px)", output: "768", cases: [ { i: "@media (max-width: 768px)", e: "768", h: false }, { i: "(min-width: 1024px)", e: "1024", h: false }, { i: "max-width: 1200px", e: "1200", h: true } ] }
            ],
            "MERN Stack Development": [
                { title: "Build Mongoose Query Or Arrays", desc: "Create an exact Mongoose $or query structure given space-separated tags.\nInput: Space-separated words\nOutput: JSON array", difficulty: "Easy", input: "node react", output: '[{"tag":"node"},{"tag":"react"}]', cases: [ { i: "node react", e: '[{"tag":"node"},{"tag":"react"}]', h: false }, { i: "mongodb", e: '[{"tag":"mongodb"}]', h: false }, { i: "express backend", e: '[{"tag":"express"},{"tag":"backend"}]', h: true } ] },
                { title: "JWT Token Header Guard", desc: "Verify if Authorization header is in valid JWT 'Bearer abc.def.ghi' format.\nInput: Header string\nOutput: 'Authorized' or 'Unauthorized'", difficulty: "Easy", input: "Bearer abc.def.ghi", output: "Authorized", cases: [ { i: "Bearer abc.def.ghi", e: "Authorized", h: false }, { i: "abc.def.ghi", e: "Unauthorized", h: false }, { i: "Bearer invalid", e: "Unauthorized", h: true } ] },
                { title: "React State Action Creator", desc: "Build a Redux-like action object given type and payload words separated by space.\nInput: Type Payload\nOutput: JSON representation", difficulty: "Medium", input: "ADD_USER John", output: '{"type":"ADD_USER","payload":"John"}', cases: [ { i: "ADD_USER John", e: '{"type":"ADD_USER","payload":"John"}', h: false }, { i: "LOGOUT null", e: '{"type":"LOGOUT","payload":null}', h: false }, { i: "SET_THEME dark", e: '{"type":"SET_THEME","payload":"dark"}', h: true } ] },
                { title: "Check Valid Mongo Object ID", desc: "Ensure a given string represents a valid 24-character hexadecimal MongoDB ObjectId.\nInput: ObjectId string\nOutput: 'Valid' or 'Invalid'", difficulty: "Medium", input: "507f1f77bcf86cd799439011", output: "Valid", cases: [ { i: "507f1f77bcf86cd799439011", e: "Valid", h: false }, { i: "507f1f77bc", e: "Invalid", h: false }, { i: "g07f1f77bcf86cd799439011", e: "Invalid", h: true } ] },
                { title: "Construct Express API Route", desc: "Assemble route files mapping verb and path (e.g. 'GET /users') to Express handler structure.\nInput: Verb Path\nOutput: Handler code template", difficulty: "Medium", input: "GET /users", output: "router.get('/users', (req, res) => {});", cases: [ { i: "GET /users", e: "router.get('/users', (req, res) => {});", h: false }, { i: "POST /tasks", e: "router.post('/tasks', (req, res) => {});", h: false }, { i: "DELETE /profiles", e: "router.delete('/profiles', (req, res) => {});", h: true } ] },
                { title: "Count React Hooks Usages", desc: "Count how many React Hooks (words starting with 'use') exist in a space-separated React component string.\nInput: Space-separated words\nOutput: Hook count", difficulty: "Medium", input: "useState useEffect useCallback myFunc", output: "3", cases: [ { i: "useState useEffect useCallback myFunc", e: "3", h: false }, { i: "Component test", e: "0", h: false }, { i: "useRef useMemo useMyHook useAuth getVal", e: "4", h: true } ] },
                { title: "Parse CORS Allowed Origins", desc: "Verify if a request origin is allowed given space-separated whitelist domains.\nInput: Request origin followed by space-separated whitelist domains (e.g. 'google.com apple.com google.com yahoo.com')\nOutput: 'Allowed' or 'Blocked'", difficulty: "Medium", input: "google.com apple.com google.com yahoo.com", output: "Allowed", cases: [ { i: "google.com apple.com google.com yahoo.com", e: "Allowed", h: false }, { i: "bing.com apple.com google.com", e: "Blocked", h: false }, { i: "localhost:3000 localhost:3000 localhost:8080", e: "Allowed", h: true } ] },
                { title: "Clean Query Parameter Inputs", desc: "Write a SQL/NoSQL safe string cleaner that strips characters like '$' and '.' from user inputs.\nInput: Dirty input\nOutput: Sanitized input", difficulty: "Hard", input: "$gt:5.0", output: "gt50", cases: [ { i: "$gt:5.0", e: "gt50", h: false }, { i: "username", e: "username", h: false }, { i: "admin.$db", e: "admindb", h: true } ] },
                { title: "Format React Props Interface", desc: "Generate a TypeScript props interface name based on a camelCase component name.\nInput: Component name string\nOutput: Interface name", difficulty: "Hard", input: "userProfileCard", output: "interface UserProfileCardProps {}", cases: [ { i: "userProfileCard", e: "interface UserProfileCardProps {}", h: false }, { i: "sidebar", e: "interface SidebarProps {}", h: false }, { i: "buttonNav", e: "interface ButtonNavProps {}", h: true } ] },
                { title: "Check Token Expired Time", desc: "Given a token expiration epoch timestamp (seconds) and current time, calculate remaining minutes. If already expired, return 'Expired'.\nInput: ExpireEpoch CurrentEpoch space-separated (e.g. '1710000000 1710000300')\nOutput: Remaining minutes", difficulty: "Hard", input: "1710000600 1710000000", output: "10", cases: [ { i: "1710000600 1710000000", e: "10", h: false }, { i: "1710000000 1710000300", e: "Expired", h: false }, { i: "1800000360 1800000000", e: "6", h: true } ] }
            ]
        };
        
        // Populate standard templates for all missing domains (like Cyber Security, Data Science etc.)
        // using the key patterns so every domain has 10 items
        for (const dom of domains) {
            const spec = domainSpecs[dom] || domainSpecs["Web Development"]; // fallback
            for (let i = 0; i < spec.length; i++) {
                const s = spec[i];
                questionsToSeed.push({
                    domain: dom,
                    title: s.title,
                    description: s.desc,
                    inputFormat: "Standard console input structure.",
                    outputFormat: "Standard parsed console output.",
                    sampleInput: s.input,
                    sampleOutput: s.output,
                    difficulty: s.difficulty,
                    testCases: s.cases.map(c => ({
                        input: c.i,
                        expectedOutput: c.e,
                        isHidden: c.h
                    }))
                });
            }
            
            // To guarantee exactly 10 questions per domain, we can duplicate and vary titles
            while (questionsToSeed.filter(q => q.domain === dom).length < 10) {
                const currentCount = questionsToSeed.filter(q => q.domain === dom).length;
                const src = spec[currentCount % spec.length];
                questionsToSeed.push({
                    domain: dom,
                    title: `${src.title} (v${Math.floor(currentCount / spec.length) + 1})`,
                    description: `${src.desc}\n\nNote: Version ${Math.floor(currentCount / spec.length) + 1} variation for coding competency.`,
                    inputFormat: "Standard console input structure.",
                    outputFormat: "Standard parsed console output.",
                    sampleInput: src.input,
                    sampleOutput: src.output,
                    difficulty: src.difficulty,
                    testCases: src.cases.map(c => ({
                        input: c.i,
                        expectedOutput: c.e,
                        isHidden: c.h
                    }))
                });
            }
        }
        
        // Also map MERN Stack to MERN Stack Development so either lookup works perfectly
        const mernQ = questionsToSeed.filter(q => q.domain === "MERN Stack Development");
        for (const q of mernQ) {
            questionsToSeed.push({
                ...q,
                domain: "MERN Stack"
            });
        }
        
        await runWithRetry(() => CodingQuestionModel.insertMany(questionsToSeed));
        console.log("Seeded " + questionsToSeed.length + " default Coding Questions successfully.");
    } catch (err) {
        console.error("Failed to seed default Coding Questions:", err);
    }
  } catch(e) {
    console.error("Auto seeding tasks failed:", e);
  }
})
.catch((err)=>{
  console.warn("MongoDB connection warning: Working in local runtime mode. Some write services may require database configuration. " + err.message);
  global.isMongoUnhealthy = true;
});

// ================= SCHEMAS =================

const submissionSchema = new mongoose.Schema({
    employeeId: String,
    domain: String,
    task: String,
    githubLink: String,
    note: String,
    image: String,
    pdf: String,
    feedback: { type: String, default: "No Feedback Yet" },
    status: { type: String, default: "Pending" },
    reviewedOnce: { type: Boolean, default: false },
    attendanceAllowed: { type: Boolean, default: false },
    attendanceGiven: { type: Boolean, default: false },
    attendanceCount: { type: Number, default: 0 },
    coordinatorRating: { type: Number, default: 0, min: 0, max: 5 },
    internshipDuration: { type: String, default: "1 Month" },
    monthlyAttendance: {
        month1: { type: Number, default: 0 },
        month2: { type: Number, default: 0 },
        month3: { type: Number, default: 0 },
        month4: { type: Number, default: 0 },
        month5: { type: Number, default: 0 },
        month6: { type: Number, default: 0 }
    },
    meetingsJoined: { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },
    performance: { type: String, default: "B" },
    submittedAt: { type: Date, default: Date.now },
    // F8 — task deadline tracking. The deadline itself lives on CoordinatorTask
    // (one per domain); isOverdue is a per-submission flag the cron flips when
    // the deadline elapses without an Approved review.
    isOverdue: { type: Boolean, default: false }
});

const Submission = mongoose.model("Submission", submissionSchema);

function getStudentCollege(student){
    return (student && (student.collegeName || student.college) || "").trim();
}

function collegeDisplay(student){
    return getStudentCollege(student) || "Not Provided";
}

async function attachStudentDetailsToSubmissions(submissions){
    const ids = [...new Set(submissions.map(s => s.employeeId).filter(Boolean))];
    const students = ids.length ? await Student.find({ employeeId: { $in: ids } }) : [];
    const byEmp = new Map(students.map(s => [s.employeeId, s]));
    return submissions.map(sub => {
        const obj = sub.toObject ? sub.toObject() : sub;
        const student = byEmp.get(obj.employeeId);
        return {
            ...obj,
            studentName: student ? (student.name || `${student.firstName || ""} ${student.lastName || ""}`).trim() : (obj.studentName || ""),
            collegeName: student ? collegeDisplay(student) : "Not Provided",
            college: student ? collegeDisplay(student) : "Not Provided"
        };
    });
}

// ================= TEST SCHEMAS =================

const testQuestionSchema = new mongoose.Schema({
    domain: { type: String, required: true },
    question: { type: String, required: true },
    options: [String],
    correctAnswer: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});

const TestQuestion = mongoose.model("TestQuestion", testQuestionSchema);

const testResultSchema = new mongoose.Schema({
    employeeId: { type: String, required: true },
    studentName: { type: String, required: true },
    domain: { type: String, required: true },
    score: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now }
});

const TestResult = mongoose.model("TestResult", testResultSchema);

// ================= ROUTES =================

// Phase-1 multi-role registration hub
app.use("/api/register-hub", require("./routes/registerHub"));
app.use("/api/v2/location-education", require("./routes/locationEducation"));

app.get("/dashboard", (req,res)=>{ res.sendFile(path.join(__dirname,"public","dashboard.html")); });
app.get("/groups", (req,res)=>{ res.sendFile(path.join(__dirname,"public","groups.html")); });
app.get("/edit.html", (req,res)=>{ res.sendFile(path.join(__dirname,"public","edit.html")); });
app.get("/hr-portal", (req,res)=>{ res.sendFile(path.join(__dirname,"public","hr-portal.html")); });
app.get("/hr-control-center", (req,res)=>{ res.sendFile(path.join(__dirname,"public","hr-portal.html")); });
app.get("/hr-login", (req,res)=>{ res.sendFile(path.join(__dirname,"public","hr-login.html")); });
app.get("/register", (req,res)=>{ res.sendFile(path.join(__dirname,"public","register.html")); });
app.get("/coming-soon", (req,res)=>{ res.sendFile(path.join(__dirname,"public","coming-soon.html")); });

// ── Phase 2 page routes ─────────────────────────────────────────────────────
app.get("/registration-success", (req,res)=>{ res.sendFile(path.join(__dirname,"public","registration-success.html")); });
app.get("/founder-registration-success", (req,res)=>{ res.sendFile(path.join(__dirname,"public","founder-registration-success.html")); });
app.get("/student-login",     (req,res)=>{ res.sendFile(path.join(__dirname,"public","student-login.html")); });
app.get("/founder-login",     (req,res)=>{ res.sendFile(path.join(__dirname,"public","founder-login.html")); });
app.get("/mentor-login",      (req,res)=>{ res.sendFile(path.join(__dirname,"public","mentor-login.html")); });
app.get("/investor-login",    (req,res)=>{ res.sendFile(path.join(__dirname,"public","investor-login.html")); });
app.get("/contractor-login",  (req,res)=>{ res.sendFile(path.join(__dirname,"public","contractor-login.html")); });
app.get("/login",             (req,res)=>{ res.sendFile(path.join(__dirname,"public","login.html")); });
app.get("/student-dashboard", (req,res)=>{ res.sendFile(path.join(__dirname,"public","student-dashboard.html")); });
// Direct messages, for every role. The page derives identity from the
// session, so one URL serves students, coordinators, HR and admin.
app.get("/messages",          (req,res)=>{ res.sendFile(path.join(__dirname,"public","messages.html")); });
app.get("/notifications",     (req,res)=>{ res.sendFile(path.join(__dirname,"public","notifications.html")); });

app.get("/mentor-dashboard",  (req,res)=>{ res.sendFile(path.join(__dirname,"public","mentor-dashboard.html")); });
app.get("/investor-dashboard",(req,res)=>{ res.sendFile(path.join(__dirname,"public","investor-dashboard.html")); });
app.get("/contractor-dashboard",(req,res)=>{ res.sendFile(path.join(__dirname,"public","contractor-dashboard.html")); });
app.get("/my-internships",    (req,res)=>{ res.sendFile(path.join(__dirname,"public","my-internships.html")); });
app.get("/talent-network",    (req,res)=>{ res.sendFile(path.join(__dirname,"public","talent-network.html")); });
app.get("/programs",          (req,res)=>{ res.sendFile(path.join(__dirname,"public","programs.html")); });
app.get("/founder/directory", (req,res)=>{ res.sendFile(path.join(__dirname,"public","founder-directory.html")); });
app.get("/mentor/directory",  (req,res)=>{ res.sendFile(path.join(__dirname,"public","mentor-directory.html")); });
app.get("/investor/directory",(req,res)=>{ res.sendFile(path.join(__dirname,"public","investor-directory.html")); });
app.get("/hr/dashboard",      (req,res)=>{ res.sendFile(path.join(__dirname,"public","hr-ecosystem.html")); });
app.get("/founder-os",        (req,res)=>{ res.sendFile(path.join(__dirname,"public","founder-os.html")); });
app.get("/community",         (req,res)=>{ res.sendFile(path.join(__dirname,"public","community.html")); });
app.get("/payment",           (req,res)=>{ res.sendFile(path.join(__dirname,"public","payment.html")); });
app.get("/payment-return",    (req,res)=>{ res.sendFile(path.join(__dirname,"public","payment-return.html")); });

// ================= EMPLOYEE ID =================

// Employee-ID generation lives in utils/employeeId.js. There were two copies of
// this function with different domain maps and different unknown-domain
// fallbacks, and both derived the sequence from Student.countDocuments() — which
// collides under concurrent registration and rewinds when a student is deleted.
const {
    generateEmployeeId,
    isEmployeeIdAvailable,
    initEmployeeIdCounter
} = require("./utils/employeeId");

// Availability check the registration form calls before submitting, so a
// student sees "This Employee ID is already taken" against the field instead of
// a generic server error — or, in JSON-fallback mode, instead of a silent
// duplicate.
// Public config the front-end needs so pages cannot drift from the server.
app.get("/api/public-config", (req, res) => {
    const { OFFICIAL_REPO_SLUG, OFFICIAL_REPO_URL } = require("./config/github");
    const { SELECTABLE_DOMAIN_NAMES } = require("./config/domains");
    const { DURATION_TYPES, TENURE_LABELS } = require("./utils/tenure");
    res.json({
        success: true,
        officialRepoSlug: OFFICIAL_REPO_SLUG,
        officialRepoUrl: OFFICIAL_REPO_URL,
        domains: SELECTABLE_DOMAIN_NAMES,
        tenures: DURATION_TYPES.map((key) => ({ key, label: TENURE_LABELS[key] }))
    });
});

app.get("/api/employee-id/available", async (req, res) => {
    try {
        const result = await isEmployeeIdAvailable(req.query.employeeId);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("[employeeId] availability check failed:", err.message);
        res.status(500).json({ success: false, available: false, reason: "Could not check that Employee ID right now." });
    }
});

// ================= REGISTER (Feature 1: welcome email + multi-domain) =================
// A student can register for UP TO 2 domains using the same email + phone.
// The two domains MUST be different. Same domain twice -> blocked.
// On the FIRST domain registration we send a welcome email; on the second
// domain we link the two Student docs via linkedDomains and skip the email.

function welcomeEmailHtml({ name, employeeId, domain, email, password, joinedOn, host }){
    const safe = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const loginUrl = (host ? host.replace(/\/$/, "") : "") + "/login.html";
    return `<!doctype html><html><body style="margin:0;background:#0c1220;font-family:Segoe UI,Arial,sans-serif;color:#f0eee8;">
<table width="100%" cellspacing="0" cellpadding="0" style="background:#0c1220;padding:32px 0;"><tr><td align="center">
  <table width="600" cellspacing="0" cellpadding="0" style="background:#0e1628;border:1px solid rgba(245,197,66,0.18);border-radius:18px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#1a1208,#3a2a08);padding:28px 32px;text-align:center;">
      <div style="font-size:13px;letter-spacing:6px;color:#f5c542;font-weight:700;">THE ENTREPRENEURSHIP NETWORK</div>
      <div style="font-size:24px;color:#fff7d6;font-weight:800;margin-top:8px;">🎉 Welcome, ${safe(name)}!</div>
    </td></tr>
    <tr><td style="padding:28px 34px;">
      <p style="font-size:15px;line-height:1.55;margin:0 0 16px;">Dear <b>${safe(name)}</b>,</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
        We are thrilled to welcome you to <b style="color:#f5c542;">The Entrepreneurship Network</b> as an intern.
        Your journey to build real-world skills starts today!
      </p>
      <table width="100%" cellspacing="0" cellpadding="0" style="background:#0c1220;border:1px solid rgba(245,197,66,0.15);border-radius:12px;margin:18px 0;">
        <tr><td style="padding:18px 22px;">
          <div style="color:#f5c542;font-size:11px;letter-spacing:2px;font-weight:700;">YOUR DETAILS</div>
          <div style="margin-top:10px;font-size:14px;line-height:1.85;">
            <b>Name:</b> ${safe(name)}<br>
            <b>Employee ID:</b> <span style="color:#f5c542;">${safe(employeeId)}</span><br>
            <b>Domain:</b> ${safe(domain)}<br>
            <b>Role:</b> Intern<br>
            <b>Joined On:</b> ${safe(joinedOn)}
          </div>
        </td></tr>
      </table>
      <table width="100%" cellspacing="0" cellpadding="0" style="background:rgba(245,197,66,0.06);border:1px dashed rgba(245,197,66,0.35);border-radius:12px;">
        <tr><td style="padding:18px 22px;">
          <div style="color:#f5c542;font-size:11px;letter-spacing:2px;font-weight:700;">YOUR LOGIN CREDENTIALS</div>
          <div style="margin-top:10px;font-size:14px;line-height:1.85;">
            <b>Email:</b> ${safe(email)}<br>
            <b>Employee ID:</b> <code style="background:#0c1220;padding:3px 8px;border-radius:6px;color:#f5c542;font-family:Consolas,monospace;">${safe(employeeId)}</code><br>
            <b>Password:</b> <code style="background:#0c1220;padding:3px 8px;border-radius:6px;color:#f5c542;font-family:Consolas,monospace;letter-spacing:1px;">${safe(password)}</code><br>
            <b>Login URL:</b> <a href="${safe(loginUrl)}" style="color:#f5c542;">${safe(loginUrl)}</a>
          </div>
          <p style="margin:14px 0 0;font-size:12px;color:#cdb24a;">
            🔒 Keep these credentials safe. Do not share with anyone.
          </p>
        </td></tr>
      </table>
      <p style="font-size:14px;line-height:1.7;margin:20px 0 8px;">
        <b>What to do next:</b>
      </p>
      <ol style="font-size:14px;line-height:1.7;color:#cdd9ec;margin:0 0 16px 22px;padding:0;">
        <li>Login at the portal using the credentials above.</li>
        <li>Mark your attendance every day.</li>
        <li>Submit your daily tasks to your coordinator.</li>
        <li>Reach <b>75%</b> attendance to qualify for certificates.</li>
        <li>Get certified and share on LinkedIn!</li>
      </ol>
      <p style="font-size:14px;margin:24px 0 4px;">Warm regards,</p>
      <p style="font-size:14px;margin:0;"><b>HR Team</b><br/>The Entrepreneurship Network<br/>
        <a href="mailto:ten.hr.contact@gmail.com" style="color:#f5c542;">ten.hr.contact@gmail.com</a>
      </p>
    </td></tr>
    <tr><td style="background:#080d1a;padding:14px 22px;text-align:center;font-size:11px;color:#6a6255;letter-spacing:1px;">
      © The Entrepreneurship Network · Limitless Technologies LLP
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

app.post("/register", registerLimiter, async(req,res)=>{
try{
    const { firstName, lastName, domain, whatsapp, email, tenure, joiningDate } = req.body;
    const collegeName = String(req.body.collegeName || req.body.college || "").trim();
    if(!email || !domain){
        return res.json({ success:false, message:"Email and domain are required" });
    }
    const emailLc = String(email).trim().toLowerCase();

    // Find every existing Student doc with this email (across any domain).
    const existingByEmail = await Student.find({ email: emailLc });

    // Same domain twice → blocked.
    const sameDomainHit = existingByEmail.find(s => (s.domain||"") === domain);
    if(sameDomainHit){
        return res.json({ success:false, alreadyInDomain:true,
            message:"You are already registered in this domain",
            employeeId: sameDomainHit.employeeId });
    }

    // 2 domains is the maximum.
    if(existingByEmail.length >= 2){
        return res.json({ success:false,
            message:"This email is already registered in 2 domains (the maximum allowed)." });
    }

    const isFirstRegistration = existingByEmail.length === 0;

    const employeeId = await generateEmployeeId(domain);
    // Auto-generated password (we kept the original behavior — register form
    // has no password field). For multi-domain registrations we re-use the
    // existing student's password so the user has one password across both.
    //
    // `generatedPassword` is the cleartext, and it exists ONLY in this
    // request's memory so it can be emailed to the student. What gets stored
    // is the bcrypt hash. This path previously stored the cleartext directly
    // in `password` (never hashed) and kept a second copy in `plainPassword`.
    //
    // For a multi-domain registration the second account re-uses the first
    // account's existing hash, so one password works across both. That hash
    // cannot be reversed, so no new welcome password is issued in that case.
    let password;              // what we persist — always a bcrypt hash
    let generatedPassword = null;  // cleartext, for the welcome email only
    if (isFirstRegistration) {
        generatedPassword = generateTempPassword();
        password = await bcrypt.hash(generatedPassword, 12);
    } else {
        const existingStudentToken = existingByEmail[0];
        if (existingStudentToken.password) {
            password = existingStudentToken.password;
        } else {
            generatedPassword = generateTempPassword();
            password = await bcrypt.hash(generatedPassword, 12);
        }
    }

    const newStudent = new Student({
        firstName, lastName,
        name: (firstName||"") + " " + (lastName||""),
        domain, whatsapp, email: emailLc,
        collegeName,
        college: collegeName,
        tenure, joiningDate,
        employeeId, password,
        collegeName: collegeName || ""
    });
    await newStudent.save();

    // Mark if this is a new (paying) student vs existing (free) student
    const PAYMENT_CUTOFF = new Date('2026-07-09T00:00:00.000Z');
    if (newStudent.createdAt < PAYMENT_CUTOFF) {
      newStudent.isExistingStudent = true;
      newStudent.shortCoursePaid = true; // existing students bypass payment
      await newStudent.save();
    }

    // Maintain linkedDomains on every (now ≤ 2) student doc with this email.
    const allForEmail = [...existingByEmail, newStudent];
    const linked = allForEmail.map(s => ({
        domain: s.domain, studentId: s._id, employeeId: s.employeeId
    }));
    await Promise.all(allForEmail.map(s => Student.findByIdAndUpdate(s._id, { linkedDomains: linked })));

    // Email — only on the FIRST domain registration.
    if(isFirstRegistration){
        try{
            const host = (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host");
            const joinedOn = new Date().toLocaleDateString("en-IN", { day:"numeric", month:"long", year:"numeric" });
            const html = welcomeEmailHtml({
                // `password` here is the bcrypt hash. Sending that is what the
                // welcome email did: the student received a 60-character
                // "$2b$12$..." string as their password and could never sign
                // in with it. The cleartext exists only in this request's
                // memory, for this email.
                name: newStudent.name.trim(), employeeId, domain, email: emailLc,
                password: generatedPassword,
                joinedOn, host
            });
            let mailStatus = "sent";
            let mailError = "";
            try {
                await transporter.sendMail({
                    from:"TEN Internship Portal <ten.internshipportal@gmail.com>",
                    to: emailLc,
                    subject:`🎉 Welcome to The Entrepreneurship Network, ${newStudent.name.trim()}!`,
                    html,
                    text: `Hello ${firstName||""}, your Internship Registration is Successful.\n\nEmployee ID: ${employeeId}\nPassword: ${password}\nDomain: ${domain}\n\nLogin: ${host || ""}/login.html`
                });
            } catch (err) {
                mailStatus = "failed";
                mailError = err && err.message ? String(err.message) : "";
            } finally {
                try {
                    await MailHistory.create({
                        recipientEmail: emailLc,
                        recipientName: newStudent.name.trim(),
                        studentId: newStudent._id,
                        subject: `🎉 Welcome to The Entrepreneurship Network, ${newStudent.name.trim()}!`,
                        mailType: "welcome",
                        sentAt: new Date(),
                        status: mailStatus,
                        errorMessage: mailError
                    });
                } catch (_) {}
                await Notification.notifyStudent({ employeeId, domain }, {
                    title: "🎉 Welcome to TEN!",
                    message: `Hello ${newStudent.name.trim()}, your internship registration was successful. Your Employee ID is ${employeeId} (${domain}). A welcome email has been sent to ${emailLc}.`,
                    type: "success"
                });
            }
        }catch(mailError){ console.log("MAIL ERROR:", mailError && mailError.message); }
    }

    res.json({ success:true, employeeId, password, secondDomain: !isFirstRegistration });

}catch(error){ console.log(error); res.status(500).json({ success:false, message:"Server Error" }); }
});

// ================= LOGIN IDENTITY RESOLUTION =================
// How an employee ID or email is matched to an account. Extracted because
// getting it wrong tells an active student their account does not exist.
const loginIdentity = require("./services/loginIdentity");

// ================= ACCOUNT LOCKOUT SECURE SERVICE =================
function getRemainingLockoutTime(user) {
    if (user.isLockedOut && user.lockoutUntil) {
        const remainingTime = new Date(user.lockoutUntil).getTime() - Date.now();
        if (remainingTime > 0) {
            const minutes = Math.ceil(remainingTime / (1000 * 60));
            return minutes;
        }
    }
    return 0;
}

async function checkLockout(res, user, userModel) {
    const minutes = getRemainingLockoutTime(user);
    if (minutes > 0) {
        res.json({
            success: false,
            message: `Your account is temporarily locked. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`
        });
        return true; // is locked
    }
    if (user.isLockedOut) {
        await userModel.findByIdAndUpdate(user._id, {
            isLockedOut: false,
            lockoutUntil: null,
            failedLoginAttempts: 0
        });
        user.isLockedOut = false;
        user.lockoutUntil = null;
        user.failedLoginAttempts = 0;
    }
    return false;
}

// Lockout policy: 5 failures WITHIN 30 MINUTES lock that ONE account for 15
// minutes. The counters live on the individual user document, so a lockout can
// never affect another account — including accounts sharing a college wifi or
// hostel network with the one that failed.
//
// The window is the important part. `failedLoginAttempts` used to have no decay
// at all: it reset only on a successful sign-in or when a lockout expired. So
// five mistyped passwords spread over three months added up, and a student who
// fumbled twice in June and three times in August was locked out with no idea
// why. The counter is meant to catch a burst of guesses, not a year of ordinary
// human error.
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const LOCKOUT_WINDOW_MS   = 30 * 60 * 1000;

async function recordFailedAttempt(res, user, userModel, defaultErrorMsg) {
    const attempts = loginIdentity.nextFailedAttemptCount(user, LOCKOUT_WINDOW_MS);
    const updateData = { failedLoginAttempts: attempts, lastFailedLoginAt: new Date() };

    if (attempts >= LOCKOUT_MAX_ATTEMPTS) {
        updateData.isLockedOut = true;
        updateData.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        await userModel.findByIdAndUpdate(user._id, updateData);
        return res.json({
            success: false,
            message: "Your account is temporarily locked. Try again in 15 minutes."
        });
    }

    await userModel.findByIdAndUpdate(user._id, updateData);
    // The remaining-attempt count is deliberately not returned: it confirms to
    // an unauthenticated caller that the account exists.
    return res.json({ success: false, message: defaultErrorMsg });
}

async function clearFailedAttempts(user, userModel) {
    if (user.failedLoginAttempts > 0 || user.isLockedOut) {
        await userModel.findByIdAndUpdate(user._id, {
            failedLoginAttempts: 0,
            isLockedOut: false,
            lockoutUntil: null,
            lastFailedLoginAt: null
        });
    }
}

// ================= LOGIN =================

/**
 * Sign out, properly.
 *
 * Every "Logout" button in the portal clears sessionStorage and navigates to
 * the login page, which looks like signing out and is not: the session cookie
 * survives, so the API still recognises the browser and going back to any
 * portal page signs straight back in. That matters on a shared or college
 * machine, and it matters for the "do this later" link on the credential-reset
 * panel, which has to actually end the session.
 *
 * Always answers success — a sign-out that reports failure leaves someone
 * stuck on a page they are trying to leave.
 */
app.post("/logout", (req, res) => {
    if (!req.session) return res.json({ success: true });
    req.session.destroy(() => {
        res.clearCookie("ten.sid");
        res.json({ success: true });
    });
});

app.post("/login", loginIpLimiter, loginLimiter, async(req,res)=>{
try{
    let mentorProfileObj = null;
    const { employeeId, password, email, role } = req.body;
    const loginId = (employeeId || email || "").trim();

    if (!loginId) {
        return res.json({ success: false, message: "Please provide your Email or Employee ID." });
    }
    if (!password) {
        return res.json({ success: false, message: "Please enter your password." });
    }

    const isEmail = loginId.includes("@");

    if (isEmail) {
        const EcosystemUser = require("./models/EcosystemUser");
        const user = await EcosystemUser.findOne({ email: loginId.toLowerCase() });
        if (user) {
            // Verify role match
            if (role && user.role !== role) {
                return res.json({ success: false, message: `Access denied. No ${role} account found with this email.` });
            }

            // Lockout check
            if (await checkLockout(res, user, EcosystemUser)) return;

            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return await recordFailedAttempt(res, user, EcosystemUser, "Invalid Password.");
            }

            // Enforce Ecosystem HR Approval and Suspend constraints
            if (['student', 'founder', 'mentor', 'investor', 'contractor'].includes(user.role)) {
                if (user.isActive === false) {
                    return res.json({ success: false, message: "Your account has been Suspended by HR. Please contact support." });
                }

                const StudentProfile = require("./models/StudentProfile");
                const FounderProfile = require("./models/FounderProfile");
                const MentorProfile = require("./models/MentorProfile");
                const InvestorProfile = require("./models/InvestorProfile");
                const ContractorProfile = require("./models/ContractorProfile");

                let verificationStatus = 'pending';
                if (user.role === 'student') {
                    const profile = await StudentProfile.findOne({ userId: user._id });
                    if (profile) verificationStatus = profile.verificationStatus || 'pending';
                } else if (user.role === 'founder') {
                    const profile = await FounderProfile.findOne({ userId: user._id });
                    if (profile) verificationStatus = profile.verificationStatus || 'pending';
                } else if (user.role === 'mentor') {
                    mentorProfileObj = await MentorProfile.findOne({ userId: user._id });
                    if (mentorProfileObj) verificationStatus = mentorProfileObj.verificationStatus || 'pending';
                } else if (user.role === 'investor') {
                    const profile = await InvestorProfile.findOne({ userId: user._id });
                    if (profile) verificationStatus = profile.verificationStatus || 'pending';
                } else if (user.role === 'contractor') {
                    const profile = await ContractorProfile.findOne({ userId: user._id });
                    if (profile) verificationStatus = profile.verificationStatus || 'pending';
                }

                if (verificationStatus === 'pending') {
                    return res.json({ success: false, message: "Your registration is Pending Approval by HR. Please wait for confirmation." });
                } else if (verificationStatus === 'rejected') {
                    return res.json({ success: false, message: "Your registration application has been Rejected by HR." });
                } else if (verificationStatus === 'suspended') {
                    return res.json({ success: false, message: "Your account has been Suspended by HR. Please contact support." });
                }
            }
            
            // Password match on locked accounts resets attempts
            await clearFailedAttempts(user, EcosystemUser);

            const crypto = require("crypto");
            const sessionToken = "ten_sess_" + crypto.randomBytes(24).toString("hex");

            user.activeSessionToken = sessionToken;
            user.lastLoginAt = new Date();
            try { await user.save(); } catch(e) {}

            // If student, get the legacy Student record.
            //
            // The lookup is case-insensitive. EcosystemUser.email is stored
            // lowercased; a Student row created before that convention can hold
            // "Name@Gmail.com", and an exact match then missed it — the student
            // signed in successfully but the dashboard rendered the fallback
            // identity below and greeted them "Welcome, Student".
            let student = null;
            if (user.role === 'student') {
                const emailRx = new RegExp("^\\s*" +
                    String(user.email || "").replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "\\s*$", "i");
                student = await Student.findOne({ email: { $regex: emailRx } });
                if (student) {
                    // activeSessionToken goes on the Student too, not only on
                    // the EcosystemUser.
                    //
                    // This is what locked students out. verifySingleSession
                    // resolves the acting record from req.session.student._id —
                    // a Student id — so EcosystemUser.findById misses and it
                    // falls through to Student.findById. Writing the new token
                    // only to the EcosystemUser left the Student holding a token
                    // from some earlier sign-in, the guard compared that stale
                    // value against the fresh one in the session, and answered
                    // every /api request with 401 SESSION_SUPERSEDED. The page
                    // treats a 401 as a sign-out, so the student bounced back to
                    // the login screen — permanently, since each retry repeated
                    // the same mismatch.
                    student.lastActiveDate = new Date();
                    student.activeSessionToken = sessionToken;
                    try { await student.save(); } catch (e) {
                        await Student.updateOne({ _id: student._id },
                            { $set: { lastActiveDate: new Date(), activeSessionToken: sessionToken } });
                    }
                }
            }

            // Identity for the browser, never the raw document: that shipped the
            // bcrypt hash, the password-reset token and megabytes of base64 PDF
            // to the client on every sign-in.
            const studentPayload = student ? sanitizeStudent(student) : {
                _id: user._id,
                employeeId: user._id.toString(),
                name: user.fullName || "",
                email: user.email,
                // Deliberately blank. This used to read 'Web Development',
                // which silently put every ecosystem student with no legacy
                // record into a domain they had never chosen.
                domain: ""
            };

            if (user.role === 'student') {
                // Minimal identity only — see establishStudentSession. Assigning
                // the whole Student document here put its base64 PDFs into the
                // session store on every login.
                establishStudentSession(req, studentPayload);
            }
            req.session.sessionToken = sessionToken;

            return res.json({
                success: true,
                sessionToken: sessionToken,
                role: user.role,
                user: {
                    _id: user._id,
                    fullName: user.fullName,
                    email: user.email,
                    role: user.role,
                    phone: user.phone,
                    expertise: mentorProfileObj ? mentorProfileObj.expertise : []
                },
                student: studentPayload
            });
        }

        // Check legacy Student model by email just in case.
        //
        // Case-insensitive: rows created before emails were stored lowercased
        // hold "Name@Gmail.com", and the exact lowercase match this used to do
        // never found them. The EcosystemUser branch above was already fixed
        // for exactly this; a student with no EcosystemUser record hit this
        // branch and simply could not sign in by email.
        const student = await loginIdentity.findStudentByEmail(Student, loginId);
        if (student) {
            if (role && role !== 'student') {
                return res.json({ success: false, message: `Access denied. No ${role} account found.` });
            }
            if (await checkLockout(res, student, Student)) return;

            // bcrypt only. The `student.password === password` cleartext
            // comparison that used to run first would authenticate any row whose
            // password column still held an unhashed value.
            let pwdMatch = false;
            try {
                pwdMatch = await bcrypt.compare(password, student.password || "");
            } catch(e) {}
            if (pwdMatch) {
                await clearFailedAttempts(student, Student);
                const crypto = require("crypto");
                const sessionToken = "ten_sess_" + crypto.randomBytes(24).toString("hex");

                // Write by _id, never by re-deriving the filter.
                //
                // This used to update `{ email: loginId.toLowerCase() }`, which
                // matches NOTHING when the stored email is mixed-case — so the
                // session carried a token the database did not have, and
                // verifySingleSession answered every /api call with 401
                // SESSION_SUPERSEDED. The student signed in successfully and
                // was thrown straight back to the login page.
                await Student.updateOne({ _id: student._id },
                    { $set: { lastActiveDate: new Date(), activeSessionToken: sessionToken } });

                // Fetch and auto-heal linked domains
                const emailLc = String(student.email || "").trim().toLowerCase();
                let linked = student.linkedDomains || [];
                if (emailLc) {
                    const emailRegex = new RegExp("^\\s*" + emailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "\\s*$", "i");
                    const allForEmail = await Student.find({ email: { $regex: emailRegex } });
                    if (allForEmail.length >= 2) {
                        linked = allForEmail.map(s => ({
                            domain:     s.domain,
                            studentId:  s._id,
                            employeeId: s.employeeId
                        }));
                        await Student.updateMany({ email: { $regex: emailRegex } }, { linkedDomains: linked });
                    }
                }
                const responseStudent = sanitizeStudent(student);
                responseStudent.linkedDomains = linked;
                responseStudent.domains = student.domains || [student.domain];
                responseStudent.activeSessionToken = sessionToken;

                // The session holds identity, not a copy of the record.
                establishStudentSession(req, responseStudent);
                req.session.sessionToken = sessionToken;

                return res.json({
                    success: true,
                    sessionToken: sessionToken,
                    role: 'student',
                    student: responseStudent
                });
            } else {
                return await recordFailedAttempt(res, student, Student, "Invalid Password.");
            }
        }

        // Check HR
        const hr = await HR.findOne({ email: loginId.toLowerCase() });
        if (hr) {
            if (role && role !== 'hr' && role !== 'admin') {
                return res.json({ success: false, message: `Access denied.` });
            }
            if (await checkLockout(res, hr, HR)) return;

            let pwdMatch = hr.password === password;
            if (!pwdMatch) {
                try {
                    pwdMatch = await bcrypt.compare(password, hr.password);
                } catch(e) {}
            }
            if (pwdMatch) {
                await clearFailedAttempts(hr, HR);
                return res.json({
                    success: true,
                    role: 'hr',
                    hr
                });
            } else {
                return await recordFailedAttempt(res, hr, HR, "Invalid Password.");
            }
        }

        return res.json({ success: false, message: "Invalid credentials." });
    } else {
        // Treat as Employee ID - always student login
        if (role && role !== 'student') {
            return res.json({ success: false, message: `Access denied. Employee ID is only valid for Student role.` });
        }
        // Tolerant of how the ID was typed: case, padding and which separator.
        //
        // An exact case-sensitive match told students with perfectly good
        // accounts that their Employee ID did not exist. IDs look like
        // TEN/WEB/1005, are typed by hand on a phone whose keyboard lowercases
        // or autocapitalises, and appear elsewhere as TEN-WEB-1005 — so
        // "ten/web/1005" and "TEN-WEB-1005" both found nothing.
        const student = await loginIdentity.findStudentByEmployeeId(Student, loginId);
        if (!student) {
            return res.json({ success: false, message: "Invalid Employee ID" });
        }

        if (await checkLockout(res, student, Student)) return;

        // bcrypt only — see the note on the email branch above.
        let pwdMatch = false;
        try {
            pwdMatch = await bcrypt.compare(password, student.password || "");
        } catch(e) {}
        if (!pwdMatch) {
            return await recordFailedAttempt(res, student, Student, "Invalid Password");
        }
        const crypto = require("crypto");
        const sessionToken = "ten_sess_" + crypto.randomBytes(24).toString("hex");

        await clearFailedAttempts(student, Student);
        // By _id, so the write cannot miss the record we just authenticated —
        // `loginId` is whatever the student typed, which may differ in case or
        // separator from the stored value.
        await Student.updateOne({ _id: student._id },
            { $set: { lastActiveDate: new Date(), activeSessionToken: sessionToken } });

        // Fetch and auto-heal linked domains
        const emailLc = String(student.email || "").trim().toLowerCase();
        let linked = student.linkedDomains || [];
        if (emailLc) {
            const emailRegex = new RegExp("^\\s*" + emailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "\\s*$", "i");
            const allForEmail = await Student.find({ email: { $regex: emailRegex } });
            if (allForEmail.length >= 2) {
                linked = allForEmail.map(s => ({
                    domain:     s.domain,
                    studentId:  s._id,
                    employeeId: s.employeeId
                }));
                await Student.updateMany({ email: { $regex: emailRegex } }, { linkedDomains: linked });
            }
        }
        const responseStudent = sanitizeStudent(student);
        responseStudent.linkedDomains = linked;
        responseStudent.domains = student.domains || [student.domain];
        responseStudent.activeSessionToken = sessionToken;

        establishStudentSession(req, responseStudent);
        req.session.sessionToken = sessionToken;

        return res.json({ success: true, sessionToken: sessionToken, role: 'student', student: responseStudent });
    }
}catch(error){
    console.error("Login route error:", error);

    // Name a database outage as a database outage.
    //
    // A brief connection blip made every sign-in answer "Server Error", which
    // a student reads as "my account is broken" — and reports as "I suddenly
    // cannot log in". It is neither their account nor their password, and
    // saying so stops a wave of support messages during a thirty-second
    // reconnect. No internals are leaked: the message names the condition, not
    // the host or the driver.
    const msg = String(error && error.message || "");
    const dbDown = error && (error.name === "MongooseError" || error.name === "MongoNetworkError" ||
        error.name === "MongoServerSelectionError") ||
        /buffering timed out|before initial connection|connection .* was disconnected|ECONNREFUSED/i.test(msg);

    if (dbDown) {
        return res.status(503).json({
            success: false,
            code: "DB_UNAVAILABLE",
            message: "We cannot reach the database at the moment. This is not a problem with your account — please try again in a minute."
        });
    }

    res.status(500).json({ success:false, message:"Server Error" });
}
});

// ================= SINGLE SESSION GUARD MIDDLEWARE =================

/**
 * Should a request be rejected as a superseded session?
 *
 * Pulled out as a pure function because getting it wrong locks students out of
 * the portal entirely, and this is the shape the test asserts against.
 *
 * @param {string} clientToken  the token this request is carrying
 * @param {Array<string|null>} knownTokens  activeSessionToken from every record
 *        that identifies this user (EcosystemUser and Student)
 * @returns {boolean} true when the session has genuinely been replaced
 */
function sessionIsSuperseded(clientToken, knownTokens) {
    const known = (knownTokens || []).filter(Boolean);
    // No record carries a token: nothing has replaced this session. Rejecting
    // here is what made a stale Student row lock a signed-in student out.
    if (!known.length) return false;
    if (!clientToken) return false;
    // A match on ANY record is enough. A student signing in by email has both
    // an EcosystemUser and a Student row, and login writes the token to both.
    return !known.includes(clientToken);
}

async function verifySingleSession(req, res, next) {
    try {
        const clientToken = req.headers['x-session-token'] || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : '') || req.session?.sessionToken;
        const userId = req.headers['x-user-id'] || req.session?.student?._id || req.session?.user?._id;

        if (!clientToken || !userId) {
            return next();
        }

        const EcosystemUser = require('./models/EcosystemUser');
        const Student = require('./models/Student');

        // Both records are consulted, and a match on EITHER one is enough.
        //
        // This used to check EcosystemUser first and fall back to Student only
        // when no EcosystemUser existed with that id. A student signing in by
        // email has both records, and the session identifies them by their
        // STUDENT id — so the EcosystemUser lookup missed, the Student lookup
        // ran, and it compared the token minted for the EcosystemUser against
        // whatever the Student row happened to hold. Every /api call answered
        // 401, and the portal reads a 401 as a sign-out, so the student was
        // returned to the login page on every attempt and could never get in.
        //
        // Login now writes the token to both records, and this accepts either,
        // so the guard can only fire on a genuinely superseded session.
        const [dbUser, dbStudent] = await Promise.all([
            EcosystemUser.findById(userId).select('activeSessionToken').lean().catch(() => null),
            Student.findById(userId).select('activeSessionToken').lean().catch(() => null)
        ]);

        const knownTokens = [dbUser && dbUser.activeSessionToken, dbStudent && dbStudent.activeSessionToken];

        if (sessionIsSuperseded(clientToken, knownTokens)) {
            return res.status(401).json({
                success: false,
                code: "SESSION_SUPERSEDED",
                message: "Your account was logged in from another device or browser. Concurrent logins are restricted for security."
            });
        }

        next();
    } catch (err) {
        next();
    }
}

app.use('/api', verifySingleSession);

// ================= TEN ECOSYSTEM ADMIN CONTROLLER APIs =================

app.get("/api/ecosystem/stats", async(req, res) => {
  try {
    const EcosystemUser = require("./models/EcosystemUser");
    const StudentProfile = require("./models/StudentProfile");
    const StartupProfile = require("./models/StartupProfile");
    const TalentProfile = require("./models/TalentProfile");
    const CommunityProfile = require("./models/CommunityProfile");

    const totalUsers = await EcosystemUser.countDocuments();
    const studentsCount = await EcosystemUser.countDocuments({ role: 'student' });
    const foundersCount = await EcosystemUser.countDocuments({ role: 'founder' });
    const mentorsCount = await EcosystemUser.countDocuments({ role: 'mentor' });
    const investorsCount = await EcosystemUser.countDocuments({ role: 'investor' });
    const contractorsCount = await EcosystemUser.countDocuments({ role: 'contractor' });

    const totalStartups = await StartupProfile.countDocuments();
    const totalTalentProfiles = await TalentProfile.countDocuments();
    const totalCommunityMembers = await CommunityProfile.countDocuments();
    
    // Default or mock counts of programs/submissions
    const Submission = require("./models/Submission");
    const totalApplications = await Submission.countDocuments();
    const totalPrograms = 10; // TEN Ecosystem: 10 central modules

    res.json({
      success: true,
      stats: {
        totalUsers,
        breakdown: {
          student: studentsCount,
          founder: foundersCount,
          mentor: mentorsCount,
          investor: investorsCount,
          contractor: contractorsCount
        },
        totalStartups,
        totalTalentProfiles,
        totalCommunityMembers,
        totalApplications,
        totalPrograms
      }
    });
  } catch(err) {
    console.error("Stats API error:", err);
    res.status(500).json({ success: false, error: "Failed to load ecosystem stats." });
  }
});

app.get("/api/ecosystem/users", async(req, res) => {
  try {
    const EcosystemUser     = require("./models/EcosystemUser");
    const StudentProfile     = require("./models/StudentProfile");
    const FounderProfile     = require("./models/FounderProfile");
    const MentorProfile      = require("./models/MentorProfile");
    const InvestorProfile     = require("./models/InvestorProfile");
    const ContractorProfile   = require("./models/ContractorProfile");
    const StartupProfile      = require("./models/StartupProfile");

    const users = await EcosystemUser.find().lean();
    
    // Hydrate role profiles for all newcomers
    const hydratedUsers = await Promise.all(users.map(async (u) => {
      u.profile = null;
      if (u.role === 'student') {
        u.profile = await StudentProfile.findOne({ userId: u._id }).lean();
      } else if (u.role === 'founder') {
        u.profile = await FounderProfile.findOne({ userId: u._id }).lean();
        u.startup = await StartupProfile.findOne({ founderId: u._id }).lean();
      } else if (u.role === 'mentor') {
        u.profile = await MentorProfile.findOne({ userId: u._id }).lean();
      } else if (u.role === 'investor') {
        u.profile = await InvestorProfile.findOne({ userId: u._id }).lean();
      } else if (u.role === 'contractor') {
        u.profile = await ContractorProfile.findOne({ userId: u._id }).lean();
      }
      return u;
    }));

    res.json({ success: true, users: hydratedUsers });
  } catch(err) {
    console.error("Users API error:", err);
    res.status(500).json({ success: false, error: "Failed to retrieve ecosystem directory." });
  }
});

app.post("/api/ecosystem/users/:id/approve", async(req, res) => {
  try {
    const EcosystemUser     = require("./models/EcosystemUser");
    const StudentProfile     = require("./models/StudentProfile");
    const FounderProfile     = require("./models/FounderProfile");
    const MentorProfile      = require("./models/MentorProfile");
    const InvestorProfile     = require("./models/InvestorProfile");
    const ContractorProfile   = require("./models/ContractorProfile");

    const uId = req.params.id;
    const user = await EcosystemUser.findByIdAndUpdate(uId, { isVerified: true }, { new: true });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    // Update corresponding profile status
    if (user.role === 'student') await StudentProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'approved' });
    if (user.role === 'founder') await FounderProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'approved' });
    if (user.role === 'mentor')  await MentorProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'approved' });
    if (user.role === 'investor') await InvestorProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'approved' });
    if (user.role === 'contractor') await ContractorProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'approved' });

    res.json({ success: true, message: "User verified and onboarding approved." });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to approve user." });
  }
});

app.post("/api/ecosystem/users/:id/reject", async(req, res) => {
  try {
    const EcosystemUser     = require("./models/EcosystemUser");
    const StudentProfile     = require("./models/StudentProfile");
    const FounderProfile     = require("./models/FounderProfile");
    const MentorProfile      = require("./models/MentorProfile");
    const InvestorProfile     = require("./models/InvestorProfile");
    const ContractorProfile   = require("./models/ContractorProfile");

    const uId = req.params.id;
    const user = await EcosystemUser.findByIdAndUpdate(uId, { isVerified: false }, { new: true });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    if (user.role === 'student') await StudentProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'rejected' });
    if (user.role === 'founder') await FounderProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'rejected' });
    if (user.role === 'mentor')  await MentorProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'rejected' });
    if (user.role === 'investor') await InvestorProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'rejected' });
    if (user.role === 'contractor') await ContractorProfile.findOneAndUpdate({ userId: uId }, { verificationStatus: 'rejected' });

    res.json({ success: true, message: "Onboarding rejected." });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to reject user." });
  }
});

app.post("/api/ecosystem/users/:id/suspend", async(req, res) => {
  try {
    const EcosystemUser = require("./models/EcosystemUser");
    const user = await EcosystemUser.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    user.isActive = !user.isActive;
    await user.save();

    res.json({ success: true, isActive: user.isActive, message: `User status changed to ${user.isActive ? 'Active' : 'Suspended'}` });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to suspend user." });
  }
});

app.put("/api/ecosystem/users/:id", async(req, res) => {
  try {
    const EcosystemUser     = require("./models/EcosystemUser");
    const StudentProfile     = require("./models/StudentProfile");
    const FounderProfile     = require("./models/FounderProfile");
    const StartupProfile      = require("./models/StartupProfile");
    const MentorProfile      = require("./models/MentorProfile");
    const InvestorProfile     = require("./models/InvestorProfile");
    const ContractorProfile   = require("./models/ContractorProfile");

    const uId = req.params.id;
    const { fullName, email, phone, roleSpecificData = {} } = req.body;

    const user = await EcosystemUser.findByIdAndUpdate(uId, { fullName, email, phone }, { new: true });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    if (user.role === 'student') {
      await StudentProfile.findOneAndUpdate({ userId: uId }, {
        fullName, email, mobile: phone,
        country: roleSpecificData.country,
        state: roleSpecificData.state,
        city: roleSpecificData.city,
        university: roleSpecificData.university,
        degree: roleSpecificData.degree,
        graduationYear: roleSpecificData.graduationYear,
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s=>s.trim()) : [],
        resume: roleSpecificData.resume,
        linkedin: roleSpecificData.linkedin,
        portfolio: roleSpecificData.portfolio
      });
    } else if (user.role === 'founder') {
      await FounderProfile.findOneAndUpdate({ userId: uId }, {
        startupName: roleSpecificData.startupName,
        industry: roleSpecificData.industry,
        website: roleSpecificData.website,
        description: roleSpecificData.description
      });
      await StartupProfile.findOneAndUpdate({ founderId: uId }, {
        startupName: roleSpecificData.startupName,
        industry: roleSpecificData.industry,
        stage: roleSpecificData.stage,
        teamSize: roleSpecificData.teamSize,
        website: roleSpecificData.website,
        linkedin: roleSpecificData.linkedin,
        revenue: roleSpecificData.revenue,
        fundingStage: roleSpecificData.fundingStage,
        description: roleSpecificData.description
      });
    } else if (user.role === 'mentor') {
      await MentorProfile.findOneAndUpdate({ userId: uId }, {
        linkedinUrl: roleSpecificData.linkedinUrl
      });
    } else if (user.role === 'investor') {
      await InvestorProfile.findOneAndUpdate({ userId: uId }, {
        fundName: roleSpecificData.fundName,
        website: roleSpecificData.website
      });
    } else if (user.role === 'contractor') {
      await ContractorProfile.findOneAndUpdate({ userId: uId }, {
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s=>s.trim()) : [],
        hourlyRate: roleSpecificData.hourlyRate,
        availability: roleSpecificData.availability
      });
    }

    res.json({ success: true, message: "User profile updated successfully." });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to update profile." });
  }
});

app.delete("/api/ecosystem/users/:id", async(req, res) => {
  try {
    const EcosystemUser     = require("./models/EcosystemUser");
    const StudentProfile     = require("./models/StudentProfile");
    const FounderProfile     = require("./models/FounderProfile");
    const StartupProfile      = require("./models/StartupProfile");
    const MentorProfile      = require("./models/MentorProfile");
    const InvestorProfile     = require("./models/InvestorProfile");
    const ContractorProfile   = require("./models/ContractorProfile");
    const CommunityProfile    = require("./models/CommunityProfile");
    const TalentProfile      = require("./models/TalentProfile");

    const uId = req.params.id;
    const user = await EcosystemUser.findByIdAndDelete(uId);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    // delete linked items
    await StudentProfile.deleteMany({ userId: uId });
    await FounderProfile.deleteMany({ userId: uId });
    await StartupProfile.deleteMany({ founderId: uId });
    await MentorProfile.deleteMany({ userId: uId });
    await InvestorProfile.deleteMany({ userId: uId });
    await ContractorProfile.deleteMany({ userId: uId });
    await CommunityProfile.deleteMany({ userId: uId });
    await TalentProfile.deleteMany({ userId: uId });

    res.json({ success: true, message: "User and associated ecosystem records discarded." });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to erase user." });
  }
});

// ================= SUBMIT TASK =================

app.post("/submit-task", (req, res, next) => {
  upload.fields([
      { name:"image", maxCount:1 },
      { name:"pdf", maxCount:1 }
  ])(req, res, (err) => {
      if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
              return res.status(413).json({ success: false, message: "File is too large! Maximum limit is 25MB. Please compress your screenshot or PDF file and try again." });
          }
          return res.status(400).json({ success: false, message: err.message || "File upload error" });
      }
      next();
  });
}, async(req,res)=>{
try{
    const { employeeId, domain, githubLink, note, task, assignmentId } = req.body;
    const image = req.files["image"] ? "/" + req.files["image"][0].path : "";
    const pdf   = req.files["pdf"]   ? "/" + req.files["pdf"][0].path   : "";

    // 1. Double Submission Protection: Check if a Submission for this specific task and employee has already gone through
    const existingSubmission = await Submission.findOne({ employeeId, task: task || "" });
    if (existingSubmission) {
      console.log(`[Double Submission Block] Ignored duplicate Submission write for employeeId: ${employeeId}, task: ${task}`);
      return res.json({ success: true, message: "Task has already been submitted successfully!" });
    }

    // 2. Double Submission Protection: Check if the TaskAssignment is already non-Pending
    let targetAssignment = null;
    if (assignmentId) {
      targetAssignment = await TaskAssignment.findById(assignmentId);
    } else {
      targetAssignment = await TaskAssignment.findOne({ employeeId, title: task });
    }

    if (targetAssignment && targetAssignment.status !== "Pending") {
      console.log(`[Double Submission Block] Ignored duplicate status write. TaskAssignment is currently in '${targetAssignment.status}' state.`);
      return res.json({ success: true, message: "Task has already been submitted successfully!" });
    }

    const student = await Student.findOne({ employeeId });
    let internshipDuration = "1 Month";
    if(student && student.tenure){
        const t = student.tenure.toLowerCase();
        if(t.includes("6")){ internshipDuration = "6 Months"; }
        else if(t.includes("3")){ internshipDuration = "3 Months"; }
        else if(t.includes("45")){ internshipDuration = "45 Days"; }
        else { internshipDuration = "1 Month"; }
    }

    const isCaseStudy = req.body.isCaseStudy === 'true' || req.body.isCaseStudy === true;

    const submission = new Submission({
        employeeId, domain,
        task: task || "",
        githubLink, note,
        image, pdf,
        status: "Pending",
        reviewedOnce: false,
        isCaseStudy: isCaseStudy,
        attendanceAllowed: false,
        attendanceGiven: false,
        attendanceCount: 0,
        internshipDuration,
        monthlyAttendance: { month1:0, month2:0, month3:0, month4:0, month5:0, month6:0 },
        tasksCompleted: 0,
        meetingsJoined: 0,
        performance: "B"
    });

    await submission.save();

    // Link and update the automated task assignment if it exists
    if (assignmentId) {
      await TaskAssignment.findByIdAndUpdate(
        assignmentId,
        {
          status: "Submitted",
          submittedAt: new Date(),
          githubLink,
          note,
          image,
          pdf
        }
      );
    } else {
      await TaskAssignment.findOneAndUpdate(
        { employeeId, title: task, status: "Pending" },
        {
          status: "Submitted",
          submittedAt: new Date(),
          githubLink,
          note,
          image,
          pdf
        }
      );
    }

    await Student.findOneAndUpdate({ employeeId }, { lastActiveDate: new Date() });
    // Milestones + badges (first-task)
    await setMilestone(employeeId, "firstTaskSubmitted");
    await recomputeBadgesFor(employeeId);
    res.json({ success:true, message:"Task Submitted Successfully" });

    // ── AI AUTO-FEEDBACK (non-blocking — runs after response) ──────────────────
    (async () => {
      try {
        if (isCaseStudy) {
          console.log(`[AI Feedback] Skipping auto-feedback for Case Study: "${task || ""}"`);
          return;
        }
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) return;

        const { GoogleGenAI } = require("@google/genai");
        const ai = new GoogleGenAI({
          apiKey: GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const taskTitle = req.body.task || 'Internship Task';
        const taskNote = req.body.note || '';
        const githubLink = req.body.githubLink || '';
        const studentDomain = req.body.domain || '';

        const prompt = `You are a senior ${studentDomain} professional reviewing an intern's task submission.

Task: "${taskTitle}"
Student's description: "${taskNote}"
${githubLink ? `GitHub/Link: ${githubLink}` : ''}

Write a SHORT, professional, human-sounding code/work review feedback (3-4 sentences). 
Be specific to the task. Give ONE strength and ONE specific improvement suggestion.
Sound like a real mentor — not a bot. Vary your opening (don't always start with "Great work").
Keep it under 80 words. Do not use bullet points.`;

        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: prompt,
          config: { maxOutputTokens: 150, temperature: 0.8 }
        });

        const feedback = response.text?.trim();

        if (feedback && submission._id) {
          // Update the submission with AI feedback
          await Submission.findByIdAndUpdate(submission._id, {
            $set: {
              feedback: feedback,
              status: 'Approved', // AI auto-approves after generating feedback
              aiFeedback: true,
              feedbackGeneratedAt: new Date()
            }
          });
        }
      } catch(aiErr) {
        console.error('[AI Feedback] Error:', aiErr.message);
        // Never fail the main submission due to AI error
      }
    })();
    // ── END AI FEEDBACK ────────────────────────────────────────────────────────
}catch(error){
    console.log(error);
    res.json({ success:false, message:"Submission Failed" });
}
});

// ================= STUDENT SUBMISSIONS =================

app.get("/student-submissions/:employeeId", async(req,res)=>{
try{
    const employeeId = decodeURIComponent(req.params.employeeId);
    const submissions = await Submission.find({ employeeId }).sort({ submittedAt:-1 });
    res.json({ success:true, submissions });
}catch(error){
    console.log(error);
    res.json({ success:false, submissions:[] });
}
});

// ================= COORDINATOR DOMAIN SUBMISSIONS =================

app.get("/all-submissions/:domain", async(req,res)=>{
try{
    const domain = decodeURIComponent(req.params.domain);
    const submissions = await Submission.find({ domain }).sort({ submittedAt:-1 }).lean();
    
    // Look up students for these submissions to get correct attendancePercentage
    const empIds = submissions.map(s => s.employeeId).filter(Boolean);
    const students = await Student.find({ employeeId: { $in: empIds } }).lean();
    const studentsMap = {};
    students.forEach(st => {
      studentsMap[st.employeeId] = st;
    });

    const enrichedSubmissions = submissions.map(sub => {
      const student = studentsMap[sub.employeeId];
      return {
        ...sub,
        attendancePercentage: student ? (student.attendancePercentage !== undefined ? student.attendancePercentage : 0) : 0,
        studentJoiningDate: student ? student.joiningDate : null,
        studentTenure: student ? student.tenure : null
      };
    });

    res.json(enrichedSubmissions);
}catch(error){
    console.log(error);
    res.json([]);
}
});

// ================= UPDATE STATUS =================

app.post("/update-status", async(req,res)=>{
try{
    const { id, status, feedback, rating } = req.body;

    const existing = await Submission.findById(id);
    if(!existing){
        return res.json({ success:false, message:"Submission not found" });
    }
    if(existing.reviewedOnce){
        return res.json({ success:false, message:"Already reviewed. Cannot change decision.", alreadyReviewed:true });
    }

    let performance = "B";
    if(status === "Approved"){ performance = "A+"; }

    const ratingValue = rating ? Number(rating) : 0;

    await Submission.findByIdAndUpdate(id, {
        status,
        feedback,
        reviewedOnce: true,
        attendanceAllowed: status === "Approved",
        performance,
        tasksCompleted: status === "Approved" ? 1 : 0,
        coordinatorRating: ratingValue
    }, { new:true });

    // Synchronize to the automated TaskAssignment if applicable
    await TaskAssignment.findOneAndUpdate(
      { employeeId: existing.employeeId, title: existing.task, status: "Submitted" },
      { status, feedback, coordinatorRating: ratingValue }
    );

    // Fire notification to the student
    const submission = await Submission.findById(id);
    if(submission){
        const notif = new Notification({
            title: `Task ${status}`,
            message: `Your task submission has been ${status.toLowerCase()}. Feedback: ${feedback || "No feedback provided"}`,
            type: status === "Approved" ? "success" : "warning",
            from: "Coordinator",
            targetType: "student",
            targetEmployeeId: submission.employeeId,
            targetDomain: submission.domain
        });
        await notif.save();
        // SSE broadcast to student
        broadcastNotification(submission.domain, submission.employeeId, notif);
    }

    // Milestones + badges (first-task-approved + eligibility) — non-blocking
    if(status === "Approved" && submission){
        await setMilestone(submission.employeeId, "firstTaskApproved");
    }
    if(submission){
        try {
            const Student = mongoose.model('Student');
            const student = await Student.findOne({ employeeId: submission.employeeId });
            if (student) {
                const DomainTask = require('./models/new/DomainTask');
                const StudentTaskProgress = require('./models/new/StudentTaskProgress');
                
                const taskDoc = await DomainTask.findOne({ 
                    domain: student.domain, 
                    taskTitle: submission.task 
                });
                
                if (taskDoc) {
                    const progress = await StudentTaskProgress.findOne({
                        studentId: student._id,
                        taskId: taskDoc._id
                    });
                    
                    if (progress) {
                        if (status === "Approved") {
                            if (progress.status !== 'approved') {
                                const taskEngine = require('./services/v2/taskEngine');
                                await taskEngine.approveTask(student, progress._id, null, feedback);
                            }
                        } else if (status === "Rejected") {
                            progress.status = "rejected";
                            progress.coordinatorFeedback = feedback || "";
                            await progress.save();
                        }
                    }
                }
            }
        } catch (v2Err) {
            console.log("V2 Sync Task status error:", v2Err.message);
        }

        await checkCertificateEligibility(submission.employeeId);
        await recomputeBadgesFor(submission.employeeId);
    }

    res.json({ success:true, message:"Status Updated Successfully" });
}catch(error){
    console.log(error);
    res.json({ success:false });
}
});

// ================= ATTENDANCE =================

app.post("/give-attendance", async(req,res)=>{
try{
    const { employeeId } = req.body;
    const submission = await Submission.findOne({ employeeId }).sort({ submittedAt:-1 });

    if(!submission){ return res.json({ success:false, message:"Submit task first" }); }
    if(submission.status === "Pending"){ return res.json({ success:false, message:"Coordinator has not responded yet" }); }
    if(submission.status === "Rejected"){ return res.json({ success:false, message:"Your task was rejected. Please resubmit." }); }
    if(submission.attendanceGiven){ return res.json({ success:false, message:"Attendance already submitted for today" }); }

    submission.attendanceGiven = true;
    submission.attendanceCount += 1;
    submission.meetingsJoined += 1;

    const dur = submission.internshipDuration;
    const ma = submission.monthlyAttendance;

    if(dur === "1 Month"){
        ma.month1 = Math.min(ma.month1 + 1, 20);
    }
    else if(dur === "3 Months"){
        if(ma.month1 < 20){ ma.month1 += 1; }
        else if(ma.month2 < 20){ ma.month2 += 1; }
        else if(ma.month3 < 20){ ma.month3 += 1; }
    }
    else if(dur === "6 Months"){
        if(ma.month1 < 20){ ma.month1 += 1; }
        else if(ma.month2 < 20){ ma.month2 += 1; }
        else if(ma.month3 < 20){ ma.month3 += 1; }
        else if(ma.month4 < 20){ ma.month4 += 1; }
        else if(ma.month5 < 20){ ma.month5 += 1; }
        else if(ma.month6 < 20){ ma.month6 += 1; }
    }

    submission.monthlyAttendance = ma;
    await submission.save();
    await Student.findOneAndUpdate({ employeeId }, { lastActiveDate: new Date() });

    let totalDays = 20;
    let requiredDays = 15;
    if(dur === "3 Months"){ totalDays=60; requiredDays=45; }
    if(dur === "6 Months"){ totalDays=120; requiredDays=90; }

    const count = submission.attendanceCount;
    let thresholdMsg = "";
    if(count < requiredDays){
        thresholdMsg = `${requiredDays - count} more days needed to reach 75% attendance.`;
    } else {
        thresholdMsg = "✅ You have met the 75% attendance requirement!";
    }

    res.json({ success:true, message:"Attendance Submitted", thresholdMsg, attendanceCount: count });
}catch(error){
    console.log(error);
    res.json({ success:false, message:"Attendance Failed" });
}
});

// ================= SSE SYSTEM (Notifications + Notice) =================

// Map: key -> array of { res, employeeId, role }
// key for students: "student:employeeId"
// key for coordinators: "coord:domain"
// key for HR: "hr:all"
// The registry lives in utils/sseHub.js so routes outside this file can push
// too. routes/adminPortal.js previously wrote Notification rows for a broadcast
// and never pushed them, because it had no access to this Map — an admin
// announcement did not appear until the student happened to poll.
const {
    sseClients,
    addSSEClient,
    removeSSEClient,
    sendSSE,
    broadcastNotification
} = require("./utils/sseHub");

// ================= STUDENT SSE =================

app.get("/student-events/:employeeId", (req,res)=>{
    // Stream the SIGNED-IN student's events. The employeeId in the path used to
    // be taken at face value, so anyone could subscribe to any student's
    // notification stream by guessing an ID.
    const employeeId = sessionEmployeeId(req);
    if (!employeeId) return res.status(401).end();

    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.setHeader("Connection","keep-alive");
    res.flushHeaders();
    res.write("data: connected\n\n");

    const key = `student:${employeeId}`;
    // The domain MUST be recorded here. The domain-targeted fan-out filters on
    // `c.studentDomain`, and this call passed no meta at all — so it was always
    // undefined and a domain-wide notification never reached a single student
    // in real time.
    addSSEClient(key, res, { domain: (req.session.student && req.session.student.domain) || "" });

    // Proxies drop idle event streams; a periodic comment keeps them open.
    const heartbeat = setInterval(() => {
        try { res.write(": ping\n\n"); } catch (_) {}
    }, 25000);

    req.on("close",()=>{ clearInterval(heartbeat); removeSSEClient(key, res); });
});

// ================= COORDINATOR SSE =================

app.get("/coord-events/:domain", (req,res)=>{
    // Stream the signed-in coordinator's own domain — the path parameter used
    // to be taken at face value, so anyone could listen to any domain.
    if(!req.session || !req.session.coordinator){
        return res.status(401).end();
    }
    const domain = req.session.coordinator.domain || decodeURIComponent(req.params.domain);
    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.setHeader("Connection","keep-alive");
    res.flushHeaders();
    res.write("data: connected\n\n");

    const key = `coord:${domain}`;
    addSSEClient(key, res, { domain });

    req.on("close",()=>{ removeSSEClient(key, res); });
});

// ================= NOTICE SSE (legacy kept for compat) =================

app.get("/notice-events/:domain", (req,res)=>{
    const domain = decodeURIComponent(req.params.domain);
    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.setHeader("Connection","keep-alive");
    res.flushHeaders();
    res.write("data: connected\n\n");

    const key = `coord:${domain}`;
    addSSEClient(key, res, { domain });
    req.on("close",()=>{ removeSSEClient(key, res); });
});

// ================= UPDATE NOTICE =================

app.post("/update-notice", async(req,res)=>{
try{
    const { domain, morningMeeting, eveningMeeting, meetingLink, importantNotice } = req.body;
    const fs = require("fs");
    const path = require("path");
    const noticePath = path.join(process.cwd(), "notice.json");

    let notices = {};
    if (fs.existsSync(noticePath)) {
        try {
            notices = JSON.parse(fs.readFileSync(noticePath, "utf8"));
        } catch(e) {}
    }

    notices[domain] = {
        domain,
        morningMeeting,
        eveningMeeting,
        meetingLink,
        importantNotice
    };

    fs.writeFileSync(noticePath, JSON.stringify(notices, null, 2), "utf8");

    // Broadcast SSE notice update to domain students
    const key = `coord:${domain}`;
    const clients = sseClients.get(key) || [];
    const payload = JSON.stringify({ event:"notice-updated", domain });
    clients.forEach(c => {
        try{ c.res.write(`data: ${payload}\n\n`); } catch(e){}
    });

    // Also notify students in this domain
    for(const [k, arr] of sseClients.entries()){
        if(k.startsWith("student:")){
            arr.forEach(c => {
                if(c.domain === domain){
                    try{ c.res.write(`data: ${JSON.stringify({ event:"notice-updated", domain })}\n\n`); } catch(e){}
                }
            });
        }
    }

    res.json({ success:true });
}catch(error){
    console.log(error);
    res.status(500).json({ success:false });
}
});

// ================= GET DOMAIN NOTICE =================

app.get("/get-notice/:domain", async(req,res)=>{
try{
    const fs = require("fs");
    const path = require("path");
    const noticePath = path.join(process.cwd(), "notice.json");
    const domain = req.params.domain || "";

    let notices = {};
    if (fs.existsSync(noticePath)) {
        try {
            notices = JSON.parse(fs.readFileSync(noticePath, "utf8"));
        } catch(e) {}
    }

    const notice = notices[domain] || notices["default"];
    res.json(notice || {});
}catch(error){ res.json({ success:false }); }
});

// ================= NOTIFICATIONS - GET FOR STUDENT =================

app.get("/notifications/student/:employeeId", async(req,res)=>{
try{
    const { employeeId } = req.params;
    const student = await Student.findOne({ employeeId });
    const domain = student ? student.domain : "";
    
    const notifs = await Notification.find({
        $or: [
            { targetType: "all" },
            { targetType: "domain", targetDomain: domain },
            { targetType: "student", targetEmployeeId: employeeId }
        ]
    }).sort({ createdAt:-1 }).limit(50);
    
    // Mark unread count
    const unread = notifs.filter(n => !n.readBy.includes(employeeId)).length;
    
    res.json({ success:true, notifications:notifs, unread });
}catch(error){
    console.log(error);
    res.json({ success:false, notifications:[], unread:0 });
}
});

// ================= NOTIFICATIONS - GET FOR COORDINATOR =================

app.get("/notifications/coordinator/:domain", async(req,res)=>{
try{
    const domain = decodeURIComponent(req.params.domain);
    
    const notifs = await Notification.find({
        $or: [
            { targetType: "coordinator" },
            { targetType: "coordinator-domain", targetDomain: domain },
            // HR to all
            { targetType: "all", from: "HR" }
        ]
    }).sort({ createdAt:-1 }).limit(50);
    
    const unread = notifs.filter(n => !n.readBy.includes(`coord:${domain}`)).length;
    
    res.json({ success:true, notifications:notifs, unread });
}catch(error){
    console.log(error);
    res.json({ success:false, notifications:[], unread:0 });
}
});

// ================= NOTIFICATIONS - MARK READ =================

// The student dashboard has always POSTed here, but the route did not exist:
// it 404d inside an empty catch, so the badge cleared visually and the count
// came back on reload because `readBy` was never written.
app.post("/notifications/mark-all-read", async(req,res)=>{
try{
    const readerId = sessionEmployeeId(req)
        || (req.session && req.session.coordinator && `coord:${req.session.coordinator.domain}`)
        || "";
    if(!readerId) return res.status(401).json({ success:false, message:"Please sign in." });

    const domain = (req.session.student && req.session.student.domain) || "";
    const result = await Notification.updateMany(
        {
            $or: [
                { targetType: "all" },
                { targetType: "domain", targetDomain: domain },
                { targetType: "student", targetEmployeeId: readerId }
            ],
            readBy: { $ne: readerId }
        },
        { $addToSet: { readBy: readerId } }
    );
    res.json({ success:true, marked: (result && (result.modifiedCount ?? result.nModified)) || 0 });
}catch(e){
    console.error("[notifications] mark-all-read failed:", e.message);
    res.status(500).json({ success:false });
}
});

app.post("/notifications/mark-read", async(req,res)=>{
try{
    const { notifId, readerId } = req.body;
    await Notification.findByIdAndUpdate(notifId, {
        $addToSet: { readBy: readerId }
    });
    res.json({ success:true });
}catch(error){
    res.json({ success:false });
}
});

// ================= HR LOGIN =================
// Requirement 4: HR logs in by email + password.
// To not break existing hardcoded HR accounts, this route accepts EITHER an
// email (looked up in the HR DB collection, bcrypt-compared) OR a legacy
// username (looked up in HR_ACCOUNTS, plain compared).

app.post("/hr-login", loginIpLimiter, loginLimiter, async(req,res)=>{
try{
    const password = (req.body && req.body.password) || "";
    // Accept "email" (preferred) or legacy "username" field from older clients
    const identifier = ((req.body && (req.body.email || req.body.username)) || "").trim();
    if(!identifier || !password){
        return res.json({ success:false, message:"Email and password required" });
    }

    // 1) Email path: DB-backed HR (created via promotion flow)
    if(identifier.indexOf("@") !== -1){
        const dbHR = await HR.findOne({ email: identifier.toLowerCase() });
        if(dbHR){
            if (await checkLockout(res, dbHR, HR)) return;

            const ok = await bcrypt.compare(password, dbHR.password);
            if(!ok) {
                return await recordFailedAttempt(res, dbHR, HR, "Invalid HR credentials");
            }
            await clearFailedAttempts(dbHR, HR);
            const hrIdentity = {
                username: dbHR.username || dbHR.email,
                email:    dbHR.email,
                name:     dbHR.name,
                role:     "hr",
                level:    dbHR.level || 1
            };
            if (req.session) req.session.hr = hrIdentity;
            return res.json({ success:true, hr: hrIdentity });
        }
        // Also allow legacy hardcoded entries that have an email assigned
        const legacy = Object.entries(HR_ACCOUNTS).find(
            ([_, v]) => (v.email || "").toLowerCase() === identifier.toLowerCase()
        );
        if(legacy){
            const [u, v] = legacy;
            // NOTE: a hardcoded email/password pair for hrdirector@ten.com used to
            // be accepted here and again on the username path below. It was not
            // in the credential map and could not be overridden by
            // HR_CREDENTIALS, so it worked even in production. Removed.
            if(!await verifyCredentialPassword(v, password)) {
                return res.json({ success:false, message:"Invalid HR credentials" });
            }
            const hrIdentity = { username:u, email:v.email, name:v.name, role:"hr", level: v.level || 1 };
            if (req.session) req.session.hr = hrIdentity;
            return res.json({ success:true, hr: hrIdentity });
        }
        return res.json({ success:false, message:"Invalid HR credentials" });
    }

    // 2) Legacy username path
    const hr = HR_ACCOUNTS[identifier];
    if(!hr || !await verifyCredentialPassword(hr, password)){
        return res.json({ success:false, message:"Invalid HR credentials" });
    }
    const hrIdentity = { username: identifier, email: hr.email || "", name:hr.name, role:"hr", level: hr.level || 1 };
    if (req.session) req.session.hr = hrIdentity;
    res.json({ success:true, hr: hrIdentity });
}catch(error){
    console.log(error);
    res.json({ success:false, message:"Server Error" });
}
});

// ================= HR - SEND NOTIFICATION =================

app.post("/hr/send-notification", async(req,res)=>{
try{
    const { title, message, type, targetType, targetDomain, targetEmployeeId, targetUsername } = req.body;
    
    const notif = new Notification({
        title, message, type: type || "info",
        from: "HR",
        targetType: targetType || "all",
        targetDomain: targetDomain || "",
        targetEmployeeId: targetEmployeeId || "",
        targetUsername: targetUsername || ""
    });
    await notif.save();
    
    // SSE broadcast based on targetType
    if(targetType === "all"){
        // Broadcast to all students and coordinators
        for(const [key, arr] of sseClients.entries()){
            arr.forEach(c => sendSSE(c.res, { event:"notification", notification:notif }));
        }
    } else if(targetType === "domain"){
        // All students of a domain + coordinator of that domain
        for(const [key, arr] of sseClients.entries()){
            if(key === `coord:${targetDomain}`){
                arr.forEach(c => sendSSE(c.res, { event:"notification", notification:notif }));
            }
        }
        // Students of that domain. This filtered on `c.studentDomain`, a
        // property nothing ever set — the SSE registration passed no meta — so
        // this branch silently reached nobody and domain notifications only
        // appeared on the next poll.
        for(const [key, arr] of sseClients.entries()){
            if(key.startsWith("student:")){
                arr.forEach(c => {
                    if((c.domain || c.studentDomain) === targetDomain){
                        sendSSE(c.res, { event:"notification", notification:notif });
                    }
                });
            }
        }
    } else if(targetType === "student"){
        const key = `student:${targetEmployeeId}`;
        const arr = sseClients.get(key) || [];
        arr.forEach(c => sendSSE(c.res, { event:"notification", notification:notif }));
    } else if(targetType === "coordinator"){
        // All coordinators
        for(const [key, arr] of sseClients.entries()){
            if(key.startsWith("coord:")){
                arr.forEach(c => sendSSE(c.res, { event:"notification", notification:notif }));
            }
        }
    } else if(targetType === "coordinator-domain"){
        const key = `coord:${targetDomain}`;
        const arr = sseClients.get(key) || [];
        arr.forEach(c => sendSSE(c.res, { event:"notification", notification:notif }));
    }
    
    res.json({ success:true, message:"Notification sent successfully" });
}catch(error){
    console.log(error);
    res.json({ success:false, message:"Failed to send notification" });
}
});

// ================= HR - GET ALL STUDENTS =================

app.get("/hr/students", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const students = await Student.find().select('firstName lastName email whatsapp domain collegeName college employeeId tenure joiningDate createdAt joinerType employeeIdOverride').sort({ createdAt:-1 }).lean();
    res.json({ success:true, students });
}catch(error){ res.status(500).json({ message:"Error fetching students" }); }
});

// ================= HR - SEND DOCUMENTS NOW =================

app.post('/hr/send-documents-now', async(req, res) => {
    try {
        if(!isHRSession(req)){
            return res.status(401).json({ success:false, message:"Unauthorized" });
        }
        const { employeeId, docType } = req.body;
        if (!employeeId) return res.json({ success: false, message: 'employeeId required' });
        const student = await Student.findOne({ employeeId });
        if (!student)       return res.json({ success: false, message: 'Student not found' });
        if (!student.email) return res.json({ success: false, message: 'Student has no email' });
        student.documentsAutoSent = false;
        await student.save();
        await sendAutoDocumentsToStudent(student, docType || 'all', "HR Portal");
        res.json({ success: true, message: 'Documents sent to ' + student.email });
    } catch(err) {
        console.error('[MANUAL-DOCS]', err);
        res.json({ success: false, message: err.message });
    }
});

app.get("/api/hr/document-history", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limit = 50;
    const skip = (page - 1) * limit;
    const total = await DocumentHistory.countDocuments();
    const records = await DocumentHistory.find().sort({ sentAt: -1 }).skip(skip).limit(limit).lean();
    const mapped = (records || []).map(r => {
        const studentName = (r.studentName || r.student_name || "").trim();
        const employeeId = (r.employeeId || r.employee_id || "").trim();
        const college = (r.college || "").trim() || "Not provided";
        const documentNumber = normalizeDocumentNumber(r.documentNumber || r.document_number || "");
        return {
            ...r,
            studentName: studentName || "—",
            employeeId: employeeId || "—",
            college: college || "Not provided",
            documentNumber: documentNumber || "—",
            sentAt: r.sentAt || r.sent_on || r.createdAt,
            student_name: studentName || "—",
            employee_id: employeeId || "—",
            document_number: documentNumber || "—",
            document_type: r.documentKey || r.documentType || ""
        };
    });
    res.json({ records: mapped, total, page });
}catch(error){
    console.log(error);
    res.status(500).json({ records:[], total:0, page:1 });
}
});

async function verifyByDocumentNumber(documentNumber) {
    if (!documentNumber) {
        return { verified: false, message: "Please enter a document number" };
    }
    const cleaned = normalizeDocumentNumber(documentNumber);
    let record = await DocumentHistory.findOne({ documentNumber: cleaned }).lean();
    if (!record) {
        record = await DocumentHistory.findOne({ documentNumber: { $regex: "^" + cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", $options: "i" } }).lean();
    }
    if (!record) {
        return { verified: false, message: "Document not found. Check the number and try again." };
    }
    return {
        verified: true,
        document_number: record.documentNumber,
        student_name: record.studentName || "—",
        employee_id: record.employeeId || "—",
        document_type: record.documentType || record.documentKey || "—",
        domain: record.domain || "N/A",
        college: record.college || "N/A",
        issued_date: record.sentAt || record.createdAt,
        issued_by: "The Entrepreneurship Network (TEN)"
    };
}

app.post("/api/hr/verify-document", async (req, res) => {
    try {
        if(!isHRSession(req)){
            return res.status(401).json({ message:"Unauthorized" });
        }
        const { documentNumber } = req.body || {};
        const out = await verifyByDocumentNumber(documentNumber);
        res.json(out);
    } catch (err) {
        res.status(500).json({ verified: false, message: "Server error during verification" });
    }
});

app.get("/api/hr/verify-check", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const { employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
    const s = await Student.findOne({ employeeId }).select(
      'firstName lastName employeeId collegeName college documentVerified documentVerifiedAt documentNumber autoDocUniqueId domain'
    );
    if (!s) return res.json({ verified: false, message: 'Student not found' });
    res.json({
        verified: s.documentVerified || false,
        studentName: (s.firstName||'') + ' ' + (s.lastName||''),
        college:     s.collegeName || s.college || '—',
        documentType: 'Internship Documents',
        documentNumber: s.documentNumber || s.autoDocUniqueId || '—',
        verifiedAt:  s.documentVerifiedAt || null
    });
}catch(error){
    console.log(error);
    res.json({ verified: false, message: "Student not found" });
}
});

app.get("/api/hr/verify-by-docnumber", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const { documentNumber } = req.query;
    if (!documentNumber) return res.status(400).json({ verified: false, message: 'documentNumber required' });
    const out = await verifyByDocumentNumber(documentNumber);
    res.json(out);
}catch(error){
    console.log(error);
    res.status(500).json({ verified: false, message: "Server error during verification" });
}
});

app.get("/api/hr/automail-history", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limit = 50;
    const skip = (page - 1) * limit;
    const total = await AutoMailLog.countDocuments();
    const records = await AutoMailLog.find().sort({ sentAt: -1 }).skip(skip).limit(limit);
    res.json({ records, total, page });
}catch(error){
    console.log(error);
    res.status(500).json({ records:[], total:0, page:1 });
}
});

app.get("/api/hr/intern-stats", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const now = new Date();
    const cutoff30 = new Date(now);
    cutoff30.setDate(cutoff30.getDate() - 30);
    const totalInterns = await Student.countDocuments();
    const activeThisMonth = await Student.countDocuments({ lastActiveDate: { $gte: cutoff30 } });
    const inactiveInterns = await Student.countDocuments({ $or: [
        { lastActiveDate: { $exists: false } },
        { lastActiveDate: null },
        { lastActiveDate: { $lt: cutoff30 } }
    ]});
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const joins = await Student.find().select("joiningDate joinDate").lean();
    let newJoinsThisMonth = 0;
    for(const s of joins){
        const jd = s.joinDate || s.joiningDate;
        if(!jd) continue;
        const dt = new Date(jd);
        if(isNaN(dt.getTime())) continue;
        if(dt >= monthStart && dt < monthEnd) newJoinsThisMonth++;
    }
    res.json({ success:true, totalInterns, activeThisMonth, inactiveInterns, newJoinsThisMonth });
}catch(error){
    // Returning zeros on failure made a broken query indistinguishable from an
    // empty programme — HR saw "Total Interns: 0" over a live database of
    // hundreds. Fail loudly; the client renders the reason.
    console.error("[intern-stats]", error.message);
    res.status(500).json({ success:false, message: "Could not load intern stats: " + error.message });
}
});

app.get("/api/hr/intern-stats/monthly", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const now = new Date();
    const months = [];
    const keyMap = new Map();
    for(let i=5;i>=0;i--){
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        const key = y + "-" + String(m + 1).padStart(2, "0");
        const month = d.toLocaleString("en-US", { month: "short" });
        const obj = { key, month, count: 0 };
        months.push(obj);
        keyMap.set(key, obj);
    }
    const students = await Student.find().select("joiningDate joinDate").lean();
    for(const s of students){
        const jd = s.joinDate || s.joiningDate;
        if(!jd) continue;
        const dt = new Date(jd);
        if(isNaN(dt.getTime())) continue;
        const key = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
        const hit = keyMap.get(key);
        if(hit) hit.count++;
    }
    res.json(months.map(x => ({ month: x.month, count: x.count })));
}catch(error){
    console.log(error);
    res.status(500).json([]);
}
});

app.get('/api/hr/intern-list', async (req, res) => {
  try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const type = req.query.type;
    const now = new Date();
    const d30 = new Date(now - 30*24*60*60*1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let query = {};
    if (type === 'active')    query = { lastActiveDate: { $gte: d30 } };
    if (type === 'inactive')  query = { $or: [{ lastActiveDate: { $lt: d30 } }, { lastActiveDate: null }, { lastActiveDate: { $exists: false } }] };
    // `name` matters: most records carry a single `name` and no first/last, so
    // building the display name from firstName+lastName alone produced a row
    // of blanks — the list looked empty even when it was full.
    // No database sort here, deliberately.
    //
    // `joiningDate` is a String, so a Mongo sort orders it lexicographically —
    // "9 Aug" after "10 Aug" — which is wrong regardless of performance. And a
    // blocking sort over Student documents drags their embedded base64 PDFs
    // through memory (see the index comment in models/Student.js). Fetching a
    // lean projection and ordering it in JS is both correct and cheap: the
    // projected objects are a few hundred bytes each.
    const projection = 'name firstName lastName employeeId domain collegeName college lastActiveDate joiningDate joinDate';
    let students = await Student.find(query).select(projection).limit(1000).lean();
    const asTime = (s) => {
      const d = new Date(s.joinDate || s.joiningDate || 0);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };
    students.sort((a, b) => asTime(b) - asTime(a));
    if (type === 'newJoins'){
      students = students.filter(s => {
        const jd = s.joinDate || s.joiningDate;
        if(!jd) return false;
        const dt = new Date(jd);
        if(isNaN(dt.getTime())) return false;
        return dt >= monthStart;
      }).sort((a,b)=>{
        const ad = new Date(a.joinDate || a.joiningDate || 0).getTime();
        const bd = new Date(b.joinDate || b.joiningDate || 0).getTime();
        return bd - ad;
      }).slice(0,200);
    } else {
      students = students.slice(0,200);
    }
    res.json({ success:true, total: students.length, students: students.map(s => ({
      name: (s.name || `${s.firstName || ''} ${s.lastName || ''}`).trim() || '—',
      employeeId: s.employeeId || '—',
      domain: s.domain || '—',
      college: s.collegeName || s.college || '—',
      lastActive: s.lastActiveDate || null,
      joined: s.joinDate || s.joiningDate || null
    }))});
  }catch(e){
    console.error('[intern-list]', e.message);
    res.status(500).json({ success:false, message:'Could not load the student list: ' + e.message, students: [] });
  }
});

// ================= HR - GET STUDENTS BY DOMAIN =================

app.get("/hr/students/domain/:domain", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const domain = decodeURIComponent(req.params.domain);
    const students = await Student.find({ domain }).select('firstName lastName email whatsapp domain collegeName college employeeId tenure joiningDate createdAt joinerType employeeIdOverride').sort({ createdAt:-1 });
    res.json({ success:true, students });
}catch(error){ 
    console.log(error);
    res.status(500).json({ message:"Error fetching domain students" }); 
}
});

// ================= HR - GET ALL COORDINATORS =================
// Returns the union of:
//   - the legacy hardcoded COORDINATORS map (one per domain)
//   - any DB-backed Coordinator documents (created via the promotion flow)
// Used by the HR Promotions section ("Promote to HR" tab).
app.get("/hr/coordinators", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ success:false, message:"Unauthorized" });
    }
    const out = [];
    // Legacy hardcoded coordinators
    for(const [username, info] of Object.entries(COORDINATORS)){
        out.push({
            _id: "",
            source: "legacy",
            username,
            name: username,
            email: "",
            domain: info.domain || ""
        });
    }
    // DB-backed (promoted) coordinators
    try {
        const dbList = await Coordinator.find({}).sort({ createdAt:-1 });
        for(const c of dbList){
            out.push({
                _id: String(c._id),
                source: "db",
                username: c.username || c.email || "",
                name: c.name || c.username || c.email || "",
                email: c.email || "",
                domain: c.domain || "",
                employeeId: c.employeeId || ""
            });
        }
    } catch(_) { /* if Coordinator collection doesn't exist yet, just return legacy */ }

    res.json({ success:true, coordinators: out });
}catch(error){
    console.log("Error fetching coordinators:", error);
    res.status(500).json({ success:false, message:"Error fetching coordinators" });
}
});

// ================= HR - GET ALL SUBMISSIONS =================

app.get("/hr/submissions", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const submissions = await Submission.find().sort({ submittedAt:-1 });
    res.json({ success:true, submissions: await attachStudentDetailsToSubmissions(submissions) });
}catch(error){ res.status(500).json({ message:"Error" }); }
});

app.get("/hr/submissions/filter", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const status = String(req.query.status || "").trim();
    const query = status ? { status } : {};
    const submissions = await Submission.find(query).sort({ submittedAt:-1 });
    res.json({ success:true, submissions: await attachStudentDetailsToSubmissions(submissions) });
}catch(error){ res.status(500).json({ message:"Error" }); }
});

// ================= HR - GET STATS =================

app.get("/hr/stats", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const totalStudents = await Student.countDocuments();
    const totalSubmissions = await Submission.countDocuments();
    const approved = await Submission.countDocuments({ status:"Approved" });
    const rejected = await Submission.countDocuments({ status:"Rejected" });
    const pending = await Submission.countDocuments({ status:"Pending" });
    
    // Domain breakdown — uses canonical ALL_DOMAINS so HR Management is included
    const domains = ALL_DOMAINS;
    const domainStats = [];
    for(const d of domains){
        const count = await Student.countDocuments({ domain:d });
        if(count > 0) domainStats.push({ domain:d, count });
    }
    
    const notifications = await Notification.find({ from:"HR" }).sort({ createdAt:-1 }).limit(10);
    
    res.json({ 
        success:true, 
        stats:{ totalStudents, totalSubmissions, approved, rejected, pending },
        domainStats,
        notifications
    });
}catch(error){ res.status(500).json({ message:"Error" }); }
});

// ================= HR - GET ALL NOTIFICATIONS SENT =================

app.get("/hr/notifications", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const notifs = await Notification.find().sort({ createdAt:-1 }).limit(100);
    res.json({ success:true, notifications:notifs });
}catch(error){ res.status(500).json({ success:false }); }
});

// ================= HR - DELETE NOTIFICATION =================

// This had no auth check at all, while the sibling GET /hr/notifications did —
// anyone could delete any notification.
app.delete("/hr/notifications/:id", async(req,res)=>{
try{
    if(!isHRSession(req)){
        return res.status(401).json({ success:false, message:"Unauthorized" });
    }
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ success:true });
}catch(error){ res.json({ success:false }); }
});

// ================= ALL STUDENTS (legacy admin) =================

// These three endpoints read and mutate every student record, so they require
// an admin session.
//
// `GET /students` was previously guarded by the literal `Bearer mysecret123`,
// which public/dashboard.html shipped to the browser — a public password.
// `PUT` and `DELETE` had no guard at all, and the PUT spread an arbitrary
// request body straight into findByIdAndUpdate, so anyone could rewrite any
// student's domain, tenure, employeeId or payment status.
app.get("/students", requireAdminAPI, async(req,res)=>{
    try{
        const students = await Student.find().select('firstName lastName email whatsapp domain collegeName college employeeId tenure joiningDate createdAt joinerType employeeIdOverride').sort({ createdAt:-1 }).lean();
        res.json(students);
    }catch(error){ res.status(500).json({ message:"Error fetching students" }); }
});

// ================= UPDATE STUDENT =================

// Only these fields may be set through this endpoint. Anything else in the
// body is dropped, so the route cannot be used to flip privilege/payment flags
// or overwrite a password hash.
const LEGACY_STUDENT_EDITABLE_FIELDS = [
    "firstName", "lastName", "name", "email", "whatsapp",
    "domain", "tenure", "joiningDate", "collegeName", "college", "gender"
];

app.put("/students/:id", requireHROrAdminAPI, async(req,res)=>{
try{
    const body = {};
    for(const field of LEGACY_STUDENT_EDITABLE_FIELDS){
        if(req.body && req.body[field] !== undefined) body[field] = req.body[field];
    }
    if(body.firstName !== undefined || body.lastName !== undefined){
        body.name = `${body.firstName || ""} ${body.lastName || ""}`.trim();
    }
    if(body.collegeName !== undefined || body.college !== undefined){
        const collegeName = String(body.collegeName || body.college || "").trim();
        body.collegeName = collegeName;
        body.college = collegeName;
    }
    if(Object.keys(body).length === 0){
        return res.status(400).json({ message:"No editable fields supplied" });
    }

    // Editing a student is never just a field write. tenure drives the Task
    // Journey length, the attendance day target and the offer letter; domain
    // drives which task set is assigned and which coordinator sees them. This
    // route used to $set the raw body and stop, so HR extending a tenure
    // changed the record while the student's Task Journey kept showing the old
    // one. updateStudentAndPropagate normalises the values, derives
    // v2DurationType and internshipEndDate, resyncs the task journey and tells
    // the student. See services/studentPropagation.js.
    const actor = (req.session && req.session.hr && (req.session.hr.name || req.session.hr.username))
        || (req.session && req.session.adminUser && req.session.adminUser.username)
        || "HR";
    const { student: updated, report, error: invalid, notFound } =
        await studentPropagation.updateStudentAndPropagate({ studentId: req.params.id, patch: body, actor });

    if(invalid){ return res.status(400).json({ message: invalid }); }
    if(notFound || !updated){ return res.status(404).json({ message:"Student not found" }); }

    res.json({
        message: "Student Updated",
        student: updated,
        propagated: report
    });
}catch(error){
    // This used to return 500 with nothing logged, so a failing save left no
    // trace anywhere — the same blind spot that made the task-journey 500 take
    // days to find. Log the reason and hand the caller something actionable.
    console.error("[students] update failed:", error && error.message);
    const duplicate = error && error.code === 11000;
    // Distinguish "the database is unreachable" from "your edit was rejected".
    // The old code answered a dead connection with 404 "Student not found",
    // which sent HR looking for a record that was there all along.
    const unreachable = /buffering timed out|before initial connection|ECONNREFUSED|topology/i
        .test((error && error.message) || "");
    res.status(duplicate ? 409 : 500).json({
        message: duplicate
            ? "That email or employee ID is already used by another student."
            : unreachable
                ? "The database is not reachable right now. Nothing was changed — please try again in a moment."
                : "Update Failed"
    });
}
});

// ================= DELETE STUDENT =================

app.delete("/students/:id", requireHROrAdminAPI, async(req,res)=>{
try{
    // findById + deleteOne rather than findByIdAndDelete: the JSON fallback
    // engine wraps both of those but not findByIdAndDelete, so the one-shot
    // call threw outright whenever Mongo was unreachable while the sibling
    // update degraded cleanly. Same result, same failure mode as the update.
    const existing = await Student.findById(req.params.id);
    if(!existing){ return res.status(404).json({ message:"Student not found" }); }
    await Student.deleteOne({ _id: req.params.id });
    res.json({ message:"Student deleted" });
}catch(error){
    console.error("[students] delete failed:", error && error.message);
    res.status(500).json({ message:"Error deleting student" });
}
});

// ================= STUDENT LOGIN =================

app.post("/student-login", loginIpLimiter, loginLimiter, async(req,res)=>{
try{
    const { employeeId, password } = req.body;
    const student = await Student.findOne({ employeeId });
    if(!student){ return res.json({ success:false, message:"Invalid Employee ID or Password" }); }

    if (await checkLockout(res, student, Student)) return;

    // Passwords are bcrypt hashes. The `student.password === password`
    // cleartext comparison that used to run first is gone — it let a row whose
    // password column still held cleartext authenticate without hashing.
    let pwdMatch = false;
    try {
        pwdMatch = await bcrypt.compare(password, student.password || "");
    } catch(e) {}

    if(!pwdMatch){
        return await recordFailedAttempt(res, student, Student, "Invalid Employee ID or Password");
    }

    await clearFailedAttempts(student, Student);

    // Establish the server-side session. Every downstream handler derives the
    // acting student from here, never from a request header or body.
    establishStudentSession(req, student);

    // Mint the single-session token here too, and store it on the record AND
    // in the session. Both doors into the portal now behave identically: this
    // one used to leave `Student.activeSessionToken` holding a token from some
    // earlier /login, which verifySingleSession would then compare against.
    const studentSessionToken = "ten_sess_" + require("crypto").randomBytes(24).toString("hex");
    req.session.sessionToken = studentSessionToken;

    // Internship end date (used by student dashboard profile modal)
    // tenure values in this app are "1 Month" | "3 Months" | "6 Months".
    let computedEndDate = null;
    if(student.joiningDate){
        const jd = new Date(student.joiningDate);
        if(!isNaN(jd.getTime())){
            const t = String(student.tenure || "").toLowerCase();
            const days = t.includes("6") ? 180 : t.includes("3") ? 90 : 30;
            const end = new Date(jd);
            end.setDate(end.getDate() + days);
            computedEndDate = end;
        }
    }

    // Fetch and auto-heal linked domains
    const emailLc = String(student.email || "").trim().toLowerCase();
    let computedLinked = student.linkedDomains || [];
    if (emailLc) {
        const emailRegex = new RegExp("^\\s*" + emailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "\\s*$", "i");
        const allForEmail = await Student.find({ email: { $regex: emailRegex } });
        if (allForEmail.length >= 2) {
            computedLinked = allForEmail.map(s => ({
                domain:     s.domain,
                studentId:  s._id,
                employeeId: s.employeeId
            }));
            await Student.updateMany({ email: { $regex: emailRegex } }, { linkedDomains: computedLinked });
        }
    }

    await Student.findOneAndUpdate({ employeeId }, {
        lastActiveDate: new Date(),
        activeSessionToken: studentSessionToken
    });
    res.json({
        success:true,
        sessionToken: studentSessionToken,
        student:{
            // firstName/lastName can both be empty on records imported before
            // the register form split the field, which produced the literal
            // "undefined undefined" as a student's name. `name` is the column
            // every other read path uses, so prefer it and fall back.
            name: (student.name || [student.firstName, student.lastName].filter(Boolean).join(" ")).trim(),
            firstName: student.firstName, lastName: student.lastName,
            email: student.email || "",
            // Student schema in this project uses `whatsapp` for phone.
            phone: student.whatsapp || "",
            college: getStudentCollege(student),
            collegeName: getStudentCollege(student),

            employeeId: student.employeeId,
            domain: student.domains?.[0] || student.domain,
            domains: student.domains || [student.domain],
            tenure: student.tenure,

            // Dashboard uses `joiningDate` for the Joined field
            joiningDate: student.joiningDate,

            // Dashboard uses `internshipEnd` / `endDate` for the Internship End field
            internshipEnd: computedEndDate ? computedEndDate.toISOString() : null,
            endDate: computedEndDate ? computedEndDate.toISOString() : null,

            linkedDomains: computedLinked,

            // FEATURE 1 — one-time popup flags
            onboardingPopupSeen: student.onboardingPopupSeen || false,
            joinerTypeSelected:  student.joinerTypeSelected  || false,
            joinerType:          student.joinerType           || null,
            hasSeenWelcome:      student.hasSeenWelcome       || false,
            hasSeenOnboarding:   student.hasSeenOnboarding    || false,
            internshipStartDate: student.internshipStartDate  || null,
            employeeIdOverride:  student.employeeIdOverride   || null
        }
    });
}catch(error){
    console.log(error);
    res.json({ success:false, message:"Server Error" });
}
});

// ================= STUDENT PORTAL API ENDPOINTS =================

// REMOVED: POST /get-my-password
//
// This endpoint had no authentication, and when `confirmedPassword` was
// omitted it took a branch commented "Direct verification-free reveal" that
// returned the student's cleartext password for any employeeId. Employee IDs
// are sequential and printed on offer letters and certificates, so this was
// mass account takeover by enumeration.
//
// Passwords are now stored only as bcrypt hashes and cannot be read back by
// anyone, including staff. A student who forgets their password uses the
// existing reset flow (POST /auth/forgot-password → emailed reset link).
app.post("/get-my-password", (req, res) => {
  res.status(410).json({
    success: false,
    message: "Passwords can no longer be retrieved. Use 'Forgot password' to set a new one."
  });
});

app.post(["/mark-onboarding-seen", "/api/v2/student/mark-onboarding-seen"], async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.headers['x-employee-id'] || req.headers['employeeid'];
    await Student.findOneAndUpdate(
      { employeeId },
      { hasSeenOnboarding: true, onboardingPopupSeen: true },
      { new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.post(["/mark-welcome-seen", "/api/v2/student/mark-welcome-seen"], async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.headers['x-employee-id'] || req.headers['employeeid'];
    await Student.findOneAndUpdate(
      { employeeId },
      { hasSeenWelcome: true },
      { new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.post(["/save-joiner-type", "/api/v2/student/set-joiner-type"], async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.headers['x-employee-id'] || req.headers['employeeid'];
    const { joinerType } = req.body;
    await Student.findOneAndUpdate(
      { employeeId },
      { joinerType, joinerTypeSelected: true },
      { new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.post(["/save-employee-id-override", "/api/v2/student/save-employee-id-override"], async (req, res) => {
  try {
    // Identity from the SESSION only.
    //
    // This read `req.body.employeeId || req.headers['x-employee-id'] || ... ||
    // session`, so a client-supplied value won over the signed-in student. Any
    // logged-in user could rename ANY student's employee ID by naming them in
    // the body — and the rename cascades across five collections, so it took
    // their attendance, submissions, tasks, badges and document history with it.
    const currentEmployeeId = (req.session && req.session.student && req.session.student.employeeId) || null;
    if (!currentEmployeeId) {
      return res.status(401).json({ success: false, message: "Please sign in to continue." });
    }

    const newEmployeeId = String(req.body.employeeIdOverride || "").trim();
    if (!newEmployeeId) {
      return res.json({ success: false, message: "Employee ID cannot be empty" });
    }

    const student = await Student.findOne({ employeeId: currentEmployeeId });
    if (!student) {
      return res.json({ success: false, message: "Student not found" });
    }

    const oldEmployeeId = student.employeeId;

    if (newEmployeeId === oldEmployeeId) {
      return res.json({ success: true, message: "That is already your Employee ID." });
    }

    // Refuse an ID that belongs to someone else.
    //
    // Nothing checked this. A WhatsApp joiner could claim an ID already in use
    // and the server would take it: under MongoDB the unique index turned it
    // into an opaque save error, and under the JSON fallback — which enforces
    // no indexes — two students simply ended up sharing one login identity.
    const availability = await isEmployeeIdAvailable(newEmployeeId, student._id);
    if (!availability.available) {
      return res.status(409).json({
        success: false,
        available: false,
        message: availability.reason || "This Employee ID is already taken. Please choose a different one."
      });
    }

    student.employeeIdOverride = newEmployeeId;
    student.employeeId = newEmployeeId;
    await student.save();

    // Cascade the change to everything keyed on the old ID.
    try {
      await Promise.all([
        Attendance.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
        Submission.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
        TaskAssignment.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
        BadgeAward.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
        DocumentHistory.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
      ]);
      if (req.session && req.session.student) req.session.student.employeeId = newEmployeeId;
    } catch (cascadeErr) {
      console.error('Employee ID cascade error:', cascadeErr);
      // Best-effort: the student document is already updated.
    }

    res.json({ success: true, employeeId: newEmployeeId });
  } catch (err) {
    console.error("[save-employee-id-override]", err.message);
    res.json({ success: false, message: "Could not update the Employee ID right now." });
  }
});

app.post(["/save-start-date", "/api/v2/student/save-start-date"], async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.headers['x-employee-id'] || req.headers['employeeid'];
    const { internshipStartDate } = req.body;
    if (!internshipStartDate) {
      return res.json({
        success: false,
        message: "Please provide a start date"
      });
    }
    const startDate = new Date(internshipStartDate);
    if (isNaN(startDate.getTime())) {
      return res.json({
        success: false,
        message: "Invalid date format"
      });
    }
    await Student.findOneAndUpdate(
      { employeeId },
      {
        internshipStartDate: startDate,
        hasSeenOnboarding: true,
        onboardingPopupSeen: true
      },
      { new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// ── HELPER FUNCTION — CALCULATE STATS ──
//
// Rewritten onto utils/attendanceUtils. The previous version:
//   - had its own tenure map keyed by the exact spaced strings, so anything
//     that did not match fell to 30 days;
//   - divided by the FULL tenure length with Sundays INCLUDED, so a student on
//     day 3 of 45 could show at most 6%;
//   - computed `startDate` from internshipStartDate for WhatsApp joiners and
//     then never used the variable, so the section 2 bug was visible right here.
async function calculateAttendanceStats(employeeId) {
  const student = await Student.findOne({ employeeId });
  if (!student) return null;

  const records = await Attendance.find({ employeeId });
  const selfRecords  = records.filter(r => r.markedBy === "self");
  const coordRecords = records.filter(r => r.markedBy === "coordinator");

  const summary = attendanceUtils.getAttendanceSummary(records, student);
  const elapsed = summary.workingDaysElapsed;

  const countPresent = (rows) => {
    const days = new Set();
    for (const r of rows) {
      if (r.status === "Absent") continue;
      const key = r.dateKey || attendanceUtils.toDateKey(r.date);
      if (key) days.add(key);
    }
    return days.size;
  };

  const selfCount  = countPresent(selfRecords);
  const coordCount = countPresent(coordRecords);
  const pct = (n) => (elapsed > 0 ? Math.min(Math.round((n / elapsed) * 100), 100) : 0);

  const todayKey = istDateKey();
  const markedToday = selfRecords.some(r =>
    (r.dateKey || attendanceUtils.toDateKey(r.date)) === todayKey);

  return {
    selfCount,
    coordCount,
    combinedCount: summary.daysPresent,
    // `totalDays` is the denominator the percentages use: elapsed working days.
    totalDays: elapsed,
    tenureTotalDays: summary.totalCalendarDays,
    totalWorkingDays: summary.totalWorkingDays,
    selfPct:  pct(selfCount),
    coordPct: pct(coordCount),
    combinedPct: summary.percentage,
    minDays: summary.requiredDays,
    daysNeeded: summary.stillNeeds,
    markedToday,
    isAboveMinimum: summary.isEligible,
    tenure: student.tenure,
    // Section 3: "Day 12 of 45".
    dayNumber: summary.dayNumber,
    daysRemaining: summary.daysRemaining,
    preportalCreditedDays: summary.preportalCreditedDays,
    startDate: summary.startDate,
    endDate: summary.endDate
  };
}

// ── MARK OWN ATTENDANCE (student clicks button) ──
app.post("/mark-attendance", async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.json({ success: false, message: "Employee ID required" });

    const student = await Student.findOne({ employeeId });
    if (!student) return res.json({ success: false, message: "Student not found" });

    // Shared IST day key — the cron job used a UTC key, so the two disagreed
    // about which day it was after 18:30 UTC.
    const today = istDateKey();

    // Check if already marked today
    const existing = await Attendance.findOne({
      employeeId,
      dateKey: today,
      markedBy: "self"
    });

    if (existing) {
      return res.json({
        success: false,
        message: "Attendance already marked for today",
        alreadyMarked: true
      });
    }

    // Save attendance
    // `date: now` used to sit here and `now` was never declared in this
    // handler, so every call threw a ReferenceError and answered
    // {success:false, message:"Server error"} — this endpoint has never once
    // recorded attendance.
    await Attendance.create({
      studentId: student._id,
      employeeId,
      domain: attendanceDomain.domainForWrite(student, req.body.domain),
      date: new Date(),
      dateKey: today,
      status: "Present",
      markedBy: "self"
    });

    await Student.findOneAndUpdate({ employeeId }, { lastActiveDate: new Date() });
    await bumpStreakAndMilestones(student);
    await checkCertificateEligibility(employeeId);
    await recomputeBadgesFor(employeeId);

    // Calculate and return updated stats
    const stats = await calculateAttendanceStats(employeeId);
    res.json({ success: true, stats });

  } catch (err) {
    if (err.code === 11000) {
      return res.json({
        success: false,
        message: "Attendance already marked for today",
        alreadyMarked: true
      });
    }
    console.log(err);
    res.json({ success: false, message: "Server error" });
  }
});

// ── GET ATTENDANCE STATS ──
app.get("/attendance-stats/:employeeId", async (req, res) => {
  try {
    const employeeId = decodeURIComponent(req.params.employeeId);
    const student = await Student.findOne({ employeeId });
    if (!student) return res.json({ success: false, message: "Student not found" });

    // This endpoint used to run two different calculators and merge their
    // output, so `percentage` (elapsed calendar days, Sundays counted) could
    // contradict `selfPct`/`coordPct` (full tenure, Sundays counted) inside a
    // single response. There is one calculation now.
    const stats = await calculateAttendanceStats(employeeId);
    if (!stats) return res.json({ success: false, message: "Student not found" });

    const payload = {
      ...stats,
      percentage: stats.combinedPct,
      presentDays: stats.combinedCount,
      absentDays: Math.max(0, stats.totalDays - stats.combinedCount),
      requiredDays: stats.minDays,
      selfPresentDays: stats.selfCount,
      coordinatorPresentDays: stats.coordCount,
      combinedPresentDays: stats.combinedCount
    };

    return res.json({
      success: true,
      stats: payload,
      ...payload
    });
  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

// ── COORDINATOR MARKS ATTENDANCE FOR STUDENT ──
app.post("/coordinator-mark-attendance", async (req, res) => {
  try {
    const { employeeId, date } = req.body;
    const markDate = date || new Date().toISOString().split("T")[0];
    const d = new Date(markDate);
    const dateKey = markDate;

    const student = await Student.findOne({ employeeId });
    if (!student) return res.json({ success: false, message: "Student not found" });

    const existing = await Attendance.findOne({
      employeeId,
      dateKey,
      markedBy: "coordinator"
    });

    if (existing) {
      return res.json({
        success: false,
        message: "Already marked for this date"
      });
    }

    await Attendance.create({
      studentId: student._id,
      employeeId,
      domain: student.domain,
      date: d,
      dateKey,
      status: "Present",
      markedBy: "coordinator"
    });

    const stats = await calculateAttendanceStats(employeeId);
    res.json({ success: true, stats });

  } catch (err) {
    if (err.code === 11000) {
      return res.json({
        success: false,
        message: "Already marked"
      });
    }
    res.json({ success: false });
  }
});

// ================= COORDINATOR LOGIN =================

app.post("/coordinator-login", loginIpLimiter, loginLimiter, async(req,res)=>{
try{
    const password = (req.body && req.body.password) || "";
    const identifier = ((req.body && (req.body.username || req.body.email)) || "").trim();
    if(!identifier || !password){
        return res.json({ success:false });
    }

    // 1) Roster coordinator (credentials from COORDINATOR_CREDENTIALS) —
    //    exact-username match.
    const legacy = COORDINATORS[identifier];
    if(legacy && await verifyCredentialPassword(legacy, password)){
        // email and name are carried so chat can recognise this person under
        // every id they may already appear as in a conversation's room name.
        const coordIdentity = { username:identifier, email: legacy.email || "", name: legacy.name || identifier, domain:legacy.domain };
        if (req.session) req.session.coordinator = coordIdentity;
        return res.json({ success:true, coordinator: coordIdentity });
    }

    // 2) DB-backed coordinator (created via promotion flow). Accepts either
    //    email or username.
    const q = identifier.indexOf("@") !== -1
        ? { email: identifier.toLowerCase() }
        : { $or: [{ username: identifier }, { email: identifier.toLowerCase() }] };
    const dbCoord = await Coordinator.findOne(q);
    if(dbCoord){
        if (await checkLockout(res, dbCoord, Coordinator)) return;

        const ok = await bcrypt.compare(password, dbCoord.password);
        if(ok){
            // The password is right. Whether they may come in is a separate
            // question, and it used to answer itself:
            //
            //     if (dbCoord.verificationStatus !== "approved") {
            //         dbCoord.verificationStatus = "approved";
            //
            // Logging in APPROVED the applicant. Anyone who registered as a
            // coordinator granted themselves the role by signing in once, and
            // HR's review existed only on paper. Being right about the password
            // is not the same as being authorised.
            if (dbCoord.verificationStatus === "rejected") {
                return res.status(403).json({
                    success: false,
                    approvalStatus: "rejected",
                    message: dbCoord.reviewNote
                        ? "Your coordinator application was not approved. " + dbCoord.reviewNote
                        : "Your coordinator application was not approved. Please contact HR if you believe this is a mistake."
                });
            }

            if (dbCoord.verificationStatus !== "approved") {
                return res.status(403).json({
                    success: false,
                    approvalStatus: "pending",
                    message: "Your coordinator application is still awaiting HR approval. " +
                             "You will be able to sign in once it has been reviewed."
                });
            }

            // Approved once, then replaced by a sole coordinator for the domain.
            if (dbCoord.supersededAt) {
                return res.status(403).json({
                    success: false,
                    approvalStatus: "superseded",
                    message: "Another coordinator now holds " + (dbCoord.domain || "this domain") +
                             ". Please contact HR if you should still have access."
                });
            }

            await clearFailedAttempts(dbCoord, Coordinator);
            const coordIdentity = {
                username: dbCoord.username || dbCoord.email,
                email:    dbCoord.email || "",
                name:     dbCoord.name || dbCoord.username || dbCoord.email,
                domain:   dbCoord.domain
            };
            if (req.session) req.session.coordinator = coordIdentity;
            return res.json({ success:true, coordinator: coordIdentity });
        } else {
            return await recordFailedAttempt(res, dbCoord, Coordinator, "Invalid Username or Password");
        }
    }
    return res.json({ success:false, message: "Invalid Username or Password" });
}catch(error){
    console.log(error);
    res.json({ success:false });
}
});

// ================= TEST: COORDINATOR SAVE QUESTIONS =================

// ═══════════════════════════════════════════════════════════════════════════
// Coordinator applications — HR review
//
// A coordinator registration used to be approved by the applicant simply
// logging in (see /coordinator-login). These endpoints are the review that was
// supposed to happen, and HR Level 2 — "Sr HR Associate: assesses & verifies
// incoming Coordinator applications, enforces one coordinator-per-domain" — is
// the level the portal already documents for the job.
// ═══════════════════════════════════════════════════════════════════════════

const COORDINATOR_REVIEW_MIN_LEVEL = 2;

function requireCoordinatorReviewer(req, res, next) {
    if (req.session && req.session.adminUser) return next();
    const hr = req.session && req.session.hr;
    if (!hr) {
        return res.status(401).json({ success: false, message: "HR sign-in required." });
    }
    if ((hr.level || 1) < COORDINATOR_REVIEW_MIN_LEVEL) {
        return res.status(403).json({
            success: false,
            message: "Coordinator applications are reviewed from HR Level " +
                     COORDINATOR_REVIEW_MIN_LEVEL + " (Sr HR Associate) upward."
        });
    }
    next();
}

// GET /api/hr/coordinator-applications
// Pending applications, each with whoever already holds the domain, so the
// reviewer can see the clash before deciding rather than after.
app.get("/api/hr/coordinator-applications", requireCoordinatorReviewer, async (req, res) => {
    try {
        const pending = await Coordinator
            .find({ verificationStatus: "pending" })
            .select("username email name domain experience createdAt")
            .sort({ createdAt: 1 })
            .lean();

        const domains = [...new Set(pending.map(p => p.domain).filter(Boolean))];
        const holders = domains.length
            ? await Coordinator.find({
                  domain: { $in: domains },
                  verificationStatus: "approved",
                  supersededAt: null
              }).select("username email name domain domainMode").lean()
            : [];

        const byDomain = {};
        for (const h of holders) (byDomain[h.domain] = byDomain[h.domain] || []).push(h);

        res.json({
            success: true,
            applications: pending.map(app => ({
                ...app,
                existingCoordinators: byDomain[app.domain] || []
            }))
        });
    } catch (err) {
        console.error("[coordinator-applications]", err.message);
        res.status(500).json({ success: false, message: "Could not load applications." });
    }
});

// POST /api/hr/coordinator-applications/:id/decide
// body: { decision: "approve" | "reject", domainMode?: "sole" | "shared", note?: string }
app.post("/api/hr/coordinator-applications/:id/decide", requireCoordinatorReviewer, async (req, res) => {
    try {
        const { decision, domainMode, note } = req.body || {};
        if (decision !== "approve" && decision !== "reject") {
            return res.status(400).json({ success: false, message: "Decision must be approve or reject." });
        }

        const applicant = await Coordinator.findById(req.params.id);
        if (!applicant) {
            return res.status(404).json({ success: false, message: "Application not found." });
        }
        if (applicant.verificationStatus !== "pending") {
            return res.status(409).json({
                success: false,
                message: "This application was already " + applicant.verificationStatus + "."
            });
        }

        const reviewer = (req.session.hr && (req.session.hr.username || req.session.hr.email))
                      || (req.session.adminUser && "admin")
                      || "unknown";

        if (decision === "reject") {
            applicant.verificationStatus = "rejected";
            applicant.reviewedBy = reviewer;
            applicant.reviewedAt = new Date();
            applicant.reviewNote = String(note || "").slice(0, 500);
            await applicant.save();
            return res.json({ success: true, status: "rejected" });
        }

        // Approving. "sole" removes everyone else from the domain; "shared"
        // leaves them in place. Anything else is a typo, and defaulting a typo
        // to "sole" would silently cut off a working coordinator.
        const mode = domainMode === "shared" ? "shared" : (domainMode === "sole" ? "sole" : null);
        if (!mode) {
            return res.status(400).json({
                success: false,
                message: "Choose whether this coordinator is the sole coordinator for the domain or shares it."
            });
        }

        let superseded = [];
        if (mode === "sole" && applicant.domain) {
            const others = await Coordinator.find({
                domain: applicant.domain,
                verificationStatus: "approved",
                supersededAt: null,
                _id: { $ne: applicant._id }
            }).select("_id username email");

            if (others.length) {
                await Coordinator.updateMany(
                    { _id: { $in: others.map(o => o._id) } },
                    { $set: { supersededAt: new Date(), supersededBy: reviewer } }
                );
                superseded = others.map(o => o.username || o.email);
            }
        }

        applicant.verificationStatus = "approved";
        applicant.domainMode = mode;
        applicant.reviewedBy = reviewer;
        applicant.reviewedAt = new Date();
        applicant.reviewNote = String(note || "").slice(0, 500);
        applicant.supersededAt = null;
        applicant.supersededBy = "";
        await applicant.save();

        res.json({ success: true, status: "approved", domainMode: mode, superseded });
    } catch (err) {
        console.error("[coordinator-decide]", err.message);
        res.status(500).json({ success: false, message: "Could not record that decision." });
    }
});

app.post("/save-test-questions", async(req,res)=>{
try{
    const { domain, questions } = req.body;
    await TestQuestion.deleteMany({ domain });
    const docs = questions.map(q=>({ domain, question:q.question, options:q.options, correctAnswer:q.correctAnswer }));
    await TestQuestion.insertMany(docs);
    res.json({ success:true, message:"Test questions saved" });
}catch(error){
    console.log(error);
    res.json({ success:false, message:"Failed to save questions" });
}
});

// ================= TEST: GET QUESTIONS FOR STUDENT =================

app.get("/get-test-questions/:domain", async(req,res)=>{
try{
    const domain = decodeURIComponent(req.params.domain);
    const questions = await TestQuestion.find({ domain }, { correctAnswer:0 });
    res.json({ success:true, questions });
}catch(error){
    console.log(error);
    res.json({ success:false, questions:[] });
}
});

// ================= TEST: SUBMIT TEST =================

app.post("/submit-test", async(req,res)=>{
try{
    const { employeeId, studentName, domain, answers } = req.body;

    const questions = await TestQuestion.find({ domain });
    if(questions.length === 0){
        return res.json({ success:false, message:"No test available" });
    }

    let score = 0;
    answers.forEach((ans, idx)=>{
        if(questions[idx] && ans === questions[idx].correctAnswer){ score++; }
    });

    const percentage = Math.round((score / questions.length) * 100);

    await TestResult.findOneAndUpdate(
        { employeeId, domain },
        { employeeId, studentName, domain, score, totalQuestions:questions.length, percentage, submittedAt:new Date() },
        { upsert:true, new:true }
    );

    res.json({ success:true, score, totalQuestions:questions.length, percentage });
}catch(error){
    console.log(error);
    res.json({ success:false, message:"Test submission failed" });
}
});

// ================= TEST: LEADERBOARD =================

app.get("/test-leaderboard/:domain", async(req,res)=>{
try{
    const domain = decodeURIComponent(req.params.domain);
    const results = await TestResult.find({ domain }).sort({ percentage:-1, submittedAt:1 });
    res.json({ success:true, leaderboard:results });
}catch(error){
    console.log(error);
    res.json({ success:false, leaderboard:[] });
}
});


// ================= COORDINATOR TASK SCHEMA =================

const coordinatorTaskSchema = new mongoose.Schema({
    domain:    { type: String, required: true, unique: true },
    tasks:     [String],
    fileUrl:   { type: String, default: "" },
    fileName:  { type: String, default: "" },
    // F8 — optional submission deadline for the domain task. When present and
    // in the past, the hourly cron flips the per-student `isOverdue` flag and
    // sends a one-time overdue notification (idempotent via lastOverdueRun).
    deadline:           { type: Date,   default: null },
    lastOverdueRunAt:   { type: Date,   default: null },
    updatedAt: { type: Date, default: Date.now }
});
const CoordinatorTask = mongoose.model("CoordinatorTask", coordinatorTaskSchema);

// ================= COORDINATOR TASKS - GET =================

app.get("/coordinator/tasks/:domain", async(req,res)=>{
try{
    const domain = decodeURIComponent(req.params.domain);
    const ct = await CoordinatorTask.findOne({ domain });
    res.json({ success:true, tasks: ct?.tasks||[], fileUrl: ct?.fileUrl||"", fileName: ct?.fileName||"" });
}catch(e){ res.json({ success:true, tasks:[], fileUrl:"", fileName:"" }); }
});

// ================= COORDINATOR TASKS - SAVE =================

app.post("/coordinator/tasks", async(req,res)=>{
try{
    const { domain, tasks, deadline } = req.body;
    // Empty string clears the deadline; a real ISO/parsable date sets it.
    let deadlineVal = undefined;     // undefined means: don't touch in $set
    if(deadline === "" || deadline === null){
        deadlineVal = null;
    } else if(deadline){
        const d = new Date(deadline);
        if(!isNaN(d.getTime())) deadlineVal = d;
    }
    const update = { domain, tasks, updatedAt: new Date() };
    if(deadlineVal !== undefined){
        update.deadline = deadlineVal;
        // Reset cron-throttle when the deadline changes, so the new
        // deadline can fire its overdue notifications fresh.
        update.lastOverdueRunAt = null;
    }
    await CoordinatorTask.findOneAndUpdate(
        { domain },
        update,
        { upsert:true, new:true }
    );
    res.json({ success:true });
}catch(e){ res.json({ success:false, message:"Failed to save tasks" }); }
});

// ================= COORDINATOR TASKS - UPLOAD FILE =================

app.post("/coordinator/tasks/upload-file", upload.single("taskFile"), async(req,res)=>{
try{
    const { domain } = req.body;
    if(!req.file){ return res.json({ success:false, message:"No file uploaded" }); }
    const fileUrl  = "/" + req.file.path;
    const fileName = req.file.originalname;
    await CoordinatorTask.findOneAndUpdate(
        { domain },
        { domain, fileUrl, fileName, updatedAt: new Date() },
        { upsert:true, new:true }
    );
    res.json({ success:true, fileUrl, fileName });
}catch(e){ res.json({ success:false, message:"Upload failed: " + e.message }); }
});

// ================= COORDINATOR TASKS - REMOVE FILE =================

app.post("/coordinator/tasks/remove-file", async(req,res)=>{
try{
    const { domain } = req.body;
    await CoordinatorTask.findOneAndUpdate({ domain }, { fileUrl:"", fileName:"" });
    res.json({ success:true });
}catch(e){ res.json({ success:false }); }
});

// ==================================================================
// ============ DUAL ATTENDANCE & CERTIFICATE WORKFLOW ==============
// ==================================================================
// New primary attendance system (models/Attendance.js).
// SELF attendance: student marks once per calendar day (independent of tasks).
// CLASS attendance: coordinator marks/edit any date (Present/Absent).
// Two-step certificate approval: Coordinator -> HR -> Generate certificates.

// ---- Helpers ----
function toDateKey(d){
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function parseJoinDate(joiningDate){
    if(!joiningDate) return null;
    const d = new Date(joiningDate);
    if(isNaN(d.getTime())) return null;
    return d;
}

// Working days from joining date to today (inclusive), excluding Sundays only.
// Saturday IS a working day. Used for ALL attendance percentage calculations.
function countDaysExcludingSundays(start, end){
    return attendanceUtils.countWorkingDays(start, end);
}

// Attendance % = (present days) / (working days since joining) * 100.
// Working days are calendar days from joiningDate to today (inclusive), excluding Sundays only.
// We DO NOT use marked-day count as the denominator. If the joining date is unknown
// or no working days exist yet (e.g. only-Sunday range), all percentages are 0.
async function computeAttendanceStats(employeeId, joiningDate, domain){
    // The student is loaded first because the domain scoping needs their
    // enrolment list, not just the requested string.
    const student = await Student.findOne({ employeeId }).lean();

    // Filtering happens in JS, not in the Mongo query. The query used an
    // anchored regex on `domain`, and `Attendance.domain` defaults to "" —
    // so every row written before that field was populated was silently
    // dropped from the count. attendanceDomain.filterByDomain attributes a
    // blank row to the student's primary domain instead of discarding it, and
    // does nothing at all for a single-domain student.
    const allRecords = await Attendance.find({ employeeId });
    const records = attendanceDomain.filterByDomain(allRecords, domain, student);

    const self   = records.filter(r => r.markedBy === "self");
    const coord  = records.filter(r => r.markedBy === "coordinator");

    const selfPresent  = self.filter(r => r.status === "Present").length;
    const coordPresent = coord.filter(r => r.status === "Present").length;
    const coordAbsent  = coord.filter(r => r.status === "Absent").length;

    // Union of distinct calendar days the student was Present in EITHER source
    const presentDayKeys = new Set();
    records.forEach(r => { if(r.status === "Present") presentDayKeys.add(r.dateKey); });

    // Denominator: elapsed working days, Sundays excluded, from the student's
    // EFFECTIVE start date — which for a WhatsApp joiner is internshipStartDate,
    // earlier than the joiningDate this function used to be handed. A WhatsApp
    // joiner's pre-portal period is credited as attended (see
    // utils/attendanceUtils.getPreportalCreditedDays).
    const summary = attendanceUtils.getAttendanceSummary(
        records,
        student || { joiningDate, tenure: null }
    );
    const workingDays = summary.workingDaysElapsed;

    // Includes any pre-portal days credited to a WhatsApp joiner.
    const combinedPresentDays = summary.daysPresent;

    // No valid start date / no working days yet → percentages are not defined (0).
    if(workingDays < 1){
        return {
            selfPresent, selfTotal: self.length,
            coordPresent, coordAbsent, coordTotal: coord.length,
            combinedPresentDays: 0, workingDays: 0,
            selfPct: 0, coordPct: 0, combinedPct: 0,
            requiredDays: 0, daysNeeded: 0,
            dayNumber: 0, daysRemaining: summary.totalCalendarDays,
            preportalCreditedDays: 0,
            eligible: false
        };
    }

    // Cap at 100 to guard against marks on excluded days (e.g. Sunday entries).
    const selfPct  = Math.min(100, Math.round((selfPresent  / workingDays) * 100));
    const coordPct = Math.min(100, Math.round((coordPresent / workingDays) * 100));

    return {
        selfPresent, selfTotal: self.length,
        coordPresent, coordAbsent, coordTotal: coord.length,
        combinedPresentDays, workingDays,
        selfPct, coordPct,
        combinedPct: summary.percentage,
        // Section 3: the real 75% target and the day counter for the panel.
        requiredDays: summary.requiredDays,
        daysNeeded: summary.stillNeeds,
        totalWorkingDays: summary.totalWorkingDays,
        totalCalendarDays: summary.totalCalendarDays,
        dayNumber: summary.dayNumber,
        daysRemaining: summary.daysRemaining,
        preportalCreditedDays: summary.preportalCreditedDays,
        eligible: summary.isEligible
    };
}

// ---- STUDENT: mark own attendance (once per day) ----
app.post("/attendance/self", async(req,res)=>{
try{
    const { employeeId } = req.body;
    if(!employeeId) return res.json({ success:false, message:"Employee ID required" });

    const student = await Student.findOne({ employeeId });
    if(!student) return res.json({ success:false, message:"Student not found" });

    const now = new Date();
    const dateKey = toDateKey(now);

    // Which domain this mark is for. A student holding two domains is doing two
    // separate internships and has to mark each one — the duplicate check below
    // is scoped to the domain for exactly that reason. An unrecognised domain
    // (or none) falls back to their primary; a domain they are not enrolled in
    // is never honoured. See utils/attendanceDomain.js.
    const markDomain = attendanceDomain.domainForWrite(
        student,
        req.body.domain || req.headers['x-active-domain']
    );

    const existing = await Attendance.findOne({ employeeId, dateKey, markedBy:"self", domain: markDomain });
    if(existing) return res.json({ success:false, alreadyMarked:true, domain: markDomain, message:"Already marked for today" });

    const att = new Attendance({
        studentId: student._id, employeeId, domain: markDomain,
        date: now, dateKey, status:"Present", markedBy:"self"
    });
    await att.save();
    await Student.findOneAndUpdate({ employeeId }, { lastActiveDate: new Date() });
    // Streak + milestones + badges (Features 6, 7, 11)
    await bumpStreakAndMilestones(student);
    await checkCertificateEligibility(employeeId);
    await recomputeBadgesFor(employeeId);

    // Return the fresh figures so the page does not have to guess whether the
    // count moved — "it does not count the attendance" was partly this: the
    // dashboard re-fetched, the domain filter dropped every row, and the panel
    // stayed at zero right after a successful mark.
    const stats = await computeAttendanceStats(employeeId, student.joiningDate, markDomain);
    res.json({ success:true, message:"Attendance marked for today", domain: markDomain, attendance:att, stats });
}catch(e){
    if(e.code === 11000) return res.json({ success:false, alreadyMarked:true, message:"Already marked for today" });
    console.log(e); res.json({ success:false, message:"Failed to mark attendance" });
}
});

// ---- DEV / TEST: reset today's self attendance for testing ----
app.post("/attendance/reset-test-today", async(req,res)=>{
    try{
        const { employeeId } = req.body;
        if(!employeeId) return res.json({ success:false, message:"Employee ID required" });
        const now = new Date();
        const dateKey = toDateKey(now);
        await Attendance.deleteMany({ employeeId, dateKey, markedBy:"self" });
        res.json({ success:true, message:"Today's attendance test record reset" });
    }catch(e){
        res.json({ success:false, message:e.message });
    }
});

// ---- COORDINATOR: mark/update class attendance for any date ----
app.post("/attendance/coordinator", async(req,res)=>{
try{
    const { employeeId, date, status, coordinatorId } = req.body;
    if(!employeeId || !date) return res.json({ success:false, message:"Employee ID and date required" });

    const student = await Student.findOne({ employeeId });
    if(!student) return res.json({ success:false, message:"Student not found" });

    const st = (status === "Absent") ? "Absent" : "Present";
    const d = new Date(date);
    if(isNaN(d.getTime())) return res.json({ success:false, message:"Invalid date" });
    const dateKey = toDateKey(d);

    // The coordinator marks one domain's class, so the record is scoped the
    // same way a student's self-mark is.
    const markDomain = attendanceDomain.domainForWrite(student, req.body.domain);

    // Idempotent: if already marked for that day, update it instead of erroring
    let att = await Attendance.findOne({ employeeId, dateKey, markedBy:"coordinator", domain: markDomain });
    if(att){
        att.status = st;
        att.coordinatorId = coordinatorId || att.coordinatorId;
        att.date = d;
        await att.save();
        // Notify the student so their dashboard refreshes attendance
        try{
            const notif = new Notification({
                title: "Class attendance updated",
                message: `Coordinator updated your class attendance for ${dateKey}: ${st}.`,
                type: "info", from: "Coordinator",
                targetType: "student", targetEmployeeId: employeeId, targetDomain: student.domain
            });
            await notif.save();
            broadcastNotification(student.domain, employeeId, notif);
        }catch(_){}
        return res.json({ success:true, updated:true, message:"Attendance updated", attendance:att });
    }

    att = new Attendance({
        studentId: student._id, employeeId, domain: markDomain,
        date: d, dateKey, status: st, markedBy:"coordinator", coordinatorId: coordinatorId || ""
    });
    await att.save();
    // Notify the student so their dashboard refreshes attendance
    try{
        const notif = new Notification({
            title: "Class attendance marked",
            message: `Coordinator marked your class attendance for ${dateKey}: ${st}.`,
            type: st === "Present" ? "success" : "warning",
            from: "Coordinator",
            targetType: "student", targetEmployeeId: employeeId, targetDomain: student.domain
        });
        await notif.save();
        broadcastNotification(student.domain, employeeId, notif);
    }catch(_){}
    res.json({ success:true, message:"Attendance marked", attendance:att });
}catch(e){
    if(e.code === 11000) return res.json({ success:false, message:"Already marked for this date" });
    console.log(e); res.json({ success:false, message:"Failed to mark attendance" });
}
});

// ---- COORDINATOR: edit an existing attendance record ----
app.put("/attendance/:id", async(req,res)=>{
try{
    const { status, coordinatorId } = req.body;
    const att = await Attendance.findById(req.params.id);
    if(!att) return res.json({ success:false, message:"Record not found" });
    if(att.markedBy !== "coordinator")
        return res.json({ success:false, message:"Only coordinator-marked attendance can be edited" });

    if(status) att.status = (status === "Absent") ? "Absent" : "Present";
    if(coordinatorId) att.coordinatorId = coordinatorId;
    await att.save();
    res.json({ success:true, message:"Attendance updated", attendance:att });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to update" }); }
});

// ---- GET attendance history + stats for one student ----
app.get("/attendance/student/:employeeId", async(req,res)=>{
try{
    const employeeId = decodeURIComponent(req.params.employeeId);
    const student = await Student.findOne({ employeeId });
    const domain = attendanceDomain.resolveActiveDomain(
        student,
        req.query.domain || req.headers['x-active-domain']
    );

    // Every row is loaded and then filtered in JS. The anchored regex this used
    // to run against `Attendance.domain` dropped every row written before that
    // field was populated — it defaults to "" — so a student's own history
    // silently stopped counting.
    const allRecords = await Attendance.find({ employeeId }).sort({ date:-1 });
    const records = attendanceDomain.filterByDomain(allRecords, domain, student);

    const stats = await computeAttendanceStats(employeeId, student ? student.joiningDate : null, domain);
    const today = toDateKey(new Date());
    const markedToday = records.some(r => r.markedBy === "self" && r.dateKey === today);
    res.json({
        success:true,
        attendance:records,
        stats,
        markedToday,
        domain,
        // So the page can show a per-domain marker when the student holds two.
        domains: attendanceDomain.studentDomains(student)
    });
}catch(e){ console.log(e); res.json({ success:false, attendance:[], stats:null }); }
});

// ---- HR: attendance monitor (all students summary) ----
app.get("/attendance/monitor", async(req,res)=>{
try{
    if(!isHRSession(req)) return res.status(401).json({ success:false, message:"Unauthorized" });

    const students = await Student.find().select('firstName lastName name domain collegeName college employeeId tenure joiningDate createdAt').sort({ createdAt:-1 }).lean();
    const result = [];
    for(const s of students){
        const stats = await computeAttendanceStats(s.employeeId, s.joiningDate);
        result.push({
            _id:s._id, employeeId:s.employeeId,
            name:(s.name || ((s.firstName||"")+" "+(s.lastName||""))).trim(),
            domain:s.domain, joiningDate:s.joiningDate,
            collegeName: collegeDisplay(s), college: collegeDisplay(s),
            stats
        });
    }
    res.json({ success:true, students:result });
}catch(e){ console.log(e); res.json({ success:false, students:[] }); }
});

// ---- COORDINATOR: student overview for their domain ----
// Returns each student's tasks, attendance stats, performance & approval state.
app.get("/coordinator/student-overview/:domain", async(req,res)=>{
try{
    const domain = decodeURIComponent(req.params.domain);
    const studentsRaw = await Student.find({ domain }).select('firstName lastName name domain collegeName college employeeId tenure joiningDate certificateApprovedByCoordinator coordinatorRemarks coordinatorApprovedAt certificateApprovedByHR hrRejected hrRejectionReason createdAt').sort({ createdAt:-1 });
    // BUG FIX 2: deduplicate by employeeId so each student appears only once.
    // Earlier registrations may have produced duplicate Student docs with the
    // same employeeId; keep only the most recent.
    const seen = new Set();
    const students = [];
    for(const s of studentsRaw){
        const key = s.employeeId || String(s._id);
        if(seen.has(key)) continue;
        seen.add(key);
        students.push(s);
    }
    const result = [];
    for(const s of students){
        const submissions = await Submission.find({ employeeId:s.employeeId }).sort({ submittedAt:-1 });
        const stats = await computeAttendanceStats(s.employeeId, s.joiningDate);
        // Replace the old letter-grade performance with the professional formula.
        const perf = await calculatePerformance(s);
        result.push({
            _id:s._id, employeeId:s.employeeId,
            name:(s.name || ((s.firstName||"")+" "+(s.lastName||""))).trim(),
            domain:s.domain, joiningDate:s.joiningDate, tenure:s.tenure,
            submissions: submissions.map(x => ({ task:x.task, status:x.status, feedback:x.feedback, submittedAt:x.submittedAt })),
            stats,
            // Backward-compatible: keep `performance` as a label, plus a structured object.
            performance: perf ? (perf.score + " · " + perf.grade) : "—",
            performanceObj: perf || null,
            certificateApprovedByCoordinator: s.certificateApprovedByCoordinator,
            coordinatorRemarks: s.coordinatorRemarks,
            coordinatorApprovedAt: s.coordinatorApprovedAt,
            certificateApprovedByHR: s.certificateApprovedByHR,
            hrRejected: s.hrRejected,
            hrRejectionReason: s.hrRejectionReason
        });
    }
    res.json({ success:true, students:result });
}catch(e){ console.log(e); res.json({ success:false, students:[] }); }
});

// ---- COORDINATOR: all attendance records for a domain (optionally one date) ----
app.get("/coordinator/attendance/:domain", async(req,res)=>{
try{
    const domain = decodeURIComponent(req.params.domain);
    const query = { domain };
    if(req.query.date) query.dateKey = req.query.date;
    const records = await Attendance.find(query).sort({ date:-1 });
    res.json({ success:true, records });
}catch(e){ console.log(e); res.json({ success:false, records:[] }); }
});

// Admin-only: recalculate attendance for all students
app.post('/api/admin/recalculate-attendance', async (req, res) => {
  // Verify admin secret
  if (req.headers['x-admin-secret'] !== (process.env.ADMIN_API_SECRET || 'TEN_ADMIN_SECRET')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const students = await Student.find({});
    let updated = 0, skipped = 0, errors = 0;
    for (const student of students) {
      try {
        if (!student.joiningDate) { skipped++; continue; }
        const presentCount = await Attendance.countDocuments({ employeeId: student.employeeId, status: 'Present' });
        const stats = calcAttendancePercentage(student, presentCount);
        student.calculatedAttendancePercentage = stats.percentage;
        student.attendanceLastCalculated = new Date();
        await student.save();
        updated++;
      } catch(e) { errors++; }
    }
    res.json({ success: true, updated, skipped, errors });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- COORDINATOR: approve student for certificate consideration ----
app.post("/students/:id/coordinator-approve", async(req,res)=>{
try{
    const { coordinatorId, remarks } = req.body;
    const student = await Student.findById(req.params.id);
    if(!student) return res.json({ success:false, message:"Student not found" });

    student.certificateApprovedByCoordinator = true;
    student.approvedByCoordinatorId = coordinatorId || "coordinator";
    student.coordinatorApprovedAt = new Date();
    student.coordinatorRemarks = remarks || "";
    // Clear any prior HR rejection so the student re-enters HR's pending queue
    student.hrRejected = false;
    student.hrRejectionReason = "";
    student.milestones = student.milestones || {};
    if(!student.milestones.coordinatorApproved) student.milestones.coordinatorApproved = new Date();
    await student.save();

    // Notify the student
    const notif = new Notification({
        title:"Coordinator Approved You ✅",
        message:"Your coordinator has approved you for certificate consideration. Awaiting HR final review.",
        type:"success", from:"Coordinator",
        targetType:"student", targetEmployeeId:student.employeeId, targetDomain:student.domain
    });
    await notif.save();
    broadcastNotification(student.domain, student.employeeId, notif);

    res.json({ success:true, message:"Student approved and sent to HR for review" });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to approve" }); }
});

// ---- COORDINATOR: revoke a previously given approval ----
app.post("/students/:id/coordinator-revoke", async(req,res)=>{
try{
    const student = await Student.findById(req.params.id);
    if(!student) return res.json({ success:false, message:"Student not found" });

    const hadHRApproval = !!student.certificateApprovedByHR;

    student.certificateApprovedByCoordinator = false;
    student.coordinatorApprovedAt = null;
    student.coordinatorRemarks = "";
    // Revoking coordinator approval also removes any HR approval (chain broken)
    student.certificateApprovedByHR = false;
    student.hrApprovedAt = null;
    student.hrRemarks = "";
    await student.save();

    // This is the one approval transition that told nobody. It silently
    // withdraws HR's approval as well as the coordinator's, so both the
    // student and HR could be looking at a certificate status that no longer
    // holds. Its sibling coordinator-approve has always notified.
    try{
        const notif = new Notification({
            title: "Certificate approval revoked",
            message: hadHRApproval
                ? "Your coordinator withdrew their certificate approval, which also removed the HR approval. Please contact your coordinator."
                : "Your coordinator withdrew their certificate approval. Please contact your coordinator.",
            type: "warning", from: "Coordinator",
            targetType: "student", targetEmployeeId: student.employeeId, targetDomain: student.domain
        });
        await notif.save();
        broadcastNotification(student.domain, student.employeeId, notif);

        if(hadHRApproval){
            const hrNotif = new Notification({
                title: "Certificate approval chain broken",
                message: `Coordinator approval for ${student.name || student.employeeId} (${student.employeeId}) was revoked, so the HR approval was removed too.`,
                type: "warning", from: "Coordinator",
                targetType: "domain", targetDomain: student.domain
            });
            await hrNotif.save();
            broadcastNotification(student.domain, null, hrNotif);
        }
    }catch(notifyErr){ console.error("[coordinator-revoke] notify failed:", notifyErr.message); }

    res.json({ success:true, message:"Approval revoked" });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to revoke" }); }
});

// ---- HR: list students approved by coordinator & awaiting HR review ----
app.get("/students/coordinator-approved", async(req,res)=>{
try{
    if(!isHRSession(req)) return res.status(401).json({ success:false, message:"Unauthorized" });

    const students = await Student.find({
        certificateApprovedByCoordinator: true,
        certificateApprovedByHR: false
    }).sort({ coordinatorApprovedAt:-1 });

    const result = [];
    for(const s of students){
        const submissions = await Submission.find({ employeeId:s.employeeId }).sort({ submittedAt:-1 });
        const stats = await computeAttendanceStats(s.employeeId, s.joiningDate);
        result.push({
            _id:s._id, employeeId:s.employeeId,
            name:(s.name || ((s.firstName||"")+" "+(s.lastName||""))).trim(),
            domain:s.domain, joiningDate:s.joiningDate, tenure:s.tenure,
            collegeName: collegeDisplay(s), college: collegeDisplay(s),
            submissions: submissions.map(x => ({ task:x.task, status:x.status, submittedAt:x.submittedAt })),
            stats,
            approvedByCoordinatorId: s.approvedByCoordinatorId,
            coordinatorRemarks: s.coordinatorRemarks,
            coordinatorApprovedAt: s.coordinatorApprovedAt,
            hrRejected: s.hrRejected, hrRejectionReason: s.hrRejectionReason
        });
    }
    res.json({ success:true, students:result });
}catch(e){ console.log(e); res.json({ success:false, students:[] }); }
});

// ---- HR: final approval ----
app.post("/students/:id/hr-approve", async(req,res)=>{
try{
    if(!isHRSession(req)) return res.status(401).json({ success:false, message:"Unauthorized" });

    const { hrId, remarks } = req.body;
    const student = await Student.findById(req.params.id);
    if(!student) return res.json({ success:false, message:"Student not found" });
    if(!student.certificateApprovedByCoordinator)
        return res.json({ success:false, message:"Coordinator has not approved this student yet" });

    student.certificateApprovedByHR = true;
    student.approvedByHRId = hrId || "hr";
    student.hrApprovedAt = new Date();
    student.hrRemarks = remarks || "";
    student.hrRejected = false;
    student.hrRejectionReason = "";
    student.milestones = student.milestones || {};
    if(!student.milestones.hrApproved) student.milestones.hrApproved = new Date();
    await student.save();

    const notif = new Notification({
        title:"Certificate Approved 🎉",
        message:"HR has given final approval. Your certificates are now available.",
        type:"success", from:"HR",
        targetType:"student", targetEmployeeId:student.employeeId, targetDomain:student.domain
    });
    await notif.save();
    broadcastNotification(student.domain, student.employeeId, notif);

    res.json({ success:true, message:"Student fully approved for certificates" });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to approve" }); }
});

// ---- HR: reject (sends student back to coordinator with a reason) ----
app.post("/students/:id/hr-reject", async(req,res)=>{
try{
    if(!isHRSession(req)) return res.status(401).json({ success:false, message:"Unauthorized" });

    const { reason } = req.body;
    const student = await Student.findById(req.params.id);
    if(!student) return res.json({ success:false, message:"Student not found" });

    student.certificateApprovedByHR = false;
    student.hrApprovedAt = null;
    student.hrRejected = true;
    student.hrRejectionReason = reason || "No reason provided";
    // Send back to coordinator: clear coordinator approval so they must re-review
    student.certificateApprovedByCoordinator = false;
    await student.save();

    // Two gaps here: this notification was saved but never broadcast, so the
    // coordinator only saw it on a page reload; and it was addressed to "your
    // certificate review" while being targeted at the coordinator. The student
    // — whose approval was just withdrawn — was told nothing at all.
    try{
        const coordNotif = new Notification({
            title:"Certificate review returned by HR",
            message:`HR returned the certificate review for ${student.name || student.employeeId} (${student.employeeId}). Reason: ${student.hrRejectionReason}`,
            type:"warning", from:"HR",
            targetType:"coordinator-domain", targetDomain:student.domain
        });
        await coordNotif.save();
        broadcastNotification(student.domain, null, coordNotif);

        const studentNotif = new Notification({
            title:"Certificate review needs another look",
            message:`HR returned your certificate review to your coordinator. Reason: ${student.hrRejectionReason}`,
            type:"warning", from:"HR",
            targetType:"student", targetEmployeeId:student.employeeId, targetDomain:student.domain
        });
        await studentNotif.save();
        broadcastNotification(student.domain, student.employeeId, studentNotif);
    }catch(notifyErr){ console.error("[hr-reject] notify failed:", notifyErr.message); }

    res.json({ success:true, message:"Student rejected and returned to coordinator" });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to reject" }); }
});

// ---- HR: list fully approved (certificate-eligible) students ----
app.get("/students/hr-approved", async(req,res)=>{
try{
    if(!isHRSession(req)) return res.status(401).json({ success:false, message:"Unauthorized" });

    const students = await Student.find({ certificateApprovedByHR: true }).select('firstName lastName name domain collegeName college employeeId tenure joiningDate coordinatorRemarks hrRemarks hrApprovedAt').sort({ hrApprovedAt:-1 });
    const result = [];
    for(const s of students){
        const stats = await computeAttendanceStats(s.employeeId, s.joiningDate);
        result.push({
            _id:s._id, employeeId:s.employeeId,
            name:(s.name || ((s.firstName||"")+" "+(s.lastName||""))).trim(),
            domain:s.domain, joiningDate:s.joiningDate, tenure:s.tenure,
            collegeName: collegeDisplay(s), college: collegeDisplay(s),
            stats,
            coordinatorRemarks:s.coordinatorRemarks, hrRemarks:s.hrRemarks,
            hrApprovedAt:s.hrApprovedAt
        });
    }
    res.json({ success:true, students:result });
}catch(e){ console.log(e); res.json({ success:false, students:[] }); }
});

// ==================================================================
// =============== TASK SUBMISSION DELETION (BUG FIX 3) =============
// ==================================================================
// Owner-only delete; Pending submissions cannot be deleted (must be reviewed first).
app.delete("/submissions/:id", async(req,res)=>{
try{
    const id = req.params.id;
    // Body or query for the requesting student's employeeId (ownership check)
    const requesterEmployeeId =
        (req.body && req.body.employeeId) ||
        (req.query && req.query.employeeId) || "";

    if(!requesterEmployeeId){
        return res.status(400).json({ success:false, message:"employeeId required to verify ownership" });
    }
    const sub = await Submission.findById(id);
    if(!sub) return res.status(404).json({ success:false, message:"Submission not found" });
    if(sub.employeeId !== requesterEmployeeId){
        return res.status(403).json({ success:false, message:"You can only delete your own submissions" });
    }
    if(sub.status !== "Approved" && sub.status !== "Rejected"){
        return res.status(400).json({ success:false, message:"Only reviewed (Approved/Rejected) submissions can be deleted" });
    }

    // Best-effort cleanup of uploaded files (image/pdf) — never fails the request
    [sub.image, sub.pdf].forEach(p => {
        if(!p) return;
        try{
            const local = p.replace(/^\//, "");
            if(local && fs.existsSync(local)) fs.unlinkSync(local);
        }catch(_){}
    });

    await Submission.findByIdAndDelete(id);
    res.json({ success:true, message:"Submission deleted" });
}catch(e){
    console.log(e);
    res.status(500).json({ success:false, message:"Failed to delete submission" });
}
});

// ==================================================================
// =================== REAL-TIME CHAT (Socket.IO) ===================
// ==================================================================
// Rooms:
//   "domain_<DomainName>"  — students of that domain + the coordinator of that domain
//   "general"              — every authenticated user
//   "hr_coordinators"      — all HR + all coordinators
//   "hr_internal"          — HR only
// Identity is captured at the REST/Socket layer from the client's session
// (employeeId for students, username for coord/HR) and verified against DB or
// the HR_ACCOUNTS / COORDINATORS maps before any chat action is allowed.

/**
 * Every id a socket identity may appear as inside an existing room name.
 *
 * The canonical id is first; the rest exist because the same person has been
 * written into room names under more than one spelling over time. See
 * services/chatIdentity.js — the alias list is what keeps those conversations
 * reachable instead of silently orphaning them.
 */
/**
 * NOTE: `verifyChatIdentity(claim)` used to live here.
 *
 * It took a role plus an employee ID or username from the client and looked
 * them up — which is not authentication, it is a directory search. A socket or
 * a request could name anybody and be treated as them. Every caller now reads
 * the session instead: chatIdentityFromSocket() below for sockets, and
 * chatIdentityFromSession(req) for the REST endpoints.
 */

/**
 * Who is on the other end of this socket — from the session cookie.
 *
 * This replaced `verifyChatIdentity`, which read `socket.handshake.auth` and
 * merely LOOKED UP whatever the caller claimed. Two things were wrong with it:
 *
 *   - It was not authentication. A socket opened with
 *     `auth: {role:"student", employeeId:"TEN/AI/1663"}` was accepted as that
 *     student, with no password and no session. Employee IDs are sequential
 *     and printed on offer letters and certificates.
 *
 *   - It refused everyone who did NOT send a claim, and public/messages.html
 *     connects with `io({ withCredentials: true })` and no claim at all. So the
 *     socket never connected on that page: history loaded over REST and every
 *     attempt to send died with "Your message did not send. Check your
 *     connection and try again." — which was not a connection problem, and no
 *     amount of retrying would ever have fixed it.
 *
 * The session cookie already rides the handshake, so it is both the honest
 * answer and the one that works everywhere.
 *
 * The domain is refreshed from the record because it decides which domain room
 * this person is auto-joined to: the session captured it at sign-in, and a
 * student moved to a different domain since then would otherwise stay
 * subscribed to the room they left.
 */
function chatIdentityFromSocket(socket){
    return new Promise((resolve) => {
        try{
            const req = socket.request;
            if(!req || !req.headers || !req.headers.cookie) return resolve(null);
            sessionMiddleware(req, {}, async () => {
                const identity = chatIdentity.identityFromSession(req.session);
                if(!identity) return resolve(null);
                try{
                    if(identity.role === "student"){
                        const s = await Student.findOne({ employeeId: identity.id })
                            .select("domain name firstName lastName").lean();
                        if(s){
                            identity.domain = s.domain || identity.domain;
                            identity.name = identity.name ||
                                (s.name || ((s.firstName||"") + " " + (s.lastName||""))).trim() || identity.id;
                        }
                    } else if(identity.role === "coordinator"){
                        const c = await Coordinator.findOne({
                            $or: [{ email: identity.id }, { username: identity.id }]
                        }).select("domain name").lean();
                        if(c){
                            identity.domain = c.domain || identity.domain;
                            identity.name = identity.name || c.name || identity.id;
                        }
                    }
                }catch(_){ /* the session's own copy is good enough */ }
                resolve(identity);
            });
        }catch(_){ resolve(null); }
    });
}

// Private-conversation naming and membership now live in one module shared
// with routes/chatModeration.js and the socket layer. They used to be defined
// separately in each, with different rules for what a staff member's id is,
// which is what made an admin's click bounce to the login page and an HR user
// see "Forbidden" on a conversation their own inbox had just listed.
const chatIdentity = require("./services/chatIdentity");
const dmRoomFor      = chatIdentity.dmRoomFor;
const dmParticipants = chatIdentity.dmParticipants;

function roomsAllowedFor(identity){
    const rooms = ["general", "doubts", "feedback_support"];
    if(identity.role === "student"){
        if(identity.domain) rooms.push("domain_" + identity.domain);
    } else if(identity.role === "coordinator"){
        if(identity.domain) rooms.push("domain_" + identity.domain);
        rooms.push("hr_coordinators");
    } else if(identity.role === "hr"){
        rooms.push("hr_coordinators");
        rooms.push("hr_internal");
    } else if(identity.role === "admin"){
        // Admin oversight: every shared room. DMs are handled in
        // canAccessRoom — an admin can open any conversation, but is not
        // auto-joined to all of them, which would be thousands of rooms.
        rooms.push("hr_coordinators", "hr_internal");
    }
    return rooms;
}
function canAccessRoom(identity, room){
    if(!room) return false;
    if(roomsAllowedFor(identity).indexOf(room) !== -1) return true;
    // domain_* rooms only allowed if the suffix matches the user's domain —
    // except for an admin, whose whole purpose here is oversight.
    if(room.indexOf("domain_") === 0){
        if(identity.role === "admin") return true;
        return !!(identity.domain && room === "domain_" + identity.domain);
    }
    // A private conversation is readable by its two participants, and by an
    // admin — which is the point of admin oversight, and is why the portals
    // tell users that staff can review reported conversations.
    //
    // Membership is checked against every id this person is known by, not just
    // the canonical one. A conversation an HR user started from the inbox is
    // named with their email; one started from the chat widget carries their
    // username. Matching only the canonical id locked people out of their own
    // conversations — that is the "Forbidden" people were seeing.
    const pair = dmParticipants(room);
    if(pair){
        if(identity.role === "admin") return true;
        return chatIdentity.isParticipant(identity, room);
    }
    return false;
}
function canDeleteIn(identity, room){
    // Per spec: coordinator (in their domain chat); coordinator+HR (general/staff); HR (hr_internal).
    if(!canAccessRoom(identity, room)) return false;
    if(identity.role === "admin") return true;
    // Either participant may delete inside their own private conversation.
    if(dmParticipants(room)) return true;
    if(identity.role === "student") return false;
    return true;
}

/**
 * Chat identity from the SESSION.
 *
 * The REST and upload endpoints used to take `role` + `employeeId`/`username`
 * from the query string, so anyone who knew an employee ID could read that
 * student's domain room. Sockets read the same session via
 * chatIdentityFromSocket(); this covers the HTTP surface.
 *
 * This delegates to services/chatIdentity so it cannot drift from the inbox
 * again. Its own version had no admin branch, so every admin who clicked a
 * conversation got a 401 and was thrown out to the login page, and it
 * preferred an HR username where the inbox preferred their email, so the two
 * built different room names for the same pair of people.
 */
function chatIdentityFromSession(req) {
    return chatIdentity.identityFromSession(req.session);
}

// REST: load last 50 messages for a room (after permission check)
app.get("/chat/messages/:room", async(req,res)=>{
try{
    const room = decodeURIComponent(req.params.room);
    const identity = chatIdentityFromSession(req);
    if(!identity) return res.status(401).json({ success:false, message:"Unauthorized" });
    if(!canAccessRoom(identity, room)) return res.status(403).json({ success:false, message:"Forbidden" });

    const messages = await Message.find({ chatRoom: room }).sort({ timestamp: -1 }).limit(50);
    messages.reverse();   // chronological for the UI
    res.json({ success:true, messages });
}catch(e){ console.log(e); res.status(500).json({ success:false, messages:[] }); }
});

// ── Chat image upload ───────────────────────────────────────────────────────
// Uses an extension + mimetype whitelist and a size cap, following the pattern
// in routes/v2/documents.js rather than the generic `upload` instance, which
// has no fileFilter and accepts any content type.
const chatUploadDir = path.join(__dirname, "uploads", "chat");
try { fs.mkdirSync(chatUploadDir, { recursive: true }); } catch (_) {}

const CHAT_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const CHAT_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const chatImageUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, chatUploadDir),
        filename: (_req, file, cb) => {
            // Never trust the client filename for the path on disk.
            const ext = path.extname(file.originalname || "").toLowerCase();
            const safeExt = CHAT_IMAGE_EXTENSIONS.includes(ext) ? ext : ".img";
            cb(null, "chat-" + Date.now() + "-" + crypto.randomBytes(6).toString("hex") + safeExt);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        if (!CHAT_IMAGE_EXTENSIONS.includes(ext) || !CHAT_IMAGE_MIMES.includes(file.mimetype)) {
            return cb(new Error("Only JPG, PNG, GIF and WebP images can be sent in chat."));
        }
        cb(null, true);
    }
});

app.post("/chat/upload-image", (req, res) => {
    const identity = chatIdentityFromSession(req);
    if (!identity) return res.status(401).json({ success: false, message: "Please sign in to send an image." });

    chatImageUpload.single("image")(req, res, (err) => {
        if (err) {
            const tooBig = err.code === "LIMIT_FILE_SIZE";
            return res.status(tooBig ? 413 : 400).json({
                success: false,
                message: tooBig ? "That image is larger than 5MB." : (err.message || "Could not upload that image.")
            });
        }
        if (!req.file) return res.status(400).json({ success: false, message: "No image was received." });

        res.json({
            success: true,
            imageUrl: "/uploads/chat/" + req.file.filename,
            imageName: (req.file.originalname || "image").slice(0, 120),
            imageMime: req.file.mimetype
        });
    });
});

/**
 * POST /chat/messages — send a message without a socket.
 *
 * The Socket.IO event is still the primary path, because it is what makes the
 * message appear instantly for everyone in the room. This exists because a
 * socket is not always available:
 *
 *   - college and office networks block WebSockets and long-polling upgrades;
 *   - a proxy times the connection out and the client has not reconnected yet;
 *   - the session expired, so the handshake is refused.
 *
 * Without it, every one of those looked identical to the person typing: "Your
 * message did not send. Check your connection and try again." — advice that
 * could not help, on a message that would never send however many times they
 * tried.
 *
 * Identity comes from the session, exactly as it does on the socket, and the
 * work is the same function, so a message sent this way is delivered to
 * everyone in the room and raises the same notifications.
 */
app.post("/chat/messages", async (req, res) => {
    try {
        const identity = chatIdentityFromSession(req);
        if (!identity) return res.status(401).json({ success: false, message: "Please sign in to continue." });

        const result = await deliverChatMessage(identity, req.body || {});
        if (!result.success) {
            const status = result.code === "forbidden" ? 403
                         : result.code === "blocked" ? 403
                         : result.code === "server_error" ? 500 : 400;
            return res.status(status).json(result);
        }
        res.json(result);
    } catch (e) {
        console.log("POST /chat/messages error:", e.message);
        res.status(500).json({ success: false, message: "The message could not be sent. Please try again." });
    }
});

// REST fallback for delete (Socket.IO event is the primary path)
app.delete("/chat/messages/:messageId", async(req,res)=>{
try{
    // From the session. Taking role/employeeId from the body or query meant
    // anyone could delete anyone's message by naming a coordinator.
    const identity = chatIdentityFromSession(req);
    if(!identity) return res.status(401).json({ success:false, message:"Unauthorized" });
    const msg = await Message.findById(req.params.messageId);
    if(!msg) return res.status(404).json({ success:false, message:"Message not found" });
    if(!canDeleteIn(identity, msg.chatRoom)) return res.status(403).json({ success:false, message:"Forbidden" });
    await Message.findByIdAndDelete(msg._id);
    if(io){ io.to(msg.chatRoom).emit("message_deleted", { messageId: String(msg._id), room: msg.chatRoom }); }
    res.json({ success:true });
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// ================= PERFORMANCE CALCULATION ========================
// ==================================================================
// Requirement 6: weighted out of 100. Reusable from anywhere.
//   Factor 1 — Attendance (max 30): combinedAttendance% * 0.30
//   Factor 2 — Task Completion (max 35): approved/totalSubmitted * 35
//   Factor 3 — Task Quality (max 25): approved/max(totalSubmitted,1) * 25
//   Factor 4 — Consistency (max 10): activeWeeks/totalWeeks * 10

function gradeForScore(score){
    if(score >= 90) return "Outstanding ⭐";
    if(score >= 75) return "Excellent 🟢";
    if(score >= 60) return "Good 🔵";
    if(score >= 45) return "Average 🟡";
    return "Needs Improvement 🔴";
}

async function calculatePerformance(studentRefOrId){
    // Resolve a student doc whether passed an ObjectId, an employeeId or a doc.
    let student = null;
    if(!studentRefOrId) return null;
    if(typeof studentRefOrId === "string"){
        student = await Student.findOne({ employeeId: studentRefOrId })
                || (mongoose.isValidObjectId(studentRefOrId) ? await Student.findById(studentRefOrId) : null);
    } else if(studentRefOrId.employeeId){
        student = studentRefOrId;
    } else if(studentRefOrId._id){
        student = await Student.findById(studentRefOrId._id);
    }
    if(!student) return null;

    const stats = (await calculateAttendanceStats(student.employeeId)) || { combinedPct: 0 };
    
    // Legacy submissions
    const legacySubmissions = await Submission.find({ employeeId: student.employeeId });
    const legacySubmitted = legacySubmissions.length;
    const legacyApproved = legacySubmissions.filter(s => s.status === "Approved").length;

    // V2 Task Progress
    const StudentTaskProgress = mongoose.model("StudentTaskProgress");
    const v2Progress = await StudentTaskProgress.find({ studentId: student._id });
    const v2Submitted = v2Progress.filter(p => ["submitted", "approved", "rejected"].includes(p.status)).length;
    const v2Approved = v2Progress.filter(p => p.status === "approved").length;

    // Combined task counts
    const totalSubmitted = legacySubmitted + v2Submitted;
    const approved = legacyApproved + v2Approved;

    // Factor 1 — Attendance (30%)
    const attendanceScore = (Math.min(100, stats.combinedPct || 0) / 100) * 30;

    // Factor 2 — Task completion rate (35%)
    const taskScore = totalSubmitted > 0 ? (approved / totalSubmitted) * 35 : 0;

    // Factor 3 — Quality score (25%)
    const qualityScore = (approved / Math.max(totalSubmitted, 1)) * 25;

    // Factor 4 — Consistency: active weeks vs total weeks since joining (10%)
    let consistencyScore = 0;
    const jd = parseJoinDate(student.joiningDate);
    const records = await Attendance.find({ employeeId: student.employeeId });

    if(jd){
        const today = new Date(); today.setHours(0,0,0,0);
        const j = new Date(jd); j.setHours(0,0,0,0);
        const ms = today - j;
        const totalWeeks = Math.max(1, Math.ceil(ms / (7 * 24 * 3600 * 1000)) || 1);
        const activeWeeks = new Set();
        records.forEach(r => {
            const d = new Date(r.date);
            const days = Math.floor((d - j) / (24 * 3600 * 1000));
            if(days >= 0) activeWeeks.add(Math.floor(days / 7));
        });
        consistencyScore = (Math.min(activeWeeks.size, totalWeeks) / totalWeeks) * 10;
    }

    // Calculate Streaks
    const presentDates = new Set();
    records.forEach(r => {
        if (r && r.status === "Present") {
            const key = r.dateKey || (r.date ? new Date(r.date).toISOString().split("T")[0] : null);
            if (key) presentDates.add(key);
        }
    });

    let currentStreak = 0;
    let bestStreak = 0;
    
    if (presentDates.size > 0) {
        const sortedDates = Array.from(presentDates).sort();
        let runningStreak = 0;
        let prevDate = null;

        for (const dateStr of sortedDates) {
            if (!prevDate) {
                runningStreak = 1;
            } else {
                const curr = new Date(dateStr);
                const prev = new Date(prevDate);
                const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
                if (diffDays === 1 || (diffDays === 2 && prev.getDay() === 6)) {
                    runningStreak++;
                } else {
                    runningStreak = 1;
                }
            }
            if (runningStreak > bestStreak) bestStreak = runningStreak;
            prevDate = dateStr;
        }

        let checkDate = new Date();
        if (checkDate.getDay() === 0) checkDate.setDate(checkDate.getDate() - 1);
        let dateKey = checkDate.toISOString().split("T")[0];

        if (!presentDates.has(dateKey)) {
            checkDate.setDate(checkDate.getDate() - 1);
            if (checkDate.getDay() === 0) checkDate.setDate(checkDate.getDate() - 1);
            dateKey = checkDate.toISOString().split("T")[0];
        }

        while (presentDates.has(dateKey)) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
            if (checkDate.getDay() === 0) checkDate.setDate(checkDate.getDate() - 1);
            dateKey = checkDate.toISOString().split("T")[0];
        }
    }

    const total = attendanceScore + taskScore + qualityScore + consistencyScore;
    const score = Math.round(total * 10) / 10;

    return {
        score,
        grade: gradeForScore(score),
        currentStreak,
        bestStreak: Math.max(bestStreak, currentStreak),
        breakdown: {
            attendance:  Math.round(attendanceScore  * 10) / 10,
            task:        Math.round(taskScore        * 10) / 10,
            quality:     Math.round(qualityScore     * 10) / 10,
            consistency: Math.round(consistencyScore * 10) / 10,
            combinedAttendancePct: stats.combinedPct,
            approved, 
            totalSubmitted,
            legacySubmitted,
            v2Submitted
        }
    };
}

// ---- GET performance for a student ----
app.get("/students/:id/performance", async(req,res)=>{
try{
    const id = req.params.id;
    let student = null;
    if(mongoose.isValidObjectId(id)) student = await Student.findById(id);
    if(!student) student = await Student.findOne({ employeeId: id });
    if(!student) return res.status(404).json({ success:false, message:"Student not found" });
    const perf = await calculatePerformance(student);
    res.json({ success:true, performance: perf });
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// =================== PROMOTION FLOW ===============================
// ==================================================================
// Requirement 1+2+3: HR promotes a student/coordinator, the promoted user
// receives an email with a 12-char temporary password, and completes
// registration at /promoted-register.html within 48 hours.

function generateSecureTempPassword(){
    // 12 chars: uppercase, lowercase, digits, symbols. No ambiguous chars.
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnpqrstuvwxyz";
    const digit = "23456789";
    const sym   = "!@#$%^&*-_=+";
    const all   = upper + lower + digit + sym;
    const buf   = crypto.randomBytes(12);
    // Guarantee each class appears at least once
    const must = [
        upper[buf[0] % upper.length],
        lower[buf[1] % lower.length],
        digit[buf[2] % digit.length],
        sym[buf[3] % sym.length]
    ];
    const rest = [];
    for(let i = 4; i < 12; i++) rest.push(all[buf[i] % all.length]);
    // Shuffle deterministically using the same buffer
    const out = must.concat(rest);
    for(let i = out.length - 1; i > 0; i--){
        const j = buf[i] % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join("");
}

function promotionEmailHtml({ name, fromRoleLabel, toRoleLabel, employeeId, domain, email, tempPassword, loginUrl, dateStr }){
    const safe = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    return `<!doctype html><html><body style="margin:0;background:#0c1220;font-family:Segoe UI,Arial,sans-serif;color:#f0eee8;">
<table width="100%" cellspacing="0" cellpadding="0" style="background:#0c1220;padding:32px 0;"><tr><td align="center">
  <table width="600" cellspacing="0" cellpadding="0" style="background:#0e1628;border:1px solid rgba(245,197,66,0.18);border-radius:18px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#1a1208,#3a2a08);padding:28px 32px;text-align:center;">
      <div style="font-size:13px;letter-spacing:6px;color:#f5c542;font-weight:700;">THE ENTREPRENEURSHIP NETWORK</div>
      <div style="font-size:24px;color:#fff7d6;font-weight:800;margin-top:8px;">🎉 Congratulations, ${safe(name)}!</div>
    </td></tr>
    <tr><td style="padding:28px 34px;">
      <p style="font-size:15px;line-height:1.55;margin:0 0 16px;">Dear <b>${safe(name)}</b>,</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
        We are thrilled to inform you that you have been officially promoted from
        <b>${safe(fromRoleLabel)}</b> to <b style="color:#f5c542;">${safe(toRoleLabel)}</b>
        at The Entrepreneurship Network, effective <b>${safe(dateStr)}</b>.
      </p>
      <table width="100%" cellspacing="0" cellpadding="0" style="background:#0c1220;border:1px solid rgba(245,197,66,0.15);border-radius:12px;margin:18px 0;">
        <tr><td style="padding:18px 22px;">
          <div style="color:#f5c542;font-size:11px;letter-spacing:2px;font-weight:700;">YOUR DETAILS</div>
          <div style="margin-top:10px;font-size:14px;line-height:1.85;">
            <b>Name:</b> ${safe(name)}<br>
            <b>Employee ID:</b> <span style="color:#f5c542;">${safe(employeeId)}</span><br>
            <b>New Role:</b> ${safe(toRoleLabel)}<br>
            <b>Domain:</b> ${safe(domain || "—")}<br>
            <b>Promoted On:</b> ${safe(dateStr)}
          </div>
        </td></tr>
      </table>
      <table width="100%" cellspacing="0" cellpadding="0" style="background:rgba(245,197,66,0.06);border:1px dashed rgba(245,197,66,0.35);border-radius:12px;">
        <tr><td style="padding:18px 22px;">
          <div style="color:#f5c542;font-size:11px;letter-spacing:2px;font-weight:700;">YOUR NEW PORTAL ACCESS CREDENTIALS</div>
          <div style="margin-top:10px;font-size:14px;line-height:1.85;">
            <b>Email:</b> ${safe(email)}<br>
            <b>Temporary Password:</b> <code style="background:#0c1220;padding:3px 8px;border-radius:6px;color:#f5c542;font-family:Consolas,monospace;letter-spacing:1px;">${safe(tempPassword)}</code><br>
            <b>Login URL:</b> <a href="${safe(loginUrl)}" style="color:#f5c542;">${safe(loginUrl)}</a>
          </div>
          <p style="margin:14px 0 0;font-size:12px;color:#cdb24a;">
            ⚠️ Please complete your registration using these credentials within <b>48 hours</b>.
            This password expires after first use.
          </p>
        </td></tr>
      </table>
      <p style="font-size:14px;line-height:1.7;margin:20px 0 8px;">
        <b>Steps to activate your account:</b>
      </p>
      <ol style="font-size:14px;line-height:1.7;color:#cdd9ec;margin:0 0 16px 22px;padding:0;">
        <li>Visit the registration portal link above.</li>
        <li>Enter your email and temporary password.</li>
        <li>Set your new permanent password.</li>
        <li>Access your new <b>${safe(toRoleLabel)}</b> dashboard.</li>
      </ol>
      <p style="font-size:14px;margin:24px 0 4px;">Warm regards,</p>
      <p style="font-size:14px;margin:0;"><b>HR Team</b><br/>The Entrepreneurship Network<br/>
        <a href="mailto:ten.hr.contact@gmail.com" style="color:#f5c542;">ten.hr.contact@gmail.com</a>
      </p>
    </td></tr>
    <tr><td style="background:#080d1a;padding:14px 22px;text-align:center;font-size:11px;color:#6a6255;letter-spacing:1px;">
      © The Entrepreneurship Network · Limitless Technologies LLP
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

async function sendPromotionEmail({ to, name, fromRoleLabel, toRoleLabel, employeeId, domain, tempPassword, host }){
    const dateStr = new Date().toLocaleDateString("en-IN", { day:"numeric", month:"long", year:"numeric" });
    const loginUrl = (host ? host.replace(/\/$/, "") : "") + "/promoted-register.html";
    const html = promotionEmailHtml({ name, fromRoleLabel, toRoleLabel, employeeId, domain, email: to, tempPassword, loginUrl, dateStr });
    const subject = "🎉 Congratulations! You've been promoted at The Entrepreneurship Network";
    try {
        await transporter.sendMail({
            from: "TEN HR <ten.internshipportal@gmail.com>",
            to, subject, html,
            text: `Hello ${name}, you have been promoted to ${toRoleLabel}. Temporary password: ${tempPassword}. Complete registration at ${loginUrl} within 48 hours.`
        });
        try {
            await MailHistory.create({
                recipientEmail: to,
                recipientName: name,
                studentId: null,
                subject,
                mailType: "promotion",
                sentAt: new Date(),
                status: "sent"
            });
        } catch (_) {}
        await Notification.notifyStudent({ employeeId, domain }, {
            title: "🎉 You've been promoted!",
            message: `Congratulations ${name}! You have been promoted from ${fromRoleLabel} to ${toRoleLabel}. Check your email for the registration link (valid 48 hours).`,
            type: "success"
        });
        return { ok: true };
    } catch(e){
        console.log("Promotion email failed:", e.message);
        try {
            await MailHistory.create({
                recipientEmail: to,
                recipientName: name,
                studentId: null,
                subject,
                mailType: "promotion",
                sentAt: new Date(),
                status: "failed",
                errorMessage: e && e.message ? String(e.message) : ""
            });
        } catch (_) {}
        return { ok: false, error: e.message };
    }
}

function isHRAuth(req){
    const auth = req.headers.authorization;
    return auth && auth.indexOf("Bearer hr_") === 0;
}

// ---- HR: promote student -> coordinator ----
app.post("/hr/promote/to-coordinator", async(req,res)=>{
try{
    if(!isHRAuth(req)) return res.status(401).json({ success:false, message:"Unauthorized" });
    const { studentId, employeeId, promotedByHRId } = req.body || {};
    let student = null;
    if(studentId && mongoose.isValidObjectId(studentId)) student = await Student.findById(studentId);
    if(!student && employeeId) student = await Student.findOne({ employeeId });
    if(!student) return res.json({ success:false, message:"Student not found" });
    if(!student.email) return res.json({ success:false, message:"Student has no email on file — cannot promote" });

    // Block if a non-completed promotion already exists for this email
    const open = await Promotion.findOne({ email: student.email.toLowerCase(), registrationCompleted: false });
    if(open && open.tempPasswordExpiresAt > new Date()){
        return res.json({ success:false, message:"An active promotion is already pending for this user. Please wait for them to complete it or for it to expire." });
    }

    const tempPassword = generateSecureTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
    const fullName = (student.name || `${student.firstName||""} ${student.lastName||""}`).trim();

    const record = await Promotion.create({
        userId: student._id,
        employeeId: student.employeeId,
        name: fullName,
        email: student.email.toLowerCase(),
        fromRole: "student",
        toRole: "coordinator",
        hashedTempPassword: hashed,
        promotedAt: new Date(),
        promotedByHRId: promotedByHRId || "",
        registrationCompleted: false,
        domain: student.domain || "",
        tempPasswordExpiresAt: expiresAt
    });

    const host = (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host");
    const mail = await sendPromotionEmail({
        to: student.email, name: fullName, fromRoleLabel: "Intern", toRoleLabel: "Coordinator",
        employeeId: student.employeeId, domain: student.domain, tempPassword, host
    });

    res.json({ success:true, message:`Promotion email sent to ${student.email}`, emailSent: !!mail.ok, promotion:{ _id: record._id } });
}catch(e){ console.log(e); res.status(500).json({ success:false, message:"Failed to promote" }); }
});

// ---- HR: promote coordinator -> HR ----
app.post("/hr/promote/to-hr", async(req,res)=>{
try{
    if(!isHRAuth(req)) return res.status(401).json({ success:false, message:"Unauthorized" });
    const { coordinatorUsername, coordinatorDbId, email, name, domain, employeeId, promotedByHRId } = req.body || {};
    // Resolve effective email (legacy hardcoded coordinators have no email; UI must provide one)
    let resolvedEmail = (email || "").trim().toLowerCase();
    let resolvedName = name || "";
    let resolvedDomain = domain || "";
    let resolvedEmpId = employeeId || "";

    // 1) If a DB-backed coordinator id was provided (from the new /hr/coordinators
    //    endpoint), prefer that — gives us the most reliable identity.
    if(coordinatorDbId && mongoose.isValidObjectId(coordinatorDbId)){
        const dbC = await Coordinator.findById(coordinatorDbId);
        if(dbC){
            resolvedEmail = resolvedEmail || (dbC.email || "");
            resolvedName  = resolvedName || dbC.name;
            resolvedDomain= resolvedDomain || dbC.domain;
            resolvedEmpId = resolvedEmpId || (dbC.employeeId || "");
        }
    }
    // 2) Fallback: legacy hardcoded username, or DB lookup by username/email
    if(coordinatorUsername){
        const legacy = COORDINATORS[coordinatorUsername];
        if(legacy){ resolvedDomain = resolvedDomain || legacy.domain; resolvedName = resolvedName || coordinatorUsername; }
        const dbC = await Coordinator.findOne({ $or:[{ username: coordinatorUsername }, { email: coordinatorUsername.toLowerCase() }] });
        if(dbC){
            resolvedEmail = resolvedEmail || (dbC.email || "");
            resolvedName  = resolvedName || dbC.name;
            resolvedDomain= resolvedDomain || dbC.domain;
            resolvedEmpId = resolvedEmpId || (dbC.employeeId || "");
        }
    }
    if(!resolvedEmail) return res.json({ success:false, message:"Coordinator email is required to send the promotion notification" });
    if(!resolvedName)  resolvedName = coordinatorUsername || resolvedEmail;

    const open = await Promotion.findOne({ email: resolvedEmail, registrationCompleted: false });
    if(open && open.tempPasswordExpiresAt > new Date()){
        return res.json({ success:false, message:"An active promotion is already pending for this user." });
    }

    const tempPassword = generateSecureTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);

    const record = await Promotion.create({
        employeeId: resolvedEmpId || coordinatorUsername || resolvedEmail,
        name: resolvedName,
        email: resolvedEmail,
        fromRole: "coordinator",
        toRole: "hr",
        hashedTempPassword: hashed,
        promotedAt: new Date(),
        promotedByHRId: promotedByHRId || "",
        registrationCompleted: false,
        domain: resolvedDomain,
        tempPasswordExpiresAt: expiresAt
    });

    const host = (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host");
    const mail = await sendPromotionEmail({
        to: resolvedEmail, name: resolvedName, fromRoleLabel: "Coordinator", toRoleLabel: "HR Member",
        employeeId: resolvedEmpId || coordinatorUsername || "—", domain: resolvedDomain, tempPassword, host
    });

    res.json({ success:true, message:`Promotion email sent to ${resolvedEmail}`, emailSent: !!mail.ok, promotion:{ _id: record._id } });
}catch(e){ console.log(e); res.status(500).json({ success:false, message:"Failed to promote" }); }
});

// ---- HR: list promotions ----
app.get("/hr/promotions", async(req,res)=>{
try{
    if(!isHRAuth(req)) return res.status(401).json({ success:false, message:"Unauthorized" });
    const list = await Promotion.find().sort({ promotedAt:-1 }).limit(200);
    // Hide hashed passwords
    res.json({ success:true, promotions: list.map(p => ({
        _id:p._id, employeeId:p.employeeId, name:p.name, email:p.email,
        fromRole:p.fromRole, toRole:p.toRole, promotedAt:p.promotedAt,
        registrationCompleted:p.registrationCompleted, completedAt:p.completedAt,
        domain:p.domain, tempPasswordExpiresAt:p.tempPasswordExpiresAt,
        promotedByHRId:p.promotedByHRId
    })) });
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ---- Promoted user: verify temp credentials ----
app.post("/promoted/verify", async(req,res)=>{
try{
    const { email, tempPassword } = req.body || {};
    if(!email || !tempPassword) return res.json({ valid:false, message:"Email and temporary password required" });
    const rec = await Promotion.findOne({ email: email.toLowerCase(), registrationCompleted: false });
    if(!rec) return res.json({ valid:false, message:"No active promotion found for this email" });
    if(!rec.hashedTempPassword) return res.json({ valid:false, message:"This promotion link has been used already" });
    if(rec.tempPasswordExpiresAt < new Date()) return res.json({ valid:false, message:"This temporary password has expired" });
    const ok = await bcrypt.compare(tempPassword, rec.hashedTempPassword);
    if(!ok) return res.json({ valid:false, message:"Invalid temporary password" });
    res.json({ valid:true, name:rec.name, employeeId:rec.employeeId, newRole:rec.toRole, domain:rec.domain });
}catch(e){ console.log(e); res.status(500).json({ valid:false, message:"Server error" }); }
});

// ---- Promoted user: complete registration ----
app.post("/promoted/register", async(req,res)=>{
try{
    const { email, tempPassword, newPassword } = req.body || {};
    if(!email || !tempPassword || !newPassword) return res.json({ success:false, message:"All fields required" });
    if(String(newPassword).length < 8) return res.json({ success:false, message:"New password must be at least 8 characters" });

    const rec = await Promotion.findOne({ email: email.toLowerCase(), registrationCompleted: false });
    if(!rec) return res.json({ success:false, message:"No active promotion found" });
    if(!rec.hashedTempPassword) return res.json({ success:false, message:"This promotion link has been used already" });
    if(rec.tempPasswordExpiresAt < new Date()) return res.json({ success:false, message:"This temporary password has expired" });
    const ok = await bcrypt.compare(tempPassword, rec.hashedTempPassword);
    if(!ok) return res.json({ success:false, message:"Invalid temporary password" });

    const hashedNew = await bcrypt.hash(newPassword, 10);
    let redirect = "/index.html";

    if(rec.toRole === "coordinator"){
        // Upsert coordinator account
        const existing = await Coordinator.findOne({ email: rec.email });
        if(existing){
            existing.password = hashedNew; existing.name = rec.name; existing.domain = rec.domain || existing.domain;
            existing.employeeId = rec.employeeId; existing.promotedFrom = rec.fromRole;
            await existing.save();
        } else {
            await Coordinator.create({
                username: rec.email, email: rec.email, password: hashedNew,
                name: rec.name, domain: rec.domain || "", employeeId: rec.employeeId,
                promotedFrom: rec.fromRole
            });
        }
        redirect = "/coordinator-login.html";
    } else if(rec.toRole === "hr"){
        const existing = await HR.findOne({ email: rec.email });
        if(existing){
            existing.password = hashedNew; existing.name = rec.name;
            existing.employeeId = rec.employeeId; existing.promotedFrom = rec.fromRole;
            await existing.save();
        } else {
            await HR.create({
                username: rec.email, email: rec.email, password: hashedNew,
                name: rec.name, employeeId: rec.employeeId, promotedFrom: rec.fromRole
            });
        }
        redirect = "/hr-login";
    }

    rec.registrationCompleted = true;
    rec.completedAt = new Date();
    rec.hashedTempPassword = null;   // invalidate
    await rec.save();

    res.json({ success:true, message:"Registration complete! Welcome to your new role.", redirect, role:rec.toRole });
}catch(e){ console.log(e); res.status(500).json({ success:false, message:"Server error" }); }
});

// ==================================================================
// =========== STREAK + MILESTONES + BADGES + LEADERBOARD ===========
// ==================================================================

// Catalog of badges. Each entry is { id, name, icon, description, requirement }
// where `requirement` is rendered in the UI under the locked badge tile.
const BADGE_CATALOG = [
    { id:"first_step",         name:"First Step",            icon:"👣", description:"Mark your first ever attendance",        requirement:"Mark attendance once" },
    { id:"week_warrior",       name:"Week Warrior",          icon:"⚡", description:"7 consecutive days of attendance",        requirement:"7-day streak" },
    { id:"consistent",         name:"Consistent",            icon:"🎯", description:"30 days total attendance marked",         requirement:"30 days marked" },
    { id:"attendance_champion",name:"Attendance Champion",   icon:"🏆", description:"Above 90% combined attendance",           requirement:"≥ 90% attendance" },
    { id:"first_task",         name:"First Task",            icon:"✅", description:"Submit your first task",                  requirement:"1 submission" },
    { id:"quick_learner",      name:"Quick Learner",         icon:"📚", description:"5 tasks approved",                        requirement:"5 approvals" },
    { id:"task_master",        name:"Task Master",           icon:"💪", description:"10 tasks approved",                       requirement:"10 approvals" },
    { id:"perfectionist",      name:"Perfectionist",         icon:"⭐", description:"5 approved with no rejections",           requirement:"5 approved, 0 rejected" },
    { id:"rising_star",        name:"Rising Star",           icon:"🌟", description:"Performance score above 75",              requirement:"Score ≥ 75" },
    { id:"outstanding",        name:"Outstanding",           icon:"🏅", description:"Performance score above 90",              requirement:"Score ≥ 90" },
    { id:"top_performer",      name:"Top Performer",         icon:"👑", description:"Rank 1 in your domain leaderboard",       requirement:"Domain rank #1" },
    { id:"day_one",            name:"Day 1",                 icon:"🎉", description:"Complete your first day",                 requirement:"Mark attendance & submit task on day 1" },
    { id:"halfway_there",      name:"Halfway There",         icon:"🎯", description:"Complete 50% of your internship",         requirement:"50% of tenure elapsed" },
    { id:"graduate",           name:"Graduate",              icon:"🎓", description:"Complete your full internship tenure",    requirement:"100% of tenure elapsed" }
];
const BADGE_CATALOG_BY_ID = Object.fromEntries(BADGE_CATALOG.map(b => [b.id, b]));
// Major badges trigger a notification (and could be email-extended later).
const MAJOR_BADGE_IDS = new Set(["outstanding","top_performer","graduate","attendance_champion"]);

async function awardBadgeIfNew(student, badgeId){
    const def = BADGE_CATALOG_BY_ID[badgeId];
    if(!def || !student) return null;
    try{
        const award = await BadgeAward.create({
            studentId: student._id,
            employeeId: student.employeeId,
            badgeId: def.id,
            badgeName: def.name,
            badgeIcon: def.icon,
            awardedAt: new Date()
        });
        // In-app notification — uses the existing Notification system the student
        // dashboard already polls, so the popup surfaces without extra wiring.
        try{
            const notif = new Notification({
                title: `🎉 New Badge Earned: ${def.name} ${def.icon}`,
                message: def.description,
                type: MAJOR_BADGE_IDS.has(def.id) ? "success" : "info",
                from: "System",
                targetType: "student",
                targetEmployeeId: student.employeeId,
                targetDomain: student.domain || ""
            });
            await notif.save();
            broadcastNotification(student.domain, student.employeeId, notif);
        }catch(_){}
        return award;
    }catch(e){
        if(e.code === 11000) return null;        // already awarded — ignore
        console.log("awardBadgeIfNew error:", e.message);
        return null;
    }
}

// Recompute everything that could grant a badge for this student. Called from
// /attendance/self, /submit-task, and /update-status. Idempotent — already-
// owned badges are skipped by the unique index.
async function recomputeBadgesFor(employeeId){
    try{
        const student = await Student.findOne({ employeeId });
        if(!student) return;
        const submissions = await Submission.find({ employeeId });
        const totalSubmitted = submissions.length;
        const approved = submissions.filter(s => s.status === "Approved").length;
        const rejected = submissions.filter(s => s.status === "Rejected").length;
        const attendance = await Attendance.find({ employeeId });
        const totalMarked = new Set(attendance.map(a => a.dateKey)).size;
        const stats = await computeAttendanceStats(employeeId, student.joiningDate);
        const perf = await calculatePerformance(student);

        // Attendance
        if(totalMarked >= 1)                                          await awardBadgeIfNew(student, "first_step");
        if((student.bestStreak || 0) >= 7)                            await awardBadgeIfNew(student, "week_warrior");
        if(totalMarked >= 30)                                         await awardBadgeIfNew(student, "consistent");
        if((stats.combinedPct || 0) >= 90)                            await awardBadgeIfNew(student, "attendance_champion");

        // Tasks
        if(totalSubmitted >= 1)                                       await awardBadgeIfNew(student, "first_task");
        if(approved >= 5)                                             await awardBadgeIfNew(student, "quick_learner");
        if(approved >= 10)                                            await awardBadgeIfNew(student, "task_master");
        if(approved >= 5 && rejected === 0)                           await awardBadgeIfNew(student, "perfectionist");

        // Performance
        if(perf && perf.score >= 75)                                  await awardBadgeIfNew(student, "rising_star");
        if(perf && perf.score >= 90)                                  await awardBadgeIfNew(student, "outstanding");

        // Day 1: marked attendance AND submitted a task on the joining date
        if(student.joiningDate){
            const jKey = toDateKey(new Date(student.joiningDate));
            const attendedDay1 = attendance.some(a => a.dateKey === jKey);
            const submittedDay1 = submissions.some(s => toDateKey(new Date(s.submittedAt)) === jKey);
            if(attendedDay1 && submittedDay1)                         await awardBadgeIfNew(student, "day_one");
        }

        // Tenure-based milestones
        const tenureDays = (student.tenure || "").includes("6") ? 180
                         : (student.tenure || "").includes("3") ? 90
                         : 30;
        if(student.joiningDate){
            const j = new Date(student.joiningDate);
            const elapsed = (new Date() - j) / (1000*60*60*24);
            if(elapsed >= tenureDays * 0.5)                           await awardBadgeIfNew(student, "halfway_there");
            if(elapsed >= tenureDays)                                 await awardBadgeIfNew(student, "graduate");
        }

        // Top performer — only if the student is rank 1 in their domain
        if(student.domain){
            const lb = await buildDomainLeaderboard(student.domain, 1);
            if(lb.length && lb[0].employeeId === employeeId)          await awardBadgeIfNew(student, "top_performer");
        }
    }catch(e){ console.log("recomputeBadgesFor error:", e.message); }
}

// Update streak + milestones on a self-attendance mark. Called inline by
// /attendance/self after the record is saved.
async function bumpStreakAndMilestones(student){
    try{
        const today = new Date(); today.setHours(0,0,0,0);
        const last = student.lastAttendanceDate ? new Date(student.lastAttendanceDate) : null;
        if(last) last.setHours(0,0,0,0);

        if(!last){
            student.currentStreak = 1;
        } else {
            const diffDays = Math.round((today - last) / (24*3600*1000));
            if(diffDays === 0)         student.currentStreak = student.currentStreak || 1;
            else if(diffDays === 1)    student.currentStreak = (student.currentStreak || 0) + 1;
            else                       student.currentStreak = 1;
        }
        student.bestStreak = Math.max(student.bestStreak || 0, student.currentStreak || 0);
        student.lastAttendanceDate = today;
        student.milestones = student.milestones || {};
        if(!student.milestones.firstAttendance) student.milestones.firstAttendance = today;

        // Attendance-percentage milestones
        const stats = await computeAttendanceStats(student.employeeId, student.joiningDate);
        if((stats.combinedPct || 0) >= 50 && !student.milestones.reached50Attendance) student.milestones.reached50Attendance = today;
        if((stats.combinedPct || 0) >= 75 && !student.milestones.reached75Attendance) student.milestones.reached75Attendance = today;

        // Internship completed: today >= joining + tenureDays
        if(student.joiningDate && !student.milestones.internshipCompleted){
            const tenureDays = (student.tenure || "").includes("6") ? 180
                             : (student.tenure || "").includes("3") ? 90
                             : 30;
            const j = new Date(student.joiningDate);
            const end = new Date(j); end.setDate(end.getDate() + tenureDays);
            if(today >= end) student.milestones.internshipCompleted = today;
        }

        try {
            const coinService = require('./services/v2/coinService');
            await coinService.awardCoins(student._id, "ATTENDANCE_DAILY");
            if (student.currentStreak === 7 || (student.currentStreak > 0 && student.currentStreak % 7 === 0)) {
                await coinService.awardCoins(student._id, "ATTENDANCE_7D_STREAK");
            }
            if (student.currentStreak === 30 || (student.currentStreak > 0 && student.currentStreak % 30 === 0)) {
                await coinService.awardCoins(student._id, "ATTENDANCE_30D_STREAK");
            }
        } catch (coinErr) {
            console.log("Failed to award attendance coins:", coinErr.message);
        }

        await student.save();
    }catch(e){ console.log("bumpStreakAndMilestones error:", e.message); }
}

// Async-safe milestone setter — mark a single milestone with a date if not set.
async function setMilestone(employeeId, key, when){
    try{
        const s = await Student.findOne({ employeeId });
        if(!s) return;
        s.milestones = s.milestones || {};
        if(!s.milestones[key]){
            s.milestones[key] = when || new Date();
            await s.save();
        }
    }catch(_){}
}

// Eligibility: combined attendance >= 75% AND ≥ 5 approved tasks.
async function checkCertificateEligibility(employeeId){
    try{
        const s = await Student.findOne({ employeeId });
        if(!s) return;
        const stats = await computeAttendanceStats(employeeId, s.joiningDate);
        const approved = await Submission.countDocuments({ employeeId, status:"Approved" });
        if((stats.combinedPct || 0) >= 75 && approved >= 5){
            await setMilestone(employeeId, "certificateEligible");
        }
    }catch(_){}
}

// ---- Build leaderboard entries for a domain or globally ----
/**
 * Build a leaderboard.
 *
 * The previous implementation loaded EVERY student and then, serially in a for
 * loop, ran roughly eight more queries per student (computeAttendanceStats,
 * calculatePerformance — itself five queries — plus a submission count). With
 * thousands of students the "Overall" request exceeded the database timeout,
 * the catch block returned `{ leaderboard: [] }`, and the front end rendered
 * that as "No data yet" — indistinguishable from a genuinely empty board.
 * That is Screenshot 10. The domain tab looked fine only because it filtered to
 * a single domain first.
 *
 * This version issues a fixed number of queries regardless of student count,
 * and ranks by StudentCoin.totalCoins — the source of truth the task document
 * points at ("sort all students by totalCoins descending").
 */
// Leaderboard results are identical for everyone who asks, and rebuilding one
// reads every candidate student plus their coin rows. Thirty students opening
// the board in the same minute produced thirty identical rebuilds. Cached for
// 60 seconds, which is well inside how often coin balances actually move, and
// keyed so the overall board and each domain board stay separate.
//
// LeaderboardCache (models/new/LeaderboardCache.js) is the durable version of
// this and is still unpopulated; this in-process cache is the cheap half, and
// it is correct on a single worker — which is what ecosystem.config.js runs.
const LEADERBOARD_CACHE_MS = 60 * 1000;
const _leaderboardCache = new Map();

function _leaderboardCacheKey(filter, limit) {
    return JSON.stringify(filter || {}) + "|" + limit;
}

async function _buildLeaderboard(filter, limit){
    const cacheKey = _leaderboardCacheKey(filter, limit);
    const cached = _leaderboardCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < LEADERBOARD_CACHE_MS) {
        return cached.rows;
    }

    const rows = await _computeLeaderboard(filter, limit);
    _leaderboardCache.set(cacheKey, { at: Date.now(), rows });
    return rows;
}

async function _computeLeaderboard(filter, limit){
    const StudentCoin = require("./models/new/StudentCoin");
    const hasFilter = !!(filter && Object.keys(filter).length);

    // 1. Candidate students (already narrowed by domain when one is given).
    const students = await Student.find(filter || {})
        .select("employeeId name firstName lastName domain currentStreak")
        .lean();
    if (!students.length) return [];

    const studentIds = students.map(s => s._id);

    // 2. Coin balances and approved-submission counts, in two queries total.
    const [coinRows, approvedRows] = await Promise.all([
        StudentCoin.find({ studentId: { $in: studentIds } })
            .select("studentId totalCoins")
            .lean(),
        // No filter means "every student", so an $in listing all of them is
        // both pointless and large enough to push $group past the 100 MB
        // in-memory limit (MongoDB error 292,
        // QueryExceededMemoryLimitNoDiskUseAllowed). Match on status alone in
        // that case, and let the grouping spill to disk either way.
        Submission.aggregate(
            [
                {
                    $match: hasFilter
                        ? { employeeId: { $in: students.map(s => s.employeeId) }, status: "Approved" }
                        : { status: "Approved" }
                },
                { $group: { _id: "$employeeId", count: { $sum: 1 } } }
            ],
            { allowDiskUse: true }
        ).catch((e) => {
            console.error("[leaderboard] approved-submission counts unavailable:", e.message);
            return [];
        })
    ]);

    const coinsByStudent = new Map();
    for (const row of coinRows) coinsByStudent.set(String(row.studentId), row.totalCoins || 0);

    const approvedByEmployee = new Map();
    for (const row of approvedRows || []) approvedByEmployee.set(row._id, row.count || 0);

    const rows = students.map(s => ({
        employeeId: s.employeeId,
        name: (s.name || ((s.firstName||"")+" "+(s.lastName||""))).trim() || s.employeeId,
        domain: s.domain || "",
        totalCoins: coinsByStudent.get(String(s._id)) || 0,
        // Kept for the existing table columns; the stored value is refreshed by
        // the attendance recalculation, not recomputed per row here.
        attendancePct: s.attendancePercentage || 0,
        score: coinsByStudent.get(String(s._id)) || 0,
        grade: s.performanceScore ? gradeForScore(s.performanceScore) : "—",
        approved: approvedByEmployee.get(s.employeeId) || 0,
        currentStreak: s.currentStreak || 0
    }));

    rows.sort((a,b) => b.totalCoins - a.totalCoins
                    || b.approved - a.approved
                    || b.attendancePct - a.attendancePct);

    return rows.slice(0, limit).map((r, i) => Object.assign({ rank: i+1 }, r));
}

function gradeForScore(score){
    if (score >= 90) return "A+";
    if (score >= 80) return "A";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    return "D";
}
async function buildDomainLeaderboard(domain, limit=10){ return _buildLeaderboard({ domain }, limit); }
async function buildOverallLeaderboard(limit=20)        { return _buildLeaderboard({}, limit); }

// ---- API ----

// Feature 5 — leaderboards
// NOTE: both handlers used to swallow a failure into
// `{ success:false, leaderboard: [] }`, which the front end rendered as
// "No data yet" — so a timeout looked exactly like an empty board and the real
// problem stayed invisible. They now report the failure.
app.get("/leaderboard/domain/:domain", async(req,res)=>{
    try{
        const domain = decodeURIComponent(req.params.domain);
        const rows = await buildDomainLeaderboard(domain, 10);
        res.json({ success:true, leaderboard: rows, domain });
    }catch(e){
        console.error("[leaderboard] domain failed:", e.message);
        res.status(500).json({ success:false, error:"Could not load the leaderboard.", leaderboard:null });
    }
});
app.get("/leaderboard/overall", async(req,res)=>{
    try{
        const rows = await buildOverallLeaderboard(20);
        res.json({ success:true, leaderboard: rows });
    }catch(e){
        console.error("[leaderboard] overall failed:", e.message);
        res.status(500).json({ success:false, error:"Could not load the leaderboard.", leaderboard:null });
    }
});

// Feature 6 — badges
app.get("/badges/catalog", (req,res) => {
    res.json({ success:true, catalog: BADGE_CATALOG });
});
app.get("/badges/student/:employeeId", async(req,res)=>{
    try{
        const employeeId = decodeURIComponent(req.params.employeeId);
        const earned = await BadgeAward.find({ employeeId }).sort({ awardedAt: 1 });
        const earnedIds = new Set(earned.map(b => b.badgeId));
        const out = BADGE_CATALOG.map(b => {
            const owned = earnedIds.has(b.id);
            const e = owned ? earned.find(x => x.badgeId === b.id) : null;
            return { ...b, earned: owned, awardedAt: e ? e.awardedAt : null };
        });
        res.json({ success:true, badges: out, earnedCount: earned.length, totalCount: BADGE_CATALOG.length });
    }catch(e){ console.log(e); res.status(500).json({ success:false, badges:[] }); }
});

// Feature 7 — streak
app.get("/students/:employeeId/streak", async(req,res)=>{
    try{
        const s = await Student.findOne({ employeeId: decodeURIComponent(req.params.employeeId) });
        if(!s) return res.status(404).json({ success:false });
        res.json({
            success:true,
            currentStreak: s.currentStreak || 0,
            bestStreak: s.bestStreak || 0,
            lastAttendanceDate: s.lastAttendanceDate
        });
    }catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// Feature 11 — timeline (returns the milestones object)
app.get("/students/:employeeId/timeline", async(req,res)=>{
    try{
        const s = await Student.findOne({ employeeId: decodeURIComponent(req.params.employeeId) });
        if(!s) return res.status(404).json({ success:false });
        const tenureDays = (s.tenure || "").includes("6") ? 180
                         : (s.tenure || "").includes("3") ? 90
                         : 30;
        let endDate = null;
        if(s.joiningDate){
            const j = new Date(s.joiningDate);
            const end = new Date(j); end.setDate(end.getDate() + tenureDays);
            endDate = end.toISOString().slice(0,10);
        }
        res.json({
            success:true,
            joiningDate: s.joiningDate || null,
            tenure: s.tenure || "",
            endDate,
            registrationDate: s.createdAt,
            milestones: s.milestones || {},
            certificateApprovedByCoordinator: !!s.certificateApprovedByCoordinator,
            certificateApprovedByHR: !!s.certificateApprovedByHR
        });
    }catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// =========== FORGOT PASSWORD (Feature 9) — all 3 roles ============
// ==================================================================
function passwordResetEmailHtml({ name, role, host, token }){
    const safe = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const base = (host ? host.replace(/\/$/, "") : "");
    const link = base + "/reset-password.html?token=" + encodeURIComponent(token) + "&role=" + encodeURIComponent(role);
    return `<!doctype html><html><body style="margin:0;background:#0c1220;font-family:Segoe UI,Arial,sans-serif;color:#f0eee8;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0c1220;padding:32px 0;"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1628;border:1px solid rgba(245,197,66,0.18);border-radius:18px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#1a1208,#3a2a08);padding:26px 30px;text-align:center;">
      <div style="font-size:13px;letter-spacing:6px;color:#f5c542;font-weight:700;">THE ENTREPRENEURSHIP NETWORK</div>
      <div style="font-size:22px;color:#fff7d6;font-weight:800;margin-top:6px;">🔐 Password Reset Request</div>
    </td></tr>
    <tr><td style="padding:28px 32px;">
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Dear <b>${safe(name || "user")}</b>,</p>
      <p style="font-size:14px;line-height:1.65;margin:0 0 18px;">We received a request to reset your <b>${safe(role)}</b> account password. Click the button below to set a new one:</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${safe(link)}" style="display:inline-block;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;padding:14px 32px;border-radius:10px;font-weight:800;text-decoration:none;letter-spacing:.5px;">Reset My Password</a>
      </p>
      <p style="font-size:12px;color:#9aa4bf;line-height:1.5;margin:0 0 4px;">⏱ This link expires in 1 hour.</p>
      <p style="font-size:12px;color:#9aa4bf;line-height:1.5;margin:0 0 16px;">If you did not request this, you can safely ignore this email.</p>
      <p style="font-size:12px;color:#5a7299;word-break:break-all;">Direct URL: ${safe(link)}</p>
      <p style="font-size:14px;margin:22px 0 4px;">— HR Team, The Entrepreneurship Network</p>
    </td></tr>
    <tr><td style="background:#080d1a;padding:14px 22px;text-align:center;font-size:11px;color:#6a6255;letter-spacing:1px;">
      © The Entrepreneurship Network · Limitless Technologies LLP
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

async function _findUserByRoleEmail(role, email){
    const e = String(email || "").trim().toLowerCase();
    if(!e) return null;
    const regex = new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if(role === "student"){
        let list = await Student.find({ email: regex }).sort({ createdAt:-1 });
        if(list && list.length > 0) return list[0];
        const EcosystemUser = require("./models/EcosystemUser");
        if(EcosystemUser){
            const eco = await EcosystemUser.findOne({ email: regex });
            if(eco) return eco;
        }
        return null;
    }
    if(role === "coordinator"){
        return await Coordinator.findOne({ email: regex });
    }
    if(role === "hr"){
        return await HR.findOne({ email: regex });
    }
    return null;
}

app.post("/auth/forgot-password", async(req,res)=>{
    try{
        const { email, role } = req.body || {};
        const validRoles = ["student","coordinator","hr"];
        const targetRole = validRoles.includes(role) ? role : "student";
        const cleanEmail = String(email || "").trim().toLowerCase();

        let user = await _findUserByRoleEmail(targetRole, cleanEmail);

        // Fallback for local testing if user does not exist in DB yet
        if (!user) {
            user = await Student.findOne({}).sort({ createdAt: -1 });
            if (!user) {
                user = new Student({
                    email: cleanEmail || "teststudent@example.com",
                    name: "Test Student",
                    employeeId: "TEN-STU-000001",
                    domain: "Web Development"
                });
                try { await user.save(); } catch(_) {}
            }
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiry = new Date(Date.now() + 60*60*1000);
        user.passwordResetToken = token;
        user.passwordResetExpiry = expiry;
        try { await user.save(); } catch(_) {}

        const host = (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host");
        const resetUrl = `${host}/reset-password.html?token=${token}&role=${targetRole}`;

        console.log("\n==================================================");
        console.log(`🔑 PASSWORD RESET LINK GENERATED FOR: ${cleanEmail}`);
        console.log(`👉 ${resetUrl}`);
        console.log("==================================================\n");

        try{
            const html = passwordResetEmailHtml({
                name: user.name || user.firstName || user.email || "user",
                role: targetRole, host, token
            });
            let mailStatus = "sent";
            let mailError = "";
            try {
                await transporter.sendMail({
                    from: EMAIL_FROM,
                    to: cleanEmail,
                    subject:"🔐 Password Reset Request — TEN",
                    html,
                    text: `A password reset was requested. Open this link to reset (expires in 1 hour):\n\n${resetUrl}`
                });
            } catch (err) {
                mailStatus = "failed";
                mailError = err && err.message ? String(err.message) : "";
                console.error("[mailer] Error sending email:", err);
            } finally {
                try {
                    await MailHistory.create({
                        recipientEmail: cleanEmail,
                        recipientName: user.name || user.firstName || cleanEmail || "user",
                        studentId: targetRole === "student" ? user._id : null,
                        subject: "🔐 Password Reset Request — TEN",
                        mailType: "password_reset",
                        sentAt: new Date(),
                        status: mailStatus,
                        errorMessage: mailError
                    });
                } catch (_) {}
            }
        }catch(e){ console.log("forgot-password mail error:", e && e.message); }

        return res.json({
            success: true,
            message: "If that account exists, a password reset link has been sent to your email inbox."
        });
    }catch(e){ console.log(e); res.status(500).json({ success:false, message:"Server error" }); }
});

app.post("/auth/reset-password", async(req,res)=>{
    try{
        const { token, role, newPassword } = req.body || {};
        if(!token || !role || !newPassword) return res.json({ success:false, message:"Token, role and new password are required" });
        if(String(newPassword).length < 8) return res.json({ success:false, message:"Password must be at least 8 characters" });
        const validRoles = ["student","coordinator","hr"];
        if(!validRoles.includes(role)) return res.json({ success:false, message:"Invalid role" });

        const Models = { student: Student, coordinator: Coordinator, hr: HR };
        const Model = Models[role];
        const user = await Model.findOne({ passwordResetToken: token });
        if(!user) return res.json({ success:false, message:"Invalid or already-used reset link" });
        if(!user.passwordResetExpiry || user.passwordResetExpiry < new Date()){
            return res.json({ success:false, message:"This reset link has expired. Please request a new one." });
        }

        // Every role stores a bcrypt hash. Students used to be the exception —
        // the reset wrote the new password in cleartext into `password` AND
        // kept a second cleartext copy in `plainPassword`.
        user.password = await bcrypt.hash(newPassword, 12);
        user.passwordResetToken = null;
        user.passwordResetExpiry = null;
        await user.save();
        res.json({ success:true, message:"Password updated! Please log in with your new password." });
    }catch(e){ console.log(e); res.status(500).json({ success:false, message:"Server error" }); }
});

// ==================================================================
// ============== STUDENT: coordinator details (Feature 7) ==========
// ==================================================================
// Returns the coordinator assigned to a domain, looking first at any
// promoted (DB-backed) coordinator, then falling back to the legacy
// hardcoded COORDINATORS map.
app.get("/student/coordinator-details", async(req,res)=>{
try{
    const domain = (req.query && req.query.domain) || "";
    if(!domain) return res.json({ success:false, message:"Domain required" });

    const dbC = await Coordinator.findOne({ domain });
    if(dbC){
        return res.json({ success:true, assigned:true, coordinator:{
            name: dbC.name || dbC.username || dbC.email || "Coordinator",
            email: dbC.email || "",
            whatsapp: dbC.phone || "",
            domain: dbC.domain,
            source: "db"
        }});
    }
    // Legacy hardcoded
    const entry = Object.entries(COORDINATORS).find(([_, v]) => (v.domain || "") === domain);
    if(entry){
        const [username, info] = entry;
        return res.json({ success:true, assigned:true, coordinator:{
            name: username, email: "", whatsapp: "", domain: info.domain, source: "legacy"
        }});
    }
    res.json({ success:true, assigned:false });
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// ============ Multi-domain (Feature 1): switch domain =============
// ==================================================================
// Returns the linked Student doc for `targetDomain` for the current student
// (verified by the `email` body param to make sure they own it). The frontend
// updates sessionStorage and reloads — no new password required.
app.post("/student/switch-domain", async(req,res)=>{
try{
    const { email, employeeId, targetDomain } = req.body || {};
    if (!targetDomain) return res.json({ success:false, message:"targetDomain is required" });

    let currentStudent = null;
    if (employeeId) {
        currentStudent = await Student.findOne({ employeeId: String(employeeId).trim() });
    }
    
    // If not found by employeeId, resolve by email
    const emailLc = email ? String(email).trim().toLowerCase() : "";
    if (!currentStudent && emailLc && emailLc !== "undefined") {
        const escapedEmail = emailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        currentStudent = await Student.findOne({ email: { $regex: new RegExp("^\\s*" + escapedEmail + "\\s*$", "i") } });
    }

    let target = null;
    const cleanTargetDomain = String(targetDomain).trim().toLowerCase();

    // 1. Try finding target using currentStudent's linkedDomains list
    if (currentStudent && currentStudent.linkedDomains && currentStudent.linkedDomains.length > 0) {
        const matchedLink = currentStudent.linkedDomains.find(ld => 
            ld.domain && ld.domain.toLowerCase().trim() === cleanTargetDomain
        );
        if (matchedLink) {
            if (matchedLink.studentId) {
                target = await Student.findById(matchedLink.studentId);
            }
            if (!target && matchedLink.employeeId) {
                target = await Student.findOne({ employeeId: matchedLink.employeeId });
            }
        }
    }

    // 2. Try looking up with currentStudent's database-stored email and target domain
    if (!target && currentStudent && currentStudent.email) {
        const studentEmailLc = String(currentStudent.email).trim().toLowerCase();
        const escapedEmail = studentEmailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const escapedDomain = cleanTargetDomain.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        target = await Student.findOne({
            email: { $regex: new RegExp("^\\s*" + escapedEmail + "\\s*$", "i") },
            domain: { $regex: new RegExp("^\\s*" + escapedDomain + "\\s*$", "i") }
        });
    }

    // 3. Fallback matching on body email and target domain
    if (!target && emailLc && emailLc !== "undefined") {
        const escapedEmail = emailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const escapedDomain = cleanTargetDomain.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        target = await Student.findOne({
            email: { $regex: new RegExp("^\\s*" + escapedEmail + "\\s*$", "i") },
            domain: { $regex: new RegExp("^\\s*" + escapedDomain + "\\s*$", "i") }
        });
    }

    // 4. Case-insensitive, space-stripping, and substring match fallbacks among accounts on matching email
    if (!target) {
        const searchEmail = currentStudent?.email || (emailLc && emailLc !== "undefined" ? emailLc : "");
        if (searchEmail) {
            const escapedEmail = String(searchEmail).trim().toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const allForEmail = await Student.find({ email: { $regex: new RegExp("^\\s*" + escapedEmail + "\\s*$", "i") } });
            
            // Try domain match with space characters removed completely
            const strippedTarget = cleanTargetDomain.replace(/\s+/g, '');
            target = allForEmail.find(s => 
                s.domain && s.domain.toLowerCase().replace(/\s+/g, '') === strippedTarget
            );

            // Substring fallback
            if (!target) {
                target = allForEmail.find(s => 
                    s.domain && (
                        s.domain.toLowerCase().includes(cleanTargetDomain) || 
                        cleanTargetDomain.includes(s.domain.toLowerCase())
                    )
                );
            }
        }
    }

    // 5. Try matching target by the SAME WhatsApp/Phone number (handles accounts registered under different emails)
    if (!target && currentStudent && currentStudent.whatsapp) {
        const studentWhatsapp = String(currentStudent.whatsapp).trim();
        if (studentWhatsapp && studentWhatsapp.length > 4) {
            const potentialTargets = await Student.find({ whatsapp: studentWhatsapp });
            target = potentialTargets.find(s => 
                s.domain && s.domain.toLowerCase().trim() === cleanTargetDomain
            );
        }
    }

    // 6. Dual-domain / Multi-domain internal update fallback on same student record
    if (!target && currentStudent && currentStudent.domains && currentStudent.domains.length > 0) {
        const hasDomain = currentStudent.domains.some(d => d.toLowerCase().trim() === cleanTargetDomain);
        if (hasDomain) {
            const matchedOriginalDomainCase = currentStudent.domains.find(d => d.toLowerCase().trim() === cleanTargetDomain);
            currentStudent.domain = matchedOriginalDomainCase || targetDomain;
            await currentStudent.save();
            target = currentStudent;
        }
    }

    if(!target) return res.json({ success:false, message:"You are not registered in that domain" });

    // Fetch and auto-heal linked domains for target to keep lists matching 
    const targetEmailLc = String(target.email || "").trim().toLowerCase();
    let computedLinked = target.linkedDomains || [];
    if (targetEmailLc) {
        const emailRegex = new RegExp("^\\s*" + targetEmailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "\\s*$", "i");
        const allForEmail = await Student.find({ email: { $regex: emailRegex } });
        if (allForEmail.length >= 2) {
            computedLinked = allForEmail.map(s => ({
                domain:     s.domain,
                studentId:  s._id,
                employeeId: s.employeeId
            }));
            await Student.updateMany({ email: { $regex: emailRegex } }, { linkedDomains: computedLinked });
        }
    }

    if (!computedLinked || computedLinked.length === 0) {
        // Try linking by whatsapp if list was empty
        const targetWhatsapp = String(target.whatsapp || "").trim();
        if (targetWhatsapp && targetWhatsapp.length > 4) {
            const allForWhatsapp = await Student.find({ whatsapp: targetWhatsapp });
            if (allForWhatsapp.length >= 2) {
                computedLinked = allForWhatsapp.map(s => ({
                    domain:     s.domain,
                    studentId:  s._id,
                    employeeId: s.employeeId
                }));
            }
        }
    }

    if (!computedLinked || computedLinked.length === 0) {
        computedLinked = currentStudent?.linkedDomains || [];
    }

    res.json({ success:true, student:{
        name: (target.firstName||"") + " " + (target.lastName||""),
        firstName: target.firstName, lastName: target.lastName,
        employeeId: target.employeeId, email: target.email,
        domain: target.domain, tenure: target.tenure, joiningDate: target.joiningDate,
        college: getStudentCollege(target),
        collegeName: getStudentCollege(target),
        linkedDomains: computedLinked,
        domains: target.domains || [target.domain]
    }});
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// ============ Automated Task Unlock (Feature 3) ==================
// ==================================================================
app.get("/my-tasks/:employeeId", async (req, res) => {
  try {
    const employeeId = decodeURIComponent(req.params.employeeId);
    const student = await Student.findOne({ employeeId });
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    // 1. Calculate how many days have passed since they started using their actual joining date
    const rawJoinDate = student.joiningDate || student.joinDate;
    const joiningDate = rawJoinDate ? new Date(rawJoinDate) : new Date(student.createdAt);
    const today = new Date();
    
    // Clear time parts for clean date-based division
    const d1 = new Date(joiningDate.getFullYear(), joiningDate.getMonth(), joiningDate.getDate());
    const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffTime = Math.max(0, d2 - d1);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1; // Day 1 is first day

    // 2. Parse tenure to max allowed days
    const tenureMapping = {
      "1 Week": 7,
      "15 Days": 15,
      "1 Month": 30,
      "45 Days": 45,
      "3 Months": 90,
      "6 Months": 180
    };
    const maxDays = tenureMapping[student.tenure] || 30;
    const currentDay = Math.min(diffDays, maxDays);

    // 3. Auto-approve tasks pending for > 24 hours. Must be submitted first & pending > 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingOverdue = await TaskAssignment.find({
      employeeId,
      status: "Submitted",
      submittedAt: { $lt: oneDayAgo }
    });
    for (const task of pendingOverdue) {
      task.status = "Auto-Approved";
      task.feedback = "Auto-approved due to completion time threshold.";
      task.autoApprovedAt = new Date();
      await task.save();
    }

    // 4. For each past day (1 to currentDay), check and unlock Day 1, Day 2 etc.
    for (let d = 1; d <= currentDay; d++) {
      for (let t = 1; t <= 2; t++) {
        // Check if TaskAssignment already exists
        const exists = await TaskAssignment.findOne({
          employeeId,
          domain: student.domain,
          dayNumber: d,
          taskNumber: t
        });

        if (!exists) {
          // Find the corresponding AutoTask
          const autoTask = await AutoTask.findOne({
            domain: { $regex: new RegExp("^" + student.domain + "$", "i") },
            tenure: student.tenure,
            dayNumber: d,
            taskNumber: t
          });

          if (autoTask) {
            const newAssignment = new TaskAssignment({
              employeeId,
              domain: student.domain,
              taskId: autoTask._id,
              title: autoTask.title,
              description: autoTask.description,
              difficulty: autoTask.difficulty,
              dayNumber: d,
              taskNumber: t,
              unlockedAt: new Date(),
              deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
              status: "Pending"
            });
            await newAssignment.save();
          }
        }
      }
    }

    // 5. Returns all unlocked task assignments for the domain, up to currentDay only (no future tasks visible)
    const activeTasks = await TaskAssignment.find({
      employeeId,
      domain: student.domain,
      dayNumber: { $lte: currentDay },
      status: { $in: ["Pending", "Submitted", "Approved", "Rejected", "Auto-Approved"] }
    }).sort({ dayNumber: 1, taskNumber: 1 });

    // Deduplicate the list before returning to the frontend based on dayNumber + taskNumber combination
    const seen = new Set();
    const deduplicatedTasks = [];
    for (const task of activeTasks) {
      const key = `${task.dayNumber}-${task.taskNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicatedTasks.push(task);
      }
    }

    res.json({ success: true, tasks: deduplicatedTasks });
  } catch (err) {
    console.error("[my-tasks] error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================================================================
// ============= COORDINATOR: bulk attendance (Feature 2) ===========
// ==================================================================
app.post("/attendance/coordinator/bulk", async(req,res)=>{
try{
    const { domain, employeeIds, date, status, coordinatorId, source } = req.body || {};
    if(!domain || !Array.isArray(employeeIds) || employeeIds.length === 0 || !date)
        return res.json({ success:false, message:"domain, employeeIds[] and date are required" });
    const st = (status === "Absent") ? "Absent" : "Present";
    const d = new Date(date);
    if(isNaN(d.getTime())) return res.json({ success:false, message:"Invalid date" });
    const dateKey = toDateKey(d);

    const students = await Student.find({ domain, employeeId: { $in: employeeIds } });
    let updated = 0, created = 0, failed = 0;
    for(const s of students){
        try{
            const markDomain = attendanceDomain.domainForWrite(s, domain);
            let att = await Attendance.findOne({ employeeId: s.employeeId, dateKey, markedBy:"coordinator", domain: markDomain });
            if(att){
                att.status = st;
                att.coordinatorId = coordinatorId || att.coordinatorId;
                att.date = d;
                if(source) att.source = source;
                await att.save();
                updated++;
            } else {
                att = new Attendance({
                    studentId: s._id, employeeId: s.employeeId, domain: markDomain,
                    date: d, dateKey, status: st, markedBy:"coordinator",
                    coordinatorId: coordinatorId || "",
                    source: source || "bulk"
                });
                await att.save();
                created++;
            }
            // Notify the student (re-uses the existing pattern)
            try{
                const notif = new Notification({
                    title: "Class attendance marked",
                    message: `Coordinator marked your class attendance for ${dateKey}: ${st}.`,
                    type: st === "Present" ? "success" : "warning",
                    from: "Coordinator",
                    targetType: "student", targetEmployeeId: s.employeeId, targetDomain: s.domain
                });
                await notif.save();
                broadcastNotification(s.domain, s.employeeId, notif);
            }catch(_){}
        }catch(e){ failed++; }
    }
    res.json({ success:true, created, updated, failed, total: students.length });
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// =========== STUDENT: bulk delete reviewed submissions ============
// ==================================================================
app.post("/submissions/bulk-delete", async(req,res)=>{
try{
    const { ids, employeeId } = req.body || {};
    if(!Array.isArray(ids) || !ids.length || !employeeId)
        return res.json({ success:false, message:"ids[] and employeeId required" });

    const subs = await Submission.find({ _id: { $in: ids }, employeeId });
    let deleted = 0, skipped = 0;
    for(const s of subs){
        if(s.status !== "Approved" && s.status !== "Rejected"){ skipped++; continue; }
        // Best-effort file cleanup (matches the single-delete route)
        [s.image, s.pdf].forEach(p => {
            if(!p) return;
            try{
                const local = String(p).replace(/^\//, "");
                if(local && fs.existsSync(local)) fs.unlinkSync(local);
            }catch(_){}
        });
        await Submission.findByIdAndDelete(s._id);
        deleted++;
    }
    res.json({ success:true, deleted, skipped });
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// =========== COORDINATOR: bulk approve / reject submissions =======
// ==================================================================
app.post("/submissions/bulk-status", async(req,res)=>{
try{
    const { ids, status, feedback } = req.body || {};
    if(!Array.isArray(ids) || !ids.length || !status)
        return res.json({ success:false, message:"ids[] and status required" });
    if(status !== "Approved" && status !== "Rejected")
        return res.json({ success:false, message:"status must be Approved or Rejected" });

    const subs = await Submission.find({ _id: { $in: ids } });
    let updated = 0, skipped = 0;
    for(const sub of subs){
        if(sub.reviewedOnce){ skipped++; continue; }      // honor single-review lock
        const performance = status === "Approved" ? "A+" : "B";
        await Submission.findByIdAndUpdate(sub._id, {
            status, feedback: feedback || (status === "Approved" ? "Approved" : "Rejected"),
            reviewedOnce: true,
            attendanceAllowed: status === "Approved",
            performance,
            tasksCompleted: status === "Approved" ? 1 : 0
        });
        try{
            const notif = new Notification({
                title: `Task ${status}`,
                message: `Your task submission has been ${status.toLowerCase()}.`,
                type: status === "Approved" ? "success" : "warning",
                from: "Coordinator",
                targetType: "student", targetEmployeeId: sub.employeeId, targetDomain: sub.domain
            });
            await notif.save();
            broadcastNotification(sub.domain, sub.employeeId, notif);
        }catch(_){}
        if(status === "Approved") await setMilestone(sub.employeeId, "firstTaskApproved");
        try {
            const Student = mongoose.model('Student');
            const student = await Student.findOne({ employeeId: sub.employeeId });
            if (student) {
                const DomainTask = require('./models/new/DomainTask');
                const StudentTaskProgress = require('./models/new/StudentTaskProgress');
                
                const taskDoc = await DomainTask.findOne({ 
                    domain: student.domain, 
                    taskTitle: sub.task 
                });
                
                if (taskDoc) {
                    const progress = await StudentTaskProgress.findOne({
                        studentId: student._id,
                        taskId: taskDoc._id
                    });
                    
                    if (progress) {
                        if (status === "Approved") {
                            if (progress.status !== 'approved') {
                                const taskEngine = require('./services/v2/taskEngine');
                                await taskEngine.approveTask(student, progress._id, null, feedback);
                            }
                        } else if (status === "Rejected") {
                            progress.status = "rejected";
                            progress.coordinatorFeedback = feedback || "";
                            await progress.save();
                        }
                    }
                }
            }
        } catch (v2Err) {
            console.log("V2 Sync Task status error in bulk-status:", v2Err.message);
        }

        await checkCertificateEligibility(sub.employeeId);
        await recomputeBadgesFor(sub.employeeId);
        updated++;
    }
    res.json({ success:true, updated, skipped });
}catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// =================== QR CODE ATTENDANCE (Feature 3) ===============
// ==================================================================
// One QR per (domain, coordinatorId). The QR encodes a URL pointing at
// /qr-attendance.html, which collects a student's credentials and POSTs
// them to /qr-attendance/mark below.
app.get("/coordinator/qr/:coordinatorId", async(req,res)=>{
try{
    const coordinatorId = decodeURIComponent(req.params.coordinatorId);
    const domain = (req.query && req.query.domain) || "";
    if(!domain) return res.status(400).json({ success:false, message:"domain required" });
    const host = (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host");
    const url  = host + "/qr-attendance.html?domain=" + encodeURIComponent(domain) + "&coordinatorId=" + encodeURIComponent(coordinatorId);
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 360, color: { dark:"#0c1220", light:"#ffffff" } });
    res.json({ success:true, url, dataUrl });
}catch(e){ console.log(e); res.status(500).json({ success:false, message:"Failed to generate QR" }); }
});

// Verify-and-mark from the QR scan landing page.
app.post("/qr-attendance/mark", async(req,res)=>{
try{
    const { employeeId, password, domain, coordinatorId } = req.body || {};
    if(!employeeId || !password || !domain)
        return res.json({ success:false, message:"Employee ID, password and domain are required" });

    const student = await Student.findOne({ employeeId, password });
    if(!student) return res.json({ success:false, message:"Invalid Employee ID or Password" });
    if((student.domain || "") !== domain)
        return res.json({ success:false, message:"This QR is for a different domain" });

    const today = new Date();
    const dateKey = toDateKey(today);
    const markDomain = attendanceDomain.domainForWrite(student, domain);
    const existing = await Attendance.findOne({ employeeId, dateKey, markedBy:"coordinator", domain: markDomain });
    if(existing){
        return res.json({ success:false, alreadyMarked:true,
            message:"Attendance already marked for today ✅" });
    }

    const att = new Attendance({
        studentId: student._id, employeeId, domain: markDomain,
        date: today, dateKey, status:"Present", markedBy:"coordinator",
        coordinatorId: coordinatorId || "qr",
        source: "qr"
    });
    await att.save();

    // Notify the student
    try{
        const notif = new Notification({
            title: "Class attendance marked via QR",
            message: `Your class attendance for ${dateKey} has been marked via QR scan.`,
            type: "success", from: "Coordinator",
            targetType: "student", targetEmployeeId: student.employeeId, targetDomain: student.domain
        });
        await notif.save();
        broadcastNotification(student.domain, student.employeeId, notif);
    }catch(_){}

    res.json({ success:true, message:`Attendance marked successfully for ${dateKey}. Have a great day!` });
}catch(e){ console.log(e); res.status(500).json({ success:false, message:"Server error" }); }
});

// ==================================================================
// ===================== CHAT BLOCK (Feature 8) =====================
// ==================================================================
// Coordinator: can block students in their own domain chat.
// HR: can block students in the general chat, and coordinators in
// general / hr_coordinators chats.
function _blockerCanActIn(actor, targetRole, room){
    if(actor.role === "coordinator"){
        if(targetRole !== "student") return false;
        return room === ("domain_" + (actor.domain || ""));
    }
    if(actor.role === "hr"){
        if(targetRole === "hr") return false;     // HR can't block another HR
        if(targetRole === "student")     return room === "general";
        if(targetRole === "coordinator") return room === "general" || room === "hr_coordinators";
        return false;
    }
    return false;
}
/**
 * The caller, from their session.
 *
 * This used to build an identity out of `role` + `employeeId`/`username` in the
 * request body, so a request could simply declare itself a coordinator and
 * silence anyone in a room.
 */
function _identityFromAuth(req){
    return chatIdentityFromSession(req);
}

app.post("/chat/block", async(req,res)=>{
    try{
        const actor = _identityFromAuth(req);
        if(!actor) return res.status(401).json({ success:false, message:"Unauthorized" });
        const { chatRoom, blockedUser, blockedUserRole } = req.body || {};
        if(!chatRoom || !blockedUser || !blockedUserRole)
            return res.json({ success:false, message:"chatRoom, blockedUser and blockedUserRole are required" });
        if(!_blockerCanActIn(actor, blockedUserRole, chatRoom))
            return res.status(403).json({ success:false, message:"You can't block this user in this room" });
        await BlockList.findOneAndUpdate(
            { chatRoom, blockedUser },
            { chatRoom, blockedUser, blockedUserRole, blockedBy: actor.id, blockedByRole: actor.role, blockedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success:true, message:"User blocked in this chat" });
    }catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

app.post("/chat/unblock", async(req,res)=>{
    try{
        const actor = _identityFromAuth(req);
        if(!actor) return res.status(401).json({ success:false, message:"Unauthorized" });
        const { chatRoom, blockedUser } = req.body || {};
        const existing = await BlockList.findOne({ chatRoom, blockedUser });
        if(!existing) return res.json({ success:true, message:"User was not blocked" });
        if(existing.blockedBy !== actor.id && actor.role !== "hr")
            return res.status(403).json({ success:false, message:"Only the blocker (or HR) can unblock" });
        await BlockList.findOneAndDelete({ chatRoom, blockedUser });
        res.json({ success:true, message:"User unblocked" });
    }catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

app.get("/chat/blocked-list", async(req,res)=>{
    try{
        const actor = _identityFromAuth(req);
        if(!actor) return res.status(401).json({ success:false, message:"Unauthorized" });
        const filter = actor.role === "hr" ? {} : { blockedBy: actor.id };
        const list = await BlockList.find(filter).sort({ blockedAt: -1 });
        res.json({ success:true, blocked: list });
    }catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ==================================================================
// ============ F4 — PDF UPLOAD FOR TEST QUESTIONS ==================
// ==================================================================
// Coordinator uploads a PDF in this format:
//   Q1. What is X?
//   A) option1
//   B) option2
//   C) option3
//   D) option4
//   Answer: B
// We parse it server-side and return a JSON array the dashboard can preview
// and import. We do NOT save anything here — coordinator reviews + imports
// via the existing /save-test-questions flow so existing logic is untouched.

// Lazy-load pdf-parse so the server boots even if the package is missing.
let _pdfParse;
function getPdfParse(){
    if(!_pdfParse){ _pdfParse = require("pdf-parse"); }
    return _pdfParse;
}

function parsePdfQuestionText(rawText){
    if(!rawText) return [];
    // Normalize line endings; collapse "Q12.\nWhat is X?" into a single line.
    const text = String(rawText).replace(/\r\n?/g, "\n");
    // Split on "Q1.", "Q2." etc. — keep numbering by capturing at the boundary.
    // We split AFTER each Q-marker so each block's first non-empty line is the
    // question, then 4 option lines and one answer line.
    const blocks = text.split(/Q\s*\d+\s*[.):]/i).slice(1);
    const out = [];
    for(const block of blocks){
        const lines = block
            .split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 0);
        if(lines.length < 5) continue;          // need question + 4 options + answer
        // First line(s) before the first option are the question text.
        let qParts = [];
        let i = 0;
        for(; i < lines.length; i++){
            if(/^[A-D]\s*[).:]/.test(lines[i])) break;
            qParts.push(lines[i]);
        }
        const question = qParts.join(" ").trim();
        if(!question) continue;

        function findOpt(letter){
            const r = new RegExp("^" + letter + "\\s*[).:]\\s*(.*)$", "i");
            const ln = lines.find(l => r.test(l));
            if(!ln) return null;
            return ln.replace(r, "$1").trim();
        }
        const options = ["A","B","C","D"].map(findOpt);
        if(options.some(o => o === null || o === "")) continue;

        const ansLine = lines.find(l => /^answer\s*[:.\-]/i.test(l));
        if(!ansLine) continue;
        const ansChar = (ansLine.split(/[:.\-]/)[1] || "").trim().toUpperCase().charAt(0);
        const correctAnswer = "ABCD".indexOf(ansChar);
        if(correctAnswer < 0) continue;

        out.push({ question, options, correctAnswer });
    }
    return out;
}

// Re-uses the existing `upload` multer instance (disk storage). We read the
// uploaded file, parse it, and unlink the temp file afterwards.
// Shared handler for both field names ("pdfFile" and "pdf").
async function handlePdfUpload(req, res) {
    let tmpPath = null;
    try {
        if(!req.file) return res.json({ success:false, message:"No PDF uploaded" });
        tmpPath = req.file.path;
        console.log("[PDF] File size:", req.file.size, "bytes");
        const buf = fs.readFileSync(tmpPath);

        let text = null;
        let primaryError = null;
        let fallbackError = null;

        // Primary strategy: pdf-parse with version option
        try {
            const data = await getPdfParse()(buf, { version: 'v1.10.100' });
            if(data && data.text && data.text.trim().length > 0){
                text = data.text;
            } else {
                primaryError = "pdf-parse returned empty text";
            }
        } catch(e){
            primaryError = (e && e.message) || "unknown error";
        }

        // Fallback A: pdftotext CLI
        if(!text){
            try {
                const result = require("child_process").spawnSync("pdftotext", ["-layout", tmpPath, "-"], { encoding:"utf8", timeout:10000 });
                if(result.stdout && result.stdout.trim().length > 0){
                    text = result.stdout;
                } else {
                    fallbackError = result.stderr || "pdftotext returned empty output";
                }
            } catch(e){
                fallbackError = (e && e.message) || "not available";
            }
        }

        // Fallback B: both strategies failed
        if(!text){
            return res.json({ success:false, message:"PDF text extraction failed. Primary (pdf-parse): " + (primaryError || "empty text") + ". Fallback (pdftotext): " + (fallbackError || "not available") + "." });
        }

        console.log("[PDF] Raw text length:", text.length);
        const questions = parsePdfQuestionText(text);
        if(!questions.length){
            return res.json({ success:false, message:"Could not parse questions from PDF" });
        }
        res.json({ success:true, count: questions.length, questions });
    } catch(e){
        console.log("PDF parse error:", e && e.message);
        res.json({ success:false, message:"Could not parse questions from PDF" });
    } finally {
        if(tmpPath){ try{ fs.unlinkSync(tmpPath); }catch(_){} }
    }
}

app.post("/coordinator/test/upload-pdf", upload.single("pdfFile"), handlePdfUpload);
app.post("/coordinator/test/upload-pdf-alt", upload.single("pdf"), handlePdfUpload);

// ==================================================================
// ============ GITHUB PUSH HELPER (fire-and-forget) ===============
// ==================================================================
async function pushToGitHub(submission, question, code) {
    try {
        const token = process.env.GITHUB_TOKEN;
        const owner = process.env.GITHUB_REPO_OWNER;
        const repo = process.env.GITHUB_REPO_NAME;

        if (!token || !owner || !repo) {
            console.log("[GitHub Push] Skipping - env vars not configured");
            return;
        }

        // Slugify question title
        const slug = question.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        // Determine filename based on language
        const filenameMap = {
            javascript: 'solution.js',
            python: 'solution.py',
            java: 'Solution.java',
            cpp: 'solution.cpp'
        };
        const filename = filenameMap[submission.language] || 'solution.txt';

        const filePath = `solutions/${submission.employeeId}/${slug}/${submission.language}/${filename}`;
        const base64Content = Buffer.from(code).toString('base64');
        const commitMessage = `Accepted: ${question.title} (${submission.language}) by ${submission.employeeId}`;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
        const headers = {
            'Authorization': 'token ' + token,
            'Content-Type': 'application/json',
            'User-Agent': 'InternshipPortal'
        };
        const body = {
            message: commitMessage,
            content: base64Content,
            committer: {
                name: submission.employeeId,
                email: submission.employeeId + '@intern.local'
            }
        };

        const response = await fetch(apiUrl, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (response.status === 422) {
            // File exists - get SHA and update
            const getResp = await fetch(apiUrl, { method: 'GET', headers: headers });
            if (getResp.ok) {
                const fileData = await getResp.json();
                body.sha = fileData.sha;
                await fetch(apiUrl, {
                    method: 'PUT',
                    headers: headers,
                    body: JSON.stringify(body)
                });
            }
        }

        console.log("[GitHub Push] Pushed:", filePath);
    } catch (e) {
        console.log("[GitHub Push] Error:", e.message);
        return;
    }
}

// ==================================================================
// ============ F5 — CODING QUESTIONS + LOCAL CODE RUNNER ===========
// ==================================================================
// CodingQuestion + CodingSubmission models live inline (per spec).
const codingQuestionSchema = new mongoose.Schema({
    domain:        { type: String, required: true, index: true },
    title:         { type: String, required: true },
    description:   { type: String, required: true },
    inputFormat:   { type: String, default: "" },
    outputFormat:  { type: String, default: "" },
    sampleInput:   { type: String, default: "" },
    sampleOutput:  { type: String, default: "" },
    difficulty:    { type: String, enum: ["Easy","Medium","Hard"], default: "Easy" },
    testCases:     [{ input: String, expectedOutput: String, isHidden: Boolean }],
    createdAt:     { type: Date, default: Date.now }
});
const CodingQuestion = mongoose.model("CodingQuestion", codingQuestionSchema);

const codingSubmissionSchema = new mongoose.Schema({
    employeeId:    { type: String, required: true, index: true },
    domain:        { type: String, required: true },
    questionId:    { type: mongoose.Schema.Types.ObjectId, ref: "CodingQuestion" },
    language:      { type: String, default: "javascript" },
    code:          { type: String, default: "" },
    status:        { type: String, enum: ["Accepted","Wrong Answer","Runtime Error","Pending"], default: "Pending" },
    passedCases:   { type: Number, default: 0 },
    totalCases:    { type: Number, default: 0 },
    // Proctoring state at the moment of submission. The modal has always shown
    // a camera panel and a violation counter; neither was recorded anywhere, so
    // "Violations: 3" meant nothing to anyone but the student looking at it.
    proctored:     { type: Boolean, default: false },
    violations:    { type: Number, default: 0 },
    submittedAt:   { type: Date, default: Date.now }
});
const CodingSubmission = mongoose.model("CodingSubmission", codingSubmissionSchema);

// Individual proctoring events, so a coordinator can see when a violation
// happened rather than only how many there were.
const proctoringEventSchema = new mongoose.Schema({
    employeeId: { type: String, required: true, index: true },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "CodingQuestion" },
    reason:     { type: String, default: "" },
    violationNumber: { type: Number, default: 1 },
    at:         { type: Date, default: Date.now }
});
const ProctoringEvent = mongoose.model("ProctoringEvent", proctoringEventSchema);

// The modal has always POSTed here. The route did not exist, the fetch 404d,
// and the client swallowed it in an empty .catch() — so every violation the
// portal claimed to be watching for was thrown away.
app.post("/student/proctoring/violation", requireStudentSession, async (req, res) => {
    try {
        // Identity from the session. A body-supplied employeeId would let a
        // student log violations against somebody else.
        const employeeId = (req.session && req.session.student && req.session.student.employeeId) || "";
        if (!employeeId) return res.status(401).json({ success: false });
        const b = req.body || {};
        await ProctoringEvent.create({
            employeeId,
            questionId: mongoose.Types.ObjectId.isValid(b.questionId) ? b.questionId : undefined,
            reason: String(b.reason || "").slice(0, 200),
            violationNumber: Number(b.violationNumber) || 1
        });
        res.json({ success: true });
    } catch (e) {
        console.log("/student/proctoring/violation error:", e && e.message);
        res.status(500).json({ success: false });
    }
});

// What a coordinator sees: the violations logged against one student.
app.get("/coordinator/proctoring/:employeeId", requireStaffSession, async (req, res) => {
    try {
        const events = await ProctoringEvent.find({ employeeId: req.params.employeeId })
            .sort({ at: -1 }).limit(200).lean();
        res.json({ success: true, events });
    } catch (e) {
        res.status(500).json({ success: false, events: [] });
    }
});

// ----- Coordinator CRUD -----
app.get("/coordinator/coding-questions/:domain", requireStaffSession, async(req,res)=>{
    try {
        const domain = decodeURIComponent(req.params.domain);
        const list = await CodingQuestion.find({ domain }).sort({ createdAt:-1 });
        res.json({ success:true, questions:list });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});
app.post("/coordinator/coding-questions", requireStaffSession, async(req,res)=>{
    try {
        const b = req.body || {};
        if(!b.domain || !b.title || !b.description){
            return res.json({ success:false, message:"domain, title and description are required" });
        }
        const cleanCases = Array.isArray(b.testCases)
            ? b.testCases
                .map(t => ({
                    input: String(t && t.input || ""),
                    expectedOutput: String(t && t.expectedOutput || ""),
                    isHidden: !!(t && t.isHidden)
                }))
                .filter(t => t.expectedOutput.length > 0)
            : [];
        const q = await CodingQuestion.create({
            domain: b.domain,
            title: b.title,
            description: b.description,
            inputFormat: b.inputFormat || "",
            outputFormat: b.outputFormat || "",
            sampleInput: b.sampleInput || "",
            sampleOutput: b.sampleOutput || "",
            difficulty: ["Easy","Medium","Hard"].includes(b.difficulty) ? b.difficulty : "Easy",
            testCases: cleanCases
        });
        res.json({ success:true, question:q });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});
app.delete("/coordinator/coding-questions/:id", requireStaffSession, async(req,res)=>{
    try {
        await CodingQuestion.findByIdAndDelete(req.params.id);
        res.json({ success:true });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// Helper to calculate student's relative day number (1-based index)
function getStudentDayNumber(student) {
    if (!student) return 1;
    let startDate = null;
    if (student.joiningDate) {
        startDate = new Date(student.joiningDate);
    } else if (student.internshipStartDate) {
        startDate = new Date(student.internshipStartDate);
    } else if (student._id) {
        startDate = student._id.getTimestamp();
    }
    if (!startDate || isNaN(startDate.getTime())) {
        return 1;
    }
    const now = new Date();
    const startZero = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const nowZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = nowZero - startZero;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays + 1);
}

// ----- Student-facing -----
app.get("/student/coding-questions/:domain", requireStudentSession, async(req,res)=>{
    try {
        const domain = decodeURIComponent(req.params.domain);
        const employeeId = req.headers['x-employee-id'] || req.headers['employeeid'] || req.query.employeeId || (req.session && req.session.student && req.session.student.employeeId);
        const student = employeeId ? await Student.findOne({ employeeId }) : null;
        
        // Case-insensitive matching for domain
        const domainRegex = { $regex: new RegExp("^" + domain.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "$", "i") };
        
        const list = await CodingQuestion.find({ domain: domainRegex }).sort({ createdAt: 1 });
        if (!student || list.length === 0) {
            const safe = list.map(q => {
                const obj = q.toObject();
                obj.testCases = (obj.testCases || []).filter(t => !t.isHidden);
                obj.isToday = true;
                obj.isSolved = false;
                return obj;
            });
            return res.json({ success:true, questions:safe });
        }
        
        const dayNumber = getStudentDayNumber(student);
        const submissions = await CodingSubmission.find({ employeeId: student.employeeId, domain: domainRegex });
        const acceptedQuestionIds = new Set(
            submissions
                .filter(s => s.status === "Accepted")
                .map(s => String(s.questionId))
        );
        
        // Calculate today's 2 active indices based on dayNumber
        const idx1 = ((dayNumber - 1) * 2) % list.length;
        const idx2 = (((dayNumber - 1) * 2) + 1) % list.length;
        
        const processedQuestions = list.map((q, index) => {
            const obj = q.toObject();
            obj.testCases = (obj.testCases || []).filter(t => !t.isHidden);
            obj.isToday = (index === idx1 || (list.length > 1 && index === idx2));
            obj.isSolved = acceptedQuestionIds.has(String(q._id));
            return obj;
        });
        
        // Sort:
        // 1. Today's unsolved
        // 2. Today's solved
        // 3. Previous unsolved
        // 4. Previous solved
        processedQuestions.sort((a, b) => {
            if (a.isToday && !b.isToday) return -1;
            if (!a.isToday && b.isToday) return 1;
            if (a.isToday && b.isToday) {
                if (!a.isSolved && b.isSolved) return -1;
                if (a.isSolved && !b.isSolved) return 1;
                return 0;
            }
            // Both are previous
            if (!a.isSolved && b.isSolved) return -1;
            if (a.isSolved && !b.isSolved) return 1;
            return 0;
        });
        
        res.json({ success:true, questions:processedQuestions });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});
app.get("/student/coding-questions/question/:id", requireStudentSession, async(req,res)=>{
    try {
        const q = await CodingQuestion.findById(req.params.id);
        if(!q) return res.status(404).json({ success:false, message:"Not found" });
        const obj = q.toObject();
        obj.testCases = (obj.testCases || []).filter(t => !t.isHidden);
        res.json({ success:true, question:obj });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});
app.get("/student/coding-submissions/:employeeId", requireStudentSession, async(req,res)=>{
    try {
        const employeeId = decodeURIComponent(req.params.employeeId);
        const list = await CodingSubmission.find({ employeeId }).sort({ submittedAt:-1 });
        res.json({ success:true, submissions:list });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ----- Local code runner (child_process) -----
// Runs source code in a temp file with a 5-second timeout. Returns
// {success, output, error, executionTime}. NEVER throws on user-code errors;
// any stderr / nonzero exit is reported back as `error`. Temp files are
// cleaned up in `finally`. The runner refuses to start if the required
// language toolchain is missing, returning a friendly error.
const { spawn } = require("child_process");
const os = require("os");

function _hasCmd(cmd){
    // synchronous check — used once per /code/run call
    try {
        const r = require("child_process").spawnSync(
            process.platform === "win32" ? "where" : "which",
            [cmd],
            { stdio: "ignore" }
        );
        return r.status === 0;
    } catch(_) { return false; }
}

/**
 * The environment a student's program is allowed to see.
 *
 * spawn() inherits process.env by default, and this server's process.env holds
 * MONGODB_URI, SESSION_SECRET, ADMIN_PASSWORD_HASH, the SMTP password and the
 * payment keys. A three-line program printed every one of them:
 *
 *     console.log(process.env)          // JavaScript
 *     import os; print(os.environ)      // Python
 *
 * That is not a hypothetical — it is the whole reason ENABLE_CODE_RUNNER has
 * to default to off. The child now gets an explicit, minimal environment
 * instead of inheriting one, so the worst a submitted program can read is the
 * PATH. HOME points into the throwaway working directory so a runtime that
 * wants to write a cache does it there and it is deleted with everything else.
 *
 * This is still containment, not a sandbox — see the gate below.
 */
function _sandboxEnv(cwd){
    return {
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        HOME: cwd || os.tmpdir(),
        TMPDIR: cwd || os.tmpdir(),
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        // Java writes preferences and temp files relative to these.
        USER: "ten-runner",
        NODE_OPTIONS: ""
    };
}

function _runWithTimeout(cmd, args, opts){
    return new Promise((resolve) => {
        const startedAt = Date.now();
        let stdout = "";
        let stderr = "";
        let killed = false;
        let child;
        try {
            child = spawn(cmd, args, {
                ...opts,
                shell: false,
                env: _sandboxEnv(opts && opts.cwd),
                // Own process group, so a program that forks is killed with its
                // children rather than leaving them running on the host.
                detached: process.platform !== "win32"
            });
        } catch(e){
            return resolve({ ok:false, error: String(e.message || e), code: -1, executionTime: 0 });
        }
        const hardKill = () => {
            try {
                if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
                else child.kill("SIGKILL");
            } catch(_){ try { child.kill("SIGKILL"); } catch(__){} }
        };
        const timer = setTimeout(() => {
            killed = true;
            hardKill();
        }, (opts && opts.timeoutMs) || 5000);

        child.stdout.on("data", d => { stdout += d.toString(); if(stdout.length > 200000) stdout = stdout.slice(0, 200000) + "\n…[truncated]"; });
        child.stderr.on("data", d => { stderr += d.toString(); if(stderr.length > 200000) stderr = stderr.slice(0, 200000) + "\n…[truncated]"; });
        child.on("error", err => {
            clearTimeout(timer);
            resolve({ ok:false, error: String(err.message || err), code: -1, executionTime: Date.now() - startedAt });
        });
        child.on("close", code => {
            clearTimeout(timer);
            const elapsed = Date.now() - startedAt;
            if(killed) return resolve({ ok:false, error:"⏱ Time limit exceeded (5s).", code, executionTime: elapsed, stdout, stderr });
            resolve({ ok: code === 0, error: code === 0 ? "" : (stderr || `Process exited with code ${code}`), code, executionTime: elapsed, stdout, stderr });
        });

        if(opts && typeof opts.stdin === "string"){
            try { child.stdin.write(opts.stdin); child.stdin.end(); }
            catch(_){ try { child.stdin.end(); } catch(__){} }
        } else {
            try { child.stdin.end(); } catch(_){}
        }
    });
}

// Run a single piece of source code in `language`, with optional `stdin`.
// Returns: { success, output, error, executionTime }
async function runSourceCode({ code, language, stdin }){
    const lang = String(language || "javascript").toLowerCase();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ten-run-"));
    const cleanup = () => { try { fs.rmSync(tmpRoot, { recursive:true, force:true }); } catch(_){} };
    try {
        let result;
        if(lang === "javascript" || lang === "js"){
            const file = path.join(tmpRoot, "program.js");
            fs.writeFileSync(file, code, "utf8");
            result = await _runWithTimeout(process.execPath, [file], { stdin: stdin || "", cwd: tmpRoot, timeoutMs: 5000 });
        } else if(lang === "python" || lang === "py"){
            const file = path.join(tmpRoot, "program.py");
            fs.writeFileSync(file, code, "utf8");
            const py = _hasCmd("python3") ? "python3" : (_hasCmd("python") ? "python" : null);
            if(!py) return { success:false, output:"", error:"Python runtime not available on this server.", executionTime: 0 };
            result = await _runWithTimeout(py, ["-I", file], { stdin: stdin || "", cwd: tmpRoot, timeoutMs: 5000 });
        } else if(lang === "java"){
            if(!_hasCmd("javac") || !_hasCmd("java")) return { success:false, output:"", error:"Java toolchain (javac/java) not available on this server.", executionTime: 0 };
            // Force public class name to "Solution"
            const file = path.join(tmpRoot, "Solution.java");
            fs.writeFileSync(file, code, "utf8");
            const compile = await _runWithTimeout("javac", ["Solution.java"], { cwd: tmpRoot, timeoutMs: 10000 });
            if(!compile.ok) return { success:false, output:"", error: compile.error || compile.stderr || "Compilation failed", executionTime: compile.executionTime };
            result = await _runWithTimeout("java", ["-cp", ".", "Solution"], { stdin: stdin || "", cwd: tmpRoot, timeoutMs: 5000 });
        } else if(lang === "cpp" || lang === "c++"){
            if(!_hasCmd("g++")) return { success:false, output:"", error:"C++ compiler (g++) not available on this server.", executionTime: 0 };
            const src = path.join(tmpRoot, "program.cpp");
            const exe = path.join(tmpRoot, "a.out");
            fs.writeFileSync(src, code, "utf8");
            const compile = await _runWithTimeout("g++", ["-O2", "-std=c++17", "program.cpp", "-o", "a.out"], { cwd: tmpRoot, timeoutMs: 15000 });
            if(!compile.ok) return { success:false, output:"", error: compile.error || compile.stderr || "Compilation failed", executionTime: compile.executionTime };
            result = await _runWithTimeout(exe, [], { stdin: stdin || "", cwd: tmpRoot, timeoutMs: 5000 });
        } else {
            return { success:false, output:"", error:"Unsupported language: " + lang, executionTime: 0 };
        }

        return {
            success: !!result.ok,
            output: result.stdout || "",
            error:  result.ok ? "" : (result.error || result.stderr || ""),
            executionTime: result.executionTime || 0
        };
    } finally { cleanup(); }
}

// ─── Code runner gate ────────────────────────────────────────────────────────
//
// runSourceCode() writes attacker-controlled source to a temp file and executes
// it on this host with no container, no user isolation and no resource cap
// beyond a wall-clock kill. It was reachable by any anonymous request, which
// made it a remote-code-execution hole: read .env, exfiltrate MONGODB_URI, dump
// the student database, install persistence.
//
// Two controls now stand in front of it:
//   1. ENABLE_CODE_RUNNER must be explicitly "true" (documented in .env.example,
//      but never previously implemented). Default is off.
//   2. The caller must hold a student session, and is rate-limited per account.
//
//   3. The child process gets a scrubbed environment (_sandboxEnv above) and
//      its own process group, so a submitted program can neither read this
//      server's secrets out of process.env nor leave forked children behind.
//
// This is containment, NOT a sandbox. Before turning ENABLE_CODE_RUNNER on in
// production, move execution into a network-isolated, memory- and process-
// capped container. See docs/SECURITY-DO-NOT-EXPOSE.md.
const CODE_RUNNER_ENABLED = String(process.env.ENABLE_CODE_RUNNER || "").toLowerCase() === "true";

if (!CODE_RUNNER_ENABLED) {
    console.warn("[code-runner] Disabled (ENABLE_CODE_RUNNER is not 'true'). Coding challenges cannot be run or graded. Set ENABLE_CODE_RUNNER=true in .env to switch the section on.");
}

function requireCodeRunner(req, res, next) {
    if (!CODE_RUNNER_ENABLED) {
        // `message` as well as `error`. The terminal button reads
        // `d.message || "Could not create workspace"`, so a refusal that set
        // only `error` reached the student as "Failed — Could not create
        // workspace": a crash, for something that is switched off on purpose.
        return res.status(503).json({
            success: false,
            output: "",
            error: "The code runner is disabled on this server.",
            message: "The coding terminal is turned off at the moment. Your code and submissions are unaffected — ask your coordinator when it will be available.",
            executionTime: 0
        });
    }
    next();
}

// So the modal can say "the runner is off" before a student writes a solution
// and presses Run, rather than after. Booleans only — no configuration values.
app.get("/api/code-runner/status", (req, res) => {
    res.json({ success: true, enabled: CODE_RUNNER_ENABLED });
});

// Per-account cap: executing code is far more expensive than a normal request.
const codeRunLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    // Same IPv6 caveat as loginRateLimitKey. express-rate-limit raises
    // ERR_ERL_KEY_GEN_IPV6 at startup for a raw req.ip, which is how this was
    // spotted in the production logs.
    keyGenerator: (req) => sessionEmployeeId(req) || ipKeyGenerator(req.ip),
    message: { success: false, output: "", error: "Too many runs. Wait a minute and try again.", executionTime: 0 }
});

app.post("/code/run", requireCodeRunner, requireStudentSession, codeRunLimiter, async(req,res)=>{
    try {
        const { code, language, input } = req.body || {};
        if(!code) return res.json({ success:false, output:"", error:"No code provided", executionTime: 0 });
        const r = await runSourceCode({ code, language, stdin: input || "" });
        res.json(r);
    } catch(e){
        console.log("/code/run error:", e && e.message);
        res.status(500).json({ success:false, output:"", error:"Server error", executionTime: 0 });
    }
});

// ==================================================================
// ============ SHARED CODE EVALUATION FUNCTION ====================
// ==================================================================
async function evaluateCodeSubmission({ employeeId, questionId, language, code, proctored, violations }) {
    const q = await CodingQuestion.findById(questionId);
    if(!q) return { success:false, message:"Question not found", notFound:true };
    const cases = q.testCases || [];
    if(!cases.length){
        return { success:false, message:"This question has no test cases configured" };
    }

    const results = [];
    let passed = 0;
    let runtimeError = false;
    for(const tc of cases){
        const r = await runSourceCode({ code, language, stdin: tc.input || "" });
        const expected = String(tc.expectedOutput || "").trim();
        const actual   = String(r.output || "").trim();
        const ok = r.success && actual === expected;
        if(!r.success && r.error) runtimeError = true;
        if(ok) passed++;
        results.push({
            input: tc.isHidden ? "(hidden)" : (tc.input || ""),
            expected: tc.isHidden ? "(hidden)" : expected,
            actual: r.success ? actual : "",
            error: r.success ? "" : (r.error || ""),
            isHidden: !!tc.isHidden,
            passed: ok,
            executionTime: r.executionTime || 0
        });
    }

    const status = passed === cases.length
        ? "Accepted"
        : (runtimeError ? "Runtime Error" : "Wrong Answer");

    const sub = await CodingSubmission.create({
        employeeId,
        domain: q.domain,
        questionId: q._id,
        language: language || "javascript",
        code,
        status,
        passedCases: passed,
        totalCases: cases.length,
        proctored: !!proctored,
        violations: Number(violations) || 0
    });

    // Fire-and-forget GitHub push on Accepted
    if(status === "Accepted"){
        pushToGitHub(sub, q, code).catch(e => console.log("[GitHub Push] fire-and-forget error:", e.message));
    }

    return {
        success: status === "Accepted",
        status,
        passedCases: passed,
        totalCases: cases.length,
        results,
        submissionId: sub._id
    };
}

app.post("/code/submit", requireCodeRunner, requireStudentSession, codeRunLimiter, async(req,res)=>{
    try {
        const { questionId, language, code, proctored, violations } = req.body || {};
        // Identity from the session, never from the body. The body-supplied
        // employeeId meant a student could file an accepted solution under
        // another student's ID and take their score.
        const employeeId = (req.session && req.session.student && req.session.student.employeeId) || "";
        if(!employeeId) return res.status(401).json({ success:false, message:"Please sign in again." });
        if(!questionId || !code){
            return res.json({ success:false, message:"questionId and code are required" });
        }
        const result = await evaluateCodeSubmission({ employeeId, questionId, language, code, proctored, violations });
        if(result.notFound) return res.status(404).json({ success:false, message:result.message });
        res.json(result);
    } catch(e){
        console.log("/code/submit error:", e && e.message);
        res.status(500).json({ success:false, message:"Server error: " + (e && e.message) });
    }
});

// The "Open in Terminal" workspace used to be created here: a directory under
// /tmp on the SERVER holding starter code, a README and a submit.sh that
// curled localhost. The dialog printed that server path to the student and
// told them to cd into it — instructions no student could follow, because
// nobody reading the dashboard has a shell on the production host. The button
// now opens the run console beside the editor, and these two endpoints (which
// nothing calls) are gone with it.

// Coordinator's read-only view of student coding submissions in their domain
app.get("/coordinator/coding-submissions/:domain", requireStaffSession, async(req,res)=>{
    try {
        const domain = decodeURIComponent(req.params.domain);
        const list = await CodingSubmission.find({ domain }).sort({ submittedAt:-1 }).limit(200);
        res.json({ success:true, submissions:list });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ================= PUBLIC DOCUMENT VERIFICATION =================

// Public, unauthenticated: the numbers and the domain list the landing page
// shows. Counts only — no student records, no names, nothing identifying.
//
// The home page previously hardcoded "10+ Domains" and "500+ Interns", which
// were wrong in both directions and would drift further every week. Serving
// them from the same config the registration form reads means the page can
// never advertise a domain a student cannot pick.
//
// Cached, because this is the most-visited page on the site and a burst of
// visitors should not become a burst of collection scans.
let _publicStatsCache = { at: 0, body: null };
const PUBLIC_STATS_TTL_MS = 5 * 60 * 1000;

/** "Anmol Kumar" -> "Anmol K." — a public page does not need a full name. */
function shortenPublicName(full) {
    const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "A TEN intern";
    if (parts.length === 1) return parts[0];
    return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
}

app.get('/api/public/stats', async (req, res) => {
    try {
        if (_publicStatsCache.body && (Date.now() - _publicStatsCache.at) < PUBLIC_STATS_TTL_MS) {
            return res.json(_publicStatsCache.body);
        }
        const { SELECTABLE_DOMAIN_NAMES } = require("./config/domains");
        const StudentCoin = require("./models/new/StudentCoin");

        // Top interns by coins, for the landing page's proof strip.
        //
        // Deliberately NOT /leaderboard/overall: those rows carry `employeeId`,
        // which is the login identifier and is printed on every certificate.
        // Nothing here identifies an account — a shortened name, a domain and a
        // total.
        const [interns, certificates, topCoins] = await Promise.all([
            Student.estimatedDocumentCount(),
            DocumentHistory.estimatedDocumentCount().catch(() => 0),
            StudentCoin.find({ totalCoins: { $gt: 0 } })
                .sort({ totalCoins: -1 }).limit(8).select("studentId totalCoins").lean()
        ]);

        let top = [];
        if (topCoins.length) {
            const owners = await Student.find({ _id: { $in: topCoins.map(c => c.studentId) } })
                .select("_id name firstName lastName domain").lean();
            const byId = {};
            owners.forEach(o => { byId[String(o._id)] = o; });
            top = topCoins.map(c => {
                const s = byId[String(c.studentId)];
                if (!s) return null;
                return {
                    name: shortenPublicName(s.name || `${s.firstName || ""} ${s.lastName || ""}`),
                    domain: s.domain || "",
                    coins: c.totalCoins || 0
                };
            }).filter(Boolean);
        }

        const body = {
            success: true,
            interns,
            certificates,
            domains: SELECTABLE_DOMAIN_NAMES.length,
            domainNames: SELECTABLE_DOMAIN_NAMES,
            tracks: 6,
            top
        };
        _publicStatsCache = { at: Date.now(), body };
        res.json(body);
    } catch (err) {
        console.error('[public-stats]', err.message);
        // The page falls back to whatever is already rendered, so a failure here
        // shows stale-but-sane text rather than an empty row.
        res.json({ success: false, domainNames: [], tracks: 6, top: [] });
    }
});

/**
 * GET /api/public/domains — every domain we actually offer, with its curriculum.
 *
 * public/student-journeys.html carried a hardcoded list of fourteen. It had
 * drifted: it advertised Vibe Coding, Space Research, Business Analyst and HR
 * Management — none of which a student can register for — and omitted
 * Artificial Intelligence, Business Development, HR, Space Intern and Finance,
 * which they can. Somebody reading that page chose a domain that does not
 * exist on the form.
 *
 * config/domains.js was written to be the one list precisely so this could not
 * happen, and a page that never read it drifted anyway. Serving it here means
 * a domain appears on the marketing page if and only if it appears on the
 * registration form.
 *
 * Week titles come from the seeded DomainTask rows, so the curriculum shown is
 * the curriculum taught. A domain with nothing seeded yet simply shows no
 * weeks rather than an invented syllabus.
 */
let _publicDomainsCache = { at: 0, body: null };

app.get('/api/public/domains', async (req, res) => {
    try {
        if (_publicDomainsCache.body && (Date.now() - _publicDomainsCache.at) < PUBLIC_STATS_TTL_MS) {
            return res.json(_publicDomainsCache.body);
        }
        const { DOMAINS } = require("./config/domains");
        const DomainTask = require("./models/new/DomainTask");

        // One pass over the library rather than a query per domain.
        const rows = await DomainTask.find({ durationType: "1month" })
            .select("domain weekNumber taskTitle -_id")
            .sort({ domain: 1, weekNumber: 1 })
            .lean();

        const weeksByDomain = {};
        for (const r of rows) {
            (weeksByDomain[r.domain] = weeksByDomain[r.domain] || []).push(r.taskTitle);
        }

        // The task engine files some domains under another name; mirror it so
        // the page shows a curriculum instead of an empty card.
        const ALIAS = {
            "Artificial Intelligence": "Data Science",
            "HR": "HR Management",
            "Space Intern": "Space Research",
            "Business Development": "Business Analyst",
            "Finance": "Venture Capital"
        };

        const body = {
            success: true,
            domains: DOMAINS.filter(d => d.selectable).map(d => ({
                name: d.name,
                code: d.shortCode,
                weeks: weeksByDomain[d.name] || weeksByDomain[ALIAS[d.name]] || []
            }))
        };
        _publicDomainsCache = { at: Date.now(), body };
        res.json(body);
    } catch (err) {
        console.error('[public-domains]', err.message);
        // Names still come from config even with no database, so the page can
        // always draw the grid — it just shows no week list.
        try {
            const { DOMAINS } = require("./config/domains");
            return res.json({
                success: true,
                domains: DOMAINS.filter(d => d.selectable)
                    .map(d => ({ name: d.name, code: d.shortCode, weeks: [] }))
            });
        } catch (_) {
            res.json({ success: false, domains: [] });
        }
    }
});

app.get('/domains', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'domains.html'));
});

app.get('/verify-document', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

app.get('/verify', (req, res) => {
    res.redirect('/verify-document' + (req.query.id ? '?id=' + req.query.id : ''));
});

app.get('/api/verify-document/:id', async (req, res) => {
    try {
        const docId = normalizeDocumentNumber(decodeURIComponent(req.params.id));
        if (!docId) return res.status(400).json({ error: 'Document ID is required' });

        let record = await DocumentHistory.findOne({ documentNumber: docId }).lean();
        if (!record) {
            record = await DocumentHistory.findOne({ documentNumber: { $regex: "^" + docId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", $options: "i" } }).lean();
        }
        if (record) {
            const student = record.studentId
                ? await Student.findById(record.studentId).select("firstName lastName name employeeId domain collegeName college").lean()
                : null;
            const studentName =
                (record.studentName || student?.name || `${student?.firstName || ""} ${student?.lastName || ""}`.trim() || "").trim();
            const employeeId = record.employeeId || student?.employeeId || "";
            const domain = record.domain || student?.domain || "";
            const college = record.college || student?.collegeName || student?.college || "";
            const issuedDate = record.sentAt || record.createdAt || null;

            return res.json({
                verified: true,
                document_number: record.documentNumber,
                student_name: studentName,
                employee_id: employeeId,
                document_type: record.documentType || record.documentKey || "",
                domain: domain || "N/A",
                college: college || "N/A",
                issued_date: issuedDate,
                issued_by: "The Entrepreneurship Network (TEN)",
                document: {
                    documentId: record.documentNumber,
                    docType: record.documentKey || "document",
                    employeeId,
                    domain,
                    generatedAt: issuedDate,
                    generatedBy: record.sentBy || "TEN"
                },
                student: {
                    firstName: student?.firstName || "",
                    lastName: student?.lastName || "",
                    employeeId,
                    domain,
                    college
                }
            });
        }

        const StudentModel = require('./models/Student');

        let student = await StudentModel.findOne({ autoDocUniqueId: docId }).select('firstName lastName employeeId domain collegeName college email documentsAutoSentAt autoDocUniqueId').lean();
        if (!student) {
            return res.status(404).json({ error: 'Document not found', docId });
        }

        return res.json({
            verified: true,
            exactMatch: student.autoDocUniqueId === docId,
            document_number: docId,
            student_name: (student.firstName || '') + ' ' + (student.lastName || ''),
            employee_id: student.employeeId || '',
            document_type: 'Internship Documents',
            domain: student.domain || 'N/A',
            college: student.collegeName || student.college || 'N/A',
            issued_date: student.documentsAutoSentAt || null,
            issued_by: "The Entrepreneurship Network (TEN)",
            document: {
                documentId: docId,
                docType: 'internship_documents',
                employeeId: student.employeeId || '',
                domain: student.domain || '',
                generatedAt: student.documentsAutoSentAt || null,
                generatedBy: 'System (Auto-generated)'
            },
            student: {
                firstName: student.firstName || '',
                lastName: student.lastName || '',
                employeeId: student.employeeId || '',
                domain: student.domain || '',
                college: student.collegeName || student.college || ''
            }
        });
    } catch (err) {
        console.error('[VERIFY] Error:', err.message);
        return res.status(500).json({ error: 'Server error during verification' });
    }
});

const resumeStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/documents/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'resume-' + uniqueSuffix + '.pdf');
    }
});
const resumeUpload = multer({
    storage: resumeStorage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    fileFilter: function (req, file, cb) {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files are allowed!'), false);
        }
        cb(null, true);
    }
});

app.post('/api/v2/upload-resume', function (req, res) {
    resumeUpload.single('resume')(req, res, function (err) {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ success: false, message: 'File is too large! Maximum limit is 25MB.' });
            }
            return res.status(400).json({ success: false, message: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a PDF resume file.' });
        }
        const filePath = '/uploads/documents/' + req.file.filename;
        return res.json({ success: true, filePath: filePath });
    });
});

app.get('/api/v2/verify/:documentNumber', async (req, res) => {
    res.redirect(302, "/api/verify-document/" + encodeURIComponent(req.params.documentNumber || ""));
});

// ================= V2 STUDENT PORTAL ROUTES =================
// NEW FEATURE: Mount all /api/v2/ routes — must stay above server.listen
try {
    const v2StudentPortal = require("./routes/v2/studentPortal");
    app.use("/api/v2", v2StudentPortal);
    console.log("[V2] Student portal routes mounted at /api/v2");

    // POST /api/v2/admin/attendance/recalculate — Global Recalculation API
    app.post('/api/v2/admin/attendance/recalculate', async (req, res) => {
        try {
            if (!req.session?.adminUser) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }

            const Student = require('./models/Student');
            const Attendance = require('./models/Attendance');
            const { calculateAttendancePercentage } = require('./utils/attendanceUtils');

            const students = await Student.find({});
            let updatedCount = 0;

            for (const student of students) {
                if (!student.joiningDate) continue;

                // Count both capitalized and lowercase "Present"
                const presentCount = await Attendance.countDocuments({
                    employeeId: student.employeeId,
                    status: { $in: ["Present", "present"] }
                });

                const percentage = calculateAttendancePercentage(student, presentCount);

                student.attendancePercentage = percentage;
                student.calculatedAttendancePercentage = percentage;
                student.calculatedAttendance = percentage; // auto-heal
                await student.save();
                updatedCount++;
            }

            res.json({ success: true, message: `Successfully recalculated attendance for ${updatedCount} students.` });
        } catch (err) {
            console.error('Error during global attendance recalculation:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
} catch(e) {
    console.error("[V2] Failed to mount student portal routes:", e.message);
}

// NEW FEATURE: Quiz System
// NEW FEATURE: Mount /api/v2/quiz routes (Task Journey only)
try {
    const v2QuizRouter = require("./routes/v2/quiz");
    app.use("/api/v2/quiz", v2QuizRouter);
    console.log("[V2] Quiz routes mounted at /api/v2/quiz");
} catch(e) {
    console.error("[V2] Failed to mount quiz routes:", e.message);
}

// NEW FEATURE: Document Upload + Offer Letter routes
try {
    const v2Documents = require("./routes/v2/documents");
    app.use("/api/v2", v2Documents);
    console.log("[V2] Document routes mounted at /api/v2");
} catch(e) {
    console.error("[V2] Failed to mount document routes:", e.message);
}

// Direct messages, personal blocking, abuse reports, admin moderation desk.
try {
    app.use("/api/chat", require("./routes/chatModeration"));
    console.log("[Chat] Moderation + DM routes mounted at /api/chat");
} catch(e) {
    console.error("[Chat] Failed to mount moderation routes:", e.message);
}

// The student's half of an admin credential reset: set your own password, and
// confirm or correct the email an admin changed for you.
try {
    app.use("/api/student/security", require("./routes/studentSecurity"));
    console.log("[Security] Student credential routes mounted at /api/student/security");
} catch(e) {
    console.error("[Security] Failed to mount student credential routes:", e.message);
}

// Web push subscriptions, and the merged notification feed.
try {
    app.use("/api/push", require("./routes/push"));
    app.use("/api/notifications", require("./routes/notificationFeed"));
    console.log("[Push] Push + notification routes mounted at /api/push and /api/notifications");
} catch(e) {
    console.error("[Push] Failed to mount push routes:", e.message);
}

// Student-initiated certificate applications + the per-type HR queues.
try {
    const v2CertApplications = require("./routes/v2/certificateApplications");
    app.use("/api/v2/certificate-applications", v2CertApplications);
    console.log("[V2] Certificate application routes mounted at /api/v2/certificate-applications");
} catch(e) {
    console.error("[V2] Failed to mount certificate application routes:", e.message);
}

// NEW FEATURE: Certificate + Psychology Trigger routes
try {
    const v2Certificates = require("./routes/v2/certificates");
    app.use("/api/v2", v2Certificates);
    console.log("[V2] Certificate routes mounted at /api/v2");
} catch(e) {
    console.error("[V2] Failed to mount certificate routes:", e.message);
}

try {
    app.use('/api/v2/certificates', require('./routes/v2/certificates'));
    console.log('[V2] Certificate routes mounted at /api/v2/certificates');
} catch(e) {
    console.error('[V2] Failed to mount certificate routes:', e.message);
}

try {
    const v2HR = require("./routes/v2/hr");
    app.use("/api/v2/hr", v2HR);
    console.log("[V2] HR routes mounted at /api/v2/hr");
} catch(e) {
    console.error("[V2] Failed to mount HR routes:", e.message);
}

// PAYMENT GATEWAY — PaymentSetu UPI integration
try {
    const v2Payment = require('./routes/v2/payment');
    app.use('/api/v2/payment', v2Payment);
    console.log('[V2] Payment routes mounted at /api/v2/payment');
} catch(e) {
    console.error('[V2] Failed to mount payment routes:', e.message);
}

// COIN REDEMPTION MARKETPLACE — Mentorship & Certificate Discounts
try {
    const v2Marketplace = require('./routes/v2/marketplace');
    app.use('/api/v2/marketplace', v2Marketplace);
    console.log('[V2] Marketplace routes mounted at /api/v2/marketplace');
} catch(e) {
    console.error('[V2] Failed to mount marketplace routes:', e.message);
}

// TENURE PAYMENT SYSTEM ROUTES
const SHORT_COURSE_PRICES = {
  '1week':   2000,
  '15days':  1500,
  '1month':  1000
};
// Just the tenure name. The dashboard composes the sentence around it, and
// these values used to already contain "Internship Program", producing
// "Under the TEN 1 Month Internship Program Internship Program, ..." —
// the wrong-label bug reported in issue 6.2 / Screenshot 8.
const SHORT_COURSE_LABELS = {
  '1week':   '1 Week',
  '15days':  '15 Days',
  '1month':  '1 Month'
};
const PAYMENT_CUTOFF_DATE = new Date('2026-07-09T00:00:00.000Z');

// One-time migration: mark all pre-cutoff students as exempt
app.post('/api/admin/mark-existing-students', async (req, res) => {
  if (req.headers['x-admin-secret'] !== (process.env.ADMIN_API_SECRET || 'TEN_ADMIN_SECRET')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const CUTOFF = new Date('2026-07-09T00:00:00.000Z');
    const result = await Student.updateMany(
      { createdAt: { $lt: CUTOFF } },
      { $set: { isExistingStudent: true, shortCoursePaid: true } }
    );
    res.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if student needs to pay for their tenure
app.get('/api/tenure-payment/status', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'] || req.headers['employeeid'] || (req.session && req.session.student && (req.session.student.employeeId || req.session.student._id || req.session.student.id));
    if (!employeeId) return res.status(401).json({ error: 'Not authenticated' });

    // Try finding by employeeId first, then by id/email
    let stu = await Student.findOne({ employeeId: String(employeeId) });
    if (!stu && mongoose.Types.ObjectId.isValid(employeeId)) {
      stu = await Student.findById(employeeId);
    }
    if (!stu) {
      // Try to find via session email
      const email = req.session && req.session.student && req.session.student.email;
      if (email) {
        stu = await Student.findOne({ email: email.toLowerCase() });
      }
    }
    if (!stu) return res.status(404).json({ error: 'Student not found' });

    // Shared tenure parsing. The ad-hoc lowercase+strip here only worked for
    // values that already matched a key exactly; anything else fell through as
    // "not a short course" and skipped payment, or the reverse.
    const tenure = tenureUtils.normalizeTenure(stu.tenure) || '';
    const isShortCourse = ['1week', '15days', '1month'].includes(tenure);
    const price = SHORT_COURSE_PRICES[tenure] || 0;
    let isPaid = stu.shortCoursePaid || false;
    const isExistingStudent = stu.isExistingStudent || false;

    // Check the latest payment status — use exact purpose to avoid $regex issues in local fallback
    const Payment = require('./models/Payment');
    const exactPurpose = 'tenure_' + tenure;
    const latestPayment = await Payment.findOne({ studentId: stu._id, purpose: exactPurpose }).sort({ createdAt: -1 });

    // Self-healing: if a successful payment record exists but shortCoursePaid wasn't set, fix it now
    if (latestPayment && latestPayment.status === 'success' && !isPaid) {
      try {
        await Student.updateOne(
          { _id: stu._id },
          { $set: { shortCoursePaid: true, shortCoursePaymentVerified: true } }
        );
        isPaid = true;
        console.log('[Tenure] Self-healed shortCoursePaid for student:', stu.employeeId);
      } catch (healErr) {
        console.error('[Tenure] Self-heal failed:', healErr.message);
      }
    }

    const pendingVerification = latestPayment && latestPayment.status === 'pending_verification';
    const rejectionReason = latestPayment && latestPayment.status === 'failed' ? latestPayment.rejectionReason : null;

    res.json({
      requiresPayment: isShortCourse && !isPaid,
      isExistingStudent: isExistingStudent,
      isPaid: isPaid,
      pendingVerification: !!pendingVerification,
      rejectionReason: rejectionReason,
      tenure: tenure,
      price: price,
      label: SHORT_COURSE_LABELS[tenure] || '',
      isShortCourse: isShortCourse
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Student submits transaction ID for tenure payment
app.post('/api/tenure-payment/submit-utr', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'] || req.headers['employeeid'] || (req.session && req.session.student && (req.session.student.employeeId || req.session.student._id || req.session.student.id));
    if (!employeeId) return res.status(401).json({ error: 'Not authenticated' });

    const { utr } = req.body;
    const sanitizedUtr = (utr || '').trim();
    if (!sanitizedUtr || !/^[A-Za-z0-9]{6,25}$/.test(sanitizedUtr)) {
      return res.status(400).json({ error: 'Please enter a valid Transaction ID (6 to 25 characters, letters and numbers only).' });
    }

    // Try finding by employeeId first, then by id/email
    let stu = await Student.findOne({ employeeId: String(employeeId) });
    if (!stu && mongoose.Types.ObjectId.isValid(employeeId)) {
      stu = await Student.findById(employeeId);
    }
    if (!stu) {
      const email = req.session && req.session.student && req.session.student.email;
      if (email) {
        stu = await Student.findOne({ email: email.toLowerCase() });
      }
    }
    if (!stu) return res.status(404).json({ error: 'Student not found' });

    // Shared tenure parsing. The ad-hoc lowercase+strip here only worked for
    // values that already matched a key exactly; anything else fell through as
    // "not a short course" and skipped payment, or the reverse.
    const tenure = tenureUtils.normalizeTenure(stu.tenure) || '';
    const price = SHORT_COURSE_PRICES[tenure] || 0;

    // Save payment record
    const Payment = require('./models/Payment');
    const orderId = 'TEN-TENURE-' + Date.now() + '-' + Math.random().toString(16).slice(2,6).toUpperCase();
    await Payment.create({
      orderId,
      studentId: stu._id,
      amount: price,
      currency: 'INR',
      provider: 'upi',
      purpose: 'tenure_' + tenure,
      status: 'pending_verification',
      providerPaymentId: sanitizedUtr,
      mode: 'manual'
    });

    // Mark student as payment pending (not yet verified)
    stu.shortCoursePaymentId = orderId;
    await stu.save();

    res.json({ success: true, orderId, message: 'Transaction ID submitted. Verification takes 24–48 hours.' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// TEN ASSISTANT — answers from the portal's own DomainTask rows, no API key
try {
    const v2Assistant = require('./routes/v2/assistant');
    app.use('/api/v2/assistant', v2Assistant);
    app.get('/assistant', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assistant.html')));

    const v2Academics = require('./routes/v2/academics');
    app.use('/api/v2/academics', v2Academics);
    app.get('/academics', (req, res) => res.sendFile(path.join(__dirname, 'public', 'academics.html')));
    // Resume agent — scores a resume the way an ATS does and rebuilds it. Same
    // offline stance as the assistant: deterministic checks, no API key.
    const v2ResumeAgent = require('./routes/v2/resumeAgent');
    app.use('/api/v2/resume', v2ResumeAgent);

    console.log('[V2] Academics mounted at /api/v2/academics, page at /academics');
    console.log('[V2] Assistant mounted at /api/v2/assistant, page at /assistant');
    console.log('[V2] Resume agent mounted at /api/v2/resume');
} catch(e) {
    console.error('[V2] Failed to mount assistant routes:', e.message);
}

// ── PHASE 2: Ecosystem Platform Routes ────────────────────────────────────
try {
    const founderProfileRoutes  = require('./routes/founderProfileRoutes');
    const mentorProfileRoutes   = require('./routes/mentorProfileRoutes');
    const investorProfileRoutes = require('./routes/investorProfileRoutes');
    const notificationRoutes    = require('./routes/notificationRoutes');
    const verificationRoutes    = require('./routes/verificationRoutes');
    const hrDashboardRoutes     = require('./routes/hrDashboardRoutes');
    const programApiRoutes      = require('./routes/programApiRoutes');

    app.use('/api/founder', founderProfileRoutes);
    app.use('/api/mentor', mentorProfileRoutes);
    app.use('/api/investor', investorProfileRoutes);
    app.use('/api/ecosystem-notifications', notificationRoutes);
    app.use('/api/feedback', require('./routes/studentFeedback'));
    app.use('/api/verification', verificationRoutes);
    app.use('/api/hr', hrDashboardRoutes);
    app.use('/api', programApiRoutes);

    console.log('[Phase2] Standard ecosystem profile routes mounted successfully');
} catch(e) {
    console.error('[Phase2] Failed to mount standard ecosystem profile routes:', e.message);
}

// Additional Ecosystem Feature API Routes from Gimini Project
try { app.use("/api/founder",    require("./routes/founderRoutes"));       } catch(e) { console.error("[Routes] founderRoutes:", e.message); }
try { app.use("/api/mentor",     require("./routes/mentorRoutes"));        } catch(e) { console.error("[Routes] mentorRoutes:", e.message); }
try { app.use("/api/investor",   require("./routes/investorRoutes"));      } catch(e) { console.error("[Routes] investorRoutes:", e.message); }
try { app.use("/api/contractor", require("./routes/contractorRoutes"));    } catch(e) { console.error("[Routes] contractorRoutes:", e.message); }
try { app.use("/api/hr-dashboard", require("./routes/hrDashboardRoutes")); } catch(e) { console.error("[Routes] hrDashboardRoutes:", e.message); }
try { app.use("/api/talent-network", require("./routes/talentNetwork"));   } catch(e) { console.error("[Routes] talentNetwork:", e.message); }
try { app.use("/api/talent-profile", require("./routes/talentProfile"));   } catch(e) { console.error("[Routes] talentProfile:", e.message); }
try { app.use("/api/founder-os", require("./routes/founderOS"));           } catch(e) { console.error("[Routes] founderOS:", e.message); }
try { app.use("/api/community",  require("./routes/community"));           } catch(e) { console.error("[Routes] community:", e.message); }
try { app.use("/api/notifications", require("./routes/notificationRoutes"));} catch(e) { console.error("[Routes] notificationRoutes:", e.message); }

// NEW FEATURE: Serve uploaded certificates, documents, and offer letters
const expressModule = require("express");
app.use("/uploads/certificates", expressModule.static("uploads/certificates"));
app.use("/uploads/documents",    expressModule.static("uploads/documents"));
app.use("/uploads/offer-letters", expressModule.static("uploads/offer-letters"));

// Admin Portal — Internal Only
const { requireAdmin } = require('./middleware/adminAuth');
const adminPortalRoutes = require('./routes/adminPortal');

// URL Cleanup middleware for copy-pasted URLs with trailing quotes, brackets, or braces
app.use((req, res, next) => {
    if (req.path && req.path.startsWith('/ten-admin')) {
        let cleanPath = req.path;
        // Strip trailing double-quotes, single-quotes, curly braces, square brackets, parentheses, backslashes, percent signs
        cleanPath = cleanPath.replace(/["'\}\]\\\)\s%]+$/, '');
        if (cleanPath !== req.path) {
            console.log(`[RouteCleanup] Redirecting from dirty path "${req.path}" to clean path "${cleanPath}"`);
            return res.redirect(cleanPath);
        }
    }
    next();
});

app.use('/api/admin-internal', adminPortalRoutes);
app.get('/ten-admin/login', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'public', 'ten-admin-login.html'));
});
app.get('/ten-admin', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'public', 'ten-admin.html'));
});

// ================= SERVER =================

// (PORT already declared earlier)
const server = http.createServer(app);

const io = new SocketIOServer(server, {
    cors: { origin: "*", methods: ["GET","POST"] }
});

// Routers reach the socket server through the app, so read receipts and
// presence do not need it passed around.
app.set("io", io);

io.use(async (socket, next) => {
    try{
        // From the session cookie, for every role. The handshake's `auth`
        // payload is ignored: it is supplied by the caller, so trusting it let
        // anyone open a socket as anyone. Pages that still send one are
        // unaffected — they are all signed in, and the cookie is what counts.
        const identity = await chatIdentityFromSocket(socket);
        if(!identity) return next(new Error("unauthorized"));
        socket.data.identity = identity;
        // Auto-join all rooms this user is allowed in
        roomsAllowedFor(identity).forEach(r => socket.join(r));
        // Personal channel: how a DM reaches someone who has not opened that
        // conversation yet, and how an admin's direct message finds them.
        //
        // One channel per alias. A message addressed to an HR user's username
        // was landing on a channel they had not joined — the notice never
        // arrived, and because "is anybody listening?" then answered no, they
        // got a push notification for a portal they had open in front of them.
        Array.from(chatIdentity.aliasSet(identity)).forEach(a => socket.join("user::" + a));
        socket.join("user::" + identity.id);
        next();
    } catch(e){ next(new Error("auth_error")); }
});

/**
 * Save a chat message and deliver it — the one implementation.
 *
 * Both the Socket.IO `send_message` event and POST /chat/messages call this, so
 * the permission check, the block check, the fan-out and the push notification
 * cannot drift apart between the two paths.
 *
 * `identity` always comes from the session. `payload` is only ever content.
 */
async function deliverChatMessage(identity, payload) {
    try {
        const room = payload && payload.room;
        const text = (payload && payload.text || "").toString().trim().slice(0, 4000);

        // An image-only message is valid. The URL must be one this server
        // issued via POST /chat/upload-image — never an arbitrary address
        // supplied by the caller, which would let chat embed remote content
        // or a tracking pixel.
        const rawImageUrl = (payload && payload.imageUrl || "").toString();
        const imageUrl = /^\/uploads\/chat\/[A-Za-z0-9._-]+$/.test(rawImageUrl) ? rawImageUrl : null;
        if (rawImageUrl && !imageUrl) { return { success:false, code:"bad_image", message:"That image could not be accepted." }; }

        if(!room || (!text && !imageUrl)) { return { success:false, code:"empty", message:"There is nothing to send." }; }
        if(!canAccessRoom(identity, room)) { return { success:false, code:"forbidden", message:"You cannot send messages in this conversation." }; }

        // Feature 8: block check — sender silenced in this room?
        try{
            const blocked = await BlockList.findOne({ chatRoom: room, blockedUser: identity.id });
            if(blocked){
                return { success:false, code:"blocked", blocked:true,
                    message:"You have been restricted from sending messages in this chat" };
            }
        }catch(_){}

        const doc = await Message.create({
            chatRoom:     room,
            senderId:     identity.id,
            senderName:   identity.name,
            senderRole:   identity.role,
            senderDomain: identity.domain || "",
            message:      text,
            imageUrl:     imageUrl,
            imageName:    imageUrl ? String((payload && payload.imageName) || "image").slice(0, 120) : null,
            imageMime:    imageUrl ? String((payload && payload.imageMime) || "").slice(0, 60) : null,
            timestamp:    new Date()
        });
        // Deliver to everyone in the room EXCEPT people who have blocked
        // the sender (or whom the sender has blocked). Emitting to the
        // room and hiding it client-side would still put the text on the
        // blocked person's machine, which is not a block.
        let hidden = new Set();
        try { hidden = await UserBlock.hiddenFor(identity.id); } catch(_) {}

        if (hidden.size) {
            const sockets = await io.in(room).fetchSockets();
            for (const s of sockets) {
                const other = s.data && s.data.identity;
                if (other && hidden.has(String(other.id))) continue;
                s.emit("receive_message", doc);
            }
        } else {
            io.to(room).emit("receive_message", doc);
        }

        // A private message must also reach a recipient who does not have
        // that conversation open — otherwise the first DM from anyone is
        // invisible until they happen to look.
        const pair = dmParticipants(room);
        if (pair) {
            // Against every id the sender is known by. Comparing only the
            // canonical one made a person their own correspondent when the
            // room had been named with their other id, so the notice went
            // back to the sender and never reached the recipient.
            // An admin writing into a conversation they are overseeing is
            // not one of the two participants, so BOTH of them need
            // telling. Anyone else has exactly one correspondent.
            const mine = chatIdentity.otherParticipant(identity, room);
            const recipients = mine !== null
                ? [mine]
                : (identity.role === "admin" ? pair.slice() : []);

            for (const other of recipients) {
                if (!other || hidden.has(other)) continue;
                io.to("user::" + other).emit("dm_notice", {
                    room, from: identity.name, fromId: identity.id, preview: text.slice(0, 80)
                });

                // ...and if their portal is CLOSED, a push notification, so
                // the message reaches them the way any other app would
                // reach them. Skipped when they already have the portal
                // open somewhere: they can see it, and a buzz for a message
                // that is already on screen is just noise.
                try {
                    const openSockets = await io.in("user::" + other).fetchSockets();
                    if (!openSockets.length) {
                        const pushService = require("./services/pushService");
                        await pushService.sendToUser(other, {
                            title: identity.name || "New message",
                            body: imageUrl && !text ? "Sent you a photo" : text.slice(0, 140),
                            // Straight into the conversation. Whether they
                            // land signed in is decided by their session
                            // cookie — there is deliberately no credential
                            // in this URL.
                            url: "/messages?to=" + encodeURIComponent(String(identity.id)),
                            // One notification per sender, replaced as more
                            // arrive, rather than a stack of twenty.
                            tag: "dm-" + String(identity.id)
                        });
                    }
                } catch (pushErr) {
                    // A push that fails must never stop a message being
                    // delivered. It is already saved and emitted.
                    console.warn("[push] DM notification failed:", pushErr.message);
                }
            }
        }


        return { success: true, messageId: String(doc._id), doc: doc };
    } catch (e) {
        // Say WHAT went wrong. A bare "could not be sent" is unactionable for
        // the person typing and undiagnosable from a screenshot — an admin's
        // messages were failing schema validation for weeks behind that string.
        console.error("[chat] send failed:", {
            room: payload && payload.room,
            senderId: identity && identity.id,
            senderRole: identity && identity.role,
            error: e && (e.stack || e.message)
        });
        if (e && e.name === "ValidationError") {
            const why = Object.values(e.errors || {}).map(x => x.message).join("; ");
            return { success: false, code: "invalid", message: why || "That message was rejected." };
        }
        return { success: false, code: "server_error", message: "The message could not be sent. Please try again." };
    }
}

io.on("connection", (socket) => {
    const identity = socket.data.identity;

    // Optional explicit join (idempotent — server still re-checks permission)
    socket.on("join_room", (payload) => {
        const room = payload && payload.room;
        if(canAccessRoom(identity, room)) socket.join(room);
    });

    /**
     * "typing…" — relayed, never stored.
     *
     * Straight to the other participant's personal channel, so it reaches them
     * whether or not they have the conversation open. The client stops showing
     * it on a timeout, which means a dropped connection cannot leave somebody
     * typing forever.
     */
    socket.on("typing", (payload) => {
        const room = payload && payload.room;
        if (!room || !canAccessRoom(identity, room)) return;
        const other = chatIdentity.otherParticipant(identity, room);
        if (!other) return;
        io.to("user::" + other).emit("typing", {
            room, fromId: identity.id, from: identity.name,
            typing: !(payload && payload.stopped)
        });
    });

    socket.on("send_message", async (payload, ack) => {
        const result = await deliverChatMessage(identity, payload || {});
        if (ack) ack(result);
    });

    socket.on("delete_message", async (payload, ack) => {
        try{
            const messageId = payload && payload.messageId;
            const msg = messageId ? await Message.findById(messageId) : null;
            if(!msg) { if(ack) ack({ success:false, message:"not_found" }); return; }
            if(!canDeleteIn(identity, msg.chatRoom)) { if(ack) ack({ success:false, message:"forbidden" }); return; }
            await Message.findByIdAndDelete(msg._id);
            io.to(msg.chatRoom).emit("message_deleted", { messageId: String(msg._id), room: msg.chatRoom });
            if(ack) ack({ success:true });
        } catch(e){
            if(ack) ack({ success:false, message:"server_error" });
        }
    });
});


// ================= COORDINATOR ONBOARDING & HR VERIFICATION (PART 6 & 8) =================

app.post("/api/v2/coordinator/check-domain", async (req, res) => {
    try {
        const { domain } = req.body;
        if (!domain) {
            return res.json({ success: false, message: "Domain name is required." });
        }
        const existing = await Coordinator.findOne({ domain, verificationStatus: "approved" });
        if (existing) {
            return res.json({ success: false, exists: true, message: `Domain "${domain}" already has an assigned active coordinator.` });
        }
        return res.json({ success: true, exists: false, message: "Domain is available." });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error checking domain." });
    }
});

app.post("/api/v2/coordinator/register", async (req, res) => {
    try {
        const { username, email, password, name, domain, resumePdf, experience } = req.body;
        if (!username || !email || !password || !name || !domain) {
            return res.json({ success: false, message: "Missing required fields." });
        }

        const existing = await Coordinator.findOne({ $or: [{ username }, { email: email.toLowerCase() }] });
        if (existing) {
            return res.json({ success: false, message: "Username or Email already registered." });
        }

        const existingDomainCoord = await Coordinator.findOne({ domain, verificationStatus: "approved" });
        if (existingDomainCoord) {
            return res.json({ success: false, message: `Domain "${domain}" is already managed.` });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newCoord = new Coordinator({
            username,
            email: email.toLowerCase(),
            password: hashedPassword,
            name,
            domain,
            resumePdf: resumePdf || "",
            experience: experience || "",
            verificationStatus: "approved"
        });

        await newCoord.save();
        return res.json({ success: true, message: "Coordinator account created and approved successfully." });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error in coordinator registration." });
    }
});

app.post("/api/v2/coordinator/auto-approve", async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) return res.json({ success: false, message: "Identifier required" });

        const q = identifier.indexOf("@") !== -1
            ? { email: identifier.toLowerCase() }
            : { $or: [{ username: identifier }, { email: identifier.toLowerCase() }] };

        await Coordinator.updateMany(q, { $set: { verificationStatus: "approved" } });
        return res.json({ success: true, message: "Account approved! You can log in now." });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.get("/api/v2/coordinator/pending", async (req, res) => {
    try {
        const pending = await Coordinator.find({ verificationStatus: "pending" });
        return res.json({ success: true, pending });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error retrieving pending applications." });
    }
});

app.post("/api/v2/coordinator/approve", async (req, res) => {
    try {
        const { id, action } = req.body; // action: 'approve' or 'reject'
        if (!id || !action) {
            return res.json({ success: false, message: "Id and action required." });
        }
        
        const status = action === "approve" ? "approved" : "rejected";
        const coord = await Coordinator.findById(id);
        if (!coord) {
            return res.json({ success: false, message: "Coordinator not found." });
        }

        if (status === "approved") {
            const existingApproved = await Coordinator.findOne({ domain: coord.domain, verificationStatus: "approved" });
            if (existingApproved && String(existingApproved._id) !== id) {
                return res.json({ success: false, message: `Domain "${coord.domain}" already has an approved coordinator.` });
            }
        }

        coord.verificationStatus = status;
        await coord.save();
        return res.json({ success: true, message: `Coordinator application successfully ${status}.` });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error updating coordinator status." });
    }
});


// ===== MENTORSHIP BOOKINGS FLOW DIRECT API HANDLERS =====
const CoinRedemption = require('./models/new/CoinRedemption');

app.get("/api/v2/coordinator/mentorship-bookings", async (req, res) => {
    try {
        const bookings = await CoinRedemption.find({ itemType: 'mentorship' }).sort({ createdAt: -1 });
        return res.json({ success: true, bookings });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.post("/api/v2/coordinator/verify-payment", async (req, res) => {
    try {
        const { bookingId, action } = req.body || {};
        if (!bookingId || !action) {
            return res.json({ success: false, message: "bookingId and action are required" });
        }

        let redemption = null;
        if (bookingId && bookingId !== 'demo_b1') {
            redemption = await CoinRedemption.findById(bookingId).catch(() => null);
        }

        if (!redemption) {
            return res.json({ success: false, message: "Redemption record not found" });
        }

        const Student = require('./models/Student');
        const student = await Student.findOne({ employeeId: redemption.employeeId });

        if (action === 'approve') {
            redemption.status = 'completed';
            redemption.completedAt = new Date();
            await redemption.save().catch(() => {});

            // Debit student's coins from StudentCoin model
            if (student) {
                const StudentCoin = require('./models/new/StudentCoin');
                let coinDoc = await StudentCoin.findOne({ studentId: student._id });
                if (!coinDoc) {
                    coinDoc = await StudentCoin.create({ studentId: student._id, totalCoins: 500 });
                }
                coinDoc.totalCoins = Math.max(0, coinDoc.totalCoins - redemption.coinsRedeemed);
                coinDoc.coinsHistory.push({
                    action: `Redeemed for ${redemption.title}`,
                    coins: -redemption.coinsRedeemed,
                    timestamp: new Date()
                });
                await coinDoc.save().catch(() => {});
            }

            // Dispatch receipt email
            try {
                const { createEmailTransporter, EMAIL_FROM } = require('./utils/mailer');
                const transporter = createEmailTransporter();
                if (student && student.email && transporter) {
                    await transporter.sendMail({
                        from: EMAIL_FROM,
                        to: student.email,
                        subject: `🎉 Payment Confirmed: Receipt for ${redemption.title}`,
                        html: `
                          <div style="font-family:sans-serif;padding:25px;background:#0c1220;color:#fff;border-radius:12px;border:1px solid #10b981;">
                            <h2 style="color:#f5c542;margin-top:0;text-align:center;">The Entrepreneurship Network</h2>
                            <h3 style="color:#10b981;text-align:center;">Official Booking Confirmation & Receipt</h3>
                            <hr style="border-color:rgba(16,185,129,0.3);margin-bottom:20px;">
                            <p>Dear <strong>${student.name || 'TEN Intern'}</strong>,</p>
                            <p>Your payment for <strong>${redemption.title}</strong> has been successfully verified and approved by the Coordinator!</p>
                            <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;margin:15px 0;">
                              <ul style="margin:0;padding-left:15px;line-height:1.8;">
                                <li><strong>Transaction Reference / UTR:</strong> ${redemption.paymentId || 'N/A'}</li>
                                <li><strong>Coins Redeemed:</strong> ${redemption.coinsRedeemed} Coins</li>
                                <li><strong>Net Amount Paid:</strong> ₹${redemption.netPaidAmount}</li>
                                <li><strong>Status:</strong> Approved & Verified ✅</li>
                              </ul>
                            </div>
                            <p><strong>What's Next?</strong> The coordinator is now assigning your expert domain mentor. You will receive another email shortly with the confirmed time slot and instructions on how to join your video session!</p>
                            <p>Thank you,<br>The Entrepreneurship Network Team</p>
                          </div>
                        `
                    }).catch(() => {});
                }
            } catch (_) {}
        } else if (action === 'reject') {
            redemption.status = 'failed';
            await redemption.save().catch(() => {});

            // Dispatch rejection email
            try {
                const { createEmailTransporter, EMAIL_FROM } = require('./utils/mailer');
                const transporter = createEmailTransporter();
                if (student && student.email && transporter) {
                    await transporter.sendMail({
                        from: EMAIL_FROM,
                        to: student.email,
                        subject: `❌ Payment Rejection: Verification Failed for ${redemption.title}`,
                        html: `
                          <div style="font-family:sans-serif;padding:25px;background:#0c1220;color:#fff;border-radius:12px;border:1px solid #ef4444;">
                            <h2 style="color:#f5c542;margin-top:0;text-align:center;">The Entrepreneurship Network</h2>
                            <h3 style="color:#ef4444;text-align:center;">Payment Rejection Notice</h3>
                            <hr style="border-color:rgba(239,68,68,0.3);margin-bottom:20px;">
                            <p>Dear <strong>${student.name || 'TEN Intern'}</strong>,</p>
                            <p>Unfortunately, your payment verification for <strong>${redemption.title}</strong> (UTR: ${redemption.paymentId}) has failed or could not be verified by our team.</p>
                            <p>No coins were debited from your account. Please check your transaction reference / UTR number or upload a correct proof of payment on your student dashboard again.</p>
                            <p>If you believe this is an error, please contact your coordinator or support team immediately.</p>
                            <p>Thank you,<br>The Entrepreneurship Network Team</p>
                          </div>
                        `
                    }).catch(() => {});
                }
            } catch (_) {}
        }

        return res.json({ success: true, message: `Payment successfully ${action}ed.` });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.post("/api/v2/coordinator/assign-mentor", async (req, res) => {
    try {
        const { bookingId, mentorEmail, mentorName, slotTime } = req.body || {};
        
        let redemption = null;
        if (bookingId && bookingId !== 'demo_b1') {
            redemption = await CoinRedemption.findById(bookingId).catch(() => null);
        }

        const studentEmail = (redemption && redemption.studentEmail) ? redemption.studentEmail : "shindedevaraj0@gmail.com";
        const studentName = (redemption && redemption.studentName) ? redemption.studentName : "Shinde Devraj Samadhan";
        const itemTitle = (redemption && redemption.itemTitle) ? redemption.itemTitle : "1-on-1 Mentorship Advisory Session";
        const targetMentorEmail = mentorEmail || "shindedevaraj0@gmail.com";
        const targetMentorName = mentorName || "Senior Domain Mentor";
        const targetSlot = slotTime || "Tomorrow, 5:00 PM";
        const meetUrl = "https://meet.google.com/new";

        if (redemption) {
            redemption.mentorEmail = targetMentorEmail;
            redemption.mentorName = targetMentorName;
            redemption.slotTime = targetSlot;
            redemption.status = 'assigned';
            await redemption.save().catch(() => {});
        }

        // DISPATCH DUAL CUSTOM EMAILS
        try {
            const { createEmailTransporter, EMAIL_FROM } = require('./utils/mailer');
            const transporter = createEmailTransporter();

            if (transporter) {
                // Email to Student - Instructing that link will be shared later when mentor launches
                await transporter.sendMail({
                    from: EMAIL_FROM,
                    to: studentEmail,
                    subject: `📅 Confirmed Slot: ${itemTitle} with ${targetMentorName}`,
                    html: `
                      <div style="font-family: Arial, sans-serif; padding: 25px; background-color: #0c1220; color: #ffffff; border-radius: 12px; border: 1px solid #D4AF37;">
                        <h2 style="color: #f5c542; margin-top: 0; text-align: center;">TEN Mentorship Portal</h2>
                        <hr style="border-color: rgba(245,197,66,0.3); margin-bottom: 20px;">
                        <p>Dear <strong>${studentName}</strong>,</p>
                        <p>Great news! Your mentorship session booking has been confirmed and scheduled by the Coordinator.</p>
                        
                        <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
                          <h3 style="color: #10b981; margin-top: 0;">Session Details:</h3>
                          <p style="margin: 6px 0;"><strong>📌 Topic:</strong> ${itemTitle}</p>
                          <p style="margin: 6px 0;"><strong>👤 Assigned Mentor:</strong> ${targetMentorName} (${targetMentorEmail})</p>
                          <p style="margin: 6px 0;"><strong>⏰ Scheduled Slot:</strong> ${targetSlot}</p>
                          <p style="margin: 6px 0;"><strong>🎥 Google Meet Call:</strong> <span style="color: #f5c542; font-weight: bold;">The live meeting link will be shared soon to your registered email when your mentor launches the session.</span></p>
                        </div>
                        
                        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">
                          Please make sure you have your questions prepared and check your email inbox for the direct live link when the session slot starts!
                        </p>
                        <p style="margin-top: 25px; font-size: 14px;">Best regards,<br><strong>TEN Coordinator Team</strong></p>
                      </div>
                    `
                });

                // Email to Mentor - Instructing to launch from dashboard
                await transporter.sendMail({
                    from: EMAIL_FROM,
                    to: targetMentorEmail,
                    subject: `📌 New Mentorship Assignment: Student ${studentName}`,
                    html: `
                      <div style="font-family: Arial, sans-serif; padding: 25px; background-color: #0c1220; color: #ffffff; border-radius: 12px; border: 1px solid #38bdf8;">
                        <h2 style="color: #38bdf8; margin-top: 0; text-align: center;">TEN Mentor Center</h2>
                        <hr style="border-color: rgba(56,189,248,0.3); margin-bottom: 20px;">
                        <p>Dear <strong>${targetMentorName}</strong>,</p>
                        <p>You have been assigned a new mentorship session by the Coordinator team.</p>
                        
                        <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f5c542;">
                          <h3 style="color: #f5c542; margin-top: 0;">Session Details:</h3>
                          <p style="margin: 6px 0;"><strong>🎓 Student Name:</strong> ${studentName}</p>
                          <p style="margin: 6px 0;"><strong>📧 Student Email:</strong> ${studentEmail}</p>
                          <p style="margin: 6px 0;"><strong>📌 Topic:</strong> ${itemTitle}</p>
                          <p style="margin: 6px 0;"><strong>⏰ Scheduled Slot:</strong> ${targetSlot}</p>
                          <p style="margin: 6px 0;"><strong>🎥 Google Meet Call:</strong> <span style="color: #38bdf8; font-weight: bold;">Launch a meeting for this student from your dashboard to initiate the session and trigger student invite emails.</span></p>
                        </div>
                        
                        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">
                          This session is now live in your Mentor Dashboard under the "Mentoring Calendar" tab. You can launch the video call and email dispatch directly from there.
                        </p>
                        <p style="margin-top: 25px; font-size: 14px;">Best regards,<br><strong>TEN Operations</strong></p>
                      </div>
                    `
                });
            }
        } catch (mailErr) {
            console.error("Error sending mentorship assignment emails:", mailErr);
        }

        return res.json({ success: true, message: "Emails dispatched successfully!" });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.get("/api/v2/mentor/assigned-sessions", async (req, res) => {
    try {
        const { email } = req.query || {};
        const query = { itemType: 'mentorship' };
        if (email) {
            query.mentorEmail = email.toLowerCase().trim();
        }
        const sessions = await CoinRedemption.find(query).sort({ createdAt: -1 });
        return res.json({ success: true, sessions });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.get("/api/v2/mentor/profile", async (req, res) => {
    try {
        const { email } = req.query || {};
        if (!email) {
            return res.json({ success: false, message: "Email is required" });
        }
        
        const EcosystemUser = require("./models/EcosystemUser");
        const MentorProfile = require("./models/MentorProfile");
        
        const user = await EcosystemUser.findOne({ email: email.toLowerCase().trim(), role: 'mentor' }).lean();
        if (!user) {
            return res.json({ success: false, message: "Mentor not found" });
        }
        
        const profile = await MentorProfile.findOne({ userId: user._id }).lean();
        
        return res.json({
            success: true,
            user,
            profile: profile || { expertise: [] }
        });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.get("/api/v2/student/my-bookings", async (req, res) => {
    try {
        const { employeeId } = req.query || {};
        if (!employeeId) {
            return res.json({ success: false, message: "employeeId is required" });
        }
        const bookings = await CoinRedemption.find({ employeeId }).sort({ createdAt: -1 });
        return res.json({ success: true, bookings });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.post("/api/v2/mentor/complete-session", async (req, res) => {
    try {
        const { bookingId } = req.body || {};
        if (!bookingId) {
            return res.json({ success: false, message: "bookingId is required" });
        }

        let redemption = null;
        if (bookingId && bookingId !== 'demo_b1' && bookingId !== 'live_s1') {
            redemption = await CoinRedemption.findById(bookingId).catch(() => null);
        }

        if (redemption) {
            redemption.status = 'finished';
            redemption.completedAt = new Date();
            await redemption.save().catch(() => {});
        }

        return res.json({ success: true, message: "Session marked as completed" });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.get("/api/v2/mentor/student-profile", async (req, res) => {
    try {
        const { employeeId } = req.query || {};
        if (!employeeId) {
            return res.json({ success: false, message: "employeeId is required" });
        }

        const Student = require("./models/Student");
        const Attendance = require("./models/Attendance");
        const Submission = require("./models/Submission");

        const student = await Student.findOne({ employeeId }).lean();
        if (!student) {
            return res.json({ success: false, message: "Student not found" });
        }

        // Fetch attendance count
        const attendanceCount = await Attendance.countDocuments({ employeeId }).catch(() => 0);

        // Fetch task submissions count
        const submissionsCount = await Submission.countDocuments({ employeeId }).catch(() => 0);
        const approvedCount = await Submission.countDocuments({ employeeId, status: 'approved' }).catch(() => 0);

        return res.json({
            success: true,
            student: {
                name: student.name || `${student.firstName || ''} ${student.lastName || ''}`.trim() || "TEN Intern",
                email: student.email,
                whatsapp: student.whatsapp || "N/A",
                domain: student.domain || "Web Development",
                joiningDate: student.joiningDate || "N/A",
                currentStreak: student.currentStreak || 0,
                bestStreak: student.bestStreak || 0,
                attendanceCount,
                submissionsCount,
                approvedCount
            }
        });
    } catch (err) {
        return res.json({ success: false, message: err.message });
    }
});

app.post("/api/v2/mentor/launch-session", async (req, res) => {
    try {
        const { bookingId, meetUrl } = req.body || {};
        
        let redemption = null;
        if (bookingId && bookingId !== 'demo_b1' && bookingId !== 'live_s1') {
            redemption = await CoinRedemption.findById(bookingId).catch(() => null);
        }

        const studentEmail = (redemption && redemption.studentEmail) ? redemption.studentEmail : "shindedevaraj0@gmail.com";
        const studentName = (redemption && redemption.studentName) ? redemption.studentName : "Shinde Devraj Samadhan";
        const itemTitle = (redemption && redemption.itemTitle) ? redemption.itemTitle : "1-on-1 Mentorship Advisory Session";
        const targetMentorName = (redemption && redemption.mentorName) ? redemption.mentorName : "Senior Domain Mentor";
        const targetMeetUrl = meetUrl || (redemption && redemption.meetUrl) || "https://meet.google.com/new";

        // Update redemption meetUrl and status if found
        if (redemption) {
            redemption.meetUrl = targetMeetUrl;
            redemption.status = 'live';
            await redemption.save().catch(() => {});
        }

        // Dispatch email to Student with actual Google Meet link
        try {
            const { createEmailTransporter, EMAIL_FROM } = require('./utils/mailer');
            const transporter = createEmailTransporter();

            if (transporter) {
                await transporter.sendMail({
                    from: EMAIL_FROM,
                    to: studentEmail,
                    subject: `🚨 JOIN NOW: Your Mentorship Session is Live!`,
                    html: `
                      <div style="font-family: Arial, sans-serif; padding: 25px; background-color: #0c1220; color: #ffffff; border-radius: 12px; border: 1px solid #10b981;">
                        <h2 style="color: #10b981; margin-top: 0; text-align: center;">TEN Live Mentorship Session</h2>
                        <hr style="border-color: rgba(16,185,129,0.3); margin-bottom: 20px;">
                        <p>Dear <strong>${studentName}</strong>,</p>
                        <p>Your mentor <strong>${targetMentorName}</strong> has just launched and joined your live mentorship session: <strong>${itemTitle}</strong>.</p>
                        
                        <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; margin: 25px 0; border: 1px solid rgba(245,197,66,0.3); text-align: center;">
                          <h3 style="color: #f5c542; margin-top: 0;">🚀 Live Video Call is Ready</h3>
                          <p style="font-size: 14px; margin-bottom: 20px; color: #cbd5e1;">Click the button below to join the meeting immediately:</p>
                          <a href="${targetMeetUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; font-weight: bold; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; box-shadow: 0 4px 15px rgba(16,185,129,0.4); text-transform: uppercase;">
                            Join Google Meet Now
                          </a>
                          <p style="margin-top: 15px; font-size: 11px; color: #94a3b8;">
                            Link: <a href="${targetMeetUrl}" style="color: #38bdf8;" target="_blank">${targetMeetUrl}</a>
                          </p>
                        </div>
                        
                        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; text-align: center;">
                          Please ensure your camera and microphone are working correctly before entering.
                        </p>
                        <p style="margin-top: 25px; font-size: 14px;">Best regards,<br><strong>TEN Operations</strong></p>
                      </div>
                    `
                });
                console.log(`[Launch Session] Live Meet email dispatched successfully to ${studentEmail} with link ${targetMeetUrl}`);
            }
        } catch (mailErr) {
            console.error("Error sending live launch email to student:", mailErr);
        }

        return res.json({ success: true, meetUrl: targetMeetUrl });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

server.listen(PORT, "0.0.0.0", ()=>{
    console.log(`Server running on port ${PORT}`);

    // Start the scheduled jobs. services/automationCron.js defined
    // initAutomation() but nothing ever called it, so offer-letter auto-send,
    // completed-internship detection, approval escalation and the auto-mark
    // attendance job had never run in production.
    //
    // ENABLE_AUTOMATION_CRON=false turns them off (useful when several
    // instances share one database and only one should run the jobs).
    // Align the employee-ID counter with the IDs already issued.
    //
    // This used to run right here, in the listen callback — which fires as soon
    // as the socket is bound, before mongoose.connect() has resolved. The scan
    // for the highest existing ID could therefore come back empty and leave the
    // counter at zero, and new students were issued 1004, 1005, 1006 while real
    // students already held 1758 and 1759.
    //
    // Wait for the connection instead. `once` rather than `on`, so a later
    // reconnect does not rescan; generateEmployeeId re-aligns by itself if it
    // ever meets a taken ID, which covers everything this misses.
    const alignEmployeeIdCounter = () => {
        initEmployeeIdCounter().catch((err) => {
            console.error("[employeeId] Counter initialisation failed:", err.message);
        });
    };

    if (mongoose.connection.readyState === 1) {
        alignEmployeeIdCounter();
    } else {
        mongoose.connection.once("connected", alignEmployeeIdCounter);
    }

    // Under PM2 cluster mode every worker runs this file, so N workers would
    // each schedule the same jobs against the same database — N offer letters,
    // N certificate emails, N attendance rows per student. PM2 numbers its
    // workers in NODE_APP_INSTANCE, so only worker 0 schedules anything. Fork
    // mode and a bare `node server.js` leave the variable unset, which reads as
    // "the only instance" and runs the jobs normally.
    const clusterWorker = process.env.NODE_APP_INSTANCE;
    const isCronWorker = clusterWorker === undefined || clusterWorker === "0";

    if (String(process.env.ENABLE_AUTOMATION_CRON || "true").toLowerCase() === "false") {
        console.log("[AUTO-CRON] Disabled via ENABLE_AUTOMATION_CRON=false.");
    } else if (!isCronWorker) {
        console.log(`[AUTO-CRON] Skipped on cluster worker ${clusterWorker}; worker 0 runs the jobs.`);
    } else {
        try {
            require("./services/automationCron").initAutomation();
        } catch (err) {
            console.error("[AUTO-CRON] Failed to start automation jobs:", err.message);
        }
    }
});

// Process-level crash protection and error handlers
process.on('uncaughtException', (error) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] UNCAUGHT EXCEPTION:`, error);
    if (error && error.stack) {
        console.error(error.stack);
    }
    // Do NOT exit the process. Keep the server running.
    // Comment: PM2 will restart the container if the system is truly unstable.
});

process.on('unhandledRejection', (reason, promise) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] UNHANDLED REJECTION:`, reason, 'at promise:', promise);
    // Do NOT exit the process. Keep the server running.
});

// Force server reload trigger - 2026-08-09T13:08:00

