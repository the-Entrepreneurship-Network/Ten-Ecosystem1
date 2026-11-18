'use strict';

/**
 * @jest-environment node
 *
 * Personal notifications reaching the phone.
 *
 * None of the transport is new — web-push, the service worker, the manifest
 * and the subscribe route were already here and already carried chat
 * messages. What was missing was the connection to the one funnel every
 * other notification goes through, so a certificate being issued or an
 * application approved reached the portal and the inbox but never the phone.
 *
 * Two things decide whether this works at all. It must fire for personal
 * notifications and no others, because a broadcast would wake every phone in
 * the programme at once. And the id it sends to must be the id subscriptions
 * are stored under — if those drift apart this sends to nobody, silently,
 * and nothing anywhere would say so.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const hookSrc  = fs.readFileSync(path.join(root, 'models/Notification.js'), 'utf8');
const pushRoute = fs.readFileSync(path.join(root, 'routes/push.js'), 'utf8');
const mirrorSrc = fs.readFileSync(path.join(root, 'services/notificationPush.js'), 'utf8');

/** Load the mirror with pushService stubbed. */
function load({ enabled = true, sent = 1, throws = null } = {}) {
    jest.resetModules();
    const calls = [];
    jest.doMock('../../services/pushService', () => ({
        isEnabled: () => enabled,
        sendToUser: async (userId, payload) => {
            calls.push({ userId, payload });
            if (throws) throw new Error(throws);
            return { sent, removed: 0, failed: 0 };
        }
    }));
    return { svc: require('../../services/notificationPush'), calls };
}

const personal = (over = {}) => ({
    targetType: 'student',
    targetEmployeeId: 'TEN/WEB/1234',
    title: '📄 Letter of Completion Issued',
    message: 'Your Letter of Completion has been generated.',
    type: 'success',
    ...over
});

describe('who gets woken', () => {
    it('a personal notification reaches that student', async () => {
        const { svc, calls } = load();
        await expect(svc.mirror(personal())).resolves.toMatchObject({ sent: true, devices: 1 });
        expect(calls).toHaveLength(1);
        expect(calls[0].userId).toBe('TEN/WEB/1234');
        expect(calls[0].payload.title).toContain('Letter of Completion');
    });

    it('a broadcast wakes nobody', async () => {
        // The one that would be felt immediately and by everyone.
        const { svc, calls } = load();
        for (const t of ['all', 'domain', 'hr', undefined]) {
            await expect(svc.mirror(personal({ targetType: t })))
                .resolves.toMatchObject({ sent: false, reason: 'not a personal notification' });
        }
        expect(calls).toHaveLength(0);
    });

    it('a personal notification with no recipient is dropped', async () => {
        const { svc, calls } = load();
        await expect(svc.mirror(personal({ targetEmployeeId: '' })))
            .resolves.toMatchObject({ sent: false, reason: 'no recipient' });
        expect(calls).toHaveLength(0);
    });

    it('an event that sends its own push can opt out', async () => {
        const { svc, calls } = load();
        const doc = personal();
        doc.$locals = { skipPush: true };
        await expect(svc.mirror(doc)).resolves.toMatchObject({ sent: false, reason: 'opted out' });
        expect(calls).toHaveLength(0);
    });
});

describe('the id it sends to is the id subscriptions are stored under', () => {
    it('sends to targetEmployeeId, with no lookup in between', async () => {
        const { svc, calls } = load();
        await svc.mirror(personal({ targetEmployeeId: 'TEN/AI/9999' }));
        expect(calls[0].userId).toBe('TEN/AI/9999');
    });

    it('and the subscribe route keys a student on employeeId', () => {
        // The pair that has to agree. If routes/push.js ever resolves a
        // student to something else — an _id, an email — every push here goes
        // to nobody and nothing reports it.
        expect(pushRoute).toMatch(/role:\s*'student',\s*id:\s*s\.student\.employeeId/);
    });
});

describe('nothing here can break the notification it rides on', () => {
    it('push being unconfigured is a reason, not a throw', async () => {
        const { svc, calls } = load({ enabled: false });
        await expect(svc.mirror(personal()))
            .resolves.toMatchObject({ sent: false, reason: 'push not configured' });
        expect(calls).toHaveLength(0);     // not even attempted
    });

    it('a thrown send resolves instead of propagating', async () => {
        // This runs inside a post-save hook. An unhandled rejection here would
        // surface far from the cause, long after the document was saved.
        const { svc } = load({ throws: 'web-push exploded' });
        await expect(svc.mirror(personal())).resolves.toMatchObject({ sent: false });
    });

    it('no subscriptions is a quiet no, not a failure', async () => {
        const { svc } = load({ sent: 0 });
        await expect(svc.mirror(personal())).resolves.toMatchObject({ sent: false, devices: 0 });
    });

    it('a missing document is handled', async () => {
        const { svc } = load();
        await expect(svc.mirror(null)).resolves.toMatchObject({ sent: false });
    });
});

describe('the hook wires it where every notification passes', () => {
    it('push is mirrored from the model hook, not from notifyStudent', () => {
        // Two files build notifications by hand and never call the static —
        // studentPropagation and certificateApplications. A hook on the
        // static would miss both, which is why email is hooked here too.
        expect(hookSrc).toMatch(/NotificationSchema\.post\("save"/);
        expect(hookSrc).toMatch(/require\("\.\.\/services\/notificationPush"\)\.mirror\(doc\)/);
    });

    it('email and push cannot take each other down', () => {
        // Separate try blocks: a push that cannot start must not stop the
        // email, and the reverse.
        const at = hookSrc.indexOf('NotificationSchema.post("save"');
        const hook = hookSrc.slice(at, hookSrc.indexOf('module.exports', at));
        expect((hook.match(/try \{/g) || []).length).toBe(2);
        expect((hook.match(/\.catch\(\(\) => \{\}\)/g) || []).length).toBe(2);
    });

    it('the mirror does not reach for transport of its own', () => {
        // It is a connector. A second web-push client here would mean a
        // second set of VAPID keys to keep in step.
        expect(mirrorSrc).not.toMatch(/require\('web-push'\)/);
        expect(mirrorSrc).toMatch(/require\('\.\/pushService'\)/);
    });
});
