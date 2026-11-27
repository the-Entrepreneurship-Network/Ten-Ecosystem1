'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { replaceStoredFile } = require('../../utils/replaceStoredFile');

describe('replaceStoredFile (document re-upload)', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('keeps the new upload when it was saved over the old path', () => {
    const p = path.join(dir, 'stu_address_proof.pdf');
    fs.writeFileSync(p, 'new upload');
    replaceStoredFile(p, p);
    expect(fs.readFileSync(p, 'utf8')).toBe('new upload');
  });

  it('removes the old file when the new one has a different path', () => {
    const oldP = path.join(dir, 'old.pdf');
    const newP = path.join(dir, 'new.pdf');
    fs.writeFileSync(oldP, 'old');
    fs.writeFileSync(newP, 'new');
    replaceStoredFile(oldP, newP);
    expect(fs.existsSync(oldP)).toBe(false);
    expect(fs.existsSync(newP)).toBe(true);
  });

  it('does nothing when there was no old file', () => {
    expect(() => replaceStoredFile(null, path.join(dir, 'x.pdf'))).not.toThrow();
  });

  it('is what both upload handlers use', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/v2/documents.js'), 'utf8');
    expect((src.match(/replaceStoredFile\(doc\.(addressProofUrl|marksheetUrl), req\.file\.path\)/g) || []).length).toBe(2);
    expect(src).not.toMatch(/fs\.unlinkSync\(doc\.(addressProofUrl|marksheetUrl)\)/);
  });
});
