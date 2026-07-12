const mongoose = require("mongoose");

// Per-room user block (Feature 8). One row per (chatRoom, blockedUser).
// Coordinator/HR-only — students cannot block anyone.

const blockListSchema = new mongoose.Schema({
    blockedBy:       { type: String, required: true },              // user id (employeeId / username / email)
    blockedByRole:   { type: String, enum: ["coordinator","hr"], required: true },
    blockedUser:     { type: String, required: true },              // user id of the blocked person
    blockedUserRole: { type: String, enum: ["student","coordinator","hr"], required: true },
    chatRoom:        { type: String, required: true, index: true },
    blockedAt:       { type: Date,   default: Date.now }
});

blockListSchema.index({ chatRoom: 1, blockedUser: 1 }, { unique: true });

module.exports = mongoose.model("BlockList", blockListSchema);
