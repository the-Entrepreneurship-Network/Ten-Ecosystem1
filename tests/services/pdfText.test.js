'use strict';

/**
 * An uploaded PDF's text. pdf-parse's bundled pdf.js refuses some files on its
 * first call in a process and reads the same bytes on the next, so a failure
 * is tried once more before the student is told the file cannot be read.
 */

jest.mock('pdf-parse', () => jest.fn());
const pdfParse = require('pdf-parse');
const { pdfText } = require('../../services/v2/pdfText');

beforeEach(() => pdfParse.mockReset());

it('reads a file that failed once', async () => {
    pdfParse.mockRejectedValueOnce(new Error('bad XRef entry')).mockResolvedValueOnce({ text: 'Priya Nair\nBackend developer' });
    expect(await pdfText(Buffer.from('%PDF'))).toBe('Priya Nair\nBackend developer');
    expect(pdfParse).toHaveBeenCalledTimes(2);
});

it('reads a file that failed twice, and gives up after three tries', async () => {
    pdfParse.mockRejectedValueOnce(new Error('bad XRef entry')).mockRejectedValueOnce(new Error('bad XRef entry'))
        .mockResolvedValueOnce({ text: 'read on the third try' });
    expect(await pdfText(Buffer.from('%PDF'))).toBe('read on the third try');
    pdfParse.mockReset().mockRejectedValue(new Error('bad XRef entry'));
    await expect(pdfText(Buffer.from('%PDF'))).rejects.toThrow('bad XRef entry');
    expect(pdfParse).toHaveBeenCalledTimes(3);
});

it('reads a LinkedIn export as a resume', async () => {
    pdfParse.mockResolvedValue({ text: ['Contact', 'www.linkedin.com/in/ravi-kumar (LinkedIn)', 'Top Skills', 'Go',
        'Ravi Kumar', 'Engineer', 'Pune', 'Experience', 'Acme', 'Engineer', 'January 2023 - Present (2 years)', 'Pune',
        'Built the invoicing service.', 'Page 1 of 1'].join('\n') });
    expect(await pdfText(Buffer.from('%PDF'))).toMatch(/^Ravi Kumar\nEngineer\nlinkedin\.com\/in\/ravi-kumar \| Pune\n[\s\S]*Engineer \| Acme \| January 2023 - Present/);
});
