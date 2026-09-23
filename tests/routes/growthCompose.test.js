'use strict';

/**
 * Templates, preview, and hand-picked audiences.
 *
 * The templates are exercised for real — they are plain data. The wiring is
 * checked against source, because the properties that matter are ones that
 * fail silently: a preview that signs a working unsubscribe link, a picked
 * list that skips the opt-out filter, a sender still using the old greeting.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/* Comments describe intent; they must never satisfy an assertion about code. */
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const FILES = [
  'config/growthTemplates.js', 'utils/studentName.js',
  'services/growthSegments.js', 'services/growthSender.js',
  'routes/growth.js', 'models/Student.js', 'models/GrowthCampaign.js', 'server.js'
];

describe('every touched file parses', () => {
  FILES.forEach((f) => {
    test(f, () => {
      // Braces matter: an arrow returning execFileSync's Buffer makes Jest
      // reject the test outright with "can only return Promise or undefined".
      execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
    });
  });
});

// ─── templates, for real ─────────────────────────────────────────────────────

const { TEMPLATES, byKey } = require('../../config/growthTemplates');

describe('the templates are usable as they stand', () => {
  test('there is more than one', () => expect(TEMPLATES.length).toBeGreaterThan(1));

  test.each(TEMPLATES.map((t) => [t.key, t]))('%s is complete', (key, t) => {
    ['label', 'description', 'subject', 'heading', 'bodyText', 'ctaLabel', 'ctaPath', 'suggestedSegment']
      .forEach((field) => expect(typeof t[field]).toBe('string'));
    expect(t.bodyText.length).toBeGreaterThan(80);
    expect(t.subject.length).toBeLessThanOrEqual(120);
  });

  test('keys are unique, or the picker silently loads the wrong one', () => {
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length);
  });

  test('every ctaPath is relative, so no template hard-codes a domain', () => {
    TEMPLATES.forEach((t) => {
      expect(t.ctaPath.startsWith('/')).toBe(true);
      expect(t.ctaPath).not.toMatch(/^https?:/);
    });
  });

  test('every suggestedSegment is a segment that exists', () => {
    // growthSegments pulls in the Student model, so its keys are read from
    // source rather than by requiring it.
    const block = code('services/growthSegments.js');
    const decl = block.slice(block.indexOf('const SEGMENTS = {'), block.indexOf('function isSegment'));
    const keys = [...decl.matchAll(/^\s{4}(\w+):\s*\{/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(2);
    TEMPLATES.forEach((t) => expect(keys).toContain(t.suggestedSegment));
  });

  test('bodies use blank lines, which is what the sender splits on', () => {
    TEMPLATES.forEach((t) => expect(t.bodyText).toContain('\n\n'));
  });

  test('byKey finds one and refuses an unknown', () => {
    expect(byKey(TEMPLATES[0].key)).toBe(TEMPLATES[0]);
    expect(byKey('nope')).toBeNull();
  });
});

// ─── the wiring ──────────────────────────────────────────────────────────────

describe('the preview cannot act on a real student', () => {
  const src = code('routes/growth.js');
  const route = src.slice(src.indexOf("api.post('/preview'"), src.indexOf("api.get('/students'"));

  test('buildHtml is handed a placeholder id, never the sampled one', () => {
    // buildHtml signs the unsubscribe and click links with the id it is given.
    // A real id here is a working "remove me" link for somebody who never
    // asked, one mis-click away inside the admin's own preview pane.
    // Pin the CONSTRUCTION, not just the presence of the string. An earlier
    // version of this test only checked that 'preview' appeared somewhere in
    // the route, and passed while `const student = real` handed buildHtml a
    // real id — exactly the bug it was written to prevent.
    expect(route).toMatch(/const student = \{\s*_id:\s*'preview'/);
    expect(route).not.toMatch(/const student = (real|sample)\s*;/);
  });

  test('it writes nothing and sends nothing', () => {
    expect(route).not.toMatch(/\.create\(|\.save\(|sendMail|sender\.run/);
  });

  test('it renders through the sender, so it cannot drift from what is sent', () => {
    expect(route).toContain('sender.buildHtml');
  });

  test('it survives a database that does not answer', () => {
    expect(route).toMatch(/catch\s*\(_\)/);
  });
});

describe('a hand-picked audience still honours the opt-out', () => {
  const src = code('services/growthSegments.js');

  test('recipientsByIds spreads baseFilter alongside the ids', () => {
    const fn = src.slice(src.indexOf('async function recipientsByIds'));
    expect(fn.slice(0, 500)).toMatch(/\.\.\.baseFilter\(\)/);
  });

  test('the search does too, so an opted-out student cannot even be found', () => {
    const fn = src.slice(src.indexOf('async function searchStudents'));
    expect(fn.slice(0, 400)).toMatch(/\.\.\.baseFilter\(\)/);
  });

  test('the search term is escaped before becoming a RegExp', () => {
    const fn = src.slice(src.indexOf('async function searchStudents'));
    expect(fn).toMatch(/replace\(\/\[\.\*\+\?/);
  });

  test("'picked' is not a segment, so it can never run as a query", () => {
    const src = code('services/growthSegments.js');
    expect(src).toMatch(/const PICKED = 'picked';/);
    // isSegment only answers true for an own property of SEGMENTS, and the
    // sentinel is declared outside that object.
    const decl = src.slice(src.indexOf('const SEGMENTS = {'), src.indexOf('function isSegment'));
    expect(decl).not.toContain('picked:');
  });

  test('the sender resolves the audience through the campaign', () => {
    expect(code('services/growthSender.js')).toContain('recipientsForCampaign');
  });

  test('preflight counts a picked list instead of throwing on it', () => {
    const src2 = code('routes/growth.js');
    const pre = src2.slice(src2.indexOf("api.get('/campaigns/:id/preflight'"));
    expect(pre.slice(0, 700)).toContain('recipientsByIds');
  });

  test('an empty tick list is refused rather than saved as a draft to nobody', () => {
    const src2 = code('routes/growth.js');
    const create = src2.slice(src2.indexOf("api.post('/campaigns'"), src2.indexOf("api.get('/campaigns/:id/preflight'"));
    expect(create).toMatch(/picked && !ids\.length/);
  });
});

describe('both senders use the one greeting rule', () => {
  test('the campaign sender imports it', () => {
    expect(code('services/growthSender.js')).toMatch(/greetingNameFor.*require\('\.\.\/utils\/studentName'\)/);
  });

  test('the Monday cron uses it too', () => {
    expect(code('server.js')).toMatch(/const studentName = greetingNameFor\(student\)/);
  });

  test('neither greets with the literal word "Intern" any more', () => {
    const sender = code('services/growthSender.js');
    expect(sender).not.toMatch(/\|\| 'Intern'/);
  });

  test('MailHistory still gets a usable label when the greeting is dropped', () => {
    // An empty greeting is right in the mail and wrong in an admin table.
    expect(code('services/growthSender.js')).toContain('logNameOf');
    expect(code('server.js')).toMatch(/recipientName: studentName \|\|/);
  });

  test('Student.js re-exports the moved helpers, so old callers still work', () => {
    const src = code('models/Student.js');
    expect(src).toMatch(/require\("\.\.\/utils\/studentName"\)/);
    expect(src).toContain('module.exports.deriveStudentName = deriveStudentName');
    expect(src).toContain('module.exports.isUsableName = isUsableName');
  });
});

describe('the dashboard wires the three new pieces', () => {
  const html = read('public/growth-os.html');

  test.each([
    ['tplPick', 'template picker'],
    ['previewFrame', 'preview pane'],
    ['pickWrap', 'student list'],
    ['pickQ', 'student search']
  ])('%s exists (%s)', (id) => expect(html).toContain('id="' + id + '"'));

  test('the save request carries the ticked ids', () => {
    expect(html).toMatch(/studentIds: Array\.from\(state\.picked\)/);
  });

  test('choosing a segment clears the ticked list', () => {
    // Otherwise ticking one more student silently flips the campaign back to
    // the hand-picked audience without the sender noticing.
    const at = html.indexOf("el.addEventListener('click'");
    expect(html.slice(at, at + 600)).toContain('state.picked.clear()');
  });
});
