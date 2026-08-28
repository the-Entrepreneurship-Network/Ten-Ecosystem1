const mongoose = require("mongoose");

// Chat message stored in MongoDB. One collection for all 4 chat rooms.
// Rooms:
//   "domain_<DomainName>"  — students of that domain + the coordinator of that domain
//   "general"              — every authenticated user
//   "hr_coordinators"      — all HR + all coordinators
//   "hr_internal"          — HR only

const messageSchema = new mongoose.Schema({
    chatRoom:     { type: String, required: true, index: true },
    senderId:     { type: String, required: true },   // employeeId for students, username for coord/HR
    senderName:   { type: String, required: true },
    // founder/investor/contractor/mentor were missing, so the first message
    // any of them sent failed validation — on portals whose sidebars all carry
    // a Messages link.
    senderRole:   { type: String, enum: ["student","coordinator","hr","admin","founder","investor","contractor","mentor"], required: true },
    senderDomain: { type: String, default: "" },

    // Text is optional when an image is attached — an image on its own is a
    // valid message. Validation below requires at least one of the two.
    message:      { type: String, default: "", maxlength: 4000 },

    // Image attachment. `imageUrl` is a path under /uploads served by the app,
    // never a caller-supplied external URL.
    imageUrl:     { type: String, default: null },
    imageName:    { type: String, default: null },
    imageMime:    { type: String, default: null },

    timestamp:    { type: Date, default: Date.now, index: true },

    // When this message should stop existing.
    //
    // Set ONLY on direct messages, which are kept for 30 days and then removed.
    // Group-room messages leave it null and are never expired: a domain room is
    // a shared record of the programme, while a private conversation between
    // two people is not something the portal should hold indefinitely.
    //
    // The TTL index below treats a missing/null value as "never expires", so
    // one field covers both policies without a second collection.
    expiresAt:    { type: Date, default: null }
});

/** Direct-message rooms are addressed "dm::<a>::<b>". */
function isDirectMessageRoom(room) {
    return typeof room === "string" && room.indexOf("dm::") === 0;
}

/** How long a private conversation is kept. */
const DM_RETENTION_DAYS = 30;

// A message must carry something. Previously `message` was required, so the
// schema could not represent an image-only message at all.
messageSchema.pre("validate", function (next) {
    const hasText = typeof this.message === "string" && this.message.trim().length > 0;
    if (!hasText && !this.imageUrl) {
        return next(new Error("A message must contain text or an image."));
    }

    // Stamp the expiry here rather than at each call site, so every path that
    // creates a message — the socket handler, a REST fallback, a future import
    // — gets the retention policy without having to remember it.
    if (isDirectMessageRoom(this.chatRoom)) {
        if (!this.expiresAt) {
            const base = this.timestamp instanceof Date ? this.timestamp : new Date();
            this.expiresAt = new Date(base.getTime() + DM_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        }
    } else {
        this.expiresAt = null;
    }
    next();
});

// Room + time is how history is read (newest 50, then reversed).
messageSchema.index({ chatRoom: 1, timestamp: -1 });

// MongoDB deletes a document once expiresAt is in the past. `expireAfterSeconds: 0`
// means "expire AT that time" rather than "N seconds after it", which is what
// lets one index carry a per-document policy. Documents with a null expiresAt
// are ignored by the TTL monitor entirely — that is how group messages are
// exempted. The monitor runs about once a minute, so deletion is prompt but not
// instantaneous.
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

messageSchema.statics.DM_RETENTION_DAYS = DM_RETENTION_DAYS;
messageSchema.statics.isDirectMessageRoom = isDirectMessageRoom;

module.exports = mongoose.model("Message", messageSchema);
