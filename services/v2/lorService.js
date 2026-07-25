"use strict";

const DocumentHistory = require("../../models/DocumentHistory");
const PDFDocument = require("pdfkit");
const fs          = require("fs");
const path        = require("path");
const {
    ensureFonts,
    registerFonts,
    drawLogo,
    drawBotanicalDecoration,
    todayFormatted
} = require("./pdfHelpers");
const { resolvePronouns } = require("./documentTextHelpers");

/**
 * Generates a Letter of Recommendation (LOR) PDF for a student.
 * @param {Object} data - Student data
 * @param {string} outputPath - Full path where PDF should be saved
 * @returns {Promise<string>} resolves with outputPath on success
 */
async function generateLORPDF(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Letter of Recommendation — TEN" } });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 595.28;
            const H = 841.89;

            // ── 1. Faint Background Watermark ──
            drawLogo(doc, W / 2, H / 2, 220, 0.05, "#E8B923");

            // ── 2. Double-ruled Gold Border ──
            doc.rect(15, 15, W - 30, H - 30).lineWidth(2).strokeColor("#E8B923").stroke();
            doc.rect(20, 20, W - 40, H - 40).lineWidth(0.6).strokeColor("#E8B923").stroke();

            // ── 3. Botanical Corner Illustrations ──
            // Top-Left corner
            drawBotanicalDecoration(doc, 25, 25, 0.9, false);
            // Bottom-Right corner
            drawBotanicalDecoration(doc, W - 45, H - 45, 1.2, true);

            // ── 4. Centered Logo + Wordmark ──
            drawLogo(doc, W / 2, 50, 42, 1, "#000000");
            doc.fillColor("#000000").font("Caveat-Bold").fontSize(17)
                .text("The Entrepreneurship Network", 0, 76, { width: W, align: "center" });

            // ── 5. Yellow/Gold Highlighted Title Banner ──
            const bannerW = 230;
            const bannerH = 22;
            doc.rect(W / 2 - bannerW / 2, 110, bannerW, bannerH).fill("#FDF2E9");
            doc.rect(W / 2 - bannerW / 2, 110, bannerW, bannerH).lineWidth(1).strokeColor("#E8B923").stroke();
            doc.fillColor("#A04000").font("Helvetica-Bold").fontSize(9.5)
                .text("LETTER OF RECOMMENDATION", 0, 117, { width: W, align: "center", characterSpacing: 1.2 });

            // ── 6. Metadata Block ──
            const dateStr = data.dateIssued || todayFormatted();
            const empId = data.employeeId || "TEN/HR/00000";
            const docNum = data.documentNumber || `TEN/CT/${Date.now().toString().slice(-5)}`;

            doc.fillColor("#444444").font("Helvetica").fontSize(9)
                .text(`Date: ${dateStr}`, 50, 146)
                .text(`Employee ID: ${empId}`, 50, 159)
                .text(`Document No.: ${docNum}`, 50, 172);

            // ── 7. Subject Salutation Line ──
            doc.fillColor("#1A1A2E").font("Times-Bold").fontSize(11).text("To whom it may concern", 50, 196);
            doc.moveTo(50, 210).lineTo(170, 210).lineWidth(1).strokeColor("#1A1A2E").stroke();

            // ── 8. 3 Detailed Paragraphs (Pronoun-aware) ──
            const p = resolvePronouns(data.gender);
            const name = data.studentName || "Candidate Name";
            const role = data.domain || data.role || "Intern";
            const start = data.startDate || "Start Date";
            const end = data.endDate || "End Date";
            const dept = data.department || data.domain || "Human Resource";

            const bodyOpts = { width: W - 100, align: "justify", lineGap: 5 };
            doc.fillColor("#1A1A2E").font("Times-Roman").fontSize(11);

            // --- Paragraph 1 ---
            doc.text("", 50, 224); // position cursor
            doc.font("Times-Bold").text(name, { continued: true });
            doc.font("Times-Roman").text(" worked in The Entrepreneurship Network as a ", { continued: true });
            doc.font("Times-Bold").text(role, { continued: true });
            doc.font("Times-Roman").text(" from ", { continued: true });
            doc.font("Times-Bold").text(start, { continued: true });
            doc.font("Times-Roman").text(" to ", { continued: true });
            doc.font("Times-Bold").text(end, { continued: true });
            doc.font("Times-Roman").text(`. During that time, I developed a very high regard for `, { continued: true });
            doc.font("Times-Bold").text(p.object, { continued: true });
            doc.font("Times-Roman").text(" based on the outstanding contributions that ", { continued: true });
            doc.font("Times-Bold").text(p.subject, { continued: true });
            doc.font("Times-Roman").text(" made to our company throughout the internship.", { continued: false });

            doc.moveDown(1);

            // --- Paragraph 2 ---
            doc.font("Times-Bold").text(name, { ...bodyOpts, continued: true });
            doc.font("Times-Roman").text(" worked within our ", { continued: true });
            doc.font("Times-Bold").text(dept, { continued: true });
            doc.font("Times-Roman").text(" department, ", { continued: true });
            doc.font("Times-Bold").text(p.subject, { continued: true });
            doc.font("Times-Roman").text(" has excellent communication skills. In addition, ", { continued: true });
            doc.font("Times-Bold").text(p.subject, { continued: true });
            doc.font("Times-Roman").text(" is extremely organized, reliable and computer literate, ", { continued: true });
            doc.font("Times-Bold").text(p.subject, { continued: true });
            doc.font("Times-Roman").text(" can work independently and is able to follow through to ensure that the job gets done, ", { continued: true });
            doc.font("Times-Bold").text(p.subject, { continued: true });
            doc.font("Times-Roman").text(" is flexible and willing to work on any project that is assigned to ", { continued: true });
            doc.font("Times-Bold").text(p.object, { continued: false });
            doc.font("Times-Roman").text(".", { continued: false });

            doc.moveDown(1);

            // --- Paragraph 3 ---
            doc.font("Times-Roman").text("As you can tell by now, I am quite impressed with this outstanding young ", doc.x, doc.y, { ...bodyOpts, continued: true });
            doc.font("Times-Bold").text(p.genderNoun, { continued: true });
            doc.font("Times-Roman").text(", and give ", { continued: true });
            doc.font("Times-Bold").text(p.object, { continued: true });
            doc.font("Times-Roman").text(" my strongest recommendation for roles that require intelligence, organization, communication skills, service and a positive attitude. ", { continued: true });
            doc.font("Times-Bold").text(name, { continued: true });
            doc.font("Times-Roman").text(" would be a tremendous asset to your Company and has my highest recommendation. Please feel free to contact us if you need additional information or perspective on ", { continued: true });
            doc.font("Times-Bold").text("ten.hr.contact@gmail.com", { continued: false });
            doc.font("Times-Roman").text(".", { continued: false });

            doc.moveDown(1.5);
            doc.font("Times-Roman").text("Sincerely,", 50, doc.y);

            // ── 9. Signature Block ──
            const sigY = 660;
            // Cursive signature
            doc.font("DancingScript-Regular").fontSize(18).fillColor("#000000").text("Kamlesh Gupta", 50, sigY - 12);
            // Printed lines
            doc.font("Times-Bold").fontSize(9.5).text("Kamlesh Gupta", 50, sigY + 5);
            doc.font("Times-Roman").fontSize(8.5).fillColor("#555555")
                .text("Director", 50, sigY + 18)
                .text("The Entrepreneurship Network", 50, sigY + 30);

            // ── 10. Bottom-Left Contact Footer ──
            const contactY = 746;
            doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8.5).text("CONTACT US:-", 50, contactY);
            doc.fillColor("#555555").font("Helvetica").fontSize(7.5)
                .text("EMAIL ID:- ten.hr.contact@gmail.com", 50, contactY + 12, {
                    link: "mailto:ten.hr.contact@gmail.com",
                    underline: true
                });

            // ── Footer Border line ──
            doc.rect(50, 785, W - 100, 0.5).fillColor("#dddddd").fill();
            doc.fillColor("#888888").font("Times-Roman").fontSize(8)
                .text("The Entrepreneurship Network  ·  hr@entrepreneurshipnetwork.net  ·  www.entrepreneurshipnetwork.net", 0, 794, {
                    width: W,
                    align: "center",
                    link: "https://www.entrepreneurshipnetwork.net",
                    underline: true
                });
            doc.fillColor("#aaaaaa").font("Times-Roman").fontSize(7)
                .text("This is a digitally generated Letter of Recommendation. For verification contact hr@entrepreneurshipnetwork.net", 0, 805, {
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
 * Logs a Letter of Recommendation send into the Document Send History.
 */
function logLORSend(entry = {}, method = "manual") {
    return DocumentHistory.logSend({ ...entry, documentType: "Letter of Recommendation", documentKey: "lor" }, method);
}

module.exports = { generateLORPDF, logLORSend };
