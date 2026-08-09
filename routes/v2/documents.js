// NEW FEATURE: Document Upload + Offer Letter Routes
// All routes under /api/v2/documents/ and /api/v2/admin/documents/
"use strict";

const express             = require("express");
const router              = express.Router();
const multer              = require("multer");
const path                = require("path");
const fs                  = require("fs");
const nodemailer          = require("nodemailer");
const Student             = require("../../models/Student");
const StudentDocument     = require("../../models/new/StudentDocument");
const StudentTaskProgress = require("../../models/new/StudentTaskProgress");
const { generateOfferLetterPDF } = require("../../services/v2/offerLetterService");
const { generateLORPDF } = require("../../services/v2/lorService");
const { generateLOCPDF } = require("../../services/v2/locService");
const DocumentHistory     = require("../../models/DocumentHistory");
const MailHistory         = require("../../models/MailHistory");
const Notification        = require("../../models/Notification");
const { generateDocumentNumber, normalizeDocumentNumber } = require("../../utils/documentNumber");

// ── Multer storage for documents ──
const uploadsDir = path.join(__dirname, "../../uploads/documents");
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}

const docStorage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const studentId = req.student?._id?.toString() || "unknown";
        const ext       = path.extname(file.originalname).toLowerCase();
        const type      = req.docType || "file";
        cb(null, `${studentId}_${type}${ext}`);
    }
});

const docUpload = multer({
    storage: docStorage,
    limits:  { fileSize: 25 * 1024 * 1024 }, // 25MB
    fileFilter: (_, file, cb) => {
        const allowed = [".jpg", ".jpeg", ".png", ".pdf"];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) return cb(null, true);
        cb(new Error("Only JPG, PNG, PDF files are allowed"));
    }
});

// ── Auth middleware (student) ──
async function requireStudent(req, res, next) {
    try {
        const employeeId = req.headers["x-employee-id"] || req.body.employeeId || req.query.employeeId;
        if (!employeeId) return res.status(401).json({ success: false, message: "Authentication required" });
        const student = await Student.findOne({ employeeId: String(employeeId) });
        if (!student) return res.status(401).json({ success: false, message: "Student not found" });
        req.student = student;
        next();
    } catch (err) {
        res.status(500).json({ success: false, message: "Auth error" });
    }
}

// ── Auth middleware (HR) ── session-derived.
// The previous check was `authorization.startsWith("Bearer hr_")`, which the
// literal string "Bearer hr_" satisfied.
const { requireHR } = require("../../middleware/sessionAuth");

// ── Mailer helper ──
const { createEmailTransporter } = require("../../utils/mailer");
function createTransporter() {
    return createEmailTransporter();
}

// ════════════════════════════════
// STUDENT ROUTES
// ════════════════════════════════

