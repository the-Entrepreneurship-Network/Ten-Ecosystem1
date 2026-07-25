"use strict";

const crypto = require("crypto");

const PREFIX = {
    offer_letter: "TEN-OL",
    lor:          "TEN-LOR",
    expert:       "TEN-EXP",
    nano_degree:  "TEN-ND",
    fellowship:   "TEN-FEL"
};

const RANDOM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function _random6() {
    const bytes = crypto.randomBytes(6);
    let out = "";
    for (let i = 0; i < 6; i++) out += RANDOM_CHARS[bytes[i] % RANDOM_CHARS.length];
    return out;
}

function normalizeDocumentNumber(v) {
    return String(v || "").trim().toUpperCase();
}

function generateDocumentNumber(type) {
    const p = PREFIX[type];
    if (!p) return "";
    const year = new Date().getFullYear();
    return `${p}-${year}-${_random6()}`;
}

function docTypeKeyFromLabel(label) {
    const x = String(label || "").trim().toLowerCase();
    if (!x) return null;
    if (x.includes("offer")) return "offer_letter";
    if (x === "lor" || x.includes("recommendation")) return "lor";
    if (x.includes("expert")) return "expert";
    if (x.includes("nano")) return "nano_degree";
    if (x.includes("fellow")) return "fellowship";
    return null;
}

module.exports = {
    PREFIX,
    generateDocumentNumber,
    normalizeDocumentNumber,
    docTypeKeyFromLabel
};

