"use strict";

const DocumentHistory = require("../../models/DocumentHistory");
const PDFDocument = require("pdfkit");
const fs          = require("fs");
const path        = require("path");
const {
    ensureFonts,
    registerFonts,
    drawLogo,
    drawCircularSeal,
    drawStarMedal,
    drawAngledRibbonCorner,
    todayFormatted
} = require("./pdfHelpers");

/**
 * Generate a unique certificate ID
 * @param {string} type - 'expert' | 'nano_degree' | 'fellowship' | 'star'
 * @returns {string}
 */
function generateCertificateId(type) {
    const year  = new Date().getFullYear();
    const code  = type === "expert" ? "EXP" : type === "nano_degree" ? "ND" : type === "fellowship" ? "FEL" : "DOC";
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let   uid   = "";
    for (let i = 0; i < 6; i++) uid += chars[Math.floor(Math.random() * chars.length)];
    return `TEN-${year}-${code}-${uid}`;
}

/**
 * Generate Star Performer Certificate (A4 portrait, TEMPLATE 4)
 */
async function generateStarCertificate(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Certificate of Star Performer — TEN" } });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 595.28;
            const H = 841.89;

            // ── 1. Thin copper hairline border ──
            doc.rect(15, 15, W - 30, H - 30).lineWidth(1.2).strokeColor("#8B5A2B").stroke();

            // ── 2. Angled copper corner ribbons ──
            drawAngledRibbonCorner(doc, W, H, "top-left");
            drawAngledRibbonCorner(doc, W, H, "top-right");
            drawAngledRibbonCorner(doc, W, H, "bottom-left");
            drawAngledRibbonCorner(doc, W, H, "bottom-right");

            // ── 3. Top Right Star Medal Badge ──
            drawStarMedal(doc, W - 100, 110, 25);

            // ── 4. Elegant Script Headline & Subtitle ──
            doc.fillColor("#1A1A1A").font("DancingScript-Regular").fontSize(42)
                .text("Certificate", 0, 136, { width: W, align: "center" });

            doc.fillColor("#8B5A2B").font("Helvetica-Bold").fontSize(13.5)
                .text("OF STAR PERFORMER", 0, 192, { width: W, align: "center", characterSpacing: 4 });

            // ── 5. Background Watermark centered behind Name ──
            drawLogo(doc, W / 2, 335, 220, 0.06, "#8B5A2B");

            // ── 6. "This is awarded to" ──
            doc.fillColor("#8B5A2B").font("Helvetica-Bold").fontSize(9.5)
                .text("THIS IS AWARDED TO:", 0, 255, { width: W, align: "center", characterSpacing: 2 });

            // ── 7. Recipient's Name (Large, Bold Serif, All Caps) ──
            const name = (data.studentName || "Student Name").toUpperCase();
            doc.fillColor("#1A1A1A").font("Times-Bold").fontSize(34)
                .text(name, 40, 284, { width: W - 80, align: "center" });

            // ── 8. Centered Commendation Text ──
            doc.fillColor("#555555").font("Times-Italic").fontSize(11.5)
                .text("to commend your excellent performance and", 0, 350, { width: W, align: "center", lineGap: 3 })
                .text("to thank you for your untiring efforts in delivering quality work.", 0, 368, { width: W, align: "center" });

            // ── 9. Highlighted Metadata Box (Tenure & ID) ──
            const start = data.startDate || "Start Date";
            const end = data.endDate || "End Date";
            const empId = data.employeeId || "TEN/HR/00000";
            const blockX = W / 2 - 120;

            doc.fillColor("#1A1A1A").font("Times-Bold").fontSize(10)
                .text(`Tenure:- `, blockX, 420, { continued: true })
                .font("Times-Roman").text(`${start} – ${end}`, { continued: false })
                .font("Times-Bold").text(`Employee Id:- `, blockX, 436, { continued: true })
                .font("Times-Roman").text(empId, { continued: false });

            // ── 10. Signature Area (Left) ──
            const sigY = 660;
            // Cursive signature
            doc.font("DancingScript-Regular").fontSize(18).fillColor("#000000").text("Kamlesh Gupta", 50, sigY - 12);
            // Printed details
            doc.font("Times-Bold").fontSize(9.5).text("Kamlesh Gupta", 50, sigY + 5);
            doc.font("Times-Roman").fontSize(8.5).fillColor("#555555")
                .text("Director", 50, sigY + 18)
                .text("The Entrepreneurship Network", 50, sigY + 30);

            // ── 11. Circular Seal & ID (Right) ──
            drawCircularSeal(doc, W - 100, sigY + 12, 33);

            const certId = data.certificateId || data.documentNumber || generateCertificateId("star");
            doc.fillColor("#666666").font("Helvetica").fontSize(7)
                .text(`Certificate ID: ${certId}`, W - 250, sigY + 54, { width: 200, align: "right" });
            const verifyUrl = `https://www.entrepreneurshipnetwork.net/cert-verify?id=${certId}`;
            doc.fillColor("#0066cc").font("Helvetica").fontSize(7)
                .text(`Verify: www.entrepreneurshipnetwork.net/cert-verify?id=${certId}`, W - 250, sigY + 64, {
                    width: 200,
                    align: "right",
                    link: verifyUrl,
                    underline: true
                });

            // ── Footer Border line ──
            doc.rect(50, 785, W - 100, 0.5).fillColor("#dddddd").fill();
            doc.fillColor("#888888").font("Times-Roman").fontSize(8)
                .text("The Entrepreneurship Network  ·  hr@entrepreneurshipnetwork.net  ·  www.entrepreneurshipnetwork.net", 0, 794, {
                    width: W,
                    align: "center",
                    link: "https://www.entrepreneurshipnetwork.net"
                });

            doc.end();
            stream.on("finish", () => resolve({ path: outputPath, certificateId: certId }));
            stream.on("error", reject);
        } catch (err) {
            reject(err);
        }
    });
}

