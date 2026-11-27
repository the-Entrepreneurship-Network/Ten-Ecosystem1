'use strict';

/**
 * The text of an uploaded PDF, as the resume and job agents read it.
 *
 * pdf-parse's bundled pdf.js refuses some files early in a process ("bad
 * XRef entry") and reads the very same bytes a call or two later. Seen with
 * PDFs that pdfkit writes — the ones this portal itself renders — so a student
 * uploading their own downloaded resume just after a restart was told it could
 * not be read. Every pdf.js build pdf-parse ships behaves the same; the most
 * failures seen in a row was two. ponytail: three tries; replace pdf-parse
 * if a file ever needs more. A LinkedIn profile saved as a PDF is then read
 * as a resume.
 */
async function pdfText(buffer) {
    const pdfParse = require('pdf-parse');
    let out;
    for (let attempt = 1; !out; attempt += 1) {
        try {
            out = await pdfParse(buffer);
        } catch (e) {
            if (attempt >= 3) throw e;
        }
    }
    return require('./linkedinPdf').toResume(out.text || '');
}

module.exports = { pdfText };
