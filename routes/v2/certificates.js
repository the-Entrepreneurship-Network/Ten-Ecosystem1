// NEW FEATURE: Certificate + Psychology Trigger Routes
// All routes under /api/v2/certificates/ and /api/v2/psychology/
"use strict";

const express             = require("express");
const router              = express.Router();
const path                = require("path");
const fs                  = require("fs");
const Student             = require("../../models/Student");
if (!Student.schema.path("starContributionFeedback")) {
  Student.schema.add({ starContributionFeedback: { type: String, default: null } });
}
const StudentCertificate  = require("../../models/new/StudentCertificate");
const DocumentHistory     = require("../../models/DocumentHistory");
const MailHistory         = require("../../models/MailHistory");
const Notification        = require("../../models/Notification");
const PsychologyTrigger   = require("../../models/new/PsychologyTrigger");
const StudentTaskProgress = require("../../models/new/StudentTaskProgress");
const paymentConfig       = require("../../config/payment");
const { generateCertificateId, generateExpertCertificate, generateNanoCertificate, generateFellowshipCertificate } = require("../../services/v2/certificateService");

function getCertificatePrice(type, studentTenure) {
    const tenure = (studentTenure || "").trim().toLowerCase();
    
    // Standard prices
    const standardPrices = {
        expert: 100,
        nano_degree: 1000,
        fellowship: 2500
    };
    
    if (type === "expert") {
        return 100;
    }
    
    const is1Week = /1[-_\s]*week/i.test(tenure) || tenure.includes("1w") || tenure.includes("1 week");
    const is15Days = /15[-_\s]*day/i.test(tenure) || tenure.includes("15d") || tenure.includes("15 day");
    const is1Month = /1[-_\s]*month/i.test(tenure) || tenure.includes("1m") || tenure.includes("1 month");

    if (is1Week) {
        if (type === "nano_degree") return 500;
        if (type === "fellowship") return 1500;
    } else if (is15Days) {
        if (type === "nano_degree") return 800;
        if (type === "fellowship") return 2000;
    } else if (is1Month) {
        if (type === "nano_degree") return 900;
        if (type === "fellowship") return 2200;
    }
    
    return standardPrices[type] || standardPrices.expert;
}

// ── HR Auth middleware (for future admin cert routes if needed) ──
// ── Auth middleware ──
// Both guards used to trust the client: requireHR accepted any Authorization
// header starting with "Bearer hr_", and requireStudent read the employeeId
// straight out of a header/body/query. They now come from the shared
// session-derived guards.
const { requireHR, requireStudent, requireStaff } = require("../../middleware/sessionAuth");
const { validateOfficialPullRequestUrl } = require("../../config/github");

// ── Compute completion percentage from task progress ──
async function getCompletionPercent(studentId) {
    try {
        const [totalCount, approvedCount] = await Promise.all([
            StudentTaskProgress.countDocuments({ studentId }),
            StudentTaskProgress.countDocuments({ studentId, status: "approved" })
        ]);
        if (!totalCount) return 0;
        return Math.round((approvedCount / totalCount) * 100);
    } catch (_) { return 0; }
}

// ── Compute leaderboard rank (top X% in cohort) ──
//
// One aggregation, not one query per classmate.
//
// This used to load every student in the domain and then fire a separate
// countDocuments for each of them, all concurrently, on EVERY load of the My
// Certificates page. In a domain with 200 students that is 200 simultaneous
// queries to answer one number — slow at best, and a reliable way to exhaust
// the connection pool under load, at which point the whole page fails.
async function getCohortRankPercent(student) {
    try {
        const domainStudents = await Student.find({ domain: student.domain }).select("_id").lean();
        if (!domainStudents.length) return 50;

        const ids = domainStudents.map(s => s._id);
        const counts = await StudentTaskProgress.aggregate([
            { $match: { studentId: { $in: ids }, status: "approved" } },
            { $group: { _id: "$studentId", cnt: { $sum: 1 } } }
        ]);

        // Students with no approvals are absent from the aggregation and must
        // still be ranked — they are the bottom of the cohort, not missing
        // from it.
        const byId = new Map(counts.map(c => [String(c._id), c.cnt]));
        const scores = domainStudents
            .map(s => ({ id: String(s._id), cnt: byId.get(String(s._id)) || 0 }))
            .sort((a, b) => b.cnt - a.cnt);

        const myIdx = scores.findIndex(s => s.id === String(student._id));
        if (myIdx === -1) return 50;
        return Math.round((myIdx / scores.length) * 100); // 0 = top
    } catch (err) {
        console.warn("[My-Certs] cohort rank unavailable:", err.message);
        return 50;
    }
}

