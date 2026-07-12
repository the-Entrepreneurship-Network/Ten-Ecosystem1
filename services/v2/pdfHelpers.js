"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const PDFDocument = require("pdfkit");

// PDFKit doesn't have a beginPath() method. We add a safe no-op shim to its prototype
// so that any calls across the codebase (including other v2 services) never crash.
if (PDFDocument && PDFDocument.prototype) {
    PDFDocument.prototype.beginPath = function() {
        return this;
    };
}

const COLORS = Object.freeze({
    gold:     "#C9A84C",
    navy:     "#0A1628",
    white:    "#FFFFFF",
    cream:    "#F8F5ED",
    textDark: "#1A1A2E",
});

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

/**
 * Downloads a file from a URL as a buffer.
 */
function fetchFontBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch font: status code ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        }).on("error", reject);
    });
}

/**
 * Attempts to download a font from a list of URLs sequentially.
 */
async function fetchFontFromList(urls) {
    let lastError;
    for (const url of urls) {
        try {
            console.log(`Attempting to download font from: ${url}`);
            const buf = await fetchFontBuffer(url);
            if (buf && buf.length > 0) {
                return buf;
            }
        } catch (err) {
            console.warn(`Failed download from ${url}: ${err.message}`);
            lastError = err;
        }
    }
    throw lastError || new Error("All font URLs failed to fetch.");
}

/**
 * Ensures Google Fonts Caveat and Dancing Script are available on disk.
 */
async function ensureFonts() {
    const fontsDir = path.join(__dirname, "fonts");
    if (!fs.existsSync(fontsDir)) {
        fs.mkdirSync(fontsDir, { recursive: true });
    }

    const caveatPath = path.join(fontsDir, "Caveat-Bold.ttf");
    const dancingPath = path.join(fontsDir, "DancingScript-Regular.ttf");

    if (!fs.existsSync(caveatPath)) {
        try {
            console.log("Downloading Caveat-Bold font...");
            const caveatUrls = [
                "https://raw.githubusercontent.com/googlefonts/caveat/main/fonts/ttf/Caveat-Bold.ttf",
                "https://raw.githubusercontent.com/Jomimoses/images/master/Caveat-Bold.ttf",
                "https://cdn.jsdelivr.net/gh/googlefonts/caveat@main/fonts/ttf/Caveat-Bold.ttf",
                "https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/static/Caveat-Bold.ttf"
            ];
            const buf = await fetchFontFromList(caveatUrls);
            fs.writeFileSync(caveatPath, buf);
            console.log("Caveat-Bold font saved successfully.");
        } catch (e) {
            console.error("Failed to download Caveat-Bold font, using standard fallback:", e.message);
        }
    }

    if (!fs.existsSync(dancingPath)) {
        try {
            console.log("Downloading DancingScript-Regular font...");
            const dancingUrls = [
                "https://raw.githubusercontent.com/ioBroker/ioBroker.vis-google-fonts/master/widgets/google-fonts/fonts/Dancing_Script/DancingScript-Regular.ttf",
                "https://raw.githubusercontent.com/googlefonts/DancingScript/main/fonts/ttf/DancingScript-Regular.ttf",
                "https://raw.githubusercontent.com/googlefonts/DancingScript/master/fonts/ttf/DancingScript-Regular.ttf",
                "https://cdn.jsdelivr.net/gh/ioBroker/ioBroker.vis-google-fonts@master/widgets/google-fonts/fonts/Dancing_Script/DancingScript-Regular.ttf",
                "https://raw.githubusercontent.com/google/fonts/main/ofl/dancingscript/static/DancingScript-Regular.ttf"
            ];
            const buf = await fetchFontFromList(dancingUrls);
            fs.writeFileSync(dancingPath, buf);
            console.log("DancingScript-Regular font saved successfully.");
        } catch (e) {
            console.error("Failed to download DancingScript-Regular font, using standard fallback:", e.message);
        }
    }
}

/**
 * Registers the downloaded custom fonts on the doc instance if available.
 */
function registerFonts(doc) {
    const fontsDir = path.join(__dirname, "fonts");
    const caveatPath = path.join(fontsDir, "Caveat-Bold.ttf");
    const dancingPath = path.join(fontsDir, "DancingScript-Regular.ttf");

    if (fs.existsSync(caveatPath)) {
        doc.registerFont("Caveat-Bold", caveatPath);
    } else {
        doc.registerFont("Caveat-Bold", "Helvetica-Bold");
    }

    if (fs.existsSync(dancingPath)) {
        doc.registerFont("DancingScript-Regular", dancingPath);
    } else {
        doc.registerFont("DancingScript-Regular", "Times-Italic");
    }
}

/**
 * Every real call site in this codebase passes one of these exact gold
 * hex colors when it wants the logo to read as gold-on-dark — mapped here
 * so no caller needs to change.
 */
