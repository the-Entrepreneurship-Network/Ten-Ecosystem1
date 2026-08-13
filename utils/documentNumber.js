const crypto = require("crypto");

function generateDocumentNumber(type) {
  const prefixes = {
    offer_letter: "TEN-OL",
    offer: "TEN-OL",
    lor: "TEN-LOR",
    loc: "TEN-LOC",
    completion: "TEN-LOC",
    expert: "TEN-EXP",
    expert_certificate: "TEN-EXP",
    nano_degree: "TEN-ND",
    fellowship: "TEN-FEL",
    star: "TEN-STAR",
    star_performer: "TEN-STAR",
    lop: "TEN-LOP",
    promotion: "TEN-LOP"
  };
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefixes[type] || "TEN-DOC"}-${year}-${random}`;
}

/**
 * One canonical shape for a document number, applied on the way IN (before
 * storing) and on the way OUT (before looking one up).
 *
 * Verifiers type what is printed on their PDF, and printed numbers have
 * appeared in both slashed (TEN/OL/…) and dashed (TEN-OL-2026-…) forms over
 * the system's life. Uppercasing alone left "ten/lor/…" and "TEN-LOR-…"
 * unequal, so a legitimate certificate could fail verification purely on
 * which separator its template used. Slashes, spaces and repeated separators
 * all collapse to a single dash.
 */
function normalizeDocumentNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\/\s]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

module.exports = { generateDocumentNumber, normalizeDocumentNumber };