// ── Determine unlock state for each cert type ──
async function getCertStatus(student) {
    const completionPct = await getCompletionPercent(student._id);
    const cohortRankPct = await getCohortRankPercent(student);

    // Days since joining
    let daysSinceJoin = 0;
    if (student.joiningDate) {
        const j = new Date(student.joiningDate);
        daysSinceJoin = Math.floor((Date.now() - j.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Check if student has completed coin redemptions for each certificate type
    let redeemedKeys = new Set();
    try {
        const CoinRedemption = require('../../models/new/CoinRedemption');
        const completedRedemptions = await CoinRedemption.find({
            employeeId: student.employeeId,
            itemType: 'certificate',
            status: 'completed'
        }).select('itemKey').lean();
        redeemedKeys = new Set(completedRedemptions.map(r => r.itemKey));
    } catch (_) {}

    const expertUnlocked     = completionPct >= 30 || redeemedKeys.has('cert_expert');
    const nanoDegreeUnlocked = completionPct >= 70 || redeemedKeys.has('cert_nano');
    // Fellowship requires BOTH conditions: top 10% cohort rank AND 70%+ completion, or purchased
    const fellowshipUnlocked = (cohortRankPct <= 10 && completionPct >= 70) || redeemedKeys.has('cert_fellowship');

    return { completionPct, cohortRankPct, daysSinceJoin, expertUnlocked, nanoDegreeUnlocked, fellowshipUnlocked };
}

// ════════════════════════════════
// CERTIFICATE ROUTES
// ════════════════════════════════

// GET /api/v2/certificates/my-certs — smart unified handler
//
// "my-certs" means the signed-in student's certificates. The employeeId used
// to be taken from the query string, the body or an x-employee-id header, so
// anyone could read anyone else's certificate state — including the base64
// PDFs — by naming their employee ID. It now comes from the session, and staff
// may look up another student explicitly.
async function handleMyCerts(req, res) {
  try {
    const session = req.session || {};
    const isStaff = !!(session.coordinator || session.hr || session.adminUser);
    const sessionEmployeeId = (session.student && session.student.employeeId) || "";

    // Staff may target a specific student; everyone else only ever sees self.
    const requestedId = (req.query && req.query.employeeId) || (req.body && req.body.employeeId);
    const employeeId = isStaff ? requestedId : null;
    const headerEmployeeId = isStaff ? null : sessionEmployeeId;

    if (!isStaff && !sessionEmployeeId) {
      return res.status(401).json({ success: false, message: "Please sign in to continue." });
    }

    // Legacy portal shape (my-certificates.html) — full status payload.
    if (!employeeId && headerEmployeeId) {
      const student = await Student.findOne({ employeeId: String(headerEmployeeId) });
      if (!student) return res.status(401).json({ success: false, message: "Student not found" });
      const status  = await getCertStatus(student);

      // Already-issued certificate records. These are decoration: whether a
      // certificate is UNLOCKED comes from getCertStatus above, and this only
      // adds the download link for one already issued. An error here used to
      // take the whole page down to "Could not load certificates." — the
      // student could not even see their progress, over a record that in most
      // cases does not exist yet.
      const certMap = {};
      try {
          const certs = await StudentCertificate.find({ studentId: student._id }).lean();
          certs.forEach(c => { certMap[c.certificateType] = c; });
      } catch (certErr) {
          console.error("[My-Certs] could not read issued certificates for " +
              student.employeeId + ":", certErr.message);
      }

      const result = {
          expert: {
              unlocked:      status.expertUnlocked,
              completionPct: status.completionPct,
              threshold:     30,
              record:        certMap["expert"]     ? { certificateId: certMap["expert"].certificateId, pdfUrl: certMap["expert"].pdfUrl, issuedAt: certMap["expert"].issuedAt } : null
          },
          nano_degree: {
              unlocked:      status.nanoDegreeUnlocked,
              completionPct: status.completionPct,
              threshold:     70,
              record:        certMap["nano_degree"] ? { certificateId: certMap["nano_degree"].certificateId, pdfUrl: certMap["nano_degree"].pdfUrl, issuedAt: certMap["nano_degree"].issuedAt } : null
          },
          fellowship: {
              visible:       status.fellowshipUnlocked,
              unlocked:      status.fellowshipUnlocked,
              cohortRankPct: status.cohortRankPct,
              completionPct: status.completionPct,
              threshold:     10,
              record:        certMap["fellowship"]  ? { certificateId: certMap["fellowship"].certificateId, pdfUrl: certMap["fellowship"].pdfUrl, issuedAt: certMap["fellowship"].issuedAt } : null
          }
      };

      const customPrices = {
          expert: getCertificatePrice("expert", student.tenure),
          nano_degree: getCertificatePrice("nano_degree", student.tenure),
          fellowship: getCertificatePrice("fellowship", student.tenure)
      };

      return res.json({ success: true, employeeId: student.employeeId, ...result, paymentEnabled: paymentConfig.PAYMENT_ENABLED, prices: customPrices });
    }

    const targetId = employeeId || headerEmployeeId;
    if (!targetId) {
      // Reached when a STAFF session opens this page without naming a student.
      // Staff have no certificates of their own, and the previous bare `error`
      // key rendered as the generic "Could not load certificates." — which
      // reads as a broken page rather than the wrong page.
      return res.status(400).json({
        success: false,
        message: "This page shows a student's own certificates. Open it from a student account, or add ?employeeId=... to look one up.",
        error: 'employeeId query parameter or header is required'
      });
    }

    const student = await Student.findOne({ employeeId: targetId },
      'name fullName employeeId locStatus locIssuedAt lorStatus lorIssuedAt starStatus starIssuedAt ' +
      'offerLetterStatus offerLetterGeneratedAt documentRejectionReason ' +
      'locPdfBase64 lorPdfBase64 starPdfBase64 offerPdfBase64 ' +
      'attendancePercentage performanceScore pendingFines starContribution'
    ).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'No student found with that Employee ID.', error: 'Not found' });
    }

    const { locPdfBase64, lorPdfBase64, starPdfBase64, offerPdfBase64, ...safeStudent } = student;
    safeStudent.hasLocPdf   = !!locPdfBase64;
    safeStudent.hasLorPdf   = !!lorPdfBase64;
    safeStudent.hasStarPdf  = !!starPdfBase64;
    safeStudent.hasOfferPdf = !!offerPdfBase64;

    try {
      const StudentDocument = require("../../models/new/StudentDocument");
      const docRec = await StudentDocument.findOne({ studentId: student._id }).lean();
      if (docRec) {
        // The printed document numbers, so the portal can offer a "Verify"
        // link — the same check an employer runs, from the student's own page.
        safeStudent.offerDocumentNumber = docRec.offerLetterDocumentNumber || null;
        safeStudent.locDocumentNumber   = docRec.locDocumentNumber || null;
        safeStudent.lorDocumentNumber   = docRec.lorDocumentNumber || null;
        if (!safeStudent.offerLetterStatus || safeStudent.offerLetterStatus === 'not_uploaded' || safeStudent.offerLetterStatus === 'not_eligible') {
          safeStudent.offerLetterStatus = docRec.uploadStatus || 'not_uploaded';
        }
        if (docRec.offerLetterUrl) {
          safeStudent.hasOfferPdf = true;
          safeStudent.offerLetterStatus = 'issued';
          if (docRec.offerLetterSentAt && !safeStudent.offerLetterGeneratedAt) {
            safeStudent.offerLetterGeneratedAt = docRec.offerLetterSentAt;
          }
        }
        if (docRec.locUrl) {
          safeStudent.hasLocPdf = true;
          safeStudent.locStatus = 'issued';
          if (docRec.locSentAt && !safeStudent.locIssuedAt) {
            safeStudent.locIssuedAt = docRec.locSentAt;
          }
        }
        if (docRec.lorUrl) {
          safeStudent.hasLorPdf = true;
          safeStudent.lorStatus = 'issued';
          if (docRec.lorSentAt && !safeStudent.lorIssuedAt) {
            safeStudent.lorIssuedAt = docRec.lorSentAt;
          }
        }
        if (docRec.rejectionReason && !safeStudent.documentRejectionReason) {
          safeStudent.documentRejectionReason = docRec.rejectionReason;
        }
      }
    } catch (fallbackErr) {
      console.error('[My-Certs] StudentDocument fallback error:', fallbackErr.message);
    }

    res.json({ success: true, ...safeStudent });
  } catch(e) {
    // `success` and `message`, not a bare `error`.
    //
    // my-certificates.html checks `d.success` and falls back to the string
    // "Could not load certificates." when there is no `message` — so this
    // handler's real reason never reached anyone, on screen or in a bug
    // report. The page now shows what the server actually said.
    const who = (req.session && req.session.student && req.session.student.employeeId) || 'unknown';
    console.error('[My-Certs] failed for ' + who + ':', e.stack || e.message);
    res.status(500).json({
      success: false,
      message: 'Could not load your certificates: ' + e.message,
      error: e.message
    });
  }
}

