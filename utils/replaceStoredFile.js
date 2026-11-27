"use strict";

const fs   = require("fs");
const path = require("path");

/**
 * Delete the file a record used to point at, now that `newPath` replaces it.
 *
 * Uploads are saved under a fixed name per student and document type, so a
 * re-upload usually lands on the SAME path as the old file. Deleting the old
 * path then deleted the file that had just been uploaded. Only remove the old
 * file when it is a different file.
 */
function replaceStoredFile(oldPath, newPath) {
    if (!oldPath) return;
    if (newPath && path.resolve(oldPath) === path.resolve(newPath)) return;
    try {
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (_) {}
}

module.exports = { replaceStoredFile };
