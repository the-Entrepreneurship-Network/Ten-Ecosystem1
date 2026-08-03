require("dotenv").config();

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
const DB_DIR = path.join(__dirname, 'uploads', 'local_db');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

global.isMongoUnhealthy = false;
global.lastMongoCheckTime = 0;

function checkMongoStatus() {
    return mongoose.connection.readyState === 1 && !global.isMongoUnhealthy;
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

function applyUpdate(item, update) {
    if (!update) return;
    if (update.$set) {
        Object.assign(item, update.$set);
    }
    if (update.$push) {
        for (const k of Object.keys(update.$push)) {
            if (!Array.isArray(item[k])) item[k] = [];
            item[k].push(update.$push[k]);
        }
    }
    if (update.$addToSet) {
        for (const k of Object.keys(update.$addToSet)) {
            if (!Array.isArray(item[k])) item[k] = [];
            if (!item[k].includes(update.$addToSet[k])) {
                item[k].push(update.$addToSet[k]);
            }
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
    }
    sort(s) { this._sort = s; return this; }
    limit(l) { this._limit = l; return this; }
    populate() { return this; }
    select() { return this; }
    lean() { return this; }
    exec() {
        return this.promiseFn(this._sort, this._limit);
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
            global.isMongoUnhealthy = true;
            global.lastMongoCheckTime = Date.now();
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
                const newItem = { _id: generateId(), createdAt: new Date() };
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
            const raw = d.toObject ? d.toObject() : { ...d };
            return { ...raw, _id: raw._id || generateId(), createdAt: new Date(), updatedAt: new Date() };
        });
        items.push(...createdDocs);
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
            items[idx] = { ...items[idx], ...obj, updatedAt: new Date() };
        } else {
            obj.createdAt = obj.createdAt || new Date();
            obj.updatedAt = obj.updatedAt || new Date();
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
                global.isMongoUnhealthy = true;
                global.lastMongoCheckTime = Date.now();
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
const EcosystemUser = require("./models/EcosystemUser");

const autoMailLogSchema = new mongoose.Schema({
  studentName:  String,
  studentEmail: String,
  employeeId:   String,
  mailType:     String,
  sentAt:       { type: Date, default: Date.now }
});
const AutoMailLog = mongoose.model('AutoMailLog', autoMailLogSchema);

function getTenureTotalDays(tenure) {
  const t = (tenure || '').toLowerCase();
  if (t.includes('1week') || t.includes('1 week') || t === 'week') return 7;
  if (t.includes('15day') || t.includes('15 day')) return 15;
  if (t.includes('45day') || t.includes('45 day')) return 45;
  if (t.includes('3month') || t.includes('3 month')) return 90;
  if (t.includes('6month') || t.includes('6 month')) return 180;
  return 30; // default 1 month
}

function calcAttendancePercentage(student, presentCount) {
  const totalTenureDays = getTenureTotalDays(student.tenure || student.v2DurationType);
  const startDate = (student.joinerType === "whatsapp" && student.internshipStartDate)
    ? new Date(student.internshipStartDate)
    : student.joiningDate ? new Date(student.joiningDate) : (student.createdAt ? new Date(student.createdAt) : new Date());
  if (isNaN(startDate.getTime())) {
    startDate = new Date();
  }
  const today = new Date();
  const workingDays = attendanceUtils.countWorkingDays(startDate, today);
  return {
    percentage: workingDays > 0 ? Math.min(Math.round((presentCount / workingDays) * 100), 100) : 0,
    totalDays: workingDays,
    tenureTotalDays: totalTenureDays,
    presentDays: presentCount,
    absentDays: Math.max(workingDays - presentCount, 0),
    requiredDays: Math.ceil(workingDays * 0.75)
  };
}

const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
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
const HR_ACCOUNTS = {
    "hr_admin":   { password: "HR@TEN2026",  name: "HR Administrator", email: "hr.admin@ten.local", level: 7 },
    "hr_manager": { password: "HRMgr@2026",  name: "HR Manager",       email: "hr.manager@ten.local", level: 6 },
    "jrhr@ten.com":      { password: "TEN@JrHR2026",  name: "Jr HR Associate",            email: "jrhr@ten.com", level: 1 },
    "srhr@ten.com":      { password: "TEN@SrHR2026",  name: "Sr HR Associate",            email: "srhr@ten.com", level: 2 },
    "jrmanager@ten.com": { password: "TEN@JrMgr2026",  name: "Jr HR Manager",             email: "jrmanager@ten.com", level: 3 },
    "srmanager@ten.com": { password: "TEN@SrMgr2026",  name: "Sr HR Manager",             email: "srmanager@ten.com", level: 4 },
    "hrad@ten.com":      { password: "TEN@HRAD2026",  name: "HR Associate Director",      email: "hrad@ten.com", level: 5 },
    "jrdir@ten.com":     { password: "TEN@JrDir2026",  name: "Jr HR Director",            email: "jrdir@ten.com", level: 6 },
    "hrdirector@ten.com":{ password: "TEN@HRDir2026",  name: "HR Director & HRBP",         email: "hrdirector@ten.com", level: 7 },
    "chro@ten.com":      { password: "TEN@CHRO2026",  name: "Chief Human Resources Officer", email: "chro@ten.com", level: 8 },
    "vp@ten.com":        { password: "TEN@VP#2026",    name: "Vice President",                 email: "vp@ten.com", level: 9 }
};
const COORDINATORS = {
    "devops_aws_admin":   { password:"DevOpsAWS@2026",  domain:"DevOps with AWS" },
    "python_admin":       { password:"Python@2026",     domain:"Python Development" },
    "java_admin":         { password:"Java@2026",       domain:"Java Development" },
    "web_admin":          { password:"Web@2026",        domain:"Web Development" },
    "mern_admin":         { password:"Mern@2026",       domain:"MERN Stack Development" },
    "ai_admin":           { password:"AI@2026",         domain:"Artificial Intelligence" },
    "datascience_admin":  { password:"DS@2026",         domain:"Data Science" },
    "cyber_admin":        { password:"Cyber@2026",      domain:"Cyber Security" },
    "software_admin":     { password:"Software@2026",   domain:"Software Engineering" },
    "flutter_admin":      { password:"Flutter@2026",    domain:"Flutter Development" },
    // Requirement 5 — HR Management treated like any other domain
    "hrmgmt_admin":       { password:"HRMgmt@2026",     domain:"HR Management" },
    // New domains added
    "venturecapital_admin":  { password: "VC@TEN2026",        domain: "Venture Capital" },
    "vibecoding_admin":      { password: "Vibe@TEN2026",       domain: "Vibe Coding" },
    "spaceresearch_admin":   { password: "Space@TEN2026",      domain: "Space Research" },
    "businessanalyst_admin": { password: "BA@TEN2026",         domain: "Business Analyst" },
    "hr_domain_admin":       { password: "HRDomain@TEN2026",   domain: "HR" }
};

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

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const session = require('express-session');
const sessionOptions = {
    secret: process.env.SESSION_SECRET || 'ten-admin-secret-key-123',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        sameSite: 'none',
        httpOnly: true,
        maxAge: 30 * 60 * 1000 // 30 minutes
    }
};

class FallbackStore extends session.Store {
    constructor() {
        super();
        this.memoryStore = new session.MemoryStore();
        this.mongoStore = null;
    }

    _getStore() {
        const isMongoConnected = mongoose.connection.readyState === 1 && !global.isMongoUnhealthy;
        if (isMongoConnected && process.env.MONGODB_URI) {
            if (!this.mongoStore) {
                try {
                    console.log("[FallbackStore] MongoDB is connected. Initializing MongoStore for session persistence...");
                    const MongoStore = require('connect-mongo').MongoStore;
                    this.mongoStore = MongoStore.create({
                        mongoUrl: process.env.MONGODB_URI,
                        ttl: 1800, // 30 minutes in seconds
                        collectionName: 'sessions',
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
            if (this.mongoStore) {
                return this.mongoStore;
            }
        }
        return this.memoryStore;
    }

    get(sid, callback) {
        const store = this._getStore();
        if (store === this.mongoStore) {
            // Try mongo first
            this.mongoStore.get(sid, (err, session) => {
                if (session) {
                    return callback(null, session);
                }
                // Fallback to memory if not found in mongo (e.g., session was created during startup)
                this.memoryStore.get(sid, callback);
            });
        } else {
            this.memoryStore.get(sid, callback);
        }
    }

    set(sid, session, callback) {
        // Always write to memoryStore first as local fallback cache
        this.memoryStore.set(sid, session, (err) => {
            const store = this._getStore();
            if (store === this.mongoStore) {
                this.mongoStore.set(sid, session, callback);
            } else if (callback) {
                callback(err);
            }
        });
    }

    destroy(sid, callback) {
        this.memoryStore.destroy(sid, (err) => {
            const store = this._getStore();
            if (store === this.mongoStore) {
                this.mongoStore.destroy(sid, callback);
            } else if (callback) {
                callback(err);
            }
        });
    }

    touch(sid, session, callback) {
        this.memoryStore.touch(sid, session, (err) => {
            const store = this._getStore();
            if (store === this.mongoStore && this.mongoStore.touch) {
                this.mongoStore.touch(sid, session, callback);
            } else if (callback) {
                callback(err);
            }
        });
    }
}

sessionOptions.store = new FallbackStore();

app.use(session(sessionOptions));

// Dynamic cookie security adjustment for iframe/HTTPS vs HTTP/local environments
app.use((req, res, next) => {
    if (req.session && req.session.cookie) {
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        req.session.cookie.secure = isSecure;
        req.session.cookie.sameSite = isSecure ? 'none' : 'lax';
    }
    next();
});

// Custom route to serve the logo with the correct JPEG Content-Type since the file has a .png extension but is actually a JPEG (JFIF format)
app.get(/.*ten-logo\.png$/, (req, res) => {
    res.setHeader("Content-Type", "image/jpeg");
    res.sendFile(path.join(__dirname, "public", "ten-logo.png"));
});

app.use(express.static("public", {
    maxAge: '7d',
    etag: true,
    lastModified: true
}));
app.use('/uploads', express.static('uploads', {
    maxAge: '30d',
    etag: true,
    lastModified: true
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

// GET /api/secrets-status: check which environment variables are configured
app.get('/api/secrets-status', (req, res) => {
    const keys = [
        'MONGODB_URI',
        'ADMIN_API_SECRET',
        'CORS_ALLOWED_ORIGINS',
        'EMAIL_USER',
        'EMAIL_PASS',
        'PAYMENTSETU_API_KEY',
        'BASE_URL',
        'HR_CREDENTIALS',
        'COORDINATOR_CREDENTIALS',
        'GITHUB_PERSONAL_ACCESS_TOKEN'
    ];
    
    const status = {};
    keys.forEach(key => {
        status[key] = {
            configured: !!process.env[key],
            valuePlaceholder: process.env[key] ? (key === 'MONGODB_URI' || key === 'EMAIL_PASS' || key === 'PAYMENTSETU_API_KEY' || key === 'ADMIN_API_SECRET' || key === 'GITHUB_PERSONAL_ACCESS_TOKEN' ? '********' : process.env[key]) : ''
        };
    });
    
    res.json({
        success: true,
        secrets: status,
        mongodbState: mongoose.connection.readyState
    });
});

// POST /api/save-secrets: save updated credentials to .env and apply to memory
app.post('/api/save-secrets', async (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ success: false, message: "Invalid request body" });
        }
        
        // Read existing .env if any
        let envContent = '';
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        } else {
            // fallback to reading .env.example
            const examplePath = path.join(__dirname, '.env.example');
            if (fs.existsSync(examplePath)) {
                envContent = fs.readFileSync(examplePath, 'utf8');
            }
        }
        
        // Parse current lines
        const lines = envContent.split(/\r?\n/);
        const envVars = {};
        
        // Extract existing env vars
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                if (parts.length >= 2) {
                    const k = parts[0].trim();
                    const v = parts.slice(1).join('=').trim();
                    envVars[k] = v;
                }
            }
        });
        
        // Merge updates
        for (const [key, val] of Object.entries(updates)) {
            if (val !== undefined && val !== null && val !== '') {
                envVars[key] = val;
                process.env[key] = val; // Apply to running memory instantly!
            }
        }
        
        // Write back to .env
        let newEnvContent = '';
        newEnvContent += "# ── Core ──────────────────────────────────────────────────────────\n";
        newEnvContent += `MONGODB_URI=${envVars['MONGODB_URI'] || ''}\n`;
        newEnvContent += `PORT=${envVars['PORT'] || process.env.PORT || '3000'}\n\n`;
        
        newEnvContent += "# ── Security ─────────────────────────────────────────────────────\n";
        newEnvContent += `ADMIN_API_SECRET=${envVars['ADMIN_API_SECRET'] || ''}\n`;
        newEnvContent += `CORS_ALLOWED_ORIGINS=${envVars['CORS_ALLOWED_ORIGINS'] || ''}\n\n`;
        
        newEnvContent += "# ── Email ─────────────────────────────────────────────────────────\n";
        newEnvContent += `EMAIL_USER=${envVars['EMAIL_USER'] || ''}\n`;
        newEnvContent += `EMAIL_PASS=${envVars['EMAIL_PASS'] || ''}\n\n`;
        
        newEnvContent += "# ── PaymentSetu ────────────────────────────────────────────────────\n";
        newEnvContent += `PAYMENTSETU_API_KEY=${envVars['PAYMENTSETU_API_KEY'] || ''}\n`;
        newEnvContent += `BASE_URL=${envVars['BASE_URL'] || ''}\n\n`;
        
        newEnvContent += "# ── HR Credentials (JSON map) ──────────────────────────────────────\n";
        newEnvContent += `HR_CREDENTIALS=${envVars['HR_CREDENTIALS'] || ''}\n`;
        newEnvContent += `COORDINATOR_CREDENTIALS=${envVars['COORDINATOR_CREDENTIALS'] || ''}\n\n`;
        
        newEnvContent += "# ── GitHub Integration ────────────────────────────────────────────\n";
        newEnvContent += `GITHUB_PERSONAL_ACCESS_TOKEN=${envVars['GITHUB_PERSONAL_ACCESS_TOKEN'] || ''}\n`;
        
        fs.writeFileSync(envPath, newEnvContent, 'utf8');
        
        // Re-initialize Mongo Connection if MONGODB_URI is updated
        if (updates.MONGODB_URI) {
            console.log("MONGODB_URI updated! Re-initializing Mongoose...");
            mongoose.disconnect().catch(() => {});
            mongoose.connect(updates.MONGODB_URI, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                maxPoolSize: 20,
                minPoolSize: 2,
                connectTimeoutMS: 10000,
                heartbeatFrequencyMS: 10000
            }).then(() => {
                console.log("Connected to new MongoDB instance successfully!");
            }).catch(err => {
                console.error("Failed to connect to new MongoDB instance:", err.message);
            });
        }
        
        res.json({
            success: true,
            message: "Credentials updated successfully. Saved to .env and applied to server instantly!"
        });
    } catch (err) {
        console.error("Error saving secrets:", err);
        res.status(500).json({ success: false, message: "Failed to save secrets: " + err.message });
    }
});


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