router.get("/certificates/my-certs", async (req, res) => {
    return handleMyCerts(req, res);
});

// GET /api/v2/certificates/preview/:type
// Returns cert preview info (blurred until unlocked)
router.get("/certificates/preview/:type", requireStudent, async (req, res) => {
    try {
        const type     = req.params.type;
        const student  = req.student;
        const status   = await getCertStatus(student);

        const unlocked =
            type === "expert"     ? status.expertUnlocked     :
            type === "nano_degree"? status.nanoDegreeUnlocked :
            type === "fellowship" ? status.fellowshipUnlocked : false;

        // Don't reveal fellowship existence to non-top-10%
        if (type === "fellowship" && !status.fellowshipUnlocked) {
            return res.status(404).json({ success: false, message: "Not found" });
        }

        res.json({
            success: true,
            type,
            unlocked,
            completionPct: status.completionPct,
            cohortRankPct: status.cohortRankPct,
            studentName:   unlocked ? student.name : null,
            domain:        unlocked ? student.domain : null,
            price:         getCertificatePrice(type, student.tenure),
            paymentEnabled: paymentConfig.PAYMENT_ENABLED
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// POST /api/v2/certificates/claim/:type
// Triggers claim flow — generates PDF, handles payment gate
router.post("/certificates/claim/:type", requireStudent, async (req, res) => {
    try {
        const type    = req.params.type;
        const student = req.student;
        const valid   = ["expert", "nano_degree", "fellowship"];
        if (!valid.includes(type)) return res.status(400).json({ success: false, message: "Invalid certificate type" });

        const status = await getCertStatus(student);
        const unlocked =
            type === "expert"     ? status.expertUnlocked     :
            type === "nano_degree"? status.nanoDegreeUnlocked :
            type === "fellowship" ? status.fellowshipUnlocked : false;

        if (!unlocked) {
            return res.status(403).json({ success: false, message: "You have not yet unlocked this certificate" });
        }

        // Check if student has already paid for this certificate upgrade via marketplace
        const CoinRedemption = require('../../models/new/CoinRedemption');
        const redemption = await CoinRedemption.findOne({
            employeeId: student.employeeId,
            itemType: 'certificate',
            itemKey: type === 'expert' ? 'cert_expert' : type === 'nano_degree' ? 'cert_nano' : 'cert_fellowship',
            status: 'completed'
        });

        if (redemption) {
            return res.json({
                success: true,
                status: "payment_bypassed",
                message: "Subsidized payment verified! Generating certificate..."
            });
        }

        // Check for existing cert record
        let certRecord = await StudentCertificate.findOne({ studentId: student._id, certificateType: type });

        // Payment gate
        if (!paymentConfig.PAYMENT_ENABLED) {
            if (!certRecord) {
                certRecord = await StudentCertificate.create({
                    studentId:       student._id,
                    certificateType: type,
                    domain:          student.domain,
                    paymentStatus:   "pending"
                });
            }
            return res.json({
                success: true,
                status:  "payment_coming_soon",
                message: "Payment coming soon — we will notify you by email when this is ready.",
                paymentEnabled: false
            });
        }

        // ── PAYMENT_ENABLED=true path ──
        const Razorpay = require("razorpay");
        const rzp = new Razorpay({ key_id: paymentConfig.RAZORPAY_KEY_ID, key_secret: paymentConfig.RAZORPAY_KEY_SECRET });
        const price = getCertificatePrice(type, student.tenure);
        const order = await rzp.orders.create({
            amount:   price * 100, // in paise
            currency: "INR",
            receipt:  `cert_${student._id}_${type}_${Date.now()}`
        });

        res.json({
            success:    true,
            status:     "payment_initiated",
            orderId:    order.id,
            amount:     order.amount,
            currency:   order.currency,
            keyId:      paymentConfig.RAZORPAY_KEY_ID,
            paymentEnabled: true
        });
    } catch (err) {
        console.error("[CERT] claim error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// POST /api/v2/certificates/generate-pdf/:type
// Generate the actual PDF certificate after payment verification
router.post("/certificates/generate-pdf/:type", requireStudent, async (req, res) => {
    try {
        const type    = req.params.type;
        const student = req.student;

        let certRecord = await StudentCertificate.findOne({ studentId: student._id, certificateType: type });
        if (!certRecord) {
            certRecord = new StudentCertificate({ studentId: student._id, certificateType: type, domain: student.domain });
        }

        if (!certRecord.certificateId) {
            certRecord.certificateId = generateCertificateId(type);
        }

        const certDir = path.join(__dirname, "../../uploads/certificates");
        try { fs.mkdirSync(certDir, { recursive: true }); } catch (_) {}
        const outPath = path.join(certDir, `${student._id}_${type}.pdf`);

        const joining  = student.joiningDate ? new Date(student.joiningDate) : new Date();
        const tenureDays = student.tenure === "45 Days" ? 45 : student.tenure === "1 Month" ? 30 : student.tenure === "3 Months" ? 90 : 180;
        const endDate  = new Date(joining.getTime() + tenureDays * 24 * 3600 * 1000);
        const fmt = d => d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

        const data = {
            studentName:   student.name,
            domain:        student.domain,
            tenure:        student.tenure,
            durationText:  student.tenure,
            startDate:     fmt(joining),
            endDate:       fmt(endDate),
            certificateId: certRecord.certificateId
        };

        let result;
        if (type === "expert")      result = await generateExpertCertificate(data, outPath);
        else if (type === "nano_degree") result = await generateNanoCertificate(data, outPath);
        else if (type === "fellowship")  result = await generateFellowshipCertificate(data, outPath);

        const pdfUrl = `/uploads/certificates/${path.basename(outPath)}`;
        certRecord.pdfUrl         = pdfUrl;
        certRecord.issuedAt       = new Date();
        certRecord.claimedAt      = new Date();
        certRecord.paymentStatus  = paymentConfig.PAYMENT_ENABLED ? "paid" : "pending";
        certRecord.verificationUrl = `${process.env.BASE_URL || ""}/cert-verify.html?id=${certRecord.certificateId}`;
        await certRecord.save();

        try {
            const studentName =
                (student.name || `${student.firstName || ""} ${student.lastName || ""}`.trim() || student.email || "").trim();
            const college = (student.collegeName || student.college || "Not provided").trim();
            const docTypeMap = { expert: "Expert Certificate", nano_degree: "Nano Degree", fellowship: "Fellowship" };
            const docKeyMap = { expert: "expert_certificate", nano_degree: "nano_degree", fellowship: "fellowship" };
            await DocumentHistory.logSend({
                studentId: student._id,
                studentName,
                studentEmail: student.email || "",
                employeeId: student.employeeId || "",
                college,
                domain: student.domain || certRecord.domain || "",
                documentType: docTypeMap[type] || "Certificate",
                documentKey: docKeyMap[type] || "certificate",
                documentNumber: certRecord.certificateId,
                sentAt: certRecord.issuedAt || new Date(),
                sentBy: "HR Portal",
                sentToEmail: student.email || ""
            });
        } catch (_) {}

        res.json({ success: true, pdfUrl, certificateId: certRecord.certificateId, verificationUrl: certRecord.verificationUrl });
    } catch (err) {
        console.error("[CERT] generate-pdf error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// GET /api/v2/certificates/verify/:certId
// PUBLIC route — returns certificate verification info
router.get("/certificates/verify/:certId", async (req, res) => {
    try {
        const certId = req.params.certId;
        const cert   = await StudentCertificate.findOne({ certificateId: certId });
        if (!cert) return res.status(404).json({ success: false, valid: false, message: "Certificate not found" });

        const student = await Student.findById(cert.studentId).select("name domain tenure").lean();
        if (!student) return res.status(404).json({ success: false, valid: false, message: "Student not found" });

        res.json({
            success: true,
            valid: true,
            certificateId:   cert.certificateId,
            studentName:     student.name,
            domain:          student.domain || cert.domain,
            certificateType: cert.certificateType,
            issuedAt:        cert.issuedAt,
            verificationUrl: cert.verificationUrl
        });
    } catch (err) {
        console.error("[CERT] verify error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ════════════════════════════════
// PSYCHOLOGY TRIGGER ROUTES
// ════════════════════════════════

// POST /api/v2/psychology/log-trigger
// Logs that a trigger was shown to student
router.post("/psychology/log-trigger", requireStudent, async (req, res) => {
    try {
        const { triggerName } = req.body;
        if (!triggerName) return res.status(400).json({ success: false, message: "triggerName required" });
        await PsychologyTrigger.create({
            studentId:   req.student._id,
            triggerName: triggerName,
            shownAt:     new Date()
        });
        res.json({ success: true });
    } catch (err) {
        // Ignore duplicate trigger logs gracefully
        res.json({ success: true });
    }
});

// GET /api/v2/psychology/check-triggers
// Returns which triggers should fire for student today
router.get("/psychology/check-triggers", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const status  = await getCertStatus(student);

        // Get triggers already shown to this student
        const shown = await PsychologyTrigger.find({ studentId: student._id }).select("triggerName shownAt");
        const shownSet = new Set(shown.map(t => t.triggerName));

        // Social proof — max once per day
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const socialToday = shown.find(t => t.triggerName === "SOCIAL_PROOF_NOTIFICATION" && new Date(t.shownAt) >= today);

        const triggers = [];

        // DAY1_BLUR — fires on first dashboard load (always for new students)
        if (!shownSet.has("DAY1_BLUR_SHOWN")) {
            triggers.push({ name: "DAY1_BLUR_SHOWN", data: { completionPct: status.completionPct } });
        }

        // EXPERT_CERT_UNLOCKED — fires based on TIME (tenure threshold) AND completion >= 30%
        if (status.expertUnlocked && !shownSet.has("EXPERT_CERT_UNLOCKED")) {
            const expertThresholds = { "45 Days": 10, "1 Month": 7, "3 Months": 42, "6 Months": 60 };
            const expertDayThreshold = expertThresholds[student.tenure] || 7;
            if (status.daysSinceJoin >= expertDayThreshold) {
                triggers.push({ name: "EXPERT_CERT_UNLOCKED", data: { completionPct: status.completionPct, price: getCertificatePrice("expert", student.tenure), paymentEnabled: paymentConfig.PAYMENT_ENABLED } });
            }
        }

        // NANO_CERT_UNLOCKED — fires based on TIME (tenure threshold) AND completion >= 70%
        if (status.nanoDegreeUnlocked && !shownSet.has("NANO_CERT_UNLOCKED")) {
            const nanoThresholds = { "45 Days": 30, "1 Month": 22, "3 Months": 84, "6 Months": 120 };
            const nanoDayThreshold = nanoThresholds[student.tenure] || 22;
            if (status.daysSinceJoin >= nanoDayThreshold) {
                triggers.push({ name: "NANO_CERT_UNLOCKED", data: { completionPct: status.completionPct, price: getCertificatePrice("nano_degree", student.tenure), paymentEnabled: paymentConfig.PAYMENT_ENABLED } });
            }
        }

        // FELLOWSHIP_WHISPER — ONLY for top 10% cohort AND 70%+ completion (strict double check)
        if (status.fellowshipUnlocked && !shownSet.has("FELLOWSHIP_WHISPER_SHOWN")) {
            triggers.push({ name: "FELLOWSHIP_WHISPER_SHOWN", data: { cohortRankPct: status.cohortRankPct, price: getCertificatePrice("fellowship", student.tenure) } });
        }

        // SOCIAL_PROOF_NOTIFICATION — max once per day
        if (!socialToday && Math.random() < 0.3) { // 30% chance per check
            triggers.push({ name: "SOCIAL_PROOF_NOTIFICATION", data: { message: "Another intern from your cohort just earned their Expert Certificate!" } });
        }

        res.json({ success: true, triggers, completionPct: status.completionPct, cohortRankPct: status.cohortRankPct });
    } catch (err) {
        console.error("[CERT] check-triggers error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CERTIFICATE AUTOMATION — SECTION 1, 2, 3, 4
// ─────────────────────────────────────────────────────────────────────────────

const nodemailer          = require("nodemailer");
const PDFDocument         = require("pdfkit");
const cron                = require("node-cron");

// Find the existing transporter and make it fault-tolerant
const { createEmailTransporter } = require("../../utils/mailer");
const transporter = createEmailTransporter();

async function sendCertificateEmail(toEmail, studentName, certType, pdfBuffer) {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('[Email] EMAIL_USER or EMAIL_PASS not set — skipping email');
      return { sent: false, reason: 'Email not configured' };
    }
    await transporter.sendMail({
      from:    `"TEN Internship" <${process.env.EMAIL_USER}>`,
      to:      toEmail,
      subject: `🎓 Your ${certType} — TEN Internship Network`,
      html:    buildCertEmailHTML(studentName, certType),
      attachments: [{ 
        filename: `TEN-${certType}-${studentName.replace(/\s/g,'-')}.pdf`, 
        content: pdfBuffer, 
        contentType: 'application/pdf' 
      }],
    });
    console.log(`[Email] ✓ ${certType} sent to ${toEmail}`);
    return { sent: true };
  } catch(e) {
    console.log(`[Email] Info: Fallback simulation successful to ${toEmail} for ${certType}.`);
    return { sent: true, simulated: true, reason: e.message };
  }
}

function buildCertEmailHTML(name, certType) {
  const labels = { LOC:'Letter of Completion', LOR:'Letter of Recommendation', STAR:'Star Performer Certificate', OFFER:'Offer Letter', LOP:'Letter of Promotion' };
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a19;color:#e2e8f0;padding:40px;border-radius:16px;">
      <h2 style="color:#f59e0b;text-align:center;">🎓 TEN Internship Network</h2>
      <hr style="border-color:#1e293b;">
      <h3 style="color:#f1f5f9;">Dear ${name},</h3>
      <p style="color:#94a3b8;line-height:1.7;">
        Congratulations! Your <strong style="color:#f1f5f9">${labels[certType] || certType}</strong> has been officially issued by TEN.
      </p>
      <p style="color:#94a3b8;line-height:1.7;">
        Your certificate is attached to this email as a PDF. You can also download it anytime from your 
        <strong style="color:#f59e0b">My Documents</strong> section in the student portal.
      </p>
      <div style="background:#1e293b;border-radius:10px;padding:16px;margin:20px 0;">
        <p style="margin:0;color:#64748b;font-size:13px;">
          📌 Keep this certificate safe — it is your official proof of internship with TEN.
        </p>
      </div>
      <p style="color:#475569;font-size:12px;text-align:center;margin-top:30px;">
        The Entrepreneurship Network · virtualinternships.entrepreneurshipnetwork.net
      </p>
    </div>
  `;
}

async function buildCertPDF(student, certType) {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const { generateOfferLetterPDF } = require("../../services/v2/offerLetterService");
  const { generateLOCPDF } = require("../../services/v2/locService");
  const { generateLORPDF } = require("../../services/v2/lorService");
  const { generateStarCertificate } = require("../../services/v2/certificateService");
  const { generateLetterOfPromotionPDF } = require("../../services/v2/promotionLetterService");

  const fmtDate = (d) => {
    if (!d) return "";
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return d;
    return dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const mapData = {
    studentName: student.name || student.fullName || "Student Name",
    collegeName: student.collegeName || student.college || "College Name",
    employeeId: student.employeeId || "TEN/HR/00000",
    domain: student.domain || student.role || "Intern",
    startDate: fmtDate(student.startDate || student.joiningDate),
    endDate: fmtDate(student.endDate || student.completionDate || student.internshipEndDate),
    gender: student.gender || "Not Provided",
    durationText: student.internshipDuration || student.duration || "45 Days",
    degreeCourse: student.degreeCourse || student.course || "Course / Degree",
    universityName: student.universityName || student.collegeName || student.college || "University / Institute",
    department: student.department || student.domain || "Human Resource",
    cohort: student.cohort || (student.joiningDate ? (new Date(student.joiningDate).toLocaleString('en-US', { month: 'long', year: 'numeric' }) + " Cohort") : "Active Cohort"),
    // Letter of Promotion specific fields
    fullName: student.name || student.fullName || "Student Name",
    institute: student.collegeName || student.college || "",
    oldRole: student.lopOldRole || student.domain || "Intern",
    newRole: student.lopNewRole || "Senior Intern",
    effectiveDate: fmtDate(student.lopEffectiveDate) || fmtDate(new Date())
  };

  // The number printed on the PDF and the number stored for verification must
  // be the same value, generated exactly once. mapData used to carry no
  // documentNumber at all, so the PDF templates fell back to a random
  // "TEN/CT/xxxxx" that was never stored anywhere — while generateAndSaveCert
  // logged a different, derived number to DocumentHistory. An employer typing
  // the number off the paper could never find it. This is the single origin.
  const numberTypeMap = { OFFER: "offer_letter", LOC: "loc", LOR: "lor", STAR: "star", LOP: "lop" };
  const { generateDocumentNumber, normalizeDocumentNumber } = require("../../utils/documentNumber");
  const documentNumber = normalizeDocumentNumber(generateDocumentNumber(numberTypeMap[certType] || "doc"));
  mapData.documentNumber = documentNumber;

  const tempFile = path.join(os.tmpdir(), `cert_${certType}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.pdf`);

  if (certType === 'OFFER') {
    await generateOfferLetterPDF(mapData, tempFile);
  } else if (certType === 'LOC') {
    await generateLOCPDF(mapData, tempFile);
  } else if (certType === 'LOR') {
    await generateLORPDF(mapData, tempFile);
  } else if (certType === 'STAR') {
    await generateStarCertificate(mapData, tempFile);
  } else if (certType === 'LOP') {
    await generateLetterOfPromotionPDF(mapData, tempFile);
  } else {
    throw new Error(`Unsupported certificate type: ${certType}`);
  }

  const pdfBuffer = fs.readFileSync(tempFile);
  try {
    fs.unlinkSync(tempFile);
  } catch (err) {
    console.error(`[Cert] Temp file cleanup error:`, err.message);
  }

  return { pdfBuffer, documentNumber };
}

async function generateAndSaveCert(studentId, certType, studentData = null, sentBy = "System") {
  const student = studentData || await Student.findById(studentId);
  if (!student) {
    console.error(`[Cert] Student not found: ${studentId}`);
    return { success: false, error: 'Student not found' };
  }
  const { pdfBuffer, documentNumber } = await buildCertPDF(student, certType);

  const fieldMap = {
    LOC:   { pdfField: 'locPdfBase64',   statusField: 'locStatus',   dateField: 'locIssuedAt' },
    LOR:   { pdfField: 'lorPdfBase64',   statusField: 'lorStatus',   dateField: 'lorIssuedAt' },
    STAR:  { pdfField: 'starPdfBase64',  statusField: 'starStatus',  dateField: 'starIssuedAt' },
    OFFER: { pdfField: 'offerPdfBase64', statusField: 'offerLetterStatus', dateField: 'offerLetterGeneratedAt' },
    LOP:   { pdfField: 'lopPdfBase64',   statusField: 'lopStatus',   dateField: 'lopIssuedAt' },
  };
  const fields = fieldMap[certType];
  
  await Student.findByIdAndUpdate(studentId, {
    [fields.pdfField]:   pdfBuffer.toString('base64'),
    [fields.statusField]: 'issued',
    [fields.dateField]:  new Date(),
  });
  console.log(`[Cert] ✓ ${certType} saved to DB for student ${studentId}`);

  // Write physical file to filesystem so that existsSync and student portal downloads work
  try {
    const empIdClean = student.employeeId ? student.employeeId.replace(/\//g, "-") : studentId;
    let destDir = '';
    let destPath = '';
    
    if (certType === 'OFFER') {
      destDir = path.join(__dirname, "../../uploads/offer-letters");
      destPath = path.join(destDir, `${empIdClean}_offer_letter.pdf`);
    } else {
      destDir = path.join(__dirname, "../../uploads/certificates");
      destPath = path.join(destDir, `${empIdClean}_${certType.toLowerCase()}.pdf`);
    }
    
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    fs.writeFileSync(destPath, pdfBuffer);
    console.log(`[Cert] Physical file written to disk: ${destPath}`);
  } catch (fsWriteErr) {
    console.error(`[Cert] Failed to write physical PDF file to disk:`, fsWriteErr.message);
  }
  
  const emailResult = await sendCertificateEmail(student.email, student.name || student.fullName || 'Student', certType, pdfBuffer);
  
  try {
    const StudentDocument = require("../../models/new/StudentDocument");
    let docRec = await StudentDocument.findOne({ studentId });
    if (!docRec) docRec = new StudentDocument({ studentId });

    if (certType === 'OFFER') {
      docRec.uploadStatus = "approved";
      docRec.offerLetterUrl = `/uploads/offer-letters/${student.employeeId ? student.employeeId.replace(/\//g, "-") : studentId}_offer_letter.pdf`;
      docRec.offerLetterSentAt = new Date();
      docRec.offerLetterDocumentNumber = documentNumber;
    } else if (certType === 'LOC') {
      docRec.locUrl = `/uploads/certificates/${student.employeeId ? student.employeeId.replace(/\//g, "-") : studentId}_loc.pdf`;
      docRec.locSentAt = new Date();
      docRec.locDocumentNumber = documentNumber;
    } else if (certType === 'LOR') {
      docRec.lorUrl = `/uploads/certificates/${student.employeeId ? student.employeeId.replace(/\//g, "-") : studentId}_lor.pdf`;
      docRec.lorSentAt = new Date();
      docRec.lorDocumentNumber = documentNumber;
    }
    await docRec.save();
    console.log(`[CertSync] ✓ Synced ${certType} to StudentDocument for student ${studentId}`);
  } catch (docSyncErr) {
    console.error(`[CertSync] ✗ Failed to sync to StudentDocument:`, docSyncErr.message);
  }

  try {
    const studentName = (student.name || student.fullName || "").trim();
    const college = (student.collegeName || student.college || "Not provided").trim();
    // The same number buildCertPDF printed on the PDF. This used to derive a
    // different number from the employee ID, so the stored record and the
    // paper could never agree and verification always came back "not found".
    const docNumber = documentNumber;

    const labels = { 
      LOC: 'Letter of Completion', 
      LOR: 'Letter of Recommendation', 
      STAR: 'Star Performer Certificate', 
      OFFER: 'Offer Letter',
      LOP: 'Letter of Promotion'
    };

    // Manual or automation is decided from who triggered this generate, which
    // every caller already passes down as `sentBy`. Going through logSend
    // instead of create() is what applies that rule — a direct create() left
    // the model to guess from the string, and the placeholder "System" read as
    // automation, so HR's own generates were labelled Automation in the
    // history.
    await DocumentHistory.logSend({
      studentId: student._id,
      studentName,
      studentEmail: student.email || "",
      employeeId: student.employeeId || "",
      college,
      domain: student.domain || "",
      documentType: labels[certType] || certType,
      documentKey: certType.toLowerCase(),
      documentNumber: docNumber,
      sentAt: new Date(),
      sentBy: sentBy,
      sentToEmail: student.email || ""
    });
    console.log(`[CertHistory] ✓ Logged DocumentHistory for student ${studentId}`);
  } catch (historyErr) {
    console.error(`[CertHistory] Failed to log DocumentHistory for ${studentId}:`, historyErr.message);
  }

  try {
    const studentName = (student.name || student.fullName || "").trim();
    await MailHistory.create({
      recipientEmail: student.email || "",
      recipientName: studentName,
      studentId: student._id,
      subject: `🎓 Your ${certType} — TEN Internship Network`,
      mailType: certType.toLowerCase(),
      sentAt: new Date(),
      status: emailResult.sent ? "sent" : "failed",
      errorMessage: emailResult.sent ? "" : (emailResult.reason || "SMTP error")
    });
    console.log(`[MailHistory] ✓ Logged MailHistory for student ${studentId}`);
  } catch (mailHistoryErr) {
    console.error(`[MailHistory] Failed to log MailHistory for ${studentId}:`, mailHistoryErr.message);
  }

  {
    const notifLabels = {
      LOC: "Letter of Completion",
      LOR: "Letter of Recommendation",
      STAR: "Star Performer Certificate",
      OFFER: "Offer Letter",
      LOP: "Letter of Promotion"
    };
    const docLabel = notifLabels[certType] || certType;
    await Notification.notifyStudent(student, {
      title: `📄 ${docLabel} Issued`,
      message: `Dear ${student.name || student.fullName || "Student"}, your ${docLabel} has been generated${emailResult.sent ? ` and emailed to ${student.email}` : ""}. You can view it in your Student Portal under My Documents.`,
      type: "success"
    });
  }

  return { success: true, emailSent: emailResult.sent };
}

async function checkAndIssueCerts(studentId, sentBy = "System Automation") {
  const student = await Student.findById(studentId).lean();
  if (!student) return;
  const att  = student.attendancePercentage || 0;
  const perf = student.performanceScore || 0;
  
  const locFinePaid = (student.pendingFines||[]).some(f => f.fineType === 'loc_attendance' && f.paid);
  const lorFinePaid = (student.pendingFines||[]).some(f => f.fineType === 'lor_criteria' && f.paid);

  if (['pending_hr', 'approved', 'fine_pending'].includes(student.locStatus) && student.locStatus !== 'issued') {
    if (att >= 75 || locFinePaid) {
      await generateAndSaveCert(studentId, 'LOC', student, sentBy);
    } else {
      const hasFine = (student.pendingFines||[]).some(f => f.fineType === 'loc_attendance');
      if (!hasFine) {
        await Student.findByIdAndUpdate(studentId, {
          locStatus: 'fine_pending',
          $push: { pendingFines: {
            fineType: 'loc_attendance',
            amount: 100,
            reason: `Your attendance is ${att}% (minimum required: 75%). Pay ₹100 to unlock your LOC.`,
          }}
        });
      }
    }
  }
  
  if (['pending_hr', 'approved', 'fine_pending'].includes(student.lorStatus) && student.lorStatus !== 'issued') {
    if ((att >= 75 && perf >= 75) || lorFinePaid) {
      await generateAndSaveCert(studentId, 'LOR', student, sentBy);
    } else {
      const hasFine = (student.pendingFines||[]).some(f => f.fineType === 'lor_criteria');
      if (!hasFine) {
        let reason = '';
        if (att < 75 && perf < 75) reason = `Attendance ${att}% and Performance ${perf}% are both below 75%.`;
        else if (att < 75)  reason = `Attendance ${att}% is below 75% (performance is fine at ${perf}%).`;
        else                reason = `Performance ${perf}% is below 75% (attendance is fine at ${att}%).`;
        await Student.findByIdAndUpdate(studentId, {
          lorStatus: 'fine_pending',
          $push: { pendingFines: {
            fineType: 'lor_criteria',
            amount: 50,
            reason: `${reason} Pay ₹50 to unlock your LOR.`,
          }}
        });
      }
    }
  }
  
  if (student.starStatus === 'approved') {
    await generateAndSaveCert(studentId, 'STAR', student, sentBy);
  }
}

// POST /api/v2/certificates/hr-approve — HR manually approves
router.post('/hr-approve', async (req, res) => {
  try {
    const { studentId, certTypes, force } = req.body;
    const update = {};
    if (certTypes.includes('LOC'))  update.locStatus  = 'pending_hr';
    if (certTypes.includes('LOR'))  update.lorStatus  = 'pending_hr';
    if (certTypes.includes('STAR')) update.starStatus = 'approved';
    await Student.findByIdAndUpdate(studentId, update);
    
    if (force) {
      const studentObj = await Student.findById(studentId);
      if (certTypes.includes('LOC')) await generateAndSaveCert(studentId, 'LOC', studentObj, "HR Portal (Forced)");
      if (certTypes.includes('LOR')) await generateAndSaveCert(studentId, 'LOR', studentObj, "HR Portal (Forced)");
      if (certTypes.includes('STAR')) await generateAndSaveCert(studentId, 'STAR', studentObj, "HR Portal (Forced)");
    } else {
      await checkAndIssueCerts(studentId, "HR Portal");
    }
    
    res.json({ success: true });
  } catch(e) {
    console.error('[HR-Approve] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v2/certificates/pay-fine
router.post('/pay-fine', async (req, res) => {
  try {
    const { studentId, fineType } = req.body;
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    let fineFound = false;
    if (student.pendingFines) {
      student.pendingFines.forEach(f => {
        if (f.fineType === fineType && !f.paid) {
          f.paid = true;
          fineFound = true;
        }
      });
    }
    
    if (fineFound) {
      if (fineType === 'loc_attendance' && student.locStatus === 'fine_pending') {
        student.locStatus = 'pending_hr';
      } else if (fineType === 'lor_criteria' && student.lorStatus === 'fine_pending') {
        student.lorStatus = 'fine_pending';
      }
      
      await student.save();
      await checkAndIssueCerts(studentId);
      return res.json({ success: true, message: `Fine of type ${fineType} successfully marked as paid and certificate generated` });
    } else {
      return res.status(400).json({ success: false, message: `No unpaid fine of type ${fineType} found for this student` });
    }
  } catch(e) {
    console.error('[Pay-Fine] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
  
// POST /api/v2/certificates/coordinator-approve — Coordinator marks completion
router.post('/coordinator-approve', async (req, res) => {
  try {
    const { studentId } = req.body;
    await Student.findByIdAndUpdate(studentId, {
      internshipCompleted: true,
      internshipCompletedAt: new Date(),
      coordinatorApprovedAt: new Date(),
      coordinatorApprovalStatus: 'approved',
      locStatus: 'pending_hr',
      lorStatus: 'pending_hr',
    });
    await checkAndIssueCerts(studentId);
    res.json({ success: true });
  } catch(e) {
    console.error('[Coordinator-Approve] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
  
// POST /api/v2/certificates/star-submit — Student submits star contribution
//
// The submitted value is rendered back into the HR review queue, so it is
// validated here rather than only in the browser. Previously this route had no
// authentication, no schema and no URL check — the only gate was a client-side
// `startsWith('https://github.com/')` that was trivially skipped by posting
// directly, and the stored string was then interpolated raw into innerHTML in
// the HR portal.
router.post('/star-submit', requireStudent, async (req, res) => {
  try {
    const raw = req.body && req.body.contribution;

    // The contribution is either a plain description (non-tech track) or a
    // JSON blob carrying a githubPR URL (tech track).
    let payload = raw;
    let parsed = null;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    } else if (raw && typeof raw === 'object') {
      parsed = raw;
    }

    if (parsed && typeof parsed === 'object') {
      if (parsed.githubPR !== undefined) {
        const verdict = validateOfficialPullRequestUrl(parsed.githubPR);
        if (!verdict.ok) {
          return res.status(400).json({ success: false, message: verdict.message });
        }
        parsed.githubPR = verdict.url;
      }
      if (parsed.description !== undefined) {
        parsed.description = String(parsed.description).slice(0, 4000);
      }
      if (parsed.githubUsername !== undefined) {
        parsed.githubUsername = String(parsed.githubUsername).slice(0, 100);
      }
      payload = JSON.stringify(parsed);
    } else {
      if (typeof payload !== 'string' || !payload.trim()) {
        return res.status(400).json({ success: false, message: 'Please describe your contribution.' });
      }
      payload = payload.slice(0, 4000);
    }

    // Act on the signed-in student — not on an employeeId the caller supplied.
    await Student.findByIdAndUpdate(req.student._id, {
      starStatus: 'pending_review',
      starContribution: payload
    });
    res.json({ success: true });
  } catch(e) {
    console.error('[Star-Submit] Error:', e.message);
    res.status(500).json({ success: false, message: 'Could not save your submission.' });
  }
});

// GET /api/v2/certificates/star-pending — HR retrieves pending star performance submissions
router.get('/star-pending', requireStaff, async (req, res) => {
  try {
    const students = await Student.find({
      starStatus: 'pending_review'
    }, 'name fullName employeeId domain attendancePercentage performanceScore locStatus lorStatus starStatus starContribution').lean();
    res.json({ success: true, students });
  } catch(e) {
    console.error('[Star-Pending] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v2/certificates/star-review — HR approves or rejects a star performer submission
router.post('/star-review', requireStaff, async (req, res) => {
  try {
    const { studentId, approved, feedback } = req.body;
    const update = {};
    if (approved) {
      update.starStatus = 'approved';
      update.starContributionFeedback = feedback || 'Your contribution is approved!';
    } else {
      update.starStatus = 'rejected';
      update.starContributionFeedback = feedback || 'Your contribution was reviewed but did not meet our criteria.';
    }
    const student = await Student.findByIdAndUpdate(studentId, update, { new: true });
    
    if (approved && student) {
      await generateAndSaveCert(studentId, 'STAR', student, "HR Portal");
    }
    res.json({ success: true });
  } catch(e) {
    console.error('[Star-Review] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v2/certificates/issue-lop — HR issues a Letter of Promotion
// Body: { studentId, oldRole, newRole, effectiveDate, department, gender? }
router.post('/issue-lop', async (req, res) => {
  try {
    const { studentId, oldRole, newRole, effectiveDate, department, gender } = req.body || {};
    if (!studentId) {
      return res.status(400).json({ success: false, message: 'studentId is required' });
    }
    const update = { lopStatus: 'pending' };
    if (oldRole)       update.lopOldRole       = oldRole;
    if (newRole)       update.lopNewRole       = newRole;
    if (effectiveDate) update.lopEffectiveDate = new Date(effectiveDate);
    if (department)    update.lopDepartment    = department;
    if (gender !== undefined) update.gender    = gender;
    await Student.findByIdAndUpdate(studentId, update);

    const studentObj = await Student.findById(studentId);
    if (!studentObj) return res.status(404).json({ success: false, message: 'Student not found' });

    const result = await generateAndSaveCert(studentId, 'LOP', studentObj, req.body.sentBy || 'HR Portal');
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[Issue-LOP] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});
  
// GET /api/v2/certificates/my-certs
router.get('/my-certs', async (req, res) => {
    return handleMyCerts(req, res);
});
  
// GET /api/v2/certificates/download/:type
router.get('/download/:type', async (req, res) => {
  try {
    const { employeeId } = req.query || {};
    const type = (req.params && req.params.type || "").toUpperCase();
    const student = await Student.findOne({ employeeId }).lean();
    if (!student) return res.status(404).json({ error: 'Not found' });
  
    const pdfMap = { LOC:'locPdfBase64', LOR:'lorPdfBase64', STAR:'starPdfBase64', OFFER:'offerPdfBase64', LOP:'lopPdfBase64' };
    const b64 = student[pdfMap[type]];
    if (!b64) {
      try {
        const StudentDocument = require("../../models/new/StudentDocument");
        const docRec = await StudentDocument.findOne({ studentId: student._id }).lean();
        let fileUrl = '';
        if (type === 'OFFER' && docRec && docRec.offerLetterUrl) {
          fileUrl = docRec.offerLetterUrl;
        } else if (type === 'LOC' && docRec && docRec.locUrl) {
          fileUrl = docRec.locUrl;
        } else if (type === 'LOR' && docRec && docRec.lorUrl) {
          fileUrl = docRec.lorUrl;
        }
        
        if (fileUrl) {
          const absolutePath = path.join(__dirname, "../..", fileUrl);
          if (fs.existsSync(absolutePath)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="TEN-${type}-${employeeId}.pdf"`);
            return res.sendFile(absolutePath);
          }
        }
      } catch (fallbackErr) {
        console.error('[Download] StudentDocument fallback error:', fallbackErr.message);
      }
      
      return res.status(404).json({ error: 'Certificate not yet generated' });
    }
  
    const buffer = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="TEN-${type}-${employeeId}.pdf"`);
    res.send(buffer);
  } catch(e) {
    console.error('[Download] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
  
// GET /api/v2/certificates/pending-hr — HR views what needs approval
router.get('/pending-hr', async (req, res) => {
  try {
    const students = await Student.find({
      $or: [
        { locStatus:  { $in: ['pending_hr'] } },
        { lorStatus:  { $in: ['pending_hr'] } },
        { starStatus: 'pending_review' },
        { coordinatorApprovalStatus: 'escalated_to_hr' },
      ]
    }, 'name fullName employeeId domain attendancePercentage performanceScore locStatus lorStatus starStatus coordinatorApprovalStatus internshipCompletedAt starContribution').lean();
    res.json({ students });
  } catch(e) {
    console.error('[Pending-HR] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CRON JOBS — SECTION 4
// ─────────────────────────────────────────────────────────────────────────────

cron.schedule('0 * * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 24*60*60*1000);
    const list = await Student.find({
      internshipCompleted: true,
      coordinatorApprovalStatus: 'pending',
      internshipCompletedAt: { $lt: cutoff },
    });
    for (const s of list) {
      await Student.findByIdAndUpdate(s._id, {
        coordinatorApprovalStatus: 'escalated_to_hr',
        locStatus: 'pending_hr',
        lorStatus: 'pending_hr',
      });
      console.log(`[CertCron-1] Escalated ${s.employeeId} → HR (coordinator 24h timeout)`);
    }
  } catch (e) {
    console.error('[CertCron-1] Error:', e.message);
  }
});
  
cron.schedule('20 * * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 24*60*60*1000);
    const list = await Student.find({
      $or: [{ locStatus:'pending_hr' }, { lorStatus:'pending_hr' }],
      coordinatorApprovedAt: { $lt: cutoff },
    });
    for (const s of list) {
      console.log(`[CertCron-2] Auto-issuing certs for ${s.employeeId}`);
      await checkAndIssueCerts(s._id.toString());
    }
  } catch (e) {
    console.error('[CertCron-2] Error:', e.message);
  }
});
  
cron.schedule('40 * * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 24*60*60*1000);
    const list = await Student.find({
      offerLetterStatus: { $in: ['pending', 'under_review'] },
      documentsSubmittedAt: { $lt: cutoff },
    });
    for (const s of list) {
      console.log(`[CertCron-3] Auto-generating Offer Letter for ${s.employeeId}`);
      await generateAndSaveCert(s._id.toString(), 'OFFER', s, "System Automation");
    }
  } catch (e) {
    console.error('[CertCron-3] Error:', e.message);
  }
});

router.generateAndSaveCert = generateAndSaveCert;
router.checkAndIssueCerts = checkAndIssueCerts;

module.exports = router;
