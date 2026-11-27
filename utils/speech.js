'use strict';

/**
 * The Interview Room's interviewer voice: Amazon Polly's Indian-English neural
 * voice (Kajal), one signed HTTPS request per line.
 *
 *   AWS_POLLY_ACCESS_KEY_ID      an IAM user's key, allowed only polly:SynthesizeSpeech
 *   AWS_POLLY_SECRET_ACCESS_KEY  its secret
 *   AWS_POLLY_REGION             default ap-south-1 (Mumbai)
 *   INTERVIEW_VOICE              default Kajal
 *
 * Cost: neural voices are billed per character (about $16 per million, roughly
 * ₹3-4 an interview), paid from the AWS account's credits while they last. Any
 * refusal, timeout or missing key returns null and the page speaks with the
 * device's own voice instead.
 *
 * The request is signed here (AWS Signature Version 4) with Node's crypto, so
 * the portal needs no AWS library: the current one wants Node 20, and CI runs 18.
 */

const crypto = require('crypto');
const https = require('https');

const voice = () => String(process.env.INTERVIEW_VOICE || 'Kajal').trim();
const key = () => String(process.env.AWS_POLLY_ACCESS_KEY_ID || '').trim();
const secret = () => String(process.env.AWS_POLLY_SECRET_ACCESS_KEY || '').trim();
const ready = () => !!(key() && secret());

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();

/** AWS Signature Version 4 headers for one request (the Authorization header and x-amz-date). */
function signV4({ method, host, path, query = '', headers = {}, body = '', region, service, accessKeyId, secretAccessKey, now = new Date() }) {
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const all = Object.assign({}, headers, { host, 'x-amz-date': amzDate });
    const names = Object.keys(all).map((h) => h.toLowerCase()).sort();
    const value = (n) => String(all[Object.keys(all).find((h) => h.toLowerCase() === n)]).trim().replace(/\s+/g, ' ');
    const signedHeaders = names.join(';');
    const canonical = [method, path, query, names.map((n) => `${n}:${value(n)}\n`).join(''), signedHeaders, sha256(body)].join('\n');
    const scope = `${day}/${region}/${service}/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(toSign, 'utf8').digest('hex');
    return { 'x-amz-date': amzDate, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

let lastWarning = '';
function warn(msg) {
    if (msg !== lastWarning) console.warn('[speech] ' + msg + '; the page uses the device voice.');
    lastWarning = msg;
}

function post(host, path, headers, body) {
    return new Promise((resolve, reject) => {
        const req = https.request({ host, path, method: 'POST', headers, timeout: 15000 }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        });
        req.on('timeout', () => req.destroy(new Error('Polly did not answer in 15 s')));
        req.on('error', reject);
        req.end(body);
    });
}

/** MP3 of the text in the interviewer's voice, or null. */
async function speak(text) {
    if (!ready() || !text) return null;
    const region = String(process.env.AWS_POLLY_REGION || 'ap-south-1').trim();
    const host = `polly.${region}.amazonaws.com`;
    const path = '/v1/speech';
    const body = JSON.stringify({ Engine: 'neural', LanguageCode: 'en-IN', OutputFormat: 'mp3', Text: String(text), TextType: 'text', VoiceId: voice() });
    const headers = { 'content-type': 'application/json' };
    Object.assign(headers, signV4({ method: 'POST', host, path, headers, body, region, service: 'polly', accessKeyId: key(), secretAccessKey: secret() }));
    try {
        const res = await post(host, path, Object.assign({ 'content-length': Buffer.byteLength(body) }, headers), body);
        if (res.status !== 200) {
            let why = '';
            try { why = JSON.parse(res.body.toString('utf8')).message || ''; } catch (_) { /* not JSON */ }
            warn(`Polly answered ${res.status}${res.status === 403 ? ' (check the AWS_POLLY keys, the region, and that the key may use Polly)' : res.status === 429 ? ' (rate limit)' : ''}${why ? ': ' + why : ''}`);
            return null;
        }
        lastWarning = '';
        return res.body;
    } catch (err) {
        warn(err.message);
        return null;
    }
}

module.exports = { speak, ready, voice, signV4 };
