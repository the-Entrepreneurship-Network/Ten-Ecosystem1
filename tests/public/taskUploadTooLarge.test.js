'use strict';

/*
 * public/student-dashboard.html: when /submit-task answers 413 with a body
 * that is not JSON, the web server in front of the portal refused the upload
 * for its own, lower, limit. The message must not claim the files are over
 * 25MB, since students with small files were told exactly that.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../public/student-dashboard.html'), 'utf8');

test('a non-JSON 413 on task submission does not blame a 25MB limit', () => {
    const start = html.indexOf('fetch("/submit-task"');
    expect(start).toBeGreaterThan(-1);
    const block = html.slice(start, html.indexOf('if(response.ok && data.success)', start));
    expect(block).toContain('response.status === 413');
    expect(block).not.toMatch(/25\s*MB/i);
    expect(block).toMatch(/Google Drive/);
});
