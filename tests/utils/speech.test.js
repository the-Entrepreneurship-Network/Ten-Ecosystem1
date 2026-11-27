'use strict';

/**
 * @jest-environment node
 *
 * utils/speech.js: Azure's text-to-speech REST call for the interviewer's
 * voice. Off without a key; the request carries the key, SSML with the text
 * escaped and the MP3 format; any refusal or error is null, so the page falls
 * back to the device's voice.
 */

const speech = require('../../utils/speech');

const ENV = ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'INTERVIEW_VOICE'];
let calls;
beforeEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    calls = [];
    global.fetch = jest.fn(async (url, opts) => { calls.push({ url, opts }); return global.__reply(); });
    global.__reply = () => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { delete global.fetch; console.warn.mockRestore(); });

describe('utils/speech', () => {
    it('is off, and calls nothing, without AZURE_SPEECH_KEY', async () => {
        expect(speech.ready()).toBe(false);
        expect(await speech.speak('Hello')).toBeNull();
        expect(calls).toEqual([]);
    });

    it('asks Azure for MP3 in the chosen voice, with the text escaped inside SSML', async () => {
        process.env.AZURE_SPEECH_KEY = ' key-1 ';
        expect(speech.voice()).toBe('en-IN-NeerjaNeural');
        const audio = await speech.speak('Is <b> & "quotes" safe?');
        expect(audio).toEqual(Buffer.from('ID3'));
        const { url, opts } = calls[0];
        expect(url).toBe('https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1');
        expect(opts.method).toBe('POST');
        expect(opts.headers).toMatchObject({ 'Ocp-Apim-Subscription-Key': 'key-1', 'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'ten-portal' });
        expect(opts.body).toBe('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-IN">' +
            '<voice name="en-IN-NeerjaNeural"><prosody rate="-4%">Is &lt;b&gt; &amp; &quot;quotes&quot; safe?</prosody></voice></speak>');

        process.env.AZURE_SPEECH_REGION = 'eastus';
        process.env.INTERVIEW_VOICE = 'en-IN-PrabhatNeural';
        await speech.speak('Hi');
        expect(calls[1].url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
        expect(calls[1].opts.body).toContain('<voice name="en-IN-PrabhatNeural">');
    });

    it('returns null when Azure refuses (the free allowance is used up) or cannot be reached, and warns once', async () => {
        process.env.AZURE_SPEECH_KEY = 'key-1';
        global.__reply = () => ({ ok: false, status: 403 });
        expect(await speech.speak('Hello')).toBeNull();
        expect(await speech.speak('Hello again')).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn.mock.calls[0][0]).toMatch(/403 \(free monthly allowance or rate limit reached\)/);
        global.__reply = () => { throw new Error('getaddrinfo ENOTFOUND'); };
        expect(await speech.speak('Hello')).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(2);
    });
});
