'use strict';

/**
 * The production server's Node has no ReadableStream global, which the
 * @google/genai SDK needs: every feature built on it failed there with
 * "ReadableStream is not defined" (AI task feedback, task, quiz, coding and
 * daily-learning generation). utils/gemini.js talks to the REST API instead.
 * Nothing else may load the SDK.
 */
const { execSync } = require('child_process');
const path = require('path');

test('no server code loads the @google/genai SDK', () => {
    const hits = execSync(
        "grep -rln --include=*.js -e 'require(\"@google/genai\")' -e \"require('@google/genai')\" server.js routes services utils models middleware || true",
        { cwd: path.join(__dirname, '../..'), encoding: 'utf8' }
    ).trim();
    expect(hits).toBe('');
});
