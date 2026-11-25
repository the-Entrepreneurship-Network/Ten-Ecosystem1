'use strict';

/**
 * The complaints@ mailbox, through the Gmail REST API.
 *
 * Plain https, the way utils/gemini.js talks to Google: the Google SDKs want
 * globals (fetch, ReadableStream) that older Node on the server lacks, and a
 * handful of REST calls do not justify a dependency.
 *
 * Access is a refresh token for the mailbox, made once with
 * scripts/connect-support-mailbox.js and kept in .env. The short-lived access
 * token lives only in memory. Errors carry the status and Google's message,
 * never a URL or body that held a credential.
 */
const https = require('https');
const querystring = require('querystring');

const env = (key) => String(process.env[key] || '').trim();

function configured() {
    return !!(env('SUPPORT_GMAIL_CLIENT_ID') && env('SUPPORT_GMAIL_CLIENT_SECRET') && env('SUPPORT_GMAIL_REFRESH_TOKEN'));
}

function request(host, path, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request({ host, path, method, headers, timeout: 30000 }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => {
                let json = null;
                try { json = text ? JSON.parse(text) : {}; } catch (_) { /* not JSON */ }
                if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
                const why = (json && (json.error_description || (json.error && (json.error.message || json.error)))) || text.slice(0, 160);
                const err = new Error(`Gmail ${method} ${path.split('?')[0]}: ${res.statusCode} ${why}`);
                err.status = res.statusCode;
                reject(err);
            });
        });
        req.on('timeout', () => req.destroy(new Error('Gmail request timed out')));
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

let token = null;

async function accessToken() {
    if (token && token.expiresAt - 60000 > Date.now()) return token.value;
    const body = querystring.stringify({
        client_id: env('SUPPORT_GMAIL_CLIENT_ID'),
        client_secret: env('SUPPORT_GMAIL_CLIENT_SECRET'),
        refresh_token: env('SUPPORT_GMAIL_REFRESH_TOKEN'),
        grant_type: 'refresh_token'
    });
    const json = await request('oauth2.googleapis.com', '/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        body
    });
    token = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
    return token.value;
}

async function api(method, path, payload) {
    const body = payload ? JSON.stringify(payload) : undefined;
    const headers = { Authorization: 'Bearer ' + await accessToken() };
    if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
    }
    return request('gmail.googleapis.com', '/gmail/v1/users/me' + path, { method, headers, body });
}

const labelIds = {};

/** A label's id, creating it the first time. "Help desk/Teach" nests under "Help desk". */
async function labelId(name) {
    if (labelIds[name]) return labelIds[name];
    const { labels = [] } = await api('GET', '/labels');
    let label = labels.find((l) => l.name === name);
    if (!label) label = await api('POST', '/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    labelIds[name] = label.id;
    return label.id;
}

const id = (value) => encodeURIComponent(String(value));

module.exports = {
    configured,
    labelId,
    profile: () => api('GET', '/profile'),
    listMessages: (q, max = 25) =>
        api('GET', '/messages?' + querystring.stringify({ q, maxResults: max })).then((r) => r.messages || []),
    getMessage: (messageId) => api('GET', `/messages/${id(messageId)}?format=full`),
    getRaw: (messageId) => api('GET', `/messages/${id(messageId)}?format=raw`).then((m) => m.raw || ''),
    getThread: (threadId) => api('GET', `/threads/${id(threadId)}?format=full`),
    threadsLabelled: async (name, max = 20) =>
        api('GET', '/threads?' + querystring.stringify({ labelIds: await labelId(name), maxResults: max })).then((r) => r.threads || []),
    send: (raw, threadId) => api('POST', '/messages/send', { raw, threadId }),
    createDraft: (raw, threadId) => api('POST', '/drafts', { message: { raw, threadId } }),
    // ponytail: one page of 500 drafts; page through if the mailbox ever keeps more.
    listDrafts: () => api('GET', '/drafts?maxResults=500').then((r) => r.drafts || []),
    sendDraft: (draftId) => api('POST', '/drafts/send', { id: draftId }),
    labelThread: async (threadId, add = [], remove = []) => api('POST', `/threads/${id(threadId)}/modify`, {
        addLabelIds: await Promise.all(add.map(labelId)),
        removeLabelIds: await Promise.all(remove.map(labelId))
    })
};
