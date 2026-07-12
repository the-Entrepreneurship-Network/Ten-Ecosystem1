"use strict";

/**
 * Letter of Promotion (LOP) PDF generator.
 *
 * Visually matches the Internship Offer Letter (same border, header,
 * gold divider, signature block, seal placement and footer) but with a
 * corrected title ("LETTER OF PROMOTION" — NOT "Offer"), a single-line
 * salutation built via {@link buildSalutation}, and promotion-specific
 * body copy (old role → new role, effective date, department).
 */

const DocumentHistory = require("../../models/DocumentHistory");
const PDFDocument = require("pdfkit");
const fs   = require("fs");
const {
    ensureFonts,
    registerFonts,
    drawLogo,
    drawCircularSeal,
    todayFormatted
} = require("./pdfHelpers");
const { buildSalutation } = require("./documentTextHelpers");

/**
 * Generates a Letter of Promotion PDF for a student/intern.
 *
 * Expected `data` fields:
 *   - fullName / studentName
 *   - employeeId
 *   - documentNumber (formatted "TEN/DOC/#####")
 *   - institute / collegeName
 *   - oldRole, newRole
 *   - effectiveDate
 *   - department  (optional — falls back to "The Entrepreneurship Network")
 *   - dateIssued  (optional — falls back to today)
 *
 * @param {Object} data
 * @param {string} outputPath
 * @returns {Promise<string>}
 */
