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
    message:      { type: String, required: true, maxlength: 4000 },
    timestamp:    { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model("Message", messageSchema);
