"use strict";

// The two reads the report needs besides login events, kept apart so the
// report builder can be tested without a database.

async function selfMarksFor(dateKey) {
    const Attendance = require("../../models/Attendance");
    return Attendance.find({ dateKey, markedBy: "self", status: "Present" })
        .select("employeeId domain")
        .lean();
}

async function studentsByEmployeeIds(ids) {
    if (!ids || !ids.length) return [];
    const Student = require("../../models/Student");
    return Student.find({ employeeId: { $in: ids } })
        .select("employeeId firstName lastName domain domains")
        .lean();
}

module.exports = { selfMarksFor, studentsByEmployeeIds };