/*
 * The three course certificates: Expert, Nano Degree and Fellowship.
 *
 * All three are drawn by services/v2/certificateDesign.js, light, with what the
 * holder can do in their domain, what it took (the real share of tasks
 * approved and, for the Fellowship, their rank) and a QR code to the public
 * verify page. They used to be three hand-drawn pages, two of them dark, that
 * said nothing an employer could weigh.
 *
 * data: studentName, domain, tenure, durationText, startDate, endDate,
 * certificateId, and when known completionPct and cohortRankPct.
 * Resolves with outputPath once the file is written.
 */
const certificateDesign = require("./certificateDesign");

function generateExpertCertificate(data, outputPath) {
    return certificateDesign.renderToFile(outputPath, (doc) => certificateDesign.drawInternshipCertificate(doc, "expert", data));
}

function generateNanoCertificate(data, outputPath) {
    return certificateDesign.renderToFile(outputPath, (doc) => certificateDesign.drawInternshipCertificate(doc, "nano_degree", data));
}

function generateFellowshipCertificate(data, outputPath) {
    return certificateDesign.renderToFile(outputPath, (doc) => certificateDesign.drawInternshipCertificate(doc, "fellowship", data));
}

/**
 * Logs a certificate send into the Document Send History.
 */
function logCertificateSend(entry = {}, method = "automation") {
    const labels = {
        expert:      "Expert Certificate",
        nano_degree: "Nano Degree",
        fellowship:  "Fellowship",
        star:        "Star Performer Certificate"
    };
    const certKey = String(entry.certType || entry.documentKey || "certificate").toLowerCase();
    return DocumentHistory.logSend({
        ...entry,
        documentType:   entry.documentType || labels[certKey] || certKey,
        documentKey:    certKey,
        documentNumber: entry.documentNumber || entry.certificateId || ""
    }, method);
}

module.exports = {
    generateCertificateId,
    generateExpertCertificate,
    generateNanoCertificate,
    generateFellowshipCertificate,
    generateStarCertificate,
    logCertificateSend
};