async function tryAutoGenerateLOC(student) {
    try {
        const [totalCount, approvedCount] = await Promise.all([
            StudentTaskProgress.countDocuments({ studentId: student._id }),
            StudentTaskProgress.countDocuments({ studentId: student._id, status: "approved" })
        ]);
        if (!totalCount || approvedCount < totalCount) return;

        let doc = await StudentDocument.findOne({ studentId: student._id });
        if (doc && doc.locUrl) return;

        const locDir = path.join(__dirname, "../../uploads/loc");
        try { fs.mkdirSync(locDir, { recursive: true }); } catch (_) {}

        const docNumber = normalizeDocumentNumber(generateDocumentNumber("loc"));
        const joining   = student.joiningDate ? new Date(student.joiningDate) : new Date();
        const tenureDays = student.tenure === "45 Days" ? 45 : student.tenure === "1 Month" ? 30 : student.tenure === "3 Months" ? 90 : student.tenure === "6 Months" ? 180 : 45;
        const endDate   = new Date(joining.getTime() + tenureDays * 24 * 3600 * 1000);
        const fmt = d => d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

        const outPath = path.join(locDir, `${student._id}_loc.pdf`);
        await generateLOCPDF({
            studentName:       student.name,
            employeeId:        student.employeeId,
            domain:            student.domain,
            durationText:      student.tenure,
            startDate:         fmt(joining),
            endDate:           fmt(endDate),
            dateIssued:        fmt(new Date()),
            documentNumber:    docNumber,
            completionPercent: 100
        }, outPath);

        const locUrl = `/uploads/loc/${path.basename(outPath)}`;

        if (!doc) doc = new StudentDocument({ studentId: student._id });
        doc.locUrl           = locUrl;
        doc.locSentAt        = new Date();
        doc.locDocumentNumber = docNumber;
        await doc.save();

        try {
            const pdfBuffer = fs.readFileSync(outPath);
            await Student.findByIdAndUpdate(student._id, {
                locPdfBase64: pdfBuffer.toString('base64'),
                locStatus: 'issued',
                locIssuedAt: new Date()
            });
            console.log(`[Sync] ✓ Synced LOC (issued) to Student ${student._id}`);
        } catch (syncErr) {
            console.error(`[Sync] ✗ Failed to sync LOC to Student:`, syncErr.message);
        }

        const studentName = (student.name || student.email || "").trim();
        await DocumentHistory.create({
            studentId:      student._id,
            studentName,
            studentEmail:   student.email || "",
            employeeId:     student.employeeId || "",
            college:        student.collegeName || student.college || "Not provided",
            domain:         student.domain || "",
            documentType:   "Letter of Completion",
            documentKey:    "loc",
            documentNumber: docNumber,
            sentAt:         new Date(),
            sentBy:         "System",
            sentToEmail:    student.email || ""
        });

        try {
            const transporter = createTransporter();
            await transporter.sendMail({
                from:        process.env.EMAIL_US,
                to:          student.email,
                subject:     "Congratulations! Your Letter of Completion — The Entrepreneurship Network",
                html:        `<p>Dear ${student.name},</p><p>🎉 Congratulations on completing 100% of your internship programme!</p><p>Your Letter of Completion is now available in your Student Portal under <strong>My Documents</strong>.</p><p>Best regards,<br>HR Team<br>The Entrepreneurship Network</p>`,
                attachments: [{ filename: "TEN_Letter_of_Completion.pdf", path: outPath }]
            });
        } catch (_) {}
        await Notification.notifyStudent(student, {
            title: "🎓 Letter of Completion Issued",
            message: `Congratulations ${student.name}! You completed 100% of your internship programme. Your Letter of Completion (${docNumber}) is available under My Documents and has been emailed to you.`,
            type: "success"
        });

        console.log(`[DOCS] LOC auto-generated for student: ${student.name} (${student.employeeId})`);
    } catch (err) {
        console.error("[DOCS] LOC auto-generation error:", err.message);
    }
}

