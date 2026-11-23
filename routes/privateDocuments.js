"use strict";

/**
 * What students and applicants upload to uploads/documents, for HR and admins.
 *
 * Address proofs, marksheets and resumes. Since #263 the /uploads guard in
 * server.js answers 404 for this folder, which is right — the names are a
 * student's database id plus a fixed suffix, a guess away for anyone — but
 * every link HR has to these files points into it, so HR could no longer
 * check a single submission. This serves the same URLs to a signed-in HR or
 * admin session and to nobody else, so no link anywhere has to change.
 */
const path = require("path");
const router = require("express").Router();
const { requireHR } = require("../middleware/sessionAuth");

const DIR = path.join(__dirname, "..", "uploads", "documents");

// Only types a browser shows without running anything. An .svg or .html in
// this folder would execute as this site, in front of a signed-in HR user.
const SAFE_NAME = /^[\w.-]+\.(pdf|png|jpe?g|webp)$/i;

router.get("/:name", requireHR, (req, res) => {
    const name = path.basename(req.params.name);
    if (!SAFE_NAME.test(name)) return res.status(404).end();
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.sendFile(name, { root: DIR }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
    });
});

module.exports = router;