async function generateLetterOfPromotionPDF(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: "A4",
                margin: 0,
                info: { Title: "Letter of Promotion — TEN" }
            });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 595.28;
            const H = 841.89;

            // ── Background watermark ──
            drawLogo(doc, W / 2, H / 2, 260, 0.06, "#C9A84C");

            // ── Outer double-ruled border ──
            doc.rect(15, 15, W - 30, H - 30).lineWidth(3).strokeColor("#C9A84C").stroke();
            doc.rect(20, 20, W - 40, H - 40).lineWidth(1).strokeColor("#C9A84C").stroke();

            // ── Top Header Section ──
            drawLogo(doc, 75, 60, 24, 1, "#C9A84C");
            doc.fillColor("#C9A84C").font("Helvetica-Bold").fontSize(16)
                .text("THE ENTREPRENEURSHIP NETWORK", 110, 50, { width: 300 });
            doc.fillColor("#666666").font("Helvetica").fontSize(8)
                .text("Empowering the next generation of professionals", 110, 68, { width: 300 });

            // ── Right: Date & Ref ──
            const today = new Date().toLocaleDateString("en-GB", {
                day: "2-digit", month: "2-digit", year: "numeric"
            });
            const dateStr = data.dateIssued || data.date || today;
            const empId = data.employeeId || "TEN/HR/00000";
            const docNum = data.documentNumber || data.docNo ||
                `TEN/DOC/${Date.now().toString().slice(-5)}`;

            doc.fillColor("#666666").font("Helvetica").fontSize(9)
                .text(`Date: ${dateStr}`, W - 200, 52, { width: 150, align: "right" })
                .text(`Employee ID: ${empId}`, W - 200, 66, { width: 150, align: "right" })
                .text(`Document No.: ${docNum}`, W - 200, 80, { width: 150, align: "right" });

            // ── Gold divider line ──
            doc.moveTo(40, 105).lineTo(W - 40, 105).lineWidth(1.5).strokeColor("#C9A84C").stroke();

            // ── Title (BUG A fix — must NOT be "Offer Letter") ──
            doc.fillColor("#1a1a1a").font("Times-Bold").fontSize(18)
                .text("LETTER OF PROMOTION", 0, 125, { width: W, align: "center", characterSpacing: 1 });
            doc.fillColor("#555555").font("Times-Roman").fontSize(10)
                .text("with The Entrepreneurship Network", 0, 148, { width: W, align: "center" });
            doc.moveTo(W / 2 - 120, 166).lineTo(W / 2 + 120, 166).lineWidth(1).strokeColor("#1a1a1a").stroke();

            // ── Recipient meta (name + institute) ──
            const fullName = data.fullName || data.studentName || "Candidate Name";
            const institute = data.institute || data.collegeName || data.college || "";

            doc.fillColor("#1a1a1a").font("Times-Roman").fontSize(10.5)
                .text(fullName, 50, 185, { width: W - 100 });
            if (institute) {
                doc.fillColor("#555555").font("Times-Roman").fontSize(9.5)
                    .text(institute, 50, 200, { width: W - 100 });
            }

            // ── Salutation (BUG B fix — single line via buildSalutation) ──
            doc.fillColor("#1a1a1a").font("Times-Bold").fontSize(11)
                .text(buildSalutation(fullName), 50, 225, { width: W - 100, lineBreak: false });

            // ── Body ──
            const oldRole        = data.oldRole || "Intern";
            const newRole        = data.newRole || "Senior Intern";
            const effectiveDate  = data.effectiveDate || dateStr;
            const department     = data.department || "The Entrepreneurship Network";
            const bodyOpts       = { width: W - 100, align: "justify", lineGap: 4 };

            doc.y = 250;
            doc.font("Times-Roman").fontSize(11).fillColor("#1a1a1a");

            doc.text("Congratulations. We are pleased and honoured to inform you that you have been promoted from ",
                50, doc.y, { ...bodyOpts, continued: true });
            doc.font("Times-Bold").text(oldRole, { continued: true });
            doc.font("Times-Roman").text(" to ", { continued: true });
            doc.font("Times-Bold").text(newRole, { continued: true });
            doc.font("Times-Roman").text(" in the organization, effective from ", { continued: true });
            doc.font("Times-Bold").text(effectiveDate, { continued: true });
            doc.font("Times-Roman").text(". ", { continued: true });
            doc.font("Times-Bold").text(department, { continued: true });
            doc.font("Times-Roman").text(" congratulates you, for this achievement of yours.", { continued: false });

            doc.moveDown(1);
            doc.text(
                "As your post grows in the company, your responsibility towards your work will also increase. " +
                "You have achieved this promotion with all your hard work and dedication towards your work. " +
                "We expect the same behaviour from you in future.",
                50, doc.y, bodyOpts
            );

            doc.moveDown(1);
            doc.text(
                "Once again many congratulations and all the best for your future growth.",
                50, doc.y, bodyOpts
            );

            // ── Signature block ──
            const sigY = 645;
            doc.font("Times-Roman").fontSize(11).text("Yours sincerely,", 50, sigY - 20);

            // Cursive signature
            doc.font("DancingScript-Regular").fontSize(18).fillColor("#000000")
                .text("Kamlesh Gupta", 50, sigY - 2);
            // Printed details
            doc.font("Times-Bold").fontSize(9.5).text("Kamlesh Gupta", 50, sigY + 15);
            doc.font("Times-Roman").fontSize(8.5).fillColor("#555555")
                .text("Director", 50, sigY + 28)
                .text("The Entrepreneurship Network", 50, sigY + 40);

            // Circular Seal on the right (identical placement to Offer Letter)
            drawCircularSeal(doc, W - 100, sigY + 15, 33);

            // ── Standard Footer ──
            doc.rect(20, 775, W - 40, 0.5).fillColor("#ccc").fill();
            doc.fillColor("#888888").font("Times-Roman").fontSize(8)
                .text("The Entrepreneurship Network  ·  hr@entrepreneurshipnetwork.net  ·  www.entrepreneurshipnetwork.net",
                    0, 785, {
                        width: W,
                        align: "center",
                        link: "https://www.entrepreneurshipnetwork.net",
                        underline: true
                    });
            doc.fillColor("#aaaaaa").font("Times-Roman").fontSize(7)
                .text("This is a digitally generated Letter of Promotion. For verification contact hr@entrepreneurshipnetwork.net",
                    0, 797, {
                        width: W,
                        align: "center",
                        link: "mailto:hr@entrepreneurshipnetwork.net",
                        underline: true
                    });

            doc.end();
            stream.on("finish", () => resolve(outputPath));
            stream.on("error",  reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Logs a Letter of Promotion send into the Document Send History.
 */
function logLOPSend(entry = {}, method = "manual") {
    return DocumentHistory.logSend(
        { ...entry, documentType: "Letter of Promotion", documentKey: "lop" },
        method
    );
}

module.exports = { generateLetterOfPromotionPDF, logLOPSend };
