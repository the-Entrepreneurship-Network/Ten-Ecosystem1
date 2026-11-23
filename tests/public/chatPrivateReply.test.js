'use strict';

/**
 * Replying to one intern from the HR chat.
 *
 * The server puts each socket in the shared rooms only, never in a private
 * conversation, so a chat window has to join its own room. The widget never
 * did: HR's private reply vanished from their screen on Send, and the intern's
 * answer never arrived. Separately, any tab click redrew the HR window's
 * messages against a stand-in object with no reply bar, so ↩ did nothing.
 *
 * Read from the source, like the other widget tests: the widget is a browser
 * script and this suite has no DOM.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const widget = fs.readFileSync(path.join(root, 'public/chat-widget.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

/** One top-level function of the widget, up to the next. */
function body(name) {
  const start = widget.indexOf('    function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const next = widget.slice(start + 1).search(/\n {4}function /);
  return next === -1 ? widget.slice(start) : widget.slice(start, start + 1 + next);
}

describe('a chat window hears its own room', () => {
  it('joins the room it opens', () => {
    expect(body('joinRoom')).toContain('socket.emit("join_room", { room: room })');
    expect(body('toggleChat')).toMatch(/createWindow\(room, label\);[^}]*joinRoom\(room\);/);
  });

  it('joins every open room again after a reconnect', () => {
    expect(body('connectSocket')).toContain(
      'socket.on("connect", function () { Object.keys(winsByRoom).forEach(joinRoom); });');
  });

  it('shows the sender their own message when it went over HTTP', () => {
    expect(body('sendOverHttp')).toContain('(win.el.dataset.currentRoom || win.room) === d.doc.chatRoom');
  });

  it('is let in only where the server allows', () => {
    // The page asks; the server decides. Naming someone else's conversation
    // gets nothing.
    expect(server).toMatch(/socket\.on\("join_room"[\s\S]{0,200}if\(canAccessRoom\(identity, room\)\) socket\.join\(room\);/);
  });
});

describe('Reply in the HR chat', () => {
  it('redraws each tab into the real window, and drops a reply begun on another tab', () => {
    const create = body('createWindow');
    expect(create).toMatch(/cancelReply\(w\);\s*loadHistory\(targetRoom, w\);/);
    expect(create).not.toContain('{ msgsEl: msgsEl }');
  });
});
