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

/**
 * Generate Expert Certificate PDF (A4 landscape)
 */
async function generateExpertCertificate(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 841.89, H = 595.28;
            const gold  = "#C9A84C";
            const ivory = "#FDFAF4";
            const dark  = "#2C1810";

            // Background
            doc.rect(0, 0, W, H).fill(ivory);

            // Outer border
            doc.rect(18, 18, W - 36, H - 36).lineWidth(1.5).strokeColor(gold).stroke();
            doc.rect(24, 24, W - 48, H - 48).lineWidth(0.5).strokeColor(gold).stroke();

            // Corner dots
            const corners = [[28, 28], [W - 28, 28], [28, H - 28], [W - 28, H - 28]];
            corners.forEach(([cx, cy]) => {
                doc.circle(cx, cy, 6).lineWidth(1).strokeColor(gold).stroke();
                doc.circle(cx, cy, 3).fill(gold);
            });

            // Watermark
            drawLogo(doc, W / 2, H / 2, 180, 0.06, gold);

            // Header
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(11)
                .text("THE ENTREPRENEURSHIP NETWORK", 0, 52, { width: W, align: "center", characterSpacing: 3 });
            doc.fillColor(dark).font("Helvetica").fontSize(8)
                .text("Shaping Tomorrow's Entrepreneurs", 0, 68, { width: W, align: "center" });

            // Title
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(9)
                .text("CERTIFICATE OF COMPLETION", 0, 95, { width: W, align: "center", characterSpacing: 4 });

            doc.moveTo(200, 112).lineTo(W - 200, 112).lineWidth(1).strokeColor(gold).stroke();

            // "This certifies that"
            doc.fillColor("#8B7355").font("Helvetica-Oblique").fontSize(13)
                .text("This certifies that", 0, 122, { width: W, align: "center" });

            // Name
            doc.fillColor(dark).font("Helvetica-Bold").fontSize(38)
                .text(data.studentName || "Student Name", 0, 145, { width: W, align: "center" });

            // Domain
            doc.fillColor("#555555").font("Helvetica").fontSize(12)
                .text(`has successfully completed the ${data.domain || "Technology"} Internship Program`, 0, 196, { width: W, align: "center" });

            // Duration + date
            doc.fillColor("#777777").font("Helvetica").fontSize(10)
                .text(`Duration: ${data.durationText || data.tenure || "N/A"}  ·  Period: ${data.startDate || ""} – ${data.endDate || ""}  ·  Issued: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`,
                    0, 220, { width: W, align: "center" });

            doc.moveTo(100, 244).lineTo(W - 100, 244).lineWidth(1).strokeColor(gold).stroke();

            // Signature block
            const sigX = 100;
            doc.moveTo(sigX, 280).lineTo(sigX + 160, 280).lineWidth(0.8).strokeColor("#333333").stroke();
            doc.fillColor(dark).font("Helvetica-Bold").fontSize(9).text("Kamlesh Gupta", sigX, 284);
            doc.fillColor("#777777").font("Helvetica").fontSize(8).text("Director, TEN", sigX, 296);

            // Seal circular
            const sealX = W / 2, sealY = 280;
            drawCircularSeal(doc, sealX, sealY, 34);

            // Cert ID
            const certId = data.certificateId || generateCertificateId("expert");
            doc.fillColor("#999999").font("Helvetica").fontSize(7)
                .text(`Certificate ID: ${certId}`, W - 300, 275);
            const verifyUrl = `https://www.entrepreneurshipnetwork.net/cert-verify?id=${certId}`;
            doc.fillColor("#0066cc").font("Helvetica").fontSize(7)
                .text(`Verify at: entrepreneurshipnetwork.net/cert-verify?id=${certId}`, W - 300, 288, {
                    link: verifyUrl,
                    underline: true
                });

            doc.end();
            stream.on("finish", () => resolve({ path: outputPath, certificateId: certId }));
            stream.on("error", reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generate Nano Degree Certificate PDF (A4 landscape)
 */
async function generateNanoCertificate(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 841.89, H = 595.28;
            const gold = "#FFD700";
            const navy = "#0A1628";
            const white = "#FFFFFF";

            // Background
            doc.rect(0, 0, W, H).fill(navy);

            // Borders
            doc.rect(12, 12, W - 24, H - 24).lineWidth(1).strokeColor(white).stroke();
            doc.rect(20, 20, W - 40, H - 40).lineWidth(1).strokeColor(gold).stroke();

            // Ribbon header band
            doc.rect(0, 0, W, 80).fill("#061020");
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(12)
                .text("THE ENTREPRENEURSHIP NETWORK", 0, 30, { width: W, align: "center", characterSpacing: 5 });
            doc.fillColor(white).font("Helvetica").fontSize(8)
                .text("Shaping Tomorrow's Entrepreneurs", 0, 52, { width: W, align: "center" });

            // Title
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(10)
                .text("NANO DEGREE CERTIFICATE", 0, 100, { width: W, align: "center", characterSpacing: 6 });

            doc.moveTo(150, 120).lineTo(W - 150, 120).lineWidth(0.8).strokeColor(gold).stroke();

            // "This certifies that"
            doc.fillColor("#AAAAAA").font("Helvetica-Oblique").fontSize(13)
                .text("This certifies that", 0, 132, { width: W, align: "center" });

            // Name
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(44)
                .text(data.studentName || "Student Name", 0, 155, { width: W, align: "center" });

            doc.fillColor(white).font("Helvetica").fontSize(13)
                .text(`has been awarded the Nano Degree in ${data.domain || "Technology"}`, 0, 210, { width: W, align: "center" });

            doc.fillColor("#888888").font("Helvetica").fontSize(10)
                .text(`Duration: ${data.durationText || "N/A"}  ·  Issued: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`,
                    0, 234, { width: W, align: "center" });

            doc.moveTo(150, 256).lineTo(W - 150, 256).lineWidth(0.8).strokeColor(gold).stroke();

            // Signature
            doc.moveTo(120, 310).lineTo(280, 310).lineWidth(0.5).strokeColor("#666666").stroke();
            doc.fillColor(white).font("Helvetica-Bold").fontSize(9).text("Kamlesh Gupta", 120, 316);
            doc.fillColor("#888888").font("Helvetica").fontSize(8).text("Director, TEN", 120, 328);

            const certId = data.certificateId || generateCertificateId("nano_degree");
            drawCircularSeal(doc, W / 2, 316, 30);

            doc.fillColor(gold).font("Helvetica-Bold").fontSize(8)
                .text("Add to LinkedIn →", W - 280, 305);
            doc.fillColor("#666666").font("Helvetica").fontSize(7)
                .text(`Verify code: ${certId}`, W - 280, 318);
            const verifyUrl = `https://www.entrepreneurshipnetwork.net/cert-verify?id=${certId}`;
            doc.fillColor("#38BDF8").font("Helvetica").fontSize(7)
                .text(`Verify: www.entrepreneurshipnetwork.net/cert-verify?id=${certId}`, W - 280, 332, {
                    link: verifyUrl,
                    underline: true
                });

            doc.end();
            stream.on("finish", () => resolve({ path: outputPath, certificateId: certId }));
            stream.on("error", reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generate Fellowship Certificate PDF (A4 landscape)
 */
async function generateFellowshipCertificate(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 841.89, H = 595.28;
            const gold   = "#FFD700";
            const green  = "#0D2818";
            const white  = "#FFFFFF";

            // Background
            doc.rect(0, 0, W, H).fill(green);

            // Constellation border
            doc.rect(15, 15, W - 30, H - 30).lineWidth(1).strokeColor(gold).opacity(0.3).stroke();
            doc.rect(22, 22, W - 44, H - 44).lineWidth(0.5).strokeColor(gold).opacity(0.2).stroke();
            doc.opacity(1);

            // Headings
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(72)
                .text("FELLOW", 0, 30, { width: W, align: "center", characterSpacing: 28 });
            doc.fillColor(white).font("Helvetica").fontSize(10)
                .text("of The Entrepreneurship Network", 0, 115, { width: W, align: "center", characterSpacing: 2 });

            doc.moveTo(100, 136).lineTo(W - 100, 136).lineWidth(0.8).strokeColor(gold).stroke();

            // Citation
            const citation = `This certifies that ${data.studentName || "the student"} has demonstrated exceptional dedication and commitment throughout their ${data.durationText || data.tenure || "internship"} journey at TEN. This Fellowship is awarded in recognition of achievement in the top 3% of their cohort in ${data.domain || "their domain"}.`;
            doc.fillColor("#AAAAAA").font("Helvetica-Oblique").fontSize(10)
                .text(citation, 80, 150, { width: W - 160, align: "center", lineGap: 3 });

            // Name
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(52)
                .text(data.studentName || "Student Name", 0, 220, { width: W, align: "center" });

            doc.fillColor(white).font("Helvetica").fontSize(11)
                .text(`Domain: ${data.domain || "Technology"}  ·  Duration: ${data.durationText || "N/A"}  ·  Issued: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`,
                    0, 285, { width: W, align: "center" });

            doc.moveTo(100, 305).lineTo(W - 100, 305).lineWidth(0.8).strokeColor(gold).stroke();

            // Wax seal style central element
            const waxX = W / 2;
            doc.circle(waxX, 350, 32).fill("#8B0000");
            doc.circle(waxX, 350, 32).lineWidth(2).strokeColor(gold).stroke();
            doc.circle(waxX, 350, 24).lineWidth(0.5).strokeColor(gold).stroke();
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(7)
                .text("TEN", waxX - 8, 346);

            // Three signature lines
            const sigs = [
                { x: 80,      label: "Director" },
                { x: W / 2 - 80, label: "Program Head" },
                { x: W - 260, label: "Domain Expert" }
            ];
            sigs.forEach(({ x, label }) => {
                doc.moveTo(x, 420).lineTo(x + 160, 420).lineWidth(0.6).strokeColor("#555555").stroke();
                doc.fillColor(white).font("Helvetica-Bold").fontSize(8).text(label, x, 426);
                doc.fillColor("#666666").font("Helvetica").fontSize(7).text("The Entrepreneurship Network", x, 438);
            });

            const certId = data.certificateId || generateCertificateId("fellowship");
            const verifyUrl = `https://www.entrepreneurshipnetwork.net/cert-verify?id=${certId}`;
            doc.fillColor("#888888").font("Helvetica").fontSize(7)
                .text(`Certificate ID: ${certId}  ·  Verify: www.entrepreneurshipnetwork.net/cert-verify?id=${certId}`, 0, H - 30, {
                    width: W,
                    align: "center",
                    link: verifyUrl,
                    underline: true
                });

            doc.end();
            stream.on("finish", () => resolve({ path: outputPath, certificateId: certId }));
            stream.on("error", reject);
        } catch (err) {
            reject(err);
        }
    });
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
