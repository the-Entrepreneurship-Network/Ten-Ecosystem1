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
    fellowship: "TEN-FEL"
  };
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefixes[type] || "TEN-DOC"}-${year}-${random}`;
}

function normalizeDocumentNumber(value) {
  return String(value || "").trim().toUpperCase();
}

module.exports = { generateDocumentNumber, normalizeDocumentNumber };