const consecutiveLimitHits = new Map();

// Per-IP login rate limit (strictest). Applied directly to the login routes
// further down via the `loginLimiter` reference.
const loginLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
    max: RATE_LIMIT_CONFIG.auth.max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => {
        const body = req.body || {};
        const account = body.email || body.employeeId || body.username || "";
        return req.ip + ":" + account.toString().toLowerCase().trim();
    },
    handler: (req, res, next, options) => {
        const body = req.body || {};
        const account = body.email || body.employeeId || body.username || "";
        const key = req.ip + ":" + account.toString().toLowerCase().trim();
        const hits = (consecutiveLimitHits.get(key) || 0) + 1;
        consecutiveLimitHits.set(key, hits);

        const backoffBase = RATE_LIMIT_CONFIG.auth.backoffBase || 2;
        const retryAfterSeconds = Math.min(Math.pow(backoffBase, hits), 3600);
        res.setHeader('Retry-After', retryAfterSeconds.toString());
        return res.status(429).json({
            success: false,
            message: `Too many login attempts. Please wait ${retryAfterSeconds} seconds.`
        });
    }
});

// Registration rate limit
const registerLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
    max: RATE_LIMIT_CONFIG.auth.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        const key = req.ip;
        const hits = (consecutiveLimitHits.get(key) || 0) + 1;
        consecutiveLimitHits.set(key, hits);

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

const { createEmailTransporter, EMAIL_FROM } = require("./utils/mailer");
const transporter = createEmailTransporter();