const GOLD_TONES = new Set(["#C9A84C", "#D4AF37", "#8B5A2B", "#E8B923"]);
const LOGO_NAVY = path.join(__dirname, "..", "..", "public", "assets", "TEN_logo_dark_transparent.png");
const LOGO_GOLD = path.join(__dirname, "..", "..", "public", "assets", "TEN_logo_gold_for_navy_bg.png");

/**
 * Draws the TEN logo using the real brand image asset.
 * Falls back to a text monogram if the asset file is unavailable.
 * Signature is kept identical to the old vector version so every caller
 * continues working without modification.
 */
function drawLogo(doc, x, y, size = 60, opacity = 1, color = "#000000") {
    // Pick the navy or gold mark depending on the caller's intended color,
    // so it reads correctly whether it's placed on a light or dark background.
    const logoFile = GOLD_TONES.has((color || "").toUpperCase()) ? LOGO_GOLD : LOGO_NAVY;
    doc.save();
    doc.opacity(opacity);
    try {
        if (fs.existsSync(logoFile)) {
            // Center the image on (x, y)
            doc.image(logoFile, x - size / 2, y - size / 2, { width: size });
        } else {
            // Text-monogram fallback — lineBreak:false + explicit coords so
            // doc.text() does NOT advance doc.y (flow cursor stays unchanged)
            const savedY = doc.y;
            doc.fillColor(color).font("Helvetica-Bold")
                .fontSize(Math.max(size * 0.35, 8))
                .text("TEN", x - size * 0.3, y - size * 0.2,
                      { width: size * 0.6, align: "center", lineBreak: false });
            doc.y = savedY;
        }
    } catch (_e) {
        const savedY = doc.y;
        doc.fillColor(color).font("Helvetica-Bold")
            .fontSize(Math.max(size * 0.35, 8))
            .text("TEN", x - size * 0.3, y - size * 0.2,
                  { width: size * 0.6, align: "center", lineBreak: false });
        doc.y = savedY;
    }
    doc.restore();
}

/**
 * Renders text along a circle arc.
 */
function drawCurvedText(doc, text, centerX, centerY, radius, startAngle) {
    doc.save();
    const chars = text.split("");
    const len = chars.length;
    const step = 0.13; // spacing in radians
    const totalAngle = (len - 1) * step;
    let angle = startAngle - totalAngle / 2;

    doc.fontSize(5.5).font("Helvetica-Bold").fillColor("#000000");
    for (let i = 0; i < len; i++) {
        const char = chars[i];
        const cx = centerX + radius * Math.cos(angle);
        const cy = centerY + radius * Math.sin(angle);
        
        doc.save();
        doc.translate(cx, cy);
        doc.rotate(angle + Math.PI / 2);
        doc.text(char, -2.5, -2.5);
        doc.restore();
        
        angle += step;
    }
    doc.restore();
}

/**
 * Draws the brand circular seal.
 */
function drawCircularSeal(doc, x, y, radius = 35) {
    doc.save();
    // Circular bounds
    doc.circle(x, y, radius).lineWidth(1.5).strokeColor("#000000").stroke();
    doc.circle(x, y, radius - 4).lineWidth(0.5).strokeColor("#000000").stroke();
    doc.circle(x, y, radius - 8).lineWidth(1).dash(2, { space: 2 }).strokeColor("#000000").stroke();
    doc.undash();

    // Curved Brand Name
    drawCurvedText(doc, "\u00A9LIMITLESS TECHNOLOGIES", x, y, radius - 13, -Math.PI / 2);

    // Inner text label
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(7)
        .text("TEN", x - 10, y - 3, { width: 20, align: "center" });

    doc.restore();
}

/**
 * Draws the star-medal badge.
 */
function drawStarMedal(doc, x, y, radius = 25) {
    doc.save();
    // Ribbon tails
    doc.fillColor("#D4AF37");
    doc.beginPath();
    doc.moveTo(x - 8, y);
    doc.lineTo(x - 14, y + 35);
    doc.lineTo(x - 5, y + 30);
    doc.lineTo(x, y);
    doc.closePath();
    doc.fill();

    doc.beginPath();
    doc.moveTo(x, y);
    doc.lineTo(x + 5, y + 30);
    doc.lineTo(x + 14, y + 35);
    doc.lineTo(x + 8, y);
    doc.closePath();
    doc.fill();

    // Medal circles
    doc.circle(x, y, radius).fill("#D4AF37");
    doc.circle(x, y, radius - 2.5).lineWidth(1).strokeColor("#FFFFFF").stroke();

    // Draw 5-point star
    doc.save();
    doc.translate(x, y);
    doc.fillColor("#FFFFFF");
    doc.beginPath();
    const r_outer = radius * 0.55;
    const r_inner = radius * 0.22;
    for (let i = 0; i < 5; i++) {
        const angle_outer = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const angle_inner = ((i * 2 + 1) * Math.PI) / 5 - Math.PI / 2;
        doc.lineTo(r_outer * Math.cos(angle_outer), r_outer * Math.sin(angle_outer));
        doc.lineTo(r_inner * Math.cos(angle_inner), r_inner * Math.sin(angle_inner));
    }
    doc.closePath();
    doc.fill();
    doc.restore();
    doc.restore();
}

