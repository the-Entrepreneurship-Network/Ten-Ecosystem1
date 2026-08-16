"use strict";

const DocumentHistory = require("../../models/DocumentHistory");
const PDFDocument = require("pdfkit");
const fs          = require("fs");
const path        = require("path");
const {
    ensureFonts,
    registerFonts,
    drawLogo,
    drawRosetteMedal,
    todayFormatted
} = require("./pdfHelpers");
const { resolvePronouns } = require("./documentTextHelpers");

/**
 * Generates a Letter of Completion (LOC) Certificate PDF for a student.
 * @param {Object} data - Student data
 * @param {string} outputPath - Full path where PDF should be saved
 * @returns {Promise<string>} resolves with outputPath on success
 */
async function generateLOCPDF(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Letter of Completion — TEN" } });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 595.28;
            const H = 841.89;

            // ── 1. Top Geometric Asymmetric Banner ──
            // Dark charcoal base panel
            doc.rect(0, 0, W, 210).fill("#1A1A1A");

            // Gold gradient sweep ribbon
            const grad = doc.linearGradient(0, 0, W, 210);
            grad.stop(0, "#D4AF37").stop(1, "#C9A227");

            doc.beginPath();
            doc.moveTo(0, 0);
            doc.lineTo(W - 80, 0);
            doc.lineTo(W, 150);
            doc.lineTo(0, 210);
            doc.closePath();
            doc.fill(grad);

            // Small dark wedge in top-right
            doc.beginPath();
            doc.moveTo(W - 80, 0);
            doc.lineTo(W, 0);
            doc.lineTo(W, 150);
            doc.closePath();
            doc.fill("#1A1A1A");

            // ── 2. Centered Laurel Wreath Logo Emblem ──
            const centerX = W / 2;
            const centerY = 190;
            doc.save();
            // Solid white backdrop ring
            doc.circle(centerX, centerY, 36).fill("#FFFFFF");
            doc.circle(centerX, centerY, 36).lineWidth(1.8).strokeColor("#D4AF37").stroke();
            
            // Stylized vector laurel wreath leaves (ring of points)
            for (let angle = 0; angle < Math.PI * 2; angle += 0.22) {
                const lx = centerX + 31 * Math.cos(angle);
                const ly = centerY + 31 * Math.sin(angle);
                doc.circle(lx, ly, 1.5).fill("#D4AF37");
            }
            // Embed central hands+infinity logo
            drawLogo(doc, centerX, centerY, 34, 1, "#1A1A1A");
            doc.restore();

            // ── 3. Certificate Headings ──
            doc.fillColor("#000000").font("Caveat-Bold").fontSize(19)
                .text("The Entrepreneurship Network", 0, 242, { width: W, align: "center" });

            doc.fillColor("#1A1A1A").font("Times-Bold").fontSize(31)
                .text("CERTIFICATE", 0, 270, { width: W, align: "center", characterSpacing: 4 });

            doc.fillColor("#D4AF37").font("Helvetica-Bold").fontSize(13)
                .text("OF COMPLETION", 0, 306, { width: W, align: "center", characterSpacing: 2 });

            // ── 4. Left-Aligned Metadata Block ──
            const empId = data.employeeId || "TEN/HR/00000";
            const docNum = data.documentNumber || `TEN/CT/${Date.now().toString().slice(-5)}`;
            const issueDate = data.dateIssued || todayFormatted();

            doc.fillColor("#555555").font("Helvetica").fontSize(9)
                .text(`Employee ID: ${empId}`, 50, 340)
                .text(`Document No.: ${docNum}`, 50, 353)
                .text(`Date Of Issue:- ${issueDate}`, 50, 366);

            // ── 5. Justified Narrative Body (Pronoun Aware) ──
            const p = resolvePronouns(data.gender);
            const name = data.studentName || "Candidate Name";
            const course = data.degreeCourse || data.collegeName || "Course / Degree";
            const uni = data.universityName || data.collegeName || "University / Institute";
            const start = data.startDate || "Start Date";
            const end = data.endDate || "End Date";
            const role = data.domain || data.role || "Intern";

            const bodyTextY = 398;
            const bodyOpts = { width: W - 100, align: "justify", lineGap: 5 };

            doc.fillColor("#1A1A1A").font("Times-Roman").fontSize(11.5);
            
            // Multi-segment text with continued formatting to preserve exact inline bolding
            doc.text("This is to certify that ", 50, bodyTextY, { ...bodyOpts, continued: true });
            doc.font("Times-Bold").text(name, { continued: true });
            doc.font("Times-Roman").text(" Completed ", { continued: true });
            doc.font("Times-Bold").text(course, { continued: true });
            doc.font("Times-Roman").text(" from ", { continued: true });
            doc.font("Times-Bold").text(uni, { continued: true });
            doc.font("Times-Roman").text(" has Successfully Completed ", { continued: true });
            doc.font("Times-Bold").text(`${p.possessive} `, { continued: true });
            doc.font("Times-Roman").text("internship tenure with ", { continued: true });
            doc.font("Times-Bold").text("The Entrepreneurship Network (Limitless Technologies LLP)", { continued: true });
            doc.font("Times-Roman").text(" from ", { continued: true });
            doc.font("Times-Bold").text(start, { continued: true });
            doc.font("Times-Roman").text(" To ", { continued: true });
            doc.font("Times-Bold").text(end, { continued: true });
            doc.font("Times-Roman").text(". During the period, ", { continued: true });
            doc.font("Times-Bold").text(p.subject, { continued: true });
            doc.font("Times-Roman").text(" worked as a ", { continued: true });
            doc.font("Times-Bold").text(`${role}-Intern`, { continued: true });
            doc.font("Times-Roman").text(". During the course of ", { continued: true });
            doc.font("Times-Bold").text(`${p.possessive} `, { continued: true });
            doc.font("Times-Roman").text("tenure, ", { continued: true });
            doc.font("Times-Bold").text(name, { continued: true });
            doc.font("Times-Roman").text(` showed considerable interest in fulfilling `, { continued: true });
            doc.font("Times-Bold").text(`${p.possessive} `, { continued: true });
            doc.font("Times-Roman").text("roles and responsibilities and ", { continued: true });
            doc.font("Times-Bold").text(`${p.possessive} `, { continued: true });
            doc.font("Times-Roman").text("conduct was professional throughout.", { continued: false });

            // Next paragraph line
            doc.moveDown(1.2);
            doc.font("Times-Roman").text("We wish ", doc.x, doc.y, { ...bodyOpts, continued: true });
            doc.font("Times-Bold").text(p.object, { continued: true });
            doc.font("Times-Roman").text(` all the best for `, { continued: true });
            doc.font("Times-Bold").text(`${p.possessive} `, { continued: true });
            doc.font("Times-Roman").text("future endeavours.", { continued: false });

            // Best Regards line
            doc.moveDown(1.5);
            doc.font("Times-Bold").text("Best Regards,", 50, doc.y);

            // ── 6. Bottom Rosette Medal (Left) ──
            const badgeY = 660;
            drawRosetteMedal(doc, 100, badgeY + 15, 33);

            // ── 7. Signature Block (Right) ──
            const sigX = W - 220;
            // Cursive signature
            doc.font("DancingScript-Regular").fontSize(18).fillColor("#000000").text("Kamlesh Gupta", sigX, badgeY - 12);
            // Printed lines
            doc.font("Times-Bold").fontSize(9.5).text("Kamlesh Gupta", sigX, badgeY + 5);
            doc.font("Times-Roman").fontSize(8.5).fillColor("#555555")
                .text("Director", sigX, badgeY + 18)
                .text("The Entrepreneurship Network", sigX, badgeY + 30);

            // ── 8. Bottom-Right Corner Decorative Charcoal Wedge ──
            doc.save();
            doc.beginPath();
            doc.moveTo(W - 100, H);
            doc.lineTo(W, H - 100);
            doc.lineTo(W, H);
            doc.closePath();
            doc.fill("#1A1A1A");
            doc.restore();

            // ── Footer Border line ──
            doc.rect(50, 775, W - 100, 0.5).fillColor("#dddddd").fill();
            doc.fillColor("#888888").font("Times-Roman").fontSize(8)
                .text("The Entrepreneurship Network  ·  hr@entrepreneurshipnetwork.net  ·  www.entrepreneurshipnetwork.net", 0, 785, {
                    width: W,
                    align: "center",
                    link: "https://www.entrepreneurshipnetwork.net",
                    underline: true
                });
            doc.fillColor("#aaaaaa").font("Times-Roman").fontSize(7)
                .text("This is a digitally generated Certificate of Completion. For verification contact hr@entrepreneurshipnetwork.net", 0, 797, {
                    width: W,
                    align: "center",
                    link: "mailto:hr@entrepreneurshipnetwork.net",
                    underline: true
                });

            doc.end();
            stream.on("finish", () => resolve(outputPath));
            stream.on("error", reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Logs a Letter of Completion send into the Document Send History.
 */
function logLOCSend(entry = {}, method = "automation") {
    return DocumentHistory.logSend({ ...entry, documentType: "Letter of Completion", documentKey: "loc" }, method);
}

module.exports = { generateLOCPDF, logLOCSend };