if(process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS){
    transporter.verify((error)=>{
        if(error){ console.log("SMTP verification status: OFFLINE —", error.message); }
        else{ console.log("Email Server Ready (SES) — sending as", EMAIL_FROM); }
    });
} else {
    console.log("Email not configured — SES_SMTP_USER/SES_SMTP_PASS missing, skipping SMTP verify.");
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
            from: EMAIL_FROM,
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

// ==================================================================
// ================ LOW ATTENDANCE ALERT EMAIL ======================
// ==================================================================
const LOW_ATTENDANCE_THRESHOLD = 75; // matches the 75% requiredDays logic in calcAttendancePercentage
const LOW_ATTENDANCE_RESEND_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // don't re-alert more than once every 3 days

async function sendLowAttendanceMail(student, studentName, percentage){
    const email = student.email;
    const subject = `⚠️ Attendance Alert — Your attendance is at ${percentage}%`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
        Hi ${studentName || "Intern"},<br><br>
        Your current attendance stands at <b>${percentage}%</b>, which is below the required <b>${LOW_ATTENDANCE_THRESHOLD}%</b> threshold for internship completion.<br><br>
        Please make sure you mark your attendance regularly to stay on track and remain eligible for your certificate and other internship benefits.<br><br>
        — TEN HR Team
    </div>`;

    let mailStatus = "sent";
    let mailError = "";
    try {
        await transporter.sendMail({ from: EMAIL_FROM, to: email, subject, html });
    } catch (err) {
        mailStatus = "failed";
        mailError = err && err.message ? String(err.message) : "";
    } finally {
        try {
            await MailHistory.create({
                recipientEmail: email,
                recipientName: studentName || "Intern",
                studentId: student._id,
                subject,
                mailType: "low-attendance",
                sentAt: new Date(),
                status: mailStatus,
                errorMessage: mailError
            });
        } catch (_) {}
    }
    try {
        await Notification.notifyStudent(student, {
            title: "⚠️ Low Attendance Alert",
            message: `Hi ${studentName || "Intern"}, your attendance is at ${percentage}%, which is below the required ${LOW_ATTENDANCE_THRESHOLD}%. Please mark your attendance regularly.`,
            type: "warning"
        });
    } catch (_) {}
    try {
        await AutoMailLog.create({ studentName, studentEmail: email, employeeId: student.employeeId || "", mailType: "low-attendance" });
    } catch (_) {}
}

async function runLowAttendanceMailer(){
    try {
        if (!checkMongoStatus()) {
            console.warn('[LOW-ATTENDANCE-MAILER] Mongoose is not connected. Skipping.');
            return;
        }
        const students = await Student.find();
        const now = new Date();

        for (const student of students) {
            try {
                const email = student.email;
                if (!email || !student.employeeId) continue;
                if (student.internshipCompleted) continue; // no need to alert finished interns

                const presentCount = await Attendance.countDocuments({ employeeId: student.employeeId, status: 'Present' });
                const stats = calcAttendancePercentage(student, presentCount);

                if (stats.percentage >= LOW_ATTENDANCE_THRESHOLD) continue;

                const lastSent = (student.reminderEmailsSent && student.reminderEmailsSent.get)
                    ? student.reminderEmailsSent.get('lowAttendance')
                    : null;
                if (lastSent && (now - new Date(lastSent)) < LOW_ATTENDANCE_RESEND_COOLDOWN_MS) {
                    continue; // already alerted recently, don't spam
                }

                const studentName = (student.name || ((student.firstName||"") + " " + (student.lastName||"")).trim()).trim();
                await sendLowAttendanceMail(student, studentName, stats.percentage);

                if (!student.reminderEmailsSent) student.reminderEmailsSent = new Map();
                student.reminderEmailsSent.set('lowAttendance', now);
                await student.save();
            } catch (error) {
                console.log(error);
            }
        }
    } catch (error) {
        console.log(error);
    }
}
cron.schedule('0 8 * * *', runLowAttendanceMailer); // daily at 8 AM

// TEMPORARY TEST ROUTE — lets you trigger the low-attendance mailer manually
// instead of waiting for the 8 AM cron. Remove this once you're done testing.
app.post("/admin/test-low-attendance-mailer", async (req, res) => {
    try {
        const { employeeId, email } = req.body || {};

        if (employeeId || email) {
            // Test a single student, bypassing the 3-day resend cooldown
            const query = employeeId ? { employeeId } : { email: String(email).toLowerCase().trim() };
            const student = await Student.findOne(query);
            if (!student) return res.status(404).json({ success: false, message: "Student not found" });

            const presentCount = await Attendance.countDocuments({ employeeId: student.employeeId, status: 'Present' });
            const stats = calcAttendancePercentage(student, presentCount);
            const studentName = (student.name || ((student.firstName||"") + " " + (student.lastName||"")).trim()).trim();

            await sendLowAttendanceMail(student, studentName, stats.percentage);

            return res.json({ success: true, message: `Test email sent to ${student.email}`, percentage: stats.percentage });
        }

        // No employeeId given — run the full daily job right now
        await runLowAttendanceMailer();
        return res.json({ success: true, message: "runLowAttendanceMailer executed for all students" });

    } catch (error) {
        console.error("[TEST] low-attendance-mailer error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

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

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/internship", {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxPoolSize: 20,
  minPoolSize: 2,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000
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

async function generateEmployeeId(domain){
    const domainShortCodes = {
        "DevOps with AWS":          "DEVOPS",
        "Python Development":       "PY",
        "Java Development":         "JAVA",
        "Web Development":          "WEB",
        "MERN Stack Development":   "MERN",
        "Artificial Intelligence":  "AI",
        "Data Science":             "DS",
        "Cyber Security":           "CYBER",
        "Software Engineering":     "SDE",
        "Flutter Development":      "FLUTTER",
        "HR Management":            "HRMGMT",
        "Venture Capital":           "VC",
        "Vibe Coding":               "VIBE",
        "Space Research":            "SPACE",
        "Business Analyst":          "BA",
        "HR":                        "HR",
        "Business Development":      "BD",
        "Space Intern":              "SPACE",
        "Finance":                   "FIN"
    };
    const shortCode = domainShortCodes[domain] || domain.toUpperCase();
    const totalStudents = await Student.countDocuments();
    const sequenceNumber = 1001 + totalStudents;
    return `TEN/${shortCode}/${sequenceNumber}`;
}

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
    let password;
    let plainPassword;
    if (isFirstRegistration) {
        plainPassword = crypto.randomBytes(4).toString("hex");
        password = plainPassword;
    } else {
        const existingStudentToken = existingByEmail[0];
        password = existingStudentToken.password || crypto.randomBytes(4).toString("hex");
        plainPassword = existingStudentToken.plainPassword || (password.startsWith("$2b$") || password.startsWith("$2a$") ? "intern123" : password);
    }

    const newStudent = new Student({
        firstName, lastName,
        name: (firstName||"") + " " + (lastName||""),
        domain, whatsapp, email: emailLc,
        collegeName,
        college: collegeName,
        tenure, joiningDate,
        employeeId, password,
        plainPassword,
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
                name: newStudent.name.trim(), employeeId, domain, email: emailLc, password,
                joinedOn, host
            });
            let mailStatus = "sent";
            let mailError = "";
            try {
                await transporter.sendMail({
                    from: EMAIL_FROM,
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

async function recordFailedAttempt(res, user, userModel, defaultErrorMsg) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    let updateData = { failedLoginAttempts: attempts };
    
    if (attempts >= 5) {
        const resetTime = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
        updateData.isLockedOut = true;
        updateData.lockoutUntil = resetTime;
        await userModel.findByIdAndUpdate(user._id, updateData);
        return res.json({
            success: false,
            message: "Your account is temporarily locked. Try again in 5 minutes."
        });
    } else {
        await userModel.findByIdAndUpdate(user._id, updateData);
        return res.json({
            success: false,
            message: `${defaultErrorMsg} (Failed attempts: ${attempts}/5)`
        });
    }
}

async function clearFailedAttempts(user, userModel) {
    if (user.failedLoginAttempts > 0 || user.isLockedOut) {
        await userModel.findByIdAndUpdate(user._id, {
            failedLoginAttempts: 0,
            isLockedOut: false,
            lockoutUntil: null
        });
    }
}

// ================= LOGIN =================

app.post("/login", loginLimiter, async(req,res)=>{
try{
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
                    const profile = await MentorProfile.findOne({ userId: user._id });
                    if (profile) verificationStatus = profile.verificationStatus || 'pending';
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

            // If student, get legacy student record or mock one
            let student = null;
            if (user.role === 'student') {
                student = await Student.findOne({ email: user.email });
                if (student) {
                    await Student.findOneAndUpdate({ email: user.email }, { lastActiveDate: new Date(), plainPassword: password });
                }
            }

            if (user.role === 'student') {
                req.session.student = student || {
                    _id: user._id,
                    employeeId: user._id.toString(),
                    name: user.fullName,
                    email: user.email,
                    domain: 'Web Development'
                };
            }

            return res.json({
                success: true,
                role: user.role,
                user: {
                    _id: user._id,
                    fullName: user.fullName,
                    email: user.email,
                    role: user.role,
                    phone: user.phone
                },
                student: student || {
                    _id: user._id,
                    employeeId: user._id.toString(),
                    name: user.fullName,
                    email: user.email,
                    domain: 'Web Development'
                }
            });
        }

        // Check legacy Student model by email just in case
        const student = await Student.findOne({ email: loginId.toLowerCase() });
        if (student) {
            if (role && role !== 'student') {
                return res.json({ success: false, message: `Access denied. No ${role} account found.` });
            }
            if (await checkLockout(res, student, Student)) return;

            let pwdMatch = student.password === password;
            if (!pwdMatch) {
                try {
                    pwdMatch = await bcrypt.compare(password, student.password);
                } catch(e) {}
            }
            if (pwdMatch) {
                await clearFailedAttempts(student, Student);
                await Student.findOneAndUpdate({ email: loginId.toLowerCase() }, { lastActiveDate: new Date(), plainPassword: password });
                
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
                const responseStudent = student.toObject ? student.toObject() : student;
                responseStudent.linkedDomains = linked;
                responseStudent.domains = student.domains || [student.domain];

                req.session.student = responseStudent;

                return res.json({
                    success: true,
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
        const student = await Student.findOne({ employeeId: loginId });
        if (!student) {
            return res.json({ success: false, message: "Invalid Employee ID" });
        }

        if (await checkLockout(res, student, Student)) return;

        let pwdMatch = student.password === password;
        if (!pwdMatch) {
            try {
                pwdMatch = await bcrypt.compare(password, student.password);
            } catch(e) {}
        }
        if (!pwdMatch) {
            return await recordFailedAttempt(res, student, Student, "Invalid Password");
        }
        await clearFailedAttempts(student, Student);
        await Student.findOneAndUpdate({ employeeId: loginId }, { lastActiveDate: new Date(), plainPassword: password });
        
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
        const responseStudent = student.toObject ? student.toObject() : student;
        responseStudent.linkedDomains = linked;
        responseStudent.domains = student.domains || [student.domain];

        req.session.student = responseStudent;

        return res.json({ success: true, role: 'student', student: responseStudent });
    }
}catch(error){
    console.error("Login route error:", error);
    res.status(500).json({ success:false, message:"Server Error" });
}
});

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
const sseClients = new Map();

function addSSEClient(key, res, meta = {}){
    if(!sseClients.has(key)) sseClients.set(key, []);
    sseClients.get(key).push({ res, ...meta });
}

function removeSSEClient(key, res){
    const arr = sseClients.get(key) || [];
    const idx = arr.findIndex(c => c.res === res);
    if(idx !== -1) arr.splice(idx, 1);
}

function sendSSE(res, data){
    try{ res.write(`data: ${JSON.stringify(data)}\n\n`); } catch(e){}
}

function broadcastNotification(domain, employeeId, notif){
    // to specific student
    if(employeeId){
        const key = `student:${employeeId}`;
        const clients = sseClients.get(key) || [];
        clients.forEach(c => sendSSE(c.res, { event:"notification", notification:notif }));
    }
    // to domain coordinator
    if(domain){
        const key = `coord:${domain}`;
        const clients = sseClients.get(key) || [];
        clients.forEach(c => sendSSE(c.res, { event:"notification", notification:notif }));
    }
}

// ================= STUDENT SSE =================

app.get("/student-events/:employeeId", (req,res)=>{
    const employeeId = decodeURIComponent(req.params.employeeId);
    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.setHeader("Connection","keep-alive");
    res.flushHeaders();
    res.write("data: connected\n\n");

    const key = `student:${employeeId}`;
    addSSEClient(key, res);

    req.on("close",()=>{ removeSSEClient(key, res); });
});

// ================= COORDINATOR SSE =================

app.get("/coord-events/:domain", (req,res)=>{
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

app.post("/hr-login", loginLimiter, async(req,res)=>{
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
            return res.json({ success:true, hr:{
                username: dbHR.username || dbHR.email,
                email:    dbHR.email,
                name:     dbHR.name,
                role:     "hr",
                level:    dbHR.level || 1
            }});
        }
        // Also allow legacy hardcoded entries that have an email assigned
        const legacy = Object.entries(HR_ACCOUNTS).find(
            ([_, v]) => (v.email || "").toLowerCase() === identifier.toLowerCase()
        );
        if(legacy){
            const [u, v] = legacy;
            let currentPassOk = (v.password === password);
            if (u === "hrdirector@ten.com" && password === "TEN@HRBP2026") {
                currentPassOk = true;
            }
            if(!currentPassOk) return res.json({ success:false, message:"Invalid HR credentials" });
            return res.json({ success:true, hr:{ username:u, email:v.email, name:v.name, role:"hr", level: v.level || 1 } });
        }
        return res.json({ success:false, message:"Invalid HR credentials" });
    }

    // 2) Legacy username path
    const hr = HR_ACCOUNTS[identifier];
    let currentPassOk = hr && (hr.password === password);
    if (identifier === "hrdirector@ten.com" && password === "TEN@HRBP2026") {
        currentPassOk = true;
    }
    if(!hr || !currentPassOk){
        return res.json({ success:false, message:"Invalid HR credentials" });
    }
    res.json({ success:true, hr:{ username: identifier, email: hr.email || "", name:hr.name, role:"hr", level: hr.level || 1 } });
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
        // Also need to notify students - broadcast to all SSE clients and they filter on client side
        for(const [key, arr] of sseClients.entries()){
            if(key.startsWith("student:")){
                arr.forEach(c => {
                    if(c.studentDomain === targetDomain){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const students = await Student.find().select('firstName lastName email whatsapp domain collegeName college employeeId tenure joiningDate createdAt').sort({ createdAt:-1 });
    res.json({ success:true, students });
}catch(error){ res.status(500).json({ message:"Error fetching students" }); }
});

// ================= HR - SEND DOCUMENTS NOW =================

app.post('/hr/send-documents-now', async(req, res) => {
    try {
        const auth = req.headers.authorization;
        if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
        const auth = req.headers.authorization;
        if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const joins = await Student.find().select("joiningDate joinDate");
    let newJoinsThisMonth = 0;
    for(const s of joins){
        const jd = s.joinDate || s.joiningDate;
        if(!jd) continue;
        const dt = new Date(jd);
        if(isNaN(dt.getTime())) continue;
        if(dt >= monthStart && dt < monthEnd) newJoinsThisMonth++;
    }
    res.json({ totalInterns, activeThisMonth, inactiveInterns, newJoinsThisMonth });
}catch(error){
    console.log(error);
    res.status(500).json({ totalInterns:0, activeThisMonth:0, inactiveInterns:0, newJoinsThisMonth:0 });
}
});

app.get("/api/hr/intern-stats/monthly", async(req,res)=>{
try{
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const students = await Student.find().select("joiningDate joinDate");
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const type = req.query.type;
    const now = new Date();
    const d30 = new Date(now - 30*24*60*60*1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let query = {};
    if (type === 'active')    query = { lastActiveDate: { $gte: d30 } };
    if (type === 'inactive')  query = { $or: [{ lastActiveDate: { $lt: d30 } }, { lastActiveDate: null }, { lastActiveDate: { $exists: false } }] };
    let students = await Student.find(query)
      .select('firstName lastName employeeId domain collegeName college lastActiveDate joiningDate joinDate')
      .sort({ joiningDate: -1 }).limit(400);
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
    res.json({ students: students.map(s => ({
      name: (s.firstName||'') + ' ' + (s.lastName||''),
      employeeId: s.employeeId,
      domain: s.domain,
      college: s.collegeName || s.college
    }))});
  }catch(e){
    console.log(e);
    res.status(500).json({ students: [] });
  }
});

// ================= HR - GET STUDENTS BY DOMAIN =================

app.get("/hr/students/domain/:domain", async(req,res)=>{
try{
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const domain = decodeURIComponent(req.params.domain);
    const students = await Student.find({ domain }).select('firstName lastName email whatsapp domain collegeName college employeeId tenure joiningDate createdAt').sort({ createdAt:-1 });
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const submissions = await Submission.find().sort({ submittedAt:-1 });
    res.json({ success:true, submissions: await attachStudentDetailsToSubmissions(submissions) });
}catch(error){ res.status(500).json({ message:"Error" }); }
});

app.get("/hr/submissions/filter", async(req,res)=>{
try{
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")){
        return res.status(401).json({ message:"Unauthorized" });
    }
    const notifs = await Notification.find().sort({ createdAt:-1 }).limit(100);
    res.json({ success:true, notifications:notifs });
}catch(error){ res.status(500).json({ success:false }); }
});

// ================= HR - DELETE NOTIFICATION =================

app.delete("/hr/notifications/:id", async(req,res)=>{
try{
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ success:true });
}catch(error){ res.json({ success:false }); }
});

// ================= ALL STUDENTS (legacy admin) =================

app.get("/students", async(req,res)=>{
    const adminPassword = req.headers.authorization;
    if(adminPassword !== "Bearer mysecret123"){
        return res.status(401).json({ message:"Unauthorized" });
    }
    try{
        const students = await Student.find().select('firstName lastName email whatsapp domain collegeName college employeeId tenure joiningDate createdAt').sort({ createdAt:-1 });
        res.json(students);
    }catch(error){ res.status(500).json({ message:"Error fetching students" }); }
});

// ================= UPDATE STUDENT =================

app.put("/students/:id", async(req,res)=>{
try{
    const body = { ...req.body };
    if(body.firstName !== undefined || body.lastName !== undefined){
        body.name = `${body.firstName || ""} ${body.lastName || ""}`.trim();
    }
    if(body.collegeName !== undefined || body.college !== undefined){
        const collegeName = String(body.collegeName || body.college || "").trim();
        body.collegeName = collegeName;
        body.college = collegeName;
    }
    await Student.findByIdAndUpdate(req.params.id, body, { new:true });
    res.json({ message:"Student Updated" });
}catch(error){ res.status(500).json({ message:"Update Failed" }); }
});

// ================= DELETE STUDENT =================

app.delete("/students/:id", async(req,res)=>{
try{
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message:"Student deleted" });
}catch(error){ res.status(500).json({ message:"Error deleting student" }); }
});

// ================= STUDENT LOGIN =================

app.post("/student-login", loginLimiter, async(req,res)=>{
try{
    const { employeeId, password } = req.body;
    const student = await Student.findOne({ employeeId });
    if(!student){ return res.json({ success:false, message:"Invalid Employee ID or Password" }); }

    if (await checkLockout(res, student, Student)) return;

    let pwdMatch = student.password === password;
    if (!pwdMatch) {
        try {
            pwdMatch = await bcrypt.compare(password, student.password);
        } catch(e) {}
    }

    if(!pwdMatch){
        return await recordFailedAttempt(res, student, Student, "Invalid Employee ID or Password");
    }

    await clearFailedAttempts(student, Student);

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

    await Student.findOneAndUpdate({ employeeId }, { lastActiveDate: new Date(), plainPassword: password });
    res.json({
        success:true,
        student:{
            name: student.firstName + " " + student.lastName,
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

app.post("/get-my-password", async (req, res) => {
  try {
    const { employeeId, confirmedPassword } = req.body;
    const student = await Student.findOne({ employeeId });
    if (!student) {
      return res.json({ success: false, message: "Not verified" });
    }
    const displayPassword = student.plainPassword || (student.password && !student.password.startsWith("$2b$") && !student.password.startsWith("$2a$") ? student.password : "intern123");
    if (confirmedPassword !== undefined && confirmedPassword !== null) {
      let pwdMatch = student.password === confirmedPassword;
      if (!pwdMatch) {
        try {
          pwdMatch = await bcrypt.compare(confirmedPassword, student.password);
        } catch (e) {}
      }
      if (!pwdMatch) {
        return res.json({ success: false, message: "Not verified" });
      }
      return res.json({ success: true, password: displayPassword });
    } else {
      // Direct verification-free reveal
      return res.json({ success: true, password: displayPassword });
    }
  } catch (err) {
    res.json({ success: false });
  }
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
    const employeeId = req.body.employeeId || req.headers['x-employee-id'] || req.headers['employeeid'] || (req.session && req.session.student && req.session.student.employeeId);
    const { employeeIdOverride } = req.body;
    if (!employeeIdOverride || employeeIdOverride.trim() === "") {
      return res.json({
        success: false,
        message: "Employee ID cannot be empty"
      });
    }

    const student = await Student.findOne({ employeeId });
    if (!student) {
      return res.json({ success: false, message: "Student not found" });
    }

    const oldEmployeeId = student.employeeId;
    const newEmployeeId = employeeIdOverride.trim();

    student.employeeIdOverride = newEmployeeId;
    student.employeeId = newEmployeeId;
    await student.save();

    // Cascade employee ID change to all related collections
    if (oldEmployeeId && newEmployeeId && oldEmployeeId !== newEmployeeId) {
      try {
        await Promise.all([
          Attendance.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
          Submission.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
          TaskAssignment.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
          BadgeAward.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
          DocumentHistory.updateMany({ employeeId: oldEmployeeId }, { $set: { employeeId: newEmployeeId } }),
        ]);
        // Update active session too
        if (req.session && req.session.student) req.session.student.employeeId = newEmployeeId;
      } catch(cascadeErr) {
        console.error('Employee ID cascade error:', cascadeErr);
        // Don't fail the main request — cascade is best-effort
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
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
async function calculateAttendanceStats(employeeId) {
  const student = await Student.findOne({ employeeId });
  if (!student) return null;

  const startDate = (student.joinerType === "whatsapp" && student.internshipStartDate)
    ? new Date(student.internshipStartDate)
    : new Date(student.joiningDate || student.createdAt);
  if (isNaN(startDate.getTime())) return null;
  startDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const workingDays = attendanceUtils.countWorkingDays(startDate, today);

  const selfPresentDays = new Set();
  const coordPresentDays = new Set();
  const combinedPresentDays = new Set();

  const attendanceRecords = await Attendance.find({ employeeId });
  for (const record of attendanceRecords) {
    if (!record) continue;
    const recordDate = record.date ? new Date(record.date) : (record.dateKey ? new Date(record.dateKey) : null);
    if (!recordDate || isNaN(recordDate.getTime())) continue;
    recordDate.setHours(0, 0, 0, 0);
    if (recordDate < startDate || recordDate > today) continue;
    if (recordDate.getDay() === 0) continue;

    const key = toDateKey(recordDate);
    if (!key) continue;
    if (record.status === "Absent") continue;

    if (record.markedBy === "self") {
      selfPresentDays.add(key);
    }
    if (record.markedBy === "coordinator") {
      coordPresentDays.add(key);
    }
    combinedPresentDays.add(key);
  }

  const selfCount = selfPresentDays.size;
  const coordCount = coordPresentDays.size;
  const combinedCount = combinedPresentDays.size;
  const selfPct = workingDays ? Math.min(Math.round((selfCount / workingDays) * 100), 100) : 0;
  const coordPct = workingDays ? Math.min(Math.round((coordCount / workingDays) * 100), 100) : 0;
  const combinedPct = workingDays ? Math.min(Math.round((combinedCount / workingDays) * 100), 100) : 0;
  const requiredDays = Math.ceil(workingDays * 0.75);
  const daysNeeded = Math.max(0, requiredDays - combinedCount);

  const todayKey = toDateKey(today);
  const markedToday = selfPresentDays.has(todayKey);

  return {
    selfCount,
    coordCount,
    combinedCount,
    workingDays,
    selfPct,
    coordPct,
    combinedPct,
    requiredDays,
    daysNeeded,
    markedToday,
    isAboveMinimum: combinedPct >= 75,
    tenure: student.tenure,
    startDate: startDate.toISOString()
  };
}

// ── MARK OWN ATTENDANCE (student clicks button) ──
app.post("/mark-attendance", async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.json({ success: false, message: "Employee ID required" });

    const student = await Student.findOne({ employeeId });
    if (!student) return res.json({ success: false, message: "Student not found" });

    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const today = istNow.toISOString().split("T")[0];

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
    await Attendance.create({
      studentId: student._id,
      employeeId,
      domain: student.domain,
      date: now,
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
    const stats = await calculateAttendanceStats(employeeId);
    if (!stats) return res.json({ success: false, message: "Student not found" });

    return res.json({
      success: true,
      stats,
      ...stats
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

app.post("/coordinator-login", loginLimiter, async(req,res)=>{
try{
    const password = (req.body && req.body.password) || "";
    const identifier = ((req.body && (req.body.username || req.body.email)) || "").trim();
    if(!identifier || !password){
        return res.json({ success:false });
    }

    // 1) Hardcoded coordinator (legacy) — exact-username match
    const legacy = COORDINATORS[identifier];
    if(legacy && legacy.password === password){
        return res.json({ success:true, coordinator:{ username:identifier, domain:legacy.domain } });
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
            if (dbCoord.verificationStatus !== "approved") {
                return res.json({ success: false, message: "Your coordinator account application is pending HR interview & approval." });
            }
            await clearFailedAttempts(dbCoord, Coordinator);
            return res.json({ success:true, coordinator:{
                username: dbCoord.username || dbCoord.email,
                domain:   dbCoord.domain
            }});
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
    const query = { employeeId };
    if (domain) {
        query.domain = { $regex: new RegExp("^" + domain.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "$", "i") };
    }
    const records = await Attendance.find(query);
    const self   = records.filter(r => r.markedBy === "self");
    const coord  = records.filter(r => r.markedBy === "coordinator");

    const selfPresent  = self.filter(r => r.status === "Present").length;
    const coordPresent = coord.filter(r => r.status === "Present").length;
    const coordAbsent  = coord.filter(r => r.status === "Absent").length;

    // Union of distinct calendar days the student was Present in EITHER source
    const presentDayKeys = new Set();
    records.forEach(r => { if(r.status === "Present") presentDayKeys.add(r.dateKey); });
    const combinedPresentDays = presentDayKeys.size;

    // Denominator: working days from joining date → today (inclusive), excluding Sundays.
    let workingDays = 0;
    const jd = parseJoinDate(joiningDate);
    if(jd){
        const today = new Date();
        const j = new Date(jd); j.setHours(0,0,0,0);
        const t = new Date(today); t.setHours(0,0,0,0);
        if(j <= t) workingDays = countDaysExcludingSundays(j, t);
    }

    // No valid joining date / no working days yet → percentages are not defined (0).
    if(workingDays < 1){
        return {
            selfPresent, selfTotal: self.length,
            coordPresent, coordAbsent, coordTotal: coord.length,
            combinedPresentDays, workingDays: 0,
            selfPct: 0, coordPct: 0, combinedPct: 0,
            eligible: false
        };
    }

    // Cap at 100 to guard against marks on excluded days (e.g. Sunday entries).
    const combinedPct = Math.min(100, Math.round((combinedPresentDays / workingDays) * 100));
    const selfPct     = Math.min(100, Math.round((selfPresent  / workingDays) * 100));
    const coordPct    = Math.min(100, Math.round((coordPresent / workingDays) * 100));

    return {
        selfPresent, selfTotal: self.length,
        coordPresent, coordAbsent, coordTotal: coord.length,
        combinedPresentDays, workingDays,
        selfPct, coordPct, combinedPct,
        eligible: combinedPct >= 75
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

    const existing = await Attendance.findOne({ employeeId, dateKey, markedBy:"self" });
    if(existing) return res.json({ success:false, alreadyMarked:true, message:"Already marked for today" });

    const att = new Attendance({
        studentId: student._id, employeeId, domain: student.domain,
        date: now, dateKey, status:"Present", markedBy:"self"
    });
    await att.save();
    await Student.findOneAndUpdate({ employeeId }, { lastActiveDate: new Date() });
    // Streak + milestones + badges (Features 6, 7, 11)
    await bumpStreakAndMilestones(student);
    await checkCertificateEligibility(employeeId);
    await recomputeBadgesFor(employeeId);
    res.json({ success:true, message:"Attendance marked for today", attendance:att });
}catch(e){
    if(e.code === 11000) return res.json({ success:false, alreadyMarked:true, message:"Already marked for today" });
    console.log(e); res.json({ success:false, message:"Failed to mark attendance" });
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

    // Idempotent: if already marked for that day, update it instead of erroring
    let att = await Attendance.findOne({ employeeId, dateKey, markedBy:"coordinator" });
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
        studentId: student._id, employeeId, domain: student.domain,
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
    const domain = req.query.domain || req.headers['x-active-domain'] || (student ? student.domain : '');
    const query = { employeeId };
    if (domain) {
        query.domain = { $regex: new RegExp("^" + domain.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "$", "i") };
    }
    const records = await Attendance.find(query).sort({ date:-1 });
    const stats = await computeAttendanceStats(employeeId, student ? student.joiningDate : null, domain);
    const today = toDateKey(new Date());
    const markedToday = records.some(r => r.markedBy === "self" && r.dateKey === today);
    res.json({ success:true, attendance:records, stats, markedToday });
}catch(e){ console.log(e); res.json({ success:false, attendance:[], stats:null }); }
});

// ---- HR: attendance monitor (all students summary) ----
app.get("/attendance/monitor", async(req,res)=>{
try{
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")) return res.status(401).json({ success:false, message:"Unauthorized" });

    const students = await Student.find().select('firstName lastName name domain collegeName college employeeId tenure joiningDate createdAt').sort({ createdAt:-1 });
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

    student.certificateApprovedByCoordinator = false;
    student.coordinatorApprovedAt = null;
    student.coordinatorRemarks = "";
    // Revoking coordinator approval also removes any HR approval (chain broken)
    student.certificateApprovedByHR = false;
    student.hrApprovedAt = null;
    student.hrRemarks = "";
    await student.save();

    res.json({ success:true, message:"Approval revoked" });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to revoke" }); }
});

// ---- HR: list students approved by coordinator & awaiting HR review ----
app.get("/students/coordinator-approved", async(req,res)=>{
try{
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")) return res.status(401).json({ success:false, message:"Unauthorized" });

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
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")) return res.status(401).json({ success:false, message:"Unauthorized" });

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

    // Try to auto-generate and send Offer Letter when HR approves the student.
    (async function generateAndSendOffer() {
        try {
            const StudentDocument = require("./models/new/StudentDocument");
            const { generateOfferLetterPDF } = require("./services/v2/offerLetterService");
            const { generateDocumentNumber, normalizeDocumentNumber } = require("./utils/documentNumber");
            const MailHistory = require("./models/MailHistory");
            const DocumentHistory = require("./models/DocumentHistory");
            const transporter = createEmailTransporter();
            const offerDir = path.join(__dirname, "uploads", "offer-letters");
            try { fs.mkdirSync(offerDir, { recursive: true }); } catch(_) {}

            // Ensure a StudentDocument record exists and student has uploaded docs
            let docRec = await StudentDocument.findOne({ studentId: student._id });
            if (!docRec) {
                // create empty record so we can attach offer metadata
                docRec = await StudentDocument.create({ studentId: student._id });
            }

            // Generate document number
            const docNumber = normalizeDocumentNumber(generateDocumentNumber("offer_letter"));

            const joining = student.joiningDate ? new Date(student.joiningDate) : new Date();
            const tenureDays = student.tenure === "45 Days" ? 45 : student.tenure === "1 Month" ? 30 : student.tenure === "3 Months" ? 90 : student.tenure === "6 Months" ? 180 : 45;
            const endDate = new Date(joining.getTime() + tenureDays * 24 * 3600 * 1000);
            const fmt = d => d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

            const safeEmpId = String(student.employeeId || student._id).replace(/\//g, "-");
            const pdfPath = path.join(offerDir, `${safeEmpId}_offer_letter.pdf`);

            await generateOfferLetterPDF({
                studentName: student.name,
                collegeName: student.collegeName || student.college || "",
                employeeId: student.employeeId,
                domain: student.domain,
                durationText: student.tenure,
                startDate: fmt(joining),
                endDate: fmt(endDate),
                dateIssued: fmt(new Date()),
                documentNumber: docNumber
            }, pdfPath);

            // Update StudentDocument
            docRec.uploadStatus = docRec.uploadStatus === "rejected" ? "approved" : (docRec.uploadStatus || "approved");
            docRec.reviewedAt = new Date();
            docRec.offerLetterUrl = `/uploads/offer-letters/${path.basename(pdfPath)}`;
            docRec.offerLetterSentAt = new Date();
            docRec.offerLetterDocumentNumber = docNumber;
            await docRec.save();

            // Sync small fields back to Student
            try {
                const pdfBuffer = fs.readFileSync(pdfPath);
                await Student.findByIdAndUpdate(student._id, {
                    offerPdfBase64: pdfBuffer.toString('base64'),
                    offerLetterStatus: 'approved',
                    offerLetterGeneratedAt: new Date(),
                    documentRejectionReason: null
                });
            } catch (syncErr) {
                console.error('[Sync] Failed to sync Offer Letter to Student:', syncErr.message);
            }

            // Send email with attachment
            let mailStatus = 'sent';
            let mailErrMsg = '';
            try {
                await transporter.sendMail({
                    from: EMAIL_FROM,
                    to: student.email,
                    subject: `Your Internship Offer Letter — The Entrepreneurship Network`,
                    html: `<p>Dear ${student.name || 'candidate'},</p><p>Congratulations! Please find your Internship Offer Letter attached to this email.</p><p>Welcome to TEN! Log in to your student portal to track your progress.</p><p>Best regards,<br>HR Team<br>The Entrepreneurship Network</p>`,
                    attachments: [{ filename: 'TEN_Offer_Letter.pdf', path: pdfPath }]
                });
            } catch (mErr) {
                mailStatus = 'failed';
                mailErrMsg = mErr && mErr.message ? String(mErr.message) : '';
                console.error('[DOCS] Offer letter email error:', mailErrMsg);
            }

            // DocumentHistory & MailHistory
            try {
                const studentName = (student.name || `${student.firstName || ''} ${student.lastName || ''}`).trim() || student.email || '';
                await DocumentHistory.create({
                    studentId: student._id,
                    studentName,
                    studentEmail: student.email || "",
                    employeeId: student.employeeId || "",
                    college: student.collegeName || student.college || "Not provided",
                    domain: student.domain || "",
                    documentType: "Offer Letter",
                    documentKey: "offer_letter",
                    documentNumber: docNumber,
                    sentAt: new Date(),
                    sentBy: "HR Approval",
                    sentToEmail: student.email || ""
                });
            } catch (_) {}

            try {
                await MailHistory.create({
                    recipientEmail: student.email || "",
                    recipientName: student.name || "",
                    studentId: student._id,
                    subject: "Your Internship Offer Letter — The Entrepreneurship Network",
                    mailType: "offer_letter",
                    sentAt: new Date(),
                    status: mailStatus,
                    errorMessage: mailErrMsg
                });
            } catch (_) {}

            // Notify student in-app
            try {
                await Notification.notifyStudent(student, {
                    title: "📄 Offer Letter Sent",
                    message: `Congratulations ${student.name || ''}! Your Internship Offer Letter (${docNumber}) has been generated and emailed to ${student.email || 'your registered email'}.`,
                    type: "success"
                });
            } catch (_) {}

            console.log(`[HR] Offer Letter generated & emailed for student ${student._id} (${student.employeeId})`);
        } catch (err) {
            console.error('[HR] Offer letter generation/send failed during hr-approve:', err && err.message ? err.message : err);
        }
    })().catch(()=>{});

    const notif = new Notification({
        title:"Certificate Approved 🎉",
        message:"HR has given final approval. Your certificates are now available.",
        type:"success", from:"HR",
        targetType:"student", targetEmployeeId:student.employeeId, targetDomain:student.domain
    });
    await notif.save();
    broadcastNotification(student.domain, student.employeeId, notif);

    res.json({ success:true, message:"Student fully approved for certificates and offer letter (if applicable) queued/sent" });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to approve" }); }
});

// ---- HR: reject (sends student back to coordinator with a reason) ----
app.post("/students/:id/hr-reject", async(req,res)=>{
try{
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")) return res.status(401).json({ success:false, message:"Unauthorized" });

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

    const notif = new Notification({
        title:"Certificate Review: Action Needed",
        message:`HR returned your certificate review to the coordinator. Reason: ${student.hrRejectionReason}`,
        type:"warning", from:"HR",
        targetType:"coordinator-domain", targetDomain:student.domain
    });
    await notif.save();

    res.json({ success:true, message:"Student rejected and returned to coordinator" });
}catch(e){ console.log(e); res.json({ success:false, message:"Failed to reject" }); }
});

// ---- HR: list fully approved (certificate-eligible) students ----
app.get("/students/hr-approved", async(req,res)=>{
try{
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith("Bearer hr_")) return res.status(401).json({ success:false, message:"Unauthorized" });

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

async function verifyChatIdentity(claim){
    if(!claim || !claim.role) return null;
    if(claim.role === "student"){
        if(!claim.employeeId) return null;
        const s = await Student.findOne({ employeeId: claim.employeeId });
        if(!s) return null;
        return {
            role: "student",
            id: s.employeeId,
            name: (s.name || ((s.firstName||"")+" "+(s.lastName||""))).trim() || s.employeeId,
            domain: s.domain || ""
        };
    }
    if(claim.role === "coordinator"){
        // The handshake field is named `username` for backward compatibility, but
        // it can hold either a legacy username or an email (DB-backed coordinator).
        const id = claim.username || claim.email;
        if(!id) return null;
        const legacy = COORDINATORS[id];
        if(legacy) return { role: "coordinator", id, name: id, domain: legacy.domain };
        // DB-backed: created via promotion flow
        const q = id.indexOf("@") !== -1
            ? { email: id.toLowerCase() }
            : { $or: [{ username: id }, { email: id.toLowerCase() }] };
        const dbC = await Coordinator.findOne(q);
        if(dbC) return { role: "coordinator", id: dbC.email || dbC.username || id, name: dbC.name, domain: dbC.domain };
        return null;
    }
    if(claim.role === "hr"){
        const id = claim.username || claim.email;
        if(!id) return null;
        // Legacy hardcoded HR (by username key)
        const legacy = HR_ACCOUNTS[id];
        if(legacy) return { role: "hr", id, name: legacy.name, domain: "" };
        // Legacy hardcoded HR (by their assigned email)
        const legacyByEmail = Object.entries(HR_ACCOUNTS).find(
            ([_, v]) => (v.email || "").toLowerCase() === String(id).toLowerCase()
        );
        if(legacyByEmail){
            const [u, v] = legacyByEmail;
            return { role: "hr", id: v.email || u, name: v.name, domain: "" };
        }
        // DB-backed HR (created via promotion flow)
        if(id.indexOf("@") !== -1){
            const dbH = await HR.findOne({ email: id.toLowerCase() });
            if(dbH) return { role: "hr", id: dbH.email, name: dbH.name, domain: "" };
        }
        return null;
    }
    return null;
}

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
    }
    return rooms;
}
function canAccessRoom(identity, room){
    if(!room) return false;
    if(roomsAllowedFor(identity).indexOf(room) !== -1) return true;
    // domain_* rooms only allowed if the suffix matches the user's domain
    if(room.indexOf("domain_") === 0 && identity.domain && room === "domain_" + identity.domain) return true;
    return false;
}
function canDeleteIn(identity, room){
    // Per spec: coordinator (in their domain chat); coordinator+HR (general/staff); HR (hr_internal).
    if(!canAccessRoom(identity, room)) return false;
    if(identity.role === "student") return false;
    return true;
}

// REST: load last 50 messages for a room (after permission check)
app.get("/chat/messages/:room", async(req,res)=>{
try{
    const room = decodeURIComponent(req.params.room);
    const identity = await verifyChatIdentity({
        role: req.query.role,
        employeeId: req.query.employeeId,
        username: req.query.username
    });
    if(!identity) return res.status(401).json({ success:false, message:"Unauthorized" });
    if(!canAccessRoom(identity, room)) return res.status(403).json({ success:false, message:"Forbidden" });

    const messages = await Message.find({ chatRoom: room }).sort({ timestamp: -1 }).limit(50);
    messages.reverse();   // chronological for the UI
    res.json({ success:true, messages });
}catch(e){ console.log(e); res.status(500).json({ success:false, messages:[] }); }
});

// REST fallback for delete (Socket.IO event is the primary path)
app.delete("/chat/messages/:messageId", async(req,res)=>{
try{
    const identity = await verifyChatIdentity({
        role: (req.body && req.body.role) || req.query.role,
        employeeId: (req.body && req.body.employeeId) || req.query.employeeId,
        username: (req.body && req.body.username) || req.query.username
    });
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
            from: EMAIL_FROM,
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
async function _buildLeaderboard(filter, limit){
    const students = await Student.find(filter || {}).sort({ createdAt: 1 });
    const rows = [];
    for(const s of students){
        const stats = await computeAttendanceStats(s.employeeId, s.joiningDate);
        const perf = await calculatePerformance(s);
        const approved = await Submission.countDocuments({ employeeId: s.employeeId, status:"Approved" });
        rows.push({
            employeeId: s.employeeId,
            name: (s.name || ((s.firstName||"")+" "+(s.lastName||""))).trim() || s.employeeId,
            domain: s.domain || "",
            score: perf ? perf.score : 0,
            grade: perf ? perf.grade : "—",
            attendancePct: stats.combinedPct || 0,
            approved,
            currentStreak: s.currentStreak || 0
        });
    }
    rows.sort((a,b) => b.score - a.score
                    || b.attendancePct - a.attendancePct
                    || b.approved - a.approved);
    return rows.slice(0, limit).map((r, i) => Object.assign({ rank: i+1 }, r));
}
async function buildDomainLeaderboard(domain, limit=10){ return _buildLeaderboard({ domain }, limit); }
async function buildOverallLeaderboard(limit=20)        { return _buildLeaderboard({}, limit); }

// ---- API ----

// Feature 5 — leaderboards
app.get("/leaderboard/domain/:domain", async(req,res)=>{
    try{
        const domain = decodeURIComponent(req.params.domain);
        const rows = await buildDomainLeaderboard(domain, 10);
        res.json({ success:true, leaderboard: rows, domain });
    }catch(e){ console.log(e); res.status(500).json({ success:false, leaderboard:[] }); }
});
app.get("/leaderboard/overall", async(req,res)=>{
    try{
        const rows = await buildOverallLeaderboard(20);
        res.json({ success:true, leaderboard: rows });
    }catch(e){ console.log(e); res.status(500).json({ success:false, leaderboard:[] }); }
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

async function sendResetPasswordEmail(to, token, { name, role, host } = {}){
    const html = passwordResetEmailHtml({ name, role, host, token });
    const base = (host ? host.replace(/\/$/, "") : "");
    const link = base + "/reset-password.html?token=" + encodeURIComponent(token) + "&role=" + encodeURIComponent(role || "");
    const subject = "🔐 Password Reset Request — The Entrepreneurship Network";
    await transporter.sendMail({
        from: EMAIL_FROM,
        to,
        subject,
        html,
        text: `Hello ${name || "user"}, reset your password here: ${link} (expires in 1 hour). If you did not request this, ignore this email.`
    });
}

async function _findUserByRoleEmail(role, email){
    const e = String(email || "").trim().toLowerCase();
    if(!e) return null;
    if(role === "student"){
        // Use the most-recently-created Student doc with this email.
        const list = await Student.find({ email: e }).sort({ createdAt:-1 });
        return list[0] || null;
    }
    if(role === "coordinator"){
        return await Coordinator.findOne({ email: e });
    }
    if(role === "hr"){
        return await HR.findOne({ email: e });
    }
    return null;
}

function getPasswordResetWindow(user) {
    const NOW = new Date();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    let attempts = Number((user.passwordResetAttempts ?? user.passwordResetCount) || 0);
    let windowStart = user.passwordResetWindowStart ? new Date(user.passwordResetWindowStart) : null;

    if (!windowStart || isNaN(windowStart.getTime())) {
        windowStart = user.passwordResetLastResetDate ? new Date(user.passwordResetLastResetDate) : new Date(0);
    }

    if (!windowStart || isNaN(windowStart.getTime())) {
        windowStart = new Date(0);
    }

    if (NOW - windowStart > TWENTY_FOUR_HOURS) {
        attempts = 0;
        windowStart = NOW;
    }

    return { NOW, attempts, windowStart };
}

// ==================== FORGOT PASSWORD ====================
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email required hai." });
    }

    const validRoles = ["student", "coordinator", "hr"];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: "Valid role (student/coordinator/hr) required hai." });
    }

    const trimmedEmail = email.toLowerCase().trim();

    // 1. Check user in the role-specific model (this is what /auth/reset-password
    //    later looks the token up against, so it must match).
    const user = await _findUserByRoleEmail(role, trimmedEmail);

    if (!user) {
      return res.status(404).json({ success: false, message: "Is email se koi account nahi mila." });
    }

        const { NOW, attempts, windowStart } = getPasswordResetWindow(user);

        if (attempts >= 2) {
            return res.status(429).json({
                success: false,
                message: "You have reached the limit of 2 password reset requests in 24 hours. Please try again later."
            });
        }

        // Generate a fresh reset token (raw for email) and store only its hash in DB
        const rawToken = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiry = new Date(NOW.getTime() + 60 * 60 * 1000);
        const nextAttempts = attempts + 1;

        user.passwordResetToken = hashedToken;
        user.passwordResetExpiry = expiry;
        user.passwordResetAttempts = nextAttempts;
        user.passwordResetWindowStart = windowStart;
        user.passwordResetCount = nextAttempts;
        user.passwordResetLastResetDate = NOW;

        await user.save();

        // Send raw token in email (frontend will post it back when resetting)
        const host = (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host");
        await sendResetPasswordEmail(user.email, rawToken, { name: user.name, role, host });

        return res.status(200).json({
            success: true,
            message: "Password reset instructions aapke email par bhej diye gaye hain."
        });

  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Server error occurred." });
  }
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
        const hashed = crypto.createHash('sha256').update(token).digest('hex');
        const user = await Model.findOne({ passwordResetToken: hashed });
        if(!user) return res.json({ success:false, message:"Invalid or already-used reset link" });
        if(!user.passwordResetExpiry || user.passwordResetExpiry < new Date()){
            return res.json({ success:false, message:"This reset link has expired. Please request a new one." });
        }

        // For students the password is currently stored in plaintext (existing
        // behaviour). For coord/HR the DB-backed accounts use bcrypt.
        if(role === "student"){
            user.password = newPassword;
            user.plainPassword = newPassword;
        } else {
            user.password = await bcrypt.hash(newPassword, 10);
        }
        user.passwordResetToken = null;
        user.passwordResetExpiry = null;
        await user.save();
        res.json({ success:true, message:"Password updated! Please log in with your new password." });
    }catch(e){ console.log(e); res.status(500).json({ success:false, message:"Server error" }); }
});

// ==================================================================
// ======== STUDENT PASSWORD RESET (merged from authController.js/auth.js) =====
// ==================================================================
async function sendPasswordResetEmail(to, rawToken, { name, host } = {}){
    const html = passwordResetEmailHtml({ name, role: "student", host, token: rawToken });
    const base = (host ? host.replace(/\/$/, "") : "");
    const link = base + "/reset-password.html?token=" + encodeURIComponent(rawToken) + "&role=student";
    const subject = "🔐 Password Reset Request — The Entrepreneurship Network";
    await transporter.sendMail({
        from: EMAIL_FROM,
        to,
        subject,
        html,
        text: `Hello ${name || "user"}, reset your password here: ${link} (expires in 1 hour). If you did not request this, ignore this email.`
    });
}

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const user = await Student.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists with that email, a password reset link has been sent.'
      });
    }

    const { NOW, attempts, windowStart } = getPasswordResetWindow(user);

    if (attempts >= 2) {
      return res.status(429).json({
        success: false,
        error: 'Daily limit reached. You can only request up to 2 password resets in 24 hours. Please try again later.'
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.passwordResetExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
    const nextAttempts = attempts + 1;
    user.passwordResetAttempts = nextAttempts;
    user.passwordResetWindowStart = windowStart;
    user.passwordResetCount = nextAttempts;
    user.passwordResetLastResetDate = NOW;

    await user.save();

    const host = (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host");
    sendPasswordResetEmail(user.email, rawToken, { name: user.name, host }).catch(err => {
      console.error('[ForgotPassword] Email dispatch error:', err.message);
    });

    return res.json({
      success: true,
      message: 'Password reset link sent to your email.'
    });

  } catch (error) {
    console.error('[ForgotPassword] Error:', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Token and new password are required'
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await Student.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpiry: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired password reset token.'
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = null;
    user.passwordResetExpiry = null;

    await user.save();

    return res.json({
      success: true,
      message: 'Password has been reset successfully! You can now log in.'
    });

  } catch (error) {
    console.error('[ResetPassword] Error:', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
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
            let att = await Attendance.findOne({ employeeId: s.employeeId, dateKey, markedBy:"coordinator" });
            if(att){
                att.status = st;
                att.coordinatorId = coordinatorId || att.coordinatorId;
                att.date = d;
                if(source) att.source = source;
                await att.save();
                updated++;
            } else {
                att = new Attendance({
                    studentId: s._id, employeeId: s.employeeId, domain: s.domain,
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
    const existing = await Attendance.findOne({ employeeId, dateKey, markedBy:"coordinator" });
    if(existing){
        return res.json({ success:false, alreadyMarked:true,
            message:"Attendance already marked for today ✅" });
    }

    const att = new Attendance({
        studentId: student._id, employeeId, domain: student.domain,
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
async function _identityFromAuth(body){
    return await verifyChatIdentity({
        role: body && body.role,
        employeeId: body && body.employeeId,
        username: body && body.username
    });
}

app.post("/chat/block", async(req,res)=>{
    try{
        const actor = await _identityFromAuth(req.body);
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
        const actor = await _identityFromAuth(req.body);
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
        const actor = await _identityFromAuth(req.query);
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
    submittedAt:   { type: Date, default: Date.now }
});
const CodingSubmission = mongoose.model("CodingSubmission", codingSubmissionSchema);

// ----- Coordinator CRUD -----
app.get("/coordinator/coding-questions/:domain", async(req,res)=>{
    try {
        const domain = decodeURIComponent(req.params.domain);
        const list = await CodingQuestion.find({ domain }).sort({ createdAt:-1 });
        res.json({ success:true, questions:list });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});
app.post("/coordinator/coding-questions", async(req,res)=>{
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
app.delete("/coordinator/coding-questions/:id", async(req,res)=>{
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
app.get("/student/coding-questions/:domain", async(req,res)=>{
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
app.get("/student/coding-questions/question/:id", async(req,res)=>{
    try {
        const q = await CodingQuestion.findById(req.params.id);
        if(!q) return res.status(404).json({ success:false, message:"Not found" });
        const obj = q.toObject();
        obj.testCases = (obj.testCases || []).filter(t => !t.isHidden);
        res.json({ success:true, question:obj });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});
app.get("/student/coding-submissions/:employeeId", async(req,res)=>{
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

function _runWithTimeout(cmd, args, opts){
    return new Promise((resolve) => {
        const startedAt = Date.now();
        let stdout = "";
        let stderr = "";
        let killed = false;
        let child;
        try {
            child = spawn(cmd, args, { ...opts, shell: false });
        } catch(e){
            return resolve({ ok:false, error: String(e.message || e), code: -1, executionTime: 0 });
        }
        const timer = setTimeout(() => {
            killed = true;
            try { child.kill("SIGKILL"); } catch(_){}
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

app.post("/code/run", async(req,res)=>{
    try {
        const { code, language, input } = req.body || {};
        if(!code) return res.json({ success:false, output:"", error:"No code provided", executionTime: 0 });
        const r = await runSourceCode({ code, language, stdin: input || "" });
        res.json(r);
    } catch(e){
        console.log("/code/run error:", e && e.message);
        res.status(500).json({ success:false, output:"", error:"Server error: " + (e && e.message), executionTime: 0 });
    }
});

// ==================================================================
// ============ SHARED CODE EVALUATION FUNCTION ====================
// ==================================================================
async function evaluateCodeSubmission({ employeeId, questionId, language, code }) {
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
        totalCases: cases.length
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

app.post("/code/submit", async(req,res)=>{
    try {
        const { employeeId, questionId, language, code } = req.body || {};
        if(!employeeId || !questionId || !code){
            return res.json({ success:false, message:"employeeId, questionId and code are required" });
        }
        const result = await evaluateCodeSubmission({ employeeId, questionId, language, code });
        if(result.notFound) return res.status(404).json({ success:false, message:result.message });
        res.json(result);
    } catch(e){
        console.log("/code/submit error:", e && e.message);
        res.status(500).json({ success:false, message:"Server error: " + (e && e.message) });
    }
});

// ----- Open in Terminal: create temp workspace -----
// NOTE: Directories are created under /tmp and will be cleaned by the OS tmpfile cleaner (e.g., systemd-tmpfiles or tmpreaper). This is acceptable for ephemeral coding workspaces.
app.post("/student/coding/open-terminal", async(req,res)=>{
    try {
        const { employeeId, questionId, language } = req.body || {};
        if(!employeeId || !questionId || !language){
            return res.json({ success:false, message:"employeeId, questionId, and language are required" });
        }
        // Sanitize employeeId and questionId to prevent path traversal and shell injection
        const safeId = String(employeeId).replace(/[^a-zA-Z0-9_-]/g, '');
        const safeQid = String(questionId).replace(/[^a-zA-Z0-9_-]/g, '');
        if(!safeId || !safeQid){
            return res.json({ success:false, message:"Invalid employeeId or questionId" });
        }
        const q = await CodingQuestion.findById(safeQid);
        if(!q) return res.status(404).json({ success:false, message:"Question not found" });

        const dirPath = `/tmp/coding_${safeId}_${safeQid}/`;
        fs.mkdirSync(dirPath, { recursive: true });

        // Write starter code file
        const lang = String(language).toLowerCase();
        let filename, starterCode;
        if(lang === "javascript" || lang === "js"){
            filename = "solution.js";
            starterCode = "// Problem: " + q.title + "\n// Read input from stdin\nconst readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nlet lines = [];\nrl.on('line', l => lines.push(l));\nrl.on('close', () => {\n  // Your solution here\n});\n";
        } else if(lang === "python" || lang === "py"){
            filename = "solution.py";
            starterCode = "# Problem: " + q.title + "\nimport sys\n\ndef solve():\n    # Your solution here\n    pass\n\nif __name__ == \"__main__\":\n    solve()\n";
        } else if(lang === "java"){
            filename = "Solution.java";
            starterCode = "// Problem: " + q.title + "\nimport java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // Your solution here\n    }\n}\n";
        } else if(lang === "cpp" || lang === "c++"){
            filename = "solution.cpp";
            starterCode = "#include <iostream>\nusing namespace std;\n// Problem: " + q.title + "\nint main() {\n    // Your solution here\n    return 0;\n}\n";
        } else {
            filename = "solution.txt";
            starterCode = "// Problem: " + q.title + "\n// Unsupported language: " + lang + "\n";
        }
        fs.writeFileSync(path.join(dirPath, filename), starterCode, "utf8");

        // Write README.txt
        let readme = "=== " + q.title + " ===\n\n";
        readme += "Description:\n" + (q.description || "N/A") + "\n\n";
        readme += "Input Format:\n" + (q.inputFormat || "N/A") + "\n\n";
        readme += "Output Format:\n" + (q.outputFormat || "N/A") + "\n\n";
        readme += "Sample Input:\n" + (q.sampleInput || "N/A") + "\n\n";
        readme += "Sample Output:\n" + (q.sampleOutput || "N/A") + "\n";
        fs.writeFileSync(path.join(dirPath, "README.txt"), readme, "utf8");

        // Write submit.sh
        const port = process.env.PORT || 5000;
        const submitScript = '#!/bin/bash\n# Submit your solution\n# Usage: ./submit.sh\nFILE="' + filename + '"\nCODE=$(cat "$FILE")\ncurl -s -X POST http://localhost:' + port + '/student/coding/submit-from-terminal \\\n  -H "Content-Type: application/json" \\\n  -d "{\\"employeeId\\":\\"' + safeId + '\\",\\"questionId\\":\\"' + safeQid + '\\",\\"language\\":\\"' + lang + '\\",\\"code\\":$(echo \\"$CODE\\" | jq -Rs .)}"\n';
        fs.writeFileSync(path.join(dirPath, "submit.sh"), submitScript, { mode: 0o755 });

        res.json({ success:true, workDir:dirPath, launchCmd:"cd " + dirPath + " && cat README.txt" });
    } catch(e){
        console.log("/student/coding/open-terminal error:", e && e.message);
        res.status(500).json({ success:false, message:"Server error: " + (e && e.message) });
    }
});

// ----- Submit from terminal -----
app.post("/student/coding/submit-from-terminal", async(req,res)=>{
    try {
        const { employeeId, questionId, language, code } = req.body || {};
        if(!employeeId || !questionId || !code){
            return res.json({ success:false, message:"employeeId, questionId and code are required" });
        }
        const result = await evaluateCodeSubmission({ employeeId, questionId, language, code });
        if(result.notFound) return res.status(404).json({ success:false, message:result.message });
        res.json(result);
    } catch(e){
        console.log("/student/coding/submit-from-terminal error:", e && e.message);
        res.status(500).json({ success:false, message:"Server error: " + (e && e.message) });
    }
});

// Coordinator's read-only view of student coding submissions in their domain
app.get("/coordinator/coding-submissions/:domain", async(req,res)=>{
    try {
        const domain = decodeURIComponent(req.params.domain);
        const list = await CodingSubmission.find({ domain }).sort({ submittedAt:-1 }).limit(200);
        res.json({ success:true, submissions:list });
    } catch(e){ console.log(e); res.status(500).json({ success:false }); }
});

// ================= PUBLIC DOCUMENT VERIFICATION =================

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
                if (!student.employeeId) continue;

                const percentage = await attendanceUtils.recomputeAndSaveAttendance(Student, Attendance, student.employeeId);
                if (percentage === 0 && !student.employeeId) continue;
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

// TENURE PAYMENT SYSTEM ROUTES
const SHORT_COURSE_PRICES = {
  '1week':   2000,
  '15days':  1500,
  '1month':  1000
};
const SHORT_COURSE_LABELS = {
  '1week':   '1 Week Internship Program',
  '15days':  '15 Days Internship Program',
  '1month':  '1 Month Internship Program'
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

    const tenure = (stu.tenure || '').toLowerCase().replace(/[-_\s]/g, '');
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

    const tenure = (stu.tenure || '').toLowerCase().replace(/[-_\s]/g, '');
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

// AI CHATBOT SYSTEM — Task Bot, Query Bot, Voice Bot (Gemini 2.0 Flash)
try {
    const v2Bots = require('./routes/v2/bots');
    app.use('/api/v2/bots', v2Bots);
    console.log('[V2] Bots routes mounted at /api/v2/bots');
} catch(e) {
    console.error('[V2] Failed to mount bots routes:', e.message);
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

io.use(async (socket, next) => {
    try{
        const identity = await verifyChatIdentity(socket.handshake.auth || {});
        if(!identity) return next(new Error("unauthorized"));
        socket.data.identity = identity;
        // Auto-join all rooms this user is allowed in
        roomsAllowedFor(identity).forEach(r => socket.join(r));
        next();
    } catch(e){ next(new Error("auth_error")); }
});

io.on("connection", (socket) => {
    const identity = socket.data.identity;

    // Optional explicit join (idempotent — server still re-checks permission)
    socket.on("join_room", (payload) => {
        const room = payload && payload.room;
        if(canAccessRoom(identity, room)) socket.join(room);
    });

    socket.on("send_message", async (payload, ack) => {
        try{
            const room = payload && payload.room;
            const text = (payload && payload.text || "").toString().trim().slice(0, 4000);
            if(!room || !text) { if(ack) ack({ success:false, message:"empty" }); return; }
            if(!canAccessRoom(identity, room)) { if(ack) ack({ success:false, message:"forbidden" }); return; }

            // Feature 8: block check — sender silenced in this room?
            try{
                const blocked = await BlockList.findOne({ chatRoom: room, blockedUser: identity.id });
                if(blocked){
                    if(ack) ack({ success:false, blocked:true, message:"You have been restricted from sending messages in this chat" });
                    return;
                }
            }catch(_){}

            const doc = await Message.create({
                chatRoom:     room,
                senderId:     identity.id,
                senderName:   identity.name,
                senderRole:   identity.role,
                senderDomain: identity.domain || "",
                message:      text,
                timestamp:    new Date()
            });
            io.to(room).emit("receive_message", doc);
            if(ack) ack({ success:true, messageId: String(doc._id) });
        } catch(e){
            console.log("send_message error:", e.message);
            if(ack) ack({ success:false, message:"server_error" });
        }
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
            verificationStatus: "pending"
        });

        await newCoord.save();
        return res.json({ success: true, message: "Application submitted successfully to HR Level 2 & 5." });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error in coordinator registration." });
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

        // ─── SEND EMAIL NOTIFICATION ──────────────────────────────────────────
        if (coord.email) {
            try {
                const isApproved = status === "approved";
                const subject = isApproved 
                    ? "Coordinator Application Approved 🎉" 
                    : "Coordinator Application Status Update";

                const htmlContent = isApproved ? `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #28a745;">Congratulations, ${coord.name || 'Coordinator'}!</h2>
                        <p>Your application to become a Coordinator for the domain <b>"${coord.domain}"</b> has been <b>Approved</b>.</p>
                        <p>You can now log in to access your coordinator dashboard and manage your assigned responsibilities.</p>
                        <br/>
                        <p>Best regards,<br/>The Team</p>
                    </div>
                ` : `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #dc3545;">Application Update</h2>
                        <p>Dear ${coord.name || 'Applicant'},</p>
                        <p>Thank you for your interest. Unfortunately, your application for Coordinator in the domain <b>"${coord.domain}"</b> was not approved at this time.</p>
                        <p>If you have any questions, please feel free to contact the administrative team.</p>
                        <br/>
                        <p>Best regards,<br/>The Team</p>
                    </div>
                `;

                await transporter.sendMail({
                    from: EMAIL_FROM,
                    to: coord.email,
                    subject: subject,
                    html: htmlContent
                });

                console.log(`✅ Coordinator status notification email sent to ${coord.email}`);
            } catch (emailErr) {
                console.error("❌ Failed to send email to coordinator:", emailErr.message);
                // Status save ho chuka hai, isliye flow fail nahi karenge
            }
        }
        // ───────────────────────────────────────────────────────────────────────

        return res.json({ success: true, message: `Coordinator application successfully ${status}.` });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error updating coordinator status." });
    }
});

server.listen(PORT, "0.0.0.0", ()=>{ console.log(`Server running on port ${PORT}`); });

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