/**
 * Draws botanical leafy branches for the LOR decoration.
 */
function drawBotanicalDecoration(doc, x, y, scale = 1, mirror = false) {
    doc.save();
    doc.translate(x, y);
    if (mirror) doc.scale(-scale, scale); else doc.scale(scale, scale);

    // green leaf branch stem
    doc.strokeColor("#2D6A4F").lineWidth(1.5);
    doc.beginPath();
    doc.moveTo(0, 0);
    doc.quadraticCurveTo(20, 20, 45, 5);
    doc.stroke();

    // leaves
    doc.fillColor("#40916C");
    doc.beginPath();
    doc.ellipse(12, 10, 5, 2.5, Math.PI / 4).fill();
    doc.ellipse(22, 13, 6, 3, Math.PI / 6).fill();
    doc.ellipse(32, 10, 5, 2.5, 0).fill();

    // small gold flowers
    doc.fillColor("#E8B923");
    doc.circle(6, 2, 2.5).fill();
    doc.circle(26, 20, 2).fill();
    doc.restore();
}

/**
 * Draws the angled ribbon corner decoration for the Star Performer template.
 */
function drawAngledRibbonCorner(doc, W, H, corner = "top-left") {
    doc.save();
    const grad = doc.linearGradient(0, 0, 100, 100);
    grad.stop(0, "#8B5A2B").stop(1, "#B5651D");
    doc.fillColor(grad);

    doc.beginPath();
    if (corner === "top-left") {
        doc.moveTo(15, 80);
        doc.lineTo(80, 15);
        doc.lineTo(110, 15);
        doc.lineTo(15, 110);
    } else if (corner === "top-right") {
        doc.moveTo(W - 15, 80);
        doc.lineTo(W - 80, 15);
        doc.lineTo(W - 110, 15);
        doc.lineTo(W - 15, 110);
    } else if (corner === "bottom-left") {
        doc.moveTo(15, H - 80);
        doc.lineTo(80, H - 15);
        doc.lineTo(110, H - 15);
        doc.lineTo(15, H - 110);
    } else if (corner === "bottom-right") {
        doc.moveTo(W - 15, H - 80);
        doc.lineTo(W - 80, H - 15);
        doc.lineTo(W - 110, H - 15);
        doc.lineTo(W - 15, H - 110);
    }
    doc.closePath();
    doc.fill();
    doc.restore();
}

/**
 * Draws a rosette ribbon medal graphic.
 */
function drawRosetteMedal(doc, x, y, radius = 35) {
    doc.save();
    // Ribbon tails
    doc.fillColor("#D4AF37");
    doc.beginPath();
    doc.moveTo(x - 12, y);
    doc.lineTo(x - 22, y + 55);
    doc.lineTo(x - 8, y + 45);
    doc.lineTo(x, y);
    doc.closePath();
    doc.fill();

    doc.beginPath();
    doc.moveTo(x, y);
    doc.lineTo(x + 8, y + 45);
    doc.lineTo(x + 22, y + 55);
    doc.lineTo(x + 12, y);
    doc.closePath();
    doc.fill();

    // Multi-petal starburst
    doc.fillColor("#D4AF37");
    for (let angle = 0; angle < Math.PI; angle += Math.PI / 8) {
        doc.save();
        doc.translate(x, y);
        doc.rotate(angle);
        doc.rect(-radius, -radius, radius * 2, radius * 2).fill();
        doc.restore();
    }

    // Embed circular seal
    drawCircularSeal(doc, x, y, radius * 0.82);
    doc.restore();
}

/**
 * Dynamic pronoun extraction helper.
 */
function getPronouns(gender) {
    const g = String(gender || "").toLowerCase();
    if (g === "female" || g === "she" || g === "her") {
        return {
            subject: "she",
            object: "her",
            possessive: "her",
            possessivePronoun: "hers",
            genderNoun: "female"
        };
    } else if (g === "male" || g === "he" || g === "him") {
        return {
            subject: "he",
            object: "him",
            possessive: "his",
            possessivePronoun: "his",
            genderNoun: "male"
        };
    } else {
        return {
            subject: "they",
            object: "them",
            possessive: "their",
            possessivePronoun: "theirs",
            genderNoun: "individual"
        };
    }
}

function todayFormatted() {
    return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

module.exports = {
    COLORS,
    A4_WIDTH,
    A4_HEIGHT,
    ensureFonts,
    registerFonts,
    drawLogo,
    drawCircularSeal,
    drawStarMedal,
    drawBotanicalDecoration,
    drawAngledRibbonCorner,
    drawRosetteMedal,
    getPronouns,
    todayFormatted
};
