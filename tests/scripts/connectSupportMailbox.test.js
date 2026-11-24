'use strict';

/**
 * @jest-environment node
 *
 * The first real run pasted the email address at "Paste that address here",
 * the script sent it to Google as the code, and Google answered "400 Malformed
 * auth code". Only the link Google sends the browser to may get through.
 */
const { codeFrom } = require('../../scripts/connect-support-mailbox');

const STATE = 'abc123';
const link = (query) => 'http://127.0.0.1:8765/?' + query;

test('takes the code from the link Google sends the browser to', () => {
    expect(codeFrom(link(`state=${STATE}&code=4/0AbC-d_e&scope=x`), STATE)).toBe('4/0AbC-d_e');
});

test('refuses anything else before it reaches Google', () => {
    for (const pasted of ['complaints@entrepreneurshipnetwork.net', '', '4/0AbC', 'http://[',
        'https://accounts.google.com/o/oauth2/v2/auth?code_challenge=x']) {
        expect(() => codeFrom(pasted, STATE)).toThrow('That is not the link');
    }
});

test('says when Google refused, or the link is from an earlier try', () => {
    expect(() => codeFrom(link(`error=access_denied&state=${STATE}`), STATE)).toThrow('access_denied');
    expect(() => codeFrom(link('state=old&code=4/0AbC'), STATE)).toThrow('earlier try');
});
