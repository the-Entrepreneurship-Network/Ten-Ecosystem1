'use strict';

/**
 * Server-Sent Events hub — the live notification channel.
 *
 * The client registry used to be a module-scoped Map inside server.js, so only
 * server.js could push. routes/adminPortal.js therefore wrote Notification rows
 * for a broadcast and never pushed them: an admin announcement did not appear
 * until the student happened to poll. Extracting the hub lets any route push.
 *
 * Keys:
 *   student:<employeeId>   one student's stream
 *   coord:<domain>         the coordinator of a domain
 *   hr:all                 all HR
 */

const sseClients = new Map();

function addSSEClient(key, res, meta = {}) {
    if (!sseClients.has(key)) sseClients.set(key, []);
    sseClients.get(key).push({ res, ...meta });
}

function removeSSEClient(key, res) {
    const arr = sseClients.get(key) || [];
    const idx = arr.findIndex((c) => c.res === res);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) sseClients.delete(key);
}

function sendSSE(res, data) {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}

/** Push a notification to one student and/or the coordinator of a domain. */
function broadcastNotification(domain, employeeId, notif) {
    if (employeeId) {
        for (const c of sseClients.get(`student:${employeeId}`) || []) {
            sendSSE(c.res, { event: 'notification', notification: notif });
        }
    }
    if (domain) {
        for (const c of sseClients.get(`coord:${domain}`) || []) {
            sendSSE(c.res, { event: 'notification', notification: notif });
        }
    }
}

/** Push to every connected client — used for "all" broadcasts. */
function broadcastToAll(notif) {
    for (const arr of sseClients.values()) {
        for (const c of arr) sendSSE(c.res, { event: 'notification', notification: notif });
    }
}

/** Push to every student of one domain, plus that domain's coordinator. */
function broadcastToDomain(domain, notif) {
    for (const [key, arr] of sseClients.entries()) {
        if (key === `coord:${domain}`) {
            for (const c of arr) sendSSE(c.res, { event: 'notification', notification: notif });
            continue;
        }
        if (!key.startsWith('student:')) continue;
        for (const c of arr) {
            if ((c.domain || c.studentDomain) === domain) {
                sendSSE(c.res, { event: 'notification', notification: notif });
            }
        }
    }
}

module.exports = {
    sseClients,
    addSSEClient,
    removeSSEClient,
    sendSSE,
    broadcastNotification,
    broadcastToAll,
    broadcastToDomain
};
