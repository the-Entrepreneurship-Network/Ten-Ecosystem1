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
    senderRole:   { type: String, enum: ["student","coordinator","hr"], required: true },
    senderDomain: { type: String, default: "" },

    // Text is optional when an image is attached — an image on its own is a
    // valid message. Validation below requires at least one of the two.
    message:      { type: String, default: "", maxlength: 4000 },

    // Image attachment. `imageUrl` is a path under /uploads served by the app,
    // never a caller-supplied external URL.
    imageUrl:     { type: String, default: null },
    imageName:    { type: String, default: null },
    imageMime:    { type: String, default: null },

    timestamp:    { type: Date, default: Date.now, index: true }
});

// A message must carry something. Previously `message` was required, so the
// schema could not represent an image-only message at all.
messageSchema.pre("validate", function (next) {
    const hasText = typeof this.message === "string" && this.message.trim().length > 0;
    if (!hasText && !this.imageUrl) {
        return next(new Error("A message must contain text or an image."));
    }
    next();
});

// Room + time is how history is read (newest 50, then reversed).
messageSchema.index({ chatRoom: 1, timestamp: -1 });

module.exports = mongoose.model("Message", messageSchema);
