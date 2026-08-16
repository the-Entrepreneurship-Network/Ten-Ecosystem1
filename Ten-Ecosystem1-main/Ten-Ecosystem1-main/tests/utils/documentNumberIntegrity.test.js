'use strict';

/**
 * The verification bug: the number printed on a certificate PDF and the number
 * stored in DocumentHistory were generated independently, so they never
 * matched and every lookup came back "Unverified Document".
 *
 * Three separate shapes of the same mistake:
 *   - buildCertPDF passed no documentNumber, so the PDF templates printed a
 *     random "TEN/CT/xxxxx" fallback that existed nowhere but on the paper;
 *   - generateAndSaveCert logged a number derived from the employee ID;
 *   - the completion cron logged a number minted at logging time, after the
 *     PDF was already rendered with a different one.
 */

const fs = require('fs');
const path = require('path');

const { generateDocumentNumber, normalizeDocumentNumber } = require('../../utils/documentNumber');
const { resolvePronouns } = require('../../services/v2/documentTextHelpers');

describe('generateDocumentNumber', () => {
  it.each([
    ['offer_letter', /^TEN-OL-\d{4}-[0-9A-F]{6}$/],
    ['lor',          /^TEN-LOR-\d{4}-[0-9A-F]{6}$/],
    ['loc',          /^TEN-LOC-\d{4}-[0-9A-F]{6}$/],
    ['star',         /^TEN-STAR-\d{4}-[0-9A-F]{6}$/],
    ['lop',          /^TEN-LOP-\d{4}-[0-9A-F]{6}$/]
  ])('mints a typed number for %p', (type, shape) => {
    expect(generateDocumentNumber(type)).toMatch(shape);
  });

  it('star and promotion certificates no longer fall back to TEN-DOC', () => {
    // Before the star/lop prefixes existed, these certificate types minted
    // generic TEN-DOC numbers that said nothing about what they identified.
    expect(generateDocumentNumber('star')).not.toMatch(/^TEN-DOC/);
    expect(generateDocumentNumber('lop')).not.toMatch(/^TEN-DOC/);
  });
});

describe('normalizeDocumentNumber', () => {
  it('collapses the slashed form printed on older certificates', () => {
    expect(normalizeDocumentNumber('TEN/LOR/2026/AB12CD')).toBe('TEN-LOR-2026-AB12CD');
  });

  it('uppercases and trims what a verifier types', () => {
    expect(normalizeDocumentNumber('  ten-lor-2026-ab12cd ')).toBe('TEN-LOR-2026-AB12CD');
  });

  it('treats slashed and dashed input as the same number', () => {
    expect(normalizeDocumentNumber('TEN/OL/2026/FF00AA'))
      .toBe(normalizeDocumentNumber('ten-ol-2026-ff00aa'));
  });

  it('is idempotent — normalizing a stored value changes nothing', () => {
    const once = normalizeDocumentNumber('TEN/CT/19961');
    expect(normalizeDocumentNumber(once)).toBe(once);
  });

  it('collapses doubled separators and stray spaces', () => {
    expect(normalizeDocumentNumber('TEN--LOR  2026 - AB12CD')).toBe('TEN-LOR-2026-AB12CD');
  });
});

describe('resolvePronouns verb agreement', () => {
  // "Test-user worked within our department, they has excellent communication
  // skills" went out on real, employer-facing letters. The neutral fallback
  // must carry its own verb forms.
  it('neutral: they have / they are', () => {
    const p = resolvePronouns('');
    expect(`${p.subject} ${p.has}`).toBe('they have');
    expect(`${p.subject} ${p.is}`).toBe('they are');
  });

  it('male: he has / he is', () => {
    const p = resolvePronouns('male');
    expect(`${p.subject} ${p.has}`).toBe('he has');
    expect(`${p.subject} ${p.is}`).toBe('he is');
  });

  it('female: she has / she is', () => {
    const p = resolvePronouns('female');
    expect(`${p.subject} ${p.has}`).toBe('she has');
    expect(`${p.subject} ${p.is}`).toBe('she is');
  });
});

describe('one number flows from PDF to verification record', () => {
  const certSource = fs.readFileSync(path.join(__dirname, '../../routes/v2/certificates.js'), 'utf8');
  const cronSource = fs.readFileSync(path.join(__dirname, '../../services/automationCron.js'), 'utf8');

  it('buildCertPDF generates the number and embeds it in the PDF data', () => {
    const fn = certSource.slice(certSource.indexOf('async function buildCertPDF'));
    expect(fn).toMatch(/mapData\.documentNumber = documentNumber/);
    expect(fn).toMatch(/return \{ pdfBuffer, documentNumber \}/);
  });

  it('generateAndSaveCert stores that same number, not a derived one', () => {
    const fn = certSource.slice(certSource.indexOf('async function generateAndSaveCert'));
    expect(fn).toMatch(/const \{ pdfBuffer, documentNumber \} = await buildCertPDF/);
    expect(fn).toMatch(/const docNumber = documentNumber/);
    // The old derived form must be gone.
    expect(fn).not.toMatch(/TEN-\$\{certType\}-\$\{student\.employeeId/);
  });

  it('the completion cron passes each number into its PDF before logging it', () => {
    // sentDocuments used to call generateDocumentNumber() inline, minting a
    // second number the PDF had never seen.
    expect(cronSource).not.toMatch(/documentNumber: generateDocumentNumber\("loc"\)/);
    expect(cronSource).not.toMatch(/documentNumber: generateDocumentNumber\("lor"\)/);
    expect(cronSource).not.toMatch(/documentNumber: generateDocumentNumber\("star"\)/);
    expect(cronSource).toMatch(/documentNumber: locNumber/);
    expect(cronSource).toMatch(/documentNumber: lorNumber/);
    expect(cronSource).toMatch(/documentNumber: starNumber/);
  });

  it('the cron hands each pre-minted number to its PDF generator', () => {
    expect(cronSource).toMatch(/generateLOCPDF\(student, stats, locPath, locNumber\)/);
    expect(cronSource).toMatch(/generateLORPDF\(student, stats, lorPath, lorNumber\)/);
    // And the generators actually print it.
    expect(cronSource).toMatch(/async function generateLOCPDF\(student, stats, outputPath, documentNumber\)/);
    expect(cronSource).toMatch(/async function generateLORPDF\(student, stats, outputPath, documentNumber\)/);
  });
});
