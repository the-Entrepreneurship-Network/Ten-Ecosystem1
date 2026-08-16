'use strict';

const path = require('path');

describe('Document Upload Format Validation', () => {
  const allowedExts = ['.pdf'];
  const allowedMimeTypes = ['application/pdf'];

  const testFiles = [
    { name: 'document.pdf', mimetype: 'application/pdf', valid: true },
    { name: 'image.png', mimetype: 'image/png', valid: false },
    { name: 'photo.jpg', mimetype: 'image/jpeg', valid: false },
    { name: 'graphic.svg', mimetype: 'image/svg+xml', valid: false },
    { name: 'picture.jpeg', mimetype: 'image/jpeg', valid: false }
  ];

  testFiles.forEach(file => {
    it(`should ${file.valid ? 'allow' : 'block'} file format: ${file.name}`, () => {
      const ext = path.extname(file.name).toLowerCase();
      const isAllowed = allowedExts.includes(ext) && allowedMimeTypes.includes(file.mimetype);
      expect(isAllowed).toBe(file.valid);
    });
  });
});
