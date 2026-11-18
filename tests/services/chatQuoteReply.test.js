'use strict';

/**
 * @jest-environment node
 *
 * Replying to one message in a room full of them.
 *
 * The quote is a snapshot taken by the server, not a join and not anything the
 * client supplies. Two consequences are worth pinning down. A client can only
 * send the id of the message it is answering, so nobody can put words in
 * someone else's mouth by inventing an excerpt. And the id is checked against
 * the room being posted into, because otherwise quoting is a way to read a
 * conversation you cannot open: send any message id, and its text comes back
 * inside your own reply, in front of everyone in your room.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const widget = fs.readFileSync(path.join(root, 'public/chat-widget.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const model = fs.readFileSync(path.join(root, 'models/Message.js'), 'utf8');

/** Pull one function out of the widget and run it. */
function fromWidget(name) {
    const start = widget.indexOf('function ' + name + '(');
    expect(start).toBeGreaterThan(-1);
    // Bounded at the next top-level function, not a guessed length.
    const rest = widget.slice(start + name.length + 10);
    const next = rest.search(/\n {4}function /);
    const body = next === -1 ? widget.slice(start) : widget.slice(start, start + name.length + 10 + next);
    const src = `
      function escapeHtml(s){ return String(s==null?'':s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
      ${body}
      return ${name};`;
    // eslint-disable-next-line no-new-func
    return new Function(src)();
}

describe('the quote a reply carries', () => {
    const quoteBlock = fromWidget('quoteBlock');

    it('is nothing at all on a message that is not a reply', () => {
        expect(quoteBlock({})).toBe('');
        expect(quoteBlock({ replyTo: {} })).toBe('');
        expect(quoteBlock({ replyTo: { senderName: 'X' } })).toBe('');   // no id, no quote
    });

    it('shows who was answered and what they said', () => {
        const html = quoteBlock({ replyTo: { messageId: 'abc123', senderName: 'Tashu Aryan', excerpt: 'when can i get my offer letter?' } });
        expect(html).toContain('Tashu Aryan');
        expect(html).toContain('when can i get my offer letter?');
        expect(html).toContain('data-jump="abc123"');
    });

    it('says "photo" when the quoted message was an image with no words', () => {
        const html = quoteBlock({ replyTo: { messageId: 'x', senderName: 'Sakshi', excerpt: '', hasImage: true } });
        expect(html).toContain('photo');
    });

    it('still renders when the original is gone', () => {
        // Messages can be deleted and DM rooms expire after 30 days. A reply
        // that answers nothing visible is worse than one that says so.
        const html = quoteBlock({ replyTo: { messageId: 'x', senderName: 'Sakshi', excerpt: '', hasImage: false } });
        expect(html).toContain('Sakshi');
        expect(html).toContain('tc-quote');
    });

    it('escapes the quoted text and the name', () => {
        // Both were typed by someone else and are going into innerHTML.
        const html = quoteBlock({ messageId: 'x', replyTo: { messageId: '"><b>x', senderName: '<img src=x onerror=alert(1)>', excerpt: '<script>alert(1)</script>' } });
        // What matters is that none of it opens a tag or closes an attribute.
        // The characters themselves may still appear, escaped and inert.
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&lt;img');
        // The id goes into an attribute, so its quotes must be escaped too.
        expect(html).toMatch(/data-jump="&quot;&gt;&lt;b&gt;x"/);
        // Exactly the three elements we build, no fourth smuggled in.
        expect((html.match(/<div/g) || []).length).toBe(3);
    });
});

describe('the server decides what the quote says', () => {
    function deliverBlock() {
        const at = serverJs.indexOf('async function deliverChatMessage');
        expect(at).toBeGreaterThan(-1);
        const rest = serverJs.slice(at + 30);
        const next = rest.search(/\nasync function |\nfunction /);
        return next === -1 ? serverJs.slice(at) : serverJs.slice(at, at + 30 + next);
    }

    it('takes the name and text from its own copy, never from the client', () => {
        const b = deliverBlock();
        expect(b).toMatch(/Message\.findById\(String\(replyId\)\)/);
        expect(b).toMatch(/senderName:\s*String\(parent\.senderName/);
        expect(b).toMatch(/excerpt:\s*String\(parent\.message/);
        // Nothing from the payload reaches the stored quote.
        expect(b).not.toMatch(/excerpt:\s*String\(payload/);
        expect(b).not.toMatch(/senderName:\s*payload/);
    });

    it('refuses to quote a message from another room', () => {
        // The check that stops quoting being a way to read rooms you cannot
        // open. canAccessRoom guards the room being written to, not the one
        // being quoted from.
        expect(deliverBlock()).toMatch(/parent\.chatRoom === room/);
    });

    it('validates the id before it hits the database', () => {
        expect(deliverBlock()).toMatch(/mongoose\.Types\.ObjectId\.isValid\(String\(replyId\)\)/);
    });

    it('a bad quote drops the quote, not the message', () => {
        const b = deliverBlock();
        // The lookup is wrapped, and replyTo is left undefined rather than
        // throwing out of the send.
        expect(b).toMatch(/let replyTo;/);
        expect(b).toMatch(/catch \(_\) \{[^}]*\}/);
        expect(b).toMatch(/replyTo:\s*replyTo,/);
    });
});

describe('the message record', () => {
    it('stores a snapshot rather than only a reference', () => {
        // A bare ObjectId would mean a query per quoted message when a room
        // renders, and an empty quote once the original is deleted.
        expect(model).toMatch(/replyTo:\s*\{/);
        for (const f of ['messageId', 'senderName', 'excerpt', 'hasImage']) {
            expect(model).toMatch(new RegExp(f + ':\\s*\\{'));
        }
    });

    it('caps the excerpt so a reply cannot carry a whole second message', () => {
        expect(model).toMatch(/excerpt:.*maxlength:\s*160/);
    });
});

describe('the compose bar', () => {
    it('is held per room, not per widget', () => {
        // The HR portal opens more than one room. A reply started in one must
        // not attach itself to the next message typed in another.
        expect(widget).toMatch(/w\._replyTo = \{/);
        expect(widget).not.toMatch(/\n\s*var pendingReply\b/);
    });

    it('sends only the id', () => {
        expect(widget).toMatch(/payload\.replyTo = w\._replyTo\.messageId/);
        // Not the text: the server has its own copy and does not trust ours.
        expect(widget).not.toMatch(/payload\.replyExcerpt/);
    });

    it('clears itself once the message is away', () => {
        // Otherwise the next line typed silently quotes the same message.
        const at = widget.indexOf('form.addEventListener("submit"');
        const handler = widget.slice(at, at + 1600);
        expect(handler).toMatch(/cancelReply\(w\)/);
    });

    it('is created per window so handlers can close over it', () => {
        expect(widget).toMatch(/_replyBarEl: replyBarEl/);
        expect(widget).toMatch(/form\.parentNode\.insertBefore\(replyBarEl, form\)/);
    });
});
