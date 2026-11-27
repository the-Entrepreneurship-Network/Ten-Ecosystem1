'use strict';

/**
 * Messages → "Start a conversation" must find the roster's coordinators and HR.
 *
 * Most staff are roster accounts in server.js with no database record. The
 * directory searched only the database, so a student who looked for their
 * coordinator, or for HR, was told "Nobody matches."
 *
 * The real route handler runs here against stubbed models and a roster shaped
 * like the one server.js hands over.
 */
const chain = (rows) => {
  const q = { select: () => q, limit: () => q, lean: () => Promise.resolve(rows) };
  return q;
};
jest.mock('../../models/Student', () => ({ find: () => chain([]) }));
jest.mock('../../models/Coordinator', () => ({ find: () => chain([]) }));
jest.mock('../../models/HR', () => ({ find: () => chain([]) }));
jest.mock('../../models/Message', () => ({}));
jest.mock('../../models/UserBlock', () => ({ hiddenFor: async () => new Set() }));
jest.mock('../../models/ChatReport', () => ({}));
jest.mock('../../models/ChatRead', () => ({}));

const fs = require('fs');
const path = require('path');
const router = require('../../routes/chatModeration');

const ROSTER = [
  { id: 'web_admin', username: 'web_admin', role: 'coordinator', domain: 'Web Development', name: 'Web Development coordinator' },
  { id: 'ai_admin', username: 'ai_admin', role: 'coordinator', domain: 'Artificial Intelligence', name: 'Artificial Intelligence coordinator' },
  { id: 'srmanager@ten.com', username: 'srmanager@ten.com', role: 'hr', domain: '', name: 'Sr HR Manager' }
];
const student = { role: 'student', id: 'TEN/WEB/1001', aliases: ['TEN/WEB/1001'], domain: 'Web Development' };

async function directory(q, me = student) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/directory');
  const handlers = layer.route.stack.map((s) => s.handle);
  let body;
  await handlers[handlers.length - 1](
    { me, query: { q }, app: { get: (k) => (k === 'rosterStaff' ? ROSTER : undefined) } },
    { json: (b) => { body = b; }, status() { return this; } });
  return body;
}

test('a student searching "web" finds the Web Development coordinator', async () => {
  const d = await directory('web');
  expect(d.success).toBe(true);
  expect(d.people.map((p) => p.id)).toEqual(['web_admin']);
  expect(d.people[0]).toEqual({ id: 'web_admin', name: 'Web Development coordinator', role: 'coordinator', domain: 'Web Development' });
});

test('HR is found by name', async () => {
  expect((await directory('manager')).people.map((p) => p.id)).toEqual(['srmanager@ten.com']);
});

test('with no search, every roster account is offered, but not yourself', async () => {
  const coordinator = { role: 'coordinator', id: 'web_admin', aliases: ['web_admin'], domain: 'Web Development' };
  expect((await directory('')).people.filter((p) => p.role !== 'assistant').length).toBe(3);
  expect((await directory('', coordinator)).people.map((p) => p.id)).not.toContain('web_admin');
});

test('a student is offered the AI Coordinator first, labelled as an AI; staff are not', async () => {
  const people = (await directory('')).people;
  expect(people[0]).toEqual({ id: 'ten-ai', name: 'TEN AI Coordinator', role: 'assistant', domain: 'Web Development' });
  expect((await directory('ai')).people.map((p) => p.id)).toContain('ten-ai');
  expect((await directory('manager')).people.map((p) => p.id)).not.toContain('ten-ai');
  const coordinator = { role: 'coordinator', id: 'web_admin', aliases: ['web_admin'], domain: 'Web Development' };
  expect((await directory('', coordinator)).people.map((p) => p.id)).not.toContain('ten-ai');
});

test("the AI Coordinator's profile says it is an AI, not a person", async () => {
  const layer = router.stack.find((l) => l.route && l.route.path === '/profile/:userId');
  const handlers = layer.route.stack.map((s) => s.handle);
  let body;
  await handlers[handlers.length - 1](
    { params: { userId: 'ten-ai' }, me: student, app: { get: () => null } },
    { json: (b) => { body = b; }, status() { return this; } });
  expect(body.profile).toMatchObject({ id: 'ten-ai', name: 'TEN AI Coordinator', role: 'assistant', domain: 'Web Development' });
  expect(body.profile.about).toMatch(/not a person/);
});

test('server.js hands over ids, names and domains only, never password material', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const block = src.slice(src.indexOf("app.set('rosterStaff'"), src.indexOf(']);', src.indexOf("app.set('rosterStaff'")));
  expect(block).toMatch(/Object\.entries\(COORDINATORS\)/);
  expect(block).toMatch(/Object\.entries\(HR_ACCOUNTS\)/);
  expect(block).not.toMatch(/password/i);
});
