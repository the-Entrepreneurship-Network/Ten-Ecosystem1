'use strict';

/**
 * "Your message did not send. Check your connection and try again."
 *
 * That alert was reported from the live portal, on a conversation whose history
 * had just loaded on the same screen. It was not a connection problem, and no
 * amount of retrying would ever have fixed it.
 *
 * Sending goes over the Socket.IO channel, and the handshake used to resolve
 * identity from `socket.handshake.auth` — a role plus an employee ID or
 * username, supplied by the caller. public/messages.html connects with
 * `io({ withCredentials: true })` and sends no such claim, so every connection
 * from that page was refused. History loaded because it comes over REST;
 * sending had never once worked there.
 *
 * The same handshake was also not authentication. It merely LOOKED UP whatever
 * the caller named, so a socket opened as
 * `{ role: 'student', employeeId: 'TEN/AI/1663' }` was accepted as that
 * student, with no password and no session — and employee IDs are sequential
 * and printed on offer letters and certificates. Two REST endpoints took
 * identity from the request body in exactly the same way.
 *
 * These pin the fix at the source, so a future edit cannot quietly reintroduce
 * either half.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const messagesPage = fs.readFileSync(path.join(__dirname, '../../public/messages.html'), 'utf8');
const chatWidget = fs.readFileSync(path.join(__dirname, '../../public/chat-widget.js'), 'utf8');

/** Lift a function body out of server.js, which cannot be required in a test. */
function lift(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server.js`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

const chatIdentity = require('../../services/chatIdentity');

/**
 * Rebuild chatIdentityFromSocket against fakes we control.
 *
 * `session` is what the cookie resolves to; `student`/`coordinator` are what
 * the database would return for the domain refresh.
 */
function build({ cookie = 'ten.sid=abc', session = null, student = null, coordinator = null } = {}) {
  const sessionMiddleware = (req, _res, next) => { req.session = session; next(); };
  const Student = { findOne: () => ({ select: () => ({ lean: async () => student }) }) };
  const Coordinator = { findOne: () => ({ select: () => ({ lean: async () => coordinator }) }) };

  // eslint-disable-next-line no-new-func
  const make = new Function('sessionMiddleware', 'chatIdentity', 'Student', 'Coordinator', `
    ${lift('chatIdentityFromSocket')}
    return chatIdentityFromSocket;
  `);
  const fn = make(sessionMiddleware, chatIdentity, Student, Coordinator);
  const socket = { request: cookie ? { headers: { cookie } } : { headers: {} } };
  return fn(socket);
}

describe('a socket is admitted on its session cookie alone — the reported bug', () => {
  it('admits a student who sent no auth claim at all', async () => {
    // This is exactly what /messages does, and what used to be refused.
    const me = await build({ session: { student: { employeeId: 'TEN/AI/1663', name: 'Anmol', domain: 'AI' } } });
    expect(me).not.toBeNull();
    expect(me.role).toBe('student');
    expect(me.id).toBe('TEN/AI/1663');
  });

  it('admits HR, coordinators and admins the same way', async () => {
    const hr = await build({ session: { hr: { username: 'hrdirector', email: 'hr.director@ten.com', name: 'Priya' } } });
    expect(hr.role).toBe('hr');
    expect(hr.id).toBe('hr.director@ten.com');

    const coord = await build({ session: { coordinator: { username: 'web_admin', domain: 'Web Development' } } });
    expect(coord.role).toBe('coordinator');

    const admin = await build({ session: { adminUser: { username: 'tenadmin' } } });
    expect(admin.role).toBe('admin');
  });

  it('refuses a socket with no session', async () => {
    expect(await build({ session: {} })).toBeNull();
    expect(await build({ session: null })).toBeNull();
  });

  it('refuses a socket carrying no cookie at all', async () => {
    expect(await build({ cookie: '', session: { student: { employeeId: 'TEN/AI/1663' } } })).toBeNull();
  });

  it('refreshes the domain from the record, not the sign-in snapshot', async () => {
    // The domain decides which domain room this person is auto-joined to. A
    // student moved since they signed in would otherwise stay in the old room.
    const me = await build({
      session: { student: { employeeId: 'TEN/AI/1663', name: 'Anmol', domain: 'Web Development' } },
      student: { domain: 'Artificial Intelligence' }
    });
    expect(me.domain).toBe('Artificial Intelligence');
  });

  it('keeps the session copy when the record cannot be read', async () => {
    const me = await build({
      session: { student: { employeeId: 'TEN/AI/1663', domain: 'Web Development' } },
      student: null
    });
    expect(me.domain).toBe('Web Development');
  });
});

describe('the claim is no longer trusted anywhere', () => {
  it('the handshake does not read socket.handshake.auth', () => {
    // Reading it is the bypass: it names a person, it does not prove one.
    const at = source.indexOf('io.use(async (socket, next)');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 1200);
    expect(block).toContain('chatIdentityFromSocket(socket)');
    expect(block).not.toMatch(/verifyChatIdentity\s*\(/);
    expect(block).not.toMatch(/handshake\.auth\s*\|\|/);
  });

  it('verifyChatIdentity is gone from the file entirely', () => {
    expect(source).not.toMatch(/^async function verifyChatIdentity\(/m);
    expect(source).not.toMatch(/await verifyChatIdentity\(/);
  });

  it('deleting a message reads the session, not the request body', () => {
    const at = source.indexOf('app.delete("/chat/messages/:messageId"');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 900);
    expect(block).toContain('chatIdentityFromSession(req)');
    expect(block).not.toMatch(/req\.body\s*&&\s*req\.body\.role/);
  });

  it('blocking somebody reads the session, not the request body', () => {
    const at = source.indexOf('function _identityFromAuth(');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 400);
    expect(block).toContain('chatIdentityFromSession(req)');
    expect(block).not.toMatch(/body\s*&&\s*body\.role/);
  });
});

describe('every role that can send is a role the schema accepts', () => {
  // Admin sockets started connecting when identity moved to the session — and
  // then every admin message died in schema validation, surfacing as a generic
  // "The message could not be sent. Please try again." with the real reason
  // only in the server log.
  const Message = require('../../models/Message');

  it.each(['student', 'coordinator', 'hr', 'admin'])('accepts a message from %s', (role) => {
    const err = new Message({
      chatRoom: 'dm::TEN/AI/1663::hr.director@ten.com',
      senderId: 'someone', senderName: 'Someone', senderRole: role, message: 'hi'
    }).validateSync();
    expect(err).toBeUndefined();
  });

  it('still rejects a role nobody has', () => {
    const err = new Message({
      chatRoom: 'general', senderId: 'x', senderName: 'X', senderRole: 'wizard', message: 'hi'
    }).validateSync();
    expect(err).toBeDefined();
  });

  it('reports a validation failure as itself, not as a server error', () => {
    // Otherwise the next schema mismatch is another silent week.
    expect(source).toContain("e.name === \"ValidationError\"");
    expect(source).toContain('code: "invalid"');
  });
});

describe('sending survives a network that has no socket', () => {
  it('the server accepts a message over plain HTTP', () => {
    const at = source.indexOf('app.post("/chat/messages"');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 1400);
    expect(block).toContain('chatIdentityFromSession(req)');
    expect(block).toContain('deliverChatMessage');
    // Signed out is a 401, not a silent failure.
    expect(block).toContain('status(401)');
  });

  it('both paths run the same delivery code, so they cannot drift', () => {
    // One implementation of the permission check, the block check, the
    // fan-out and the push notification.
    expect(source).toMatch(/async function deliverChatMessage\(identity, payload\)/);
    const socketAt = source.indexOf('socket.on("send_message"');
    const block = source.slice(socketAt, socketAt + 400);
    expect(block).toContain('deliverChatMessage(identity, payload');
  });

  it('the messages page falls back to HTTP instead of blaming the connection', () => {
    expect(messagesPage).toContain('function deliver(');
    expect(messagesPage).toContain('post("/chat/messages"');
    // The old code gave up here with advice that could not help.
    expect(messagesPage).not.toContain('Your message did not send. Check your connection and try again.');
  });

  it('the messages page does not refuse to send just because the socket is missing', () => {
    // `if (!text || !current || !socket) return;` swallowed the click entirely.
    expect(messagesPage).not.toMatch(/if \(!text \|\| !current \|\| !socket\) return;/);
  });

  it('the chat widget falls back the same way', () => {
    expect(chatWidget).toContain('function sendOverHttp(');
    expect(chatWidget).toContain('"/chat/messages"');
  });

  it('the page says so when live updates are unavailable', () => {
    // Sending works, but replies will not arrive on their own, and silently
    // not updating is worse than saying so.
    expect(messagesPage).toContain('function liveNotice(');
    expect(messagesPage).toContain('connect_error');
  });

  it('a message drawn locally is not drawn again by the socket echo', () => {
    expect(messagesPage).toContain('data-mid');
  });
});
