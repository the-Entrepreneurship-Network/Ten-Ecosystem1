"use strict";

/**
 * The student's half of an admin credential reset.
 *
 * When a student cannot sign in — a mistyped email at registration that no
 * reset link will ever reach, a forgotten password on an account whose email is
 * wrong — an admin can set working credentials for them
 * (POST /api/admin/students/:id/reset-credentials).
 *
 * That gets them back in, and leaves the account on a password somebody else
 * chose and knows. So the reset raises a flag, and this is what clears it: the
 * next sign-in stops here and asks the student to set their own password, and
 * to confirm or correct their own email if that was changed too. Two separate
 * steps, because an admin may have changed only one of them.
 *
 * Identity comes from the session. Nothing here takes an employee ID from the
 * caller — that would let anyone reset anyone.
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const Student = require("../models/Student");

const MIN_PASSWORD_LENGTH = 8;

/** Deliberately permissive but real: something@something.tld. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function requireStudentSession(req, res, next) {
    const s = req.session && req.session.student;
    if (!s || !s.employeeId) {
        return res.status(401).json({ success: false, message: "Please sign in to continue." });
    }
    next();
}

/** The signed-in student's record, by _id where we have it and employeeId otherwise. */
async function currentStudent(req) {
    const s = req.session.student;
    if (s._id) {
        const byId = await Student.findById(s._id);
        if (byId) return byId;
    }
    return Student.findOne({ employeeId: s.employeeId });
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * GET /api/student/security/status
 *
 * What, if anything, this student has to do before carrying on. The dashboard
 * calls it on load and shows the matching sections.
 */
router.get("/status", async (req, res) => {
    try {
        // Answered for anyone with a session, not students only.
        //
        // /messages is shared by all four portals and carries this check.
        // Returning 401 to an HR or coordinator there would be read by
        // public/session-guard.js — which treats every same-origin 401 as
        // "you have been signed out" — and throw them out to the login page.
        // Nobody but a student can have anything outstanding here, so for
        // everyone else the honest answer is "nothing to do".
        const session = req.session || {};
        if (!session.student || !session.student.employeeId) {
            if (session.hr || session.coordinator || session.adminUser) {
                return res.json({ success: true, mustChangePassword: false, mustChangeEmail: false });
            }
            return res.status(401).json({ success: false, message: "Please sign in to continue." });
        }

        const student = await currentStudent(req);
        if (!student) return res.status(404).json({ success: false, message: "Your record could not be found." });

        res.json({
            success: true,
            mustChangePassword: !!student.mustChangePassword,
            mustChangeEmail: !!student.mustChangeEmail,
            email: student.email || "",
            previousEmail: student.previousEmail || "",
            resetAt: student.credentialResetAt || null,
            resetBy: student.credentialResetBy || null,
            minPasswordLength: MIN_PASSWORD_LENGTH
        });
    } catch (err) {
        console.error("[studentSecurity] status failed:", err.message);
        res.status(500).json({ success: false, message: "Could not check your account status." });
    }
});

/**
 * POST /api/student/security/password { currentPassword?, newPassword, confirmPassword }
 *
 * `currentPassword` is required when a student is changing their password of
 * their own accord, and NOT when an admin has just reset it: they signed in
 * with the admin's password moments ago, the session proves it, and asking
 * them to retype a password they were handed on a slip of paper is friction
 * with no security value.
 */
router.post("/password", requireStudentSession, async (req, res) => {
    try {
        const body = req.body || {};
        const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
        const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : newPassword;
        const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";

        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ success: false, field: "newPassword",
                message: `Your password needs to be at least ${MIN_PASSWORD_LENGTH} characters.` });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, field: "confirmPassword",
                message: "Those two passwords do not match." });
        }

        const student = await currentStudent(req);
        if (!student) return res.status(404).json({ success: false, message: "Your record could not be found." });

        if (!student.mustChangePassword) {
            if (!currentPassword) {
                return res.status(400).json({ success: false, field: "currentPassword",
                    message: "Enter your current password." });
            }
            let ok = false;
            try { ok = await bcrypt.compare(currentPassword, student.password || ""); } catch (_) {}
            if (!ok) {
                return res.status(400).json({ success: false, field: "currentPassword",
                    message: "That is not your current password." });
            }
        }

        // Setting it back to the one the admin issued leaves the account exactly
        // where it started — on a password a third party knows.
        let sameAsBefore = false;
        try { sameAsBefore = await bcrypt.compare(newPassword, student.password || ""); } catch (_) {}
        if (sameAsBefore) {
            return res.status(400).json({ success: false, field: "newPassword",
                message: "Choose a password you have not just been using." });
        }

        student.password = await bcrypt.hash(newPassword, 10);
        student.mustChangePassword = false;
        // A reset link issued before this must stop working.
        student.passwordResetToken = null;
        student.passwordResetExpiry = null;
        // Failed attempts from before the reset are not this password's.
        student.failedLoginAttempts = 0;
        student.isLockedOut = false;
        student.lockoutUntil = null;
        await student.save();

        res.json({
            success: true,
            message: "Your password is set. Use it the next time you sign in.",
            mustChangeEmail: !!student.mustChangeEmail
        });
    } catch (err) {
        console.error("[studentSecurity] password change failed:", err.message);
        res.status(500).json({ success: false, message: "Could not change your password. Please try again." });
    }
});

/**
 * POST /api/student/security/email { newEmail, keepCurrent? }
 *
 * After an admin corrects an email, the student confirms it is really theirs —
 * or replaces it, if the admin guessed. `keepCurrent: true` means "the one on
 * the account is right", which clears the prompt without a change.
 *
 * The email is a sign-in identifier, so it has to stay unique.
 */
router.post("/email", requireStudentSession, async (req, res) => {
    try {
        const body = req.body || {};
        const keepCurrent = body.keepCurrent === true;
        const newEmail = typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";

        const student = await currentStudent(req);
        if (!student) return res.status(404).json({ success: false, message: "Your record could not be found." });

        if (keepCurrent) {
            student.mustChangeEmail = false;
            await student.save();
            return res.json({ success: true, email: student.email || "", message: "Thanks — we will use that address." });
        }

        if (!EMAIL_PATTERN.test(newEmail)) {
            return res.status(400).json({ success: false, field: "newEmail",
                message: "That does not look like a valid email address." });
        }

        if (newEmail !== String(student.email || "").toLowerCase()) {
            const clash = await Student.findOne({
                email: new RegExp("^" + escapeRegex(newEmail) + "$", "i"),
                _id: { $ne: student._id }
            }).select("_id").lean();
            if (clash) {
                return res.status(409).json({ success: false, field: "newEmail",
                    message: "That email is already registered to another account." });
            }
            student.previousEmail = student.email || null;
            student.email = newEmail;
        }

        student.mustChangeEmail = false;
        await student.save();

        // The session carries the email for display; leaving the old one there
        // would show a stale address until the next sign-in.
        if (req.session && req.session.student) req.session.student.email = student.email;

        res.json({ success: true, email: student.email, message: "Your email is updated." });
    } catch (err) {
        console.error("[studentSecurity] email change failed:", err.message);
        res.status(500).json({ success: false, message: "Could not update your email. Please try again." });
    }
});

module.exports = router;
