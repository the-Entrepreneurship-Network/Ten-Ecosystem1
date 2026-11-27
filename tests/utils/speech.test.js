'use strict';

/**
 * @jest-environment node
 *
 * utils/speech.js: the interviewer's voice from Amazon Polly. Off without the
 * keys; one signed POST to Polly's speech endpoint with Kajal, neural, Indian
 * English and MP3; the signature is AWS Signature Version 4 (checked against
 * AWS's published example); any refusal or error is null, so the page falls
 * back to the device's voice.
 */

const https = require('https');
const { EventEmitter } = require('events');
const speech = require('../../utils/speech');

const ENV = ['AWS_POLLY_ACCESS_KEY_ID', 'AWS_POLLY_SECRET_ACCESS_KEY', 'AWS_POLLY_REGION', 'INTERVIEW_VOICE'];
let calls; let reply;
beforeEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    calls = [];
    reply = () => ({ status: 200, body: Buffer.from('ID3') });
    jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        let body = '';
        req.destroy = (err) => req.emit('error', err);
        req.end = (b) => {
            body += b || '';
            calls.push({ opts, body });
            setImmediate(() => {
                let r;
                try { r = reply(); } catch (err) { req.emit('error', err); return; }
                const res = new EventEmitter();
                res.statusCode = r.status;
                cb(res);
                res.emit('data', r.body);
                res.emit('end');
            });
        };
        return req;
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('utils/speech', () => {
    it('is off, and calls nothing, without both AWS_POLLY keys', async () => {
        expect(speech.ready()).toBe(false);
        process.env.AWS_POLLY_ACCESS_KEY_ID = 'AKIDEXAMPLE';
        expect(speech.ready()).toBe(false);
        expect(await speech.speak('Hello')).toBeNull();
        expect(calls).toEqual([]);
    });

    it('asks Polly in Mumbai for Kajal, neural, Indian English, MP3, and signs the request', async () => {
        process.env.AWS_POLLY_ACCESS_KEY_ID = ' AKIDEXAMPLE ';
        process.env.AWS_POLLY_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
        expect(speech.voice()).toBe('Kajal');
        const audio = await speech.speak('Hi Asha, good morning. How are you doing today?');
        expect(audio).toEqual(Buffer.from('ID3'));
        const { opts, body } = calls[0];
        expect(opts).toMatchObject({ host: 'polly.ap-south-1.amazonaws.com', path: '/v1/speech', method: 'POST' });
        expect(JSON.parse(body)).toEqual({ Engine: 'neural', LanguageCode: 'en-IN', OutputFormat: 'mp3', Text: 'Hi Asha, good morning. How are you doing today?', TextType: 'text', VoiceId: 'Kajal' });
        expect(opts.headers['content-type']).toBe('application/json');
        expect(opts.headers['content-length']).toBe(Buffer.byteLength(body));
        expect(opts.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
        expect(opts.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-south-1\/polly\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);

        process.env.AWS_POLLY_REGION = 'us-east-1';
        process.env.INTERVIEW_VOICE = 'Aditi';
        await speech.speak('Hi');
        expect(calls[1].opts.host).toBe('polly.us-east-1.amazonaws.com');
        expect(JSON.parse(calls[1].body).VoiceId).toBe('Aditi');
    });

    it('signs exactly as AWS documents (Signature Version 4 example, IAM ListUsers)', () => {
        const h = speech.signV4({
            method: 'GET', host: 'iam.amazonaws.com', path: '/', query: 'Action=ListUsers&Version=2010-05-08',
            headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: '',
            region: 'us-east-1', service: 'iam', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
            now: new Date('2015-08-30T12:36:00Z')
        });
        expect(h).toEqual({
            'x-amz-date': '20150830T123600Z',
            Authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, ' +
                'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7'
        });
    });

    it('returns null when Polly refuses or cannot be reached, and warns once per reason', async () => {
        process.env.AWS_POLLY_ACCESS_KEY_ID = 'AKIDEXAMPLE';
        process.env.AWS_POLLY_SECRET_ACCESS_KEY = 'secret';
        reply = () => ({ status: 403, body: Buffer.from(JSON.stringify({ message: 'The security token included in the request is invalid.' })) });
        expect(await speech.speak('Hello')).toBeNull();
        expect(await speech.speak('Hello again')).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn.mock.calls[0][0]).toMatch(/Polly answered 403 \(check the AWS_POLLY keys.*\): The security token included in the request is invalid\./);
        reply = () => { throw new Error('getaddrinfo ENOTFOUND'); };
        expect(await speech.speak('Hello')).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(2);
    });
});
