const mongoose = require("mongoose");

/**
 * Atomic sequence counters.
 *
 * Employee IDs used to be derived from `1001 + Student.countDocuments()`, in
 * two separate copies of the same function. That is not a sequence:
 *
 *   - two concurrent registrations read the same count and produce the SAME
 *     employeeId. Under MongoDB the second save then violates the unique index
 *     and the student sees "Server Error"; under the JSON fallback engine,
 *     which enforces nothing, both rows are written and two students share one
 *     login identity.
 *   - deleting a student rewinds the count, so the next registration re-issues
 *     an ID that already belongs to somebody.
 *
 * findOneAndUpdate with $inc and upsert is atomic at the document level, so
 * every caller gets a distinct, monotonically increasing value.
 */
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },   // e.g. "employeeId"
    seq: { type: Number, default: 0 }
});

/**
 * Reserve and return the next value in a sequence.
 * @param {string} name    counter name
 * @param {number} startAt value the first call should return
 */
counterSchema.statics.next = async function (name, startAt = 1) {
    const doc = await this.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return (startAt - 1) + doc.seq;
};

/**
 * Move the counter forward so it never re-issues a value already in use.
 * Called once at startup with the highest existing employee-ID sequence.
 */
counterSchema.statics.ensureAtLeast = async function (name, value) {
    if (!Number.isFinite(value) || value <= 0) return;
    const existing = await this.findOne({ _id: name });
    if (!existing || existing.seq < value) {
        await this.updateOne({ _id: name }, { $set: { seq: value } }, { upsert: true });
    }
};

module.exports = mongoose.model("Counter", counterSchema);
