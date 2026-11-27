'use strict';

/**
 * The Interview Room's interviewer voice: an Indian-English neural voice from
 * Azure AI Speech (text to speech over REST).
 *
 *   AZURE_SPEECH_KEY      turns it on (the key of a Speech resource)
 *   AZURE_SPEECH_REGION   that resource's region, default centralindia
 *   INTERVIEW_VOICE       default en-IN-NeerjaNeural; en-IN-PrabhatNeural is the male one
 *
 * On the free F0 tier Azure gives 0.5 million characters a month (about 190
 * interviews) and then refuses until the next month, so it never bills. Any
 * refusal, timeout or missing key returns null and the page speaks with the
 * device's own voice instead.
 */

const voice = () => String(process.env.INTERVIEW_VOICE || 'en-IN-NeerjaNeural').trim();
const ready = () => !!String(process.env.AZURE_SPEECH_KEY || '').trim();
const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

let lastWarning = '';
function warn(msg) {
    if (msg !== lastWarning) console.warn('[speech] ' + msg + '; the page uses the device voice.');
    lastWarning = msg;
}

/** MP3 of the text in the interviewer's voice, or null. */
async function speak(text) {
    if (!ready() || !text) return null;
    const region = String(process.env.AZURE_SPEECH_REGION || 'centralindia').trim();
    const name = voice();
    const lang = name.split('-').slice(0, 2).join('-');
    try {
        const res = await fetch(`https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': String(process.env.AZURE_SPEECH_KEY).trim(),
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
                'User-Agent': 'ten-portal'
            },
            body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xml(lang)}">` +
                `<voice name="${xml(name)}"><prosody rate="-4%">${xml(text)}</prosody></voice></speak>`,
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) { warn(`Azure answered ${res.status}${res.status === 401 ? ' (check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION)' : res.status === 403 || res.status === 429 ? ' (free monthly allowance or rate limit reached)' : ''}`); return null; }
        lastWarning = '';
        return Buffer.from(await res.arrayBuffer());
    } catch (err) {
        warn(err.message);
        return null;
    }
}

module.exports = { speak, ready, voice };
