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
NotificationSchema.statics.notifyStudent = async function (student, { title, message, type = "info" } = {}) {
    try {
        const employeeId = (student && student.employeeId) || "";
        if (!employeeId || !title || !message) return null;
        return await this.create({
            title,
            message,
            type,
            from: "HR",
            targetType: "student",
            targetEmployeeId: employeeId,
            targetDomain: (student && student.domain) || ""
        });
    } catch (notifErr) {
        console.error("[notification] create failed:", notifErr.message);
        return null; // Never re-throw — mail send must not be blocked.
    }
};

module.exports = mongoose.model("Notification", NotificationSchema);
