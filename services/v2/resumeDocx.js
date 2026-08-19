'use strict';

/**
 * @fileoverview The resume as a .docx — the format Workday and Taleo parse
 * most reliably.
 *
 * The ats-resume skill says it outright: "DOCX preferred; text-based PDF if
 * asked", and several of the referenced builders ship Word first for the same
 * reason. A PDF is a layout description that a parser has to reverse-engineer;
 * a .docx is already a stream of paragraphs with styles attached, so the
 * reading order it hands over is the one that was written.
 *
 * Everything the PDF renderer refuses, this refuses too: one column, real
 * paragraphs, no tables, no text boxes, no images, standard headings, contact
 * details in the body. A .docx that used a two-column table would parse worse
 * than the PDF it replaced.
 */

const HEADINGS = new Set(['SUMMARY', 'SKILLS', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS']);

/**
 * Build the document. Kept structural rather than decorative: size and weight
 * carry the hierarchy, because a parser reads the text and a recruiter reads
 * the shape, and neither needs colour to do it.
 */
function buildDoc(text) {
  const { Document, Paragraph, TextRun, AlignmentType } = require('docx');
  const lines = String(text || '').split(/\r?\n/);
  const children = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();

    if (!line) { children.push(new Paragraph({ spacing: { after: 80 } })); return; }

    /* The name. The only line set large, and the first thing a parser reads. */
    if (i === 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: line, bold: true, size: 40 })],
        spacing: { after: 40 },
      }));
      return;
    }
    /* Target role, then the contact line — both plain text in the body, never
       a header or footer, which is where parsers stop looking. */
    if (i === 1) {
      children.push(new Paragraph({
        children: [new TextRun({ text: line, size: 23 })], spacing: { after: 30 },
      }));
      return;
    }
    if (i === 2) {
      children.push(new Paragraph({
        children: [new TextRun({ text: line, size: 19 })], spacing: { after: 140 },
      }));
      return;
    }

    if (HEADINGS.has(line)) {
      children.push(new Paragraph({
        children: [new TextRun({ text: line, bold: true, size: 22 })],
        spacing: { before: 200, after: 80 },
        /* A real bottom border, not a row of dashes — typed dashes would land
           in the extracted text and read as noise to the parser. */
        border: { bottom: { color: '999999', size: 6, style: 'single', space: 1 } },
      }));
      return;
    }

    if (/^[-*•]\s+/.test(line)) {
      children.push(new Paragraph({
        children: [new TextRun({ text: line.replace(/^[-*•]\s+/, ''), size: 20 })],
        bullet: { level: 0 },
        spacing: { after: 40 },
      }));
      return;
    }

    children.push(new Paragraph({
      children: [new TextRun({ text: line, size: 20 })], spacing: { after: 60 },
    }));
  });

  return new Document({
    /* One section, one column, generous margins: the shape every ATS expects. */
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children,
    }],
    styles: { default: { document: { run: { font: 'Calibri' } } } },
  });
}

/** The finished .docx as a Buffer, so it can be scored before it is sent. */
async function resumeDocxBuffer(text) {
  const { Packer } = require('docx');
  return Packer.toBuffer(buildDoc(text));
}

module.exports = { resumeDocxBuffer, buildDoc };
