// E:\Downloads\Ten-Ecosystem1\models\Notification.js
'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    title:            { type: String, required: true },
    message:          { type: String, required: true },
    type:             { type: String, default: "info" }, // "success" | "warning" | "info" | "error"
    from:             { type: String, default: "System" },
    targetType:       { type: String, default: "all" },  // "all" | "domain" | "student" | "coordinator" | "coordinator-domain"
    targetDomain:     { type: String, default: "" },
    targetEmployeeId: { type: String, default: "" },
    targetUsername:   { type: String, default: "" },
    readBy:           { type: [String], default: [] },
    createdAt:        { type: Date, default: Date.now }
});

// Helper used throughout server.js: Notification.notifyStudent(student, {title, message, type})
// `student` can be a full Student doc or a plain { employeeId, domain } object.
notificationSchema.statics.notifyStudent = async function(student, { title, message, type }) {
    if (!student) return null;
    const notif = new this({
        title,
        message,
        type: type || "info",
        from: "System",
        targetType: "student",
        targetEmployeeId: student.employeeId || "",
        targetDomain: student.domain || ""
    });
    await notif.save();
    return notif;
};

module.exports = mongoose.model('Notification', notificationSchema);