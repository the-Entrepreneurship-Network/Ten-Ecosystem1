const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, default: "info" }, // info, warning, success, urgent
    from: { type: String, default: "HR" },
    
    // Targeting
    targetType: { 
        type: String, 
        enum: ["all", "domain", "coordinator", "student", "coordinator-domain"],
        default: "all"
    },
    targetDomain: { type: String, default: "" },       // specific domain
    targetEmployeeId: { type: String, default: "" },   // specific student
    targetUsername: { type: String, default: "" },     // specific coordinator username
    
    // Read tracking
    readBy: [{ type: String }],     // array of employeeIds or coordinator usernames who read it
    
    createdAt: { type: Date, default: Date.now }
});

// ── Central helper: mirror an HR mail as an in-app student notification ──
// Additive and failure-safe: never throws, so mail sending is never blocked.
// Uses the EXACT existing schema fields (targetType/targetEmployeeId/targetDomain).
NotificationSchema.statics.notifyStudent = async function (student, { title, message, type = "info", email = true } = {}) {
    try {
        const employeeId = (student && student.employeeId) || "";
        if (!employeeId || !title || !message) return null;
        const doc = new this({
            title,
            message,
            type,
            from: "HR",
            targetType: "student",
            targetEmployeeId: employeeId,
            targetDomain: (student && student.domain) || ""
        });
        // `email: false` for the few events that send their own, richer mail.
        if (!email) doc.$locals.skipEmail = true;
        return await doc.save();
    } catch (notifErr) {
        console.error("[notification] create failed:", notifErr.message);
        return null; // Never re-throw — mail send must not be blocked.
    }
};

/*
 * Every personal notification is also emailed.
 *
 * Hooked on the model rather than on notifyStudent above, because two files
 * build `new Notification({ targetType: "student" })` by hand and never call
 * the static — services/studentPropagation.js and
 * routes/v2/certificateApplications.js. A hook on the static would have missed
 * both, and would keep missing whichever file does the same next year.
 *
 * Fire-and-forget with its own catch: an email must never delay or fail the
 * notification that was already saved. services/notificationEmail.js decides
 * what is worth sending — personal notifications only, never a broadcast.
 */
NotificationSchema.post("save", function (doc) {
    try {
        require("../services/notificationEmail").mirror(doc).catch(() => {});
    } catch (err) {
        console.error("[notification] email mirror failed to start:", err.message);
    }
});

module.exports = mongoose.model("Notification", NotificationSchema);