router.get("/documents/my-status", requireStudent, async (req, res) => {
    try {
        let doc = await StudentDocument.findOne({ studentId: req.student._id });
        if (!doc) {
            doc = await StudentDocument.create({ studentId: req.student._id });
        }

        tryAutoGenerateLOC(req.student).catch(() => {});

        res.json({
            success:         true,
            status:          doc.uploadStatus,
            addressProofUrl: doc.addressProofUrl ? `/uploads/documents/${path.basename(doc.addressProofUrl)}` : null,
            marksheetUrl:    doc.marksheetUrl    ? `/uploads/documents/${path.basename(doc.marksheetUrl)}`    : null,
            rejectionReason: doc.rejectionReason,
            offer_letter_url: doc.offerLetterUrl || null,
            offerLetterUrl:   doc.offerLetterUrl || null,
            offerLetterSentAt: doc.offerLetterSentAt || null,
            lor_url:          doc.lorUrl || null,
            lorUrl:           doc.lorUrl || null,
            lorSentAt:        doc.lorSentAt || null,
            lorDocumentNumber: doc.lorDocumentNumber || null,
            loc_url:          doc.locUrl || null,
            locUrl:           doc.locUrl || null,
            locSentAt:        doc.locSentAt || null,
            locDocumentNumber: doc.locDocumentNumber || null,
            uploadedAt:       doc.uploadedAt
        });
    } catch (err) {
        console.error("[DOCS] my-status error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/documents/upload-address-proof", requireStudent, (req, res, next) => {
    req.docType = "address_proof";
    next();
}, (req, res, next) => {
    docUpload.single("file")(req, res, (err) => {
        if (err) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({ success: false, message: "File is too large! Maximum limit is 25MB." });
            }
            return res.status(400).json({ success: false, message: err.message || "File upload error" });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
        let doc = await StudentDocument.findOne({ studentId: req.student._id });
        if (!doc) doc = new StudentDocument({ studentId: req.student._id });
        if (doc.addressProofUrl && fs.existsSync(doc.addressProofUrl)) {
            try { fs.unlinkSync(doc.addressProofUrl); } catch (_) {}
        }
        doc.addressProofUrl = req.file.path;
        if (doc.uploadStatus === "rejected") doc.uploadStatus = "not_uploaded";
        await doc.save();
        res.json({
            success: true,
            message: "Address proof uploaded successfully",
            fileUrl: `/uploads/documents/${req.file.filename}`
        });
    } catch (err) {
        console.error("[DOCS] upload-address-proof error:", err);
        res.status(500).json({ success: false, message: "Upload failed: " + err.message });
    }
});

router.post("/documents/upload-marksheet", requireStudent, (req, res, next) => {
    req.docType = "marksheet";
    next();
}, (req, res, next) => {
    docUpload.single("file")(req, res, (err) => {
        if (err) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({ success: false, message: "File is too large! Maximum limit is 25MB." });
            }
            return res.status(400).json({ success: false, message: err.message || "File upload error" });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
        let doc = await StudentDocument.findOne({ studentId: req.student._id });
        if (!doc) doc = new StudentDocument({ studentId: req.student._id });
        if (doc.marksheetUrl && fs.existsSync(doc.marksheetUrl)) {
            try { fs.unlinkSync(doc.marksheetUrl); } catch (_) {}
        }
        doc.marksheetUrl = req.file.path;
        if (doc.uploadStatus === "rejected") doc.uploadStatus = "not_uploaded";
        await doc.save();
        res.json({
            success: true,
            message: "Marksheet uploaded successfully",
            fileUrl: `/uploads/documents/${req.file.filename}`
        });
    } catch (err) {
        console.error("[DOCS] upload-marksheet error:", err);
        res.status(500).json({ success: false, message: "Upload failed: " + err.message });
    }
});

router.post("/documents/submit", requireStudent, async (req, res) => {
    try {
        const doc = await StudentDocument.findOne({ studentId: req.student._id });
        if (!doc || !doc.addressProofUrl || !doc.marksheetUrl) {
            return res.status(400).json({ success: false, message: "Please upload both documents first" });
        }
        if (doc.uploadStatus === "pending" || doc.uploadStatus === "under_review" || doc.uploadStatus === "approved") {
            return res.json({ success: true, status: doc.uploadStatus, message: "Already submitted" });
        }
        doc.uploadStatus = "pending";
        doc.uploadedAt   = new Date();
        doc.rejectionReason = null;
        await doc.save();

        await Student.findByIdAndUpdate(req.student._id, {
            offerLetterStatus: "pending",
            documentsSubmittedAt: new Date(),
            documentRejectionReason: null
        });

        try {
            const transporter = createTransporter();
            await transporter.sendMail({
                from:    process.env.EMAIL_US,
                to:      process.env.EMAIL_US,
                subject: `[TEN] New Document Submission — ${req.student.name} (${req.student.employeeId})`,
                html:    `<p>Student <strong>${req.student.name}</strong> (${req.student.employeeId}) has submitted their documents for review.</p><p>Please log in to the HR portal → Generate Documents → Pending to review.</p>`
            });
            await MailHistory.create({
                recipientEmail: process.env.EMAIL_US || "",
                recipientName: "HR",
                studentId: req.student._id,
                subject: `[TEN] New Document Submission — ${req.student.name} (${req.student.employeeId})`,
                mailType: "document_submission",
                sentAt: new Date(),
                status: "sent"
            });
        } catch (err) {
            try {
                await MailHistory.create({
                    recipientEmail: process.env.EMAIL_US || "",
                    recipientName: "HR",
                    studentId: req.student._id,
                    subject: `[TEN] New Document Submission — ${req.student.name} (${req.student.employeeId})`,
                    mailType: "document_submission",
                    sentAt: new Date(),
                    status: "failed",
                    errorMessage: err && err.message ? String(err.message) : ""
                });
            } catch (_) {}
        }

        res.json({ success: true, status: "pending", message: "Documents submitted for HR review" });
    } catch (err) {
        console.error("[DOCS] submit error:", err.message);
        res.status(500).json({ success: false, message: "Submit failed" });
    }
});

// ════════════════════════════════
// HR ADMIN ROUTES
// ════════════════════════════════

router.get("/admin/documents/pending", requireHR, async (req, res) => {
    try {
        const docs = await StudentDocument.find({
            uploadStatus: "pending",
            addressProofUrl: { $ne: null },
            marksheetUrl: { $ne: null }
        }).sort({ uploadedAt: -1 });

        const result = await Promise.all(docs.map(async (doc) => {
            const student = await Student.findById(doc.studentId).select("name email employeeId domain tenure joiningDate").lean();
            if (!student) return null;
            return {
                studentId:      doc.studentId,
                documentId:     doc._id,
                studentName:    student.name,
                studentEmail:   student.email,
                employeeId:     student.employeeId,
                domain:         student.domain,
                tenure:         student.tenure,
                duration:       student.tenure,
                college:        student.collegeName || student.college || "Not provided",
                joiningDate:    student.joiningDate,
                uploadStatus:   doc.uploadStatus,
                uploadedAt:     doc.uploadedAt,
                addressProofUrl: doc.addressProofUrl ? `/uploads/documents/${path.basename(doc.addressProofUrl)}` : null,
                marksheetUrl:    doc.marksheetUrl    ? `/uploads/documents/${path.basename(doc.marksheetUrl)}`    : null
            };
        }));

        res.json({ success: true, count: result.filter(Boolean).length, documents: result.filter(Boolean) });
    } catch (err) {
        console.error("[DOCS] pending error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/admin/documents/generate-offer-letters", requireHR, async (req, res) => {
    try {
        const { studentIds } = req.body;
        if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
            return res.status(400).json({ success: false, message: "No students selected" });
        }

        const results = [];
        const offerDir = path.join(__dirname, "../../uploads/offer-letters");
        try { fs.mkdirSync(offerDir, { recursive: true }); } catch (_) {}

        for (const sid of studentIds) {
            try {
                const student = await Student.findById(sid);
                const docRec  = await StudentDocument.findOne({ studentId: sid });
                if (!student || !docRec) { results.push({ studentId: sid, success: false, error: "Not found" }); continue; }

                const docNumber = normalizeDocumentNumber(generateDocumentNumber("offer_letter"));

                const joining = student.joiningDate ? new Date(student.joiningDate) : new Date();
                const tenureDays = student.tenure === "45 Days" ? 45 : student.tenure === "1 Month" ? 30 : student.tenure === "3 Months" ? 90 : student.tenure === "6 Months" ? 180 : 45;
                const endDate   = new Date(joining.getTime() + tenureDays * 24 * 3600 * 1000);
                const fmt = d => d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

                const safeEmpId = String(student.employeeId || sid).replace(/\//g, "-");
                const pdfPath = path.join(offerDir, `${safeEmpId}_offer_letter.pdf`);
                await generateOfferLetterPDF({
                    studentName:    student.name,
                    collegeName:    student.collegeName || student.college || "",
                    employeeId:     student.employeeId,
                    domain:         student.domain,
                    durationText:   student.tenure,
                    startDate:      fmt(joining),
                    endDate:        fmt(endDate),
                    dateIssued:     fmt(new Date()),
                    documentNumber: docNumber
                }, pdfPath);

                docRec.uploadStatus     = "approved";
                docRec.reviewedAt       = new Date();
                docRec.offerLetterUrl   = `/uploads/offer-letters/${path.basename(pdfPath)}`;
                docRec.offerLetterSentAt = new Date();
                docRec.offerLetterDocumentNumber = docNumber;
                await docRec.save();

                try {
                    const pdfBuffer = fs.readFileSync(pdfPath);
                    await Student.findByIdAndUpdate(sid, {
                        offerPdfBase64: pdfBuffer.toString('base64'),
                        offerLetterStatus: 'approved',
                        offerLetterGeneratedAt: new Date(),
                        documentRejectionReason: null
                    });
                    console.log(`[Sync] ✓ Synced Offer Letter (approved) to Student ${sid}`);
                } catch (syncErr) {
                    console.error(`[Sync] ✗ Failed to sync Offer Letter to Student:`, syncErr.message);
                }

                let mailStatus = "sent";
                let mailError = "";
                try {
                    const transporter = createTransporter();
                    await transporter.sendMail({
                        from:    process.env.EMAIL_US,
                        to:      student.email,
                        subject: `Your Internship Offer Letter — The Entrepreneurship Network`,
                        html:    `<p>Dear ${student.name},</p><p>Congratulations! Please find your Internship Offer Letter attached to this email.</p><p>Welcome to TEN! Log in to your student portal to track your progress.</p><p>Best regards,<br>HR Team<br>The Entrepreneurship Network</p>`,
                        attachments: [{ filename: "TEN_Offer_Letter.pdf", path: pdfPath }]
                    });
                } catch (mailErr) {
                    console.log("[DOCS] email simulated/fallback handling for", student.email);
                    mailStatus = "failed";
                    mailError = mailErr && mailErr.message ? String(mailErr.message) : "";
                }

                const studentName = (student.name || `${student.firstName || ""} ${student.lastName || ""}`.trim() || student.email || "").trim();
                const college = (student.collegeName || student.college || "Not provided").trim();

                await DocumentHistory.create({
                    studentId: student._id,
                    studentName,
                    studentEmail: student.email || "",
                    employeeId: student.employeeId || "",
                    college,
                    domain: student.domain || "",
                    documentType: "Offer Letter",
                    documentKey: "offer_letter",
                    documentNumber: docNumber,
                    sentAt: new Date(),
                    sentBy: "HR Portal",
                    sentToEmail: student.email || ""
                });

                try {
                    await MailHistory.create({
                        recipientEmail: student.email || "",
                        recipientName: studentName,
                        studentId: student._id,
                        subject: "Your Internship Offer Letter — The Entrepreneurship Network",
                        mailType: "offer_letter",
                        sentAt: new Date(),
                        status: mailStatus,
                        errorMessage: mailError
                    });
                } catch (_) {}
                await Notification.notifyStudent(student, {
                    title: "📄 Offer Letter Sent",
                    message: `Congratulations ${studentName}! Your Internship Offer Letter (${docNumber}) has been generated and emailed to ${student.email || "your registered email"}. You can also download it from My Documents.`,
                    type: "success"
                });

                results.push({
                    studentId: sid,
                    success: true,
                    studentName,
                    offerLetterUrl: docRec.offerLetterUrl,
                    documentNumber: docNumber,
                    emailStatus: mailStatus
                });
            } catch (err) {
                results.push({ studentId: sid, success: false, error: err.message });
            }
        }

        const succeeded = results.filter(r => r.success).length;
        res.json({ success: true, message: `Generated ${succeeded} of ${studentIds.length} offer letters`, results });
    } catch (err) {
        console.error("[DOCS] generate-offer-letters error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.get("/documents/my-certificates", requireStudent, async (req, res) => {
    try {
        const student = req.student;

        const stats = {
            attendance:     student.attendancePercentage   || 0,
            performance:    student.performanceScore       || 0,
            taskSubmission: student.taskSubmissionRate     || 0,
            streak:         student.currentStreak          || 0,
            daysRemaining:  null
        };

        let internshipStatus = "active";
        if (student.joiningDate) {
            const joining = new Date(student.joiningDate);
            const tenureDays = student.tenure === "45 Days" ? 45 : student.tenure === "1 Month" ? 30 : student.tenure === "3 Months" ? 90 : 180;
            const endDate = student.internshipEndDate || new Date(joining.getTime() + tenureDays * 24 * 3600 * 1000);
            const daysLeft = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
            stats.daysRemaining = Math.max(0, daysLeft);
            if (daysLeft <= 0) internshipStatus = "completed";
        }

        const docRecord = await StudentDocument.findOne({ studentId: student._id });
        const offerLetterEarned = !!(docRecord && docRecord.offerLetterUrl);

        const empId = student.employeeId || student._id.toString();
        const locPath  = require("path").join(__dirname, "../../uploads/certificates", `${empId}_loc.pdf`);
        const lorPath  = require("path").join(__dirname, "../../uploads/certificates", `${empId}_lor.pdf`);
        const starPath = require("path").join(__dirname, "../../uploads/certificates", `${empId}_star.pdf`);
        const fse = require("fs");

        const locEarned  = fse.existsSync(locPath);
        const lorEarned  = fse.existsSync(lorPath);
        const starEarned = fse.existsSync(starPath);

        const { getStarGrade } = require("../../services/automationCron");
        let starInfo = { grade: '', label: '' };
        try {
            starInfo = getStarGrade(stats);
        } catch (_) {}

        let journeyStage = "registered";
        if (offerLetterEarned) journeyStage = "offer_received";
        else if (docRecord && (docRecord.addressProofUrl || docRecord.marksheetUrl)) journeyStage = "docs_uploaded";
        if (internshipStatus === "active" && offerLetterEarned) journeyStage = "internship";
        if (locEarned || lorEarned || starEarned) journeyStage = "certified";

        res.json({
            success: true,
            internshipStatus,
            stats,
            certificates: {
                offerLetter: {
                    earned:        offerLetterEarned,
                    url:           docRecord?.offerLetterUrl || null,
                    earnedAt:      docRecord?.offerLetterSentAt || null,
                    autoGenerated: docRecord?.autoGenerated || false
                },
                loc: {
                    earned:   locEarned,
                    url:      locEarned  ? `/uploads/certificates/${empId}_loc.pdf`  : null,
                    earnedAt: null,
                    eligible: stats.attendance >= 75
                },
                lor: {
                    earned:   lorEarned,
                    url:      lorEarned  ? `/uploads/certificates/${empId}_lor.pdf`  : null,
                    earnedAt: null,
                    eligible: stats.attendance >= 75 && stats.performance >= 70
                },
                starPerformance: {
                    earned:     starEarned,
                    url:        starEarned ? `/uploads/certificates/${empId}_star.pdf` : null,
                    earnedAt:   null,
                    grade:      starInfo.grade,
                    gradeLabel: starInfo.label
                }
            },
            journeyStage
        });
    } catch (err) {
        console.error("[DOCS] my-certificates error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/admin/documents/generate-lor/:studentId", requireHR, async (req, res) => {
    try {
        const student = await Student.findById(req.params.studentId);
        if (!student) return res.status(404).json({ success: false, message: "Student not found" });

        const { force } = req.body;

        const [totalCount, approvedCount] = await Promise.all([
            StudentTaskProgress.countDocuments({ studentId: student._id }),
            StudentTaskProgress.countDocuments({ studentId: student._id, status: "approved" })
        ]);
        const completionPercent = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0;
        if (completionPercent < 50 && !force) {
            return res.json({
                success: false,
                warning: true,
                message: `Student has only completed ${completionPercent}% of the internship (LOR requires at least 50% completion). Do you still want to generate and send LOR anyway?`
            });
        }

        const v2Certificates = require("./certificates");
        const certResult = await v2Certificates.generateAndSaveCert(student._id.toString(), 'LOR', student);

        res.json({
            success: true,
            message: `LOR generated and synced to Student portal.`,
            completionPercent
        });
    } catch (err) {
        console.error("[DOCS] generate-lor error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.patch("/admin/documents/reject/:studentId", requireHR, async (req, res) => {
    try {
        const { rejectionReason } = req.body;
        const doc = await StudentDocument.findOne({ studentId: req.params.studentId });
        if (!doc) return res.status(404).json({ success: false, message: "Document record not found" });

        doc.uploadStatus    = "rejected";
        doc.rejectionReason = rejectionReason || "Documents did not meet the requirements. Please re-upload.";
        doc.reviewedAt      = new Date();
        await doc.save();

        await Student.findByIdAndUpdate(req.params.studentId, {
            offerLetterStatus: "rejected",
            documentRejectionReason: doc.rejectionReason
        });

        try {
            const student = await Student.findById(req.params.studentId).select("email name");
            if (student) {
                const transporter = createTransporter();
                await transporter.sendMail({
                    from:    process.env.EMAIL_US,
                    to:      student.email,
                    subject: `[TEN] Document Review Update`,
                    html:    `<p>Dear ${student.name},</p><p>Your submitted documents have been reviewed and require re-submission.</p><p><strong>Reason:</strong> ${doc.rejectionReason}</p><p>Please log in to your student portal and re-upload your documents.</p>`
                });
            }
        } catch (_) {}

        res.json({ success: true, message: "Documents rejected", rejectionReason: doc.rejectionReason });
    } catch (err) {
        console.error("[DOCS] reject error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

module.exports = router;
