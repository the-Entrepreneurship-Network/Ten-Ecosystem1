'use strict';

/**
 * Reads by a signed-in person have their own, larger allowance.
 *
 * On a local copy, one walk through every student section was about 150
 * counted requests against a shared allowance of 300, and each open tab polls
 * about six a minute on top. An intern exploring the portal in two tabs ran
 * out and every section answered 429.
 *
 * The limiter's key and limit are lifted out of server.js and run for real.
 */
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const helpers = server.slice(server.indexOf('function rateLimitKey'), server.indexOf('const apiLimiter'));
const limiter = server.slice(server.indexOf('const apiLimiter = rateLimit({'));
const maxExpr = limiter.match(/\bmax:\s*(\(req\) => [^\n]*),\n/)[1];
const keyExpr = limiter.match(/keyGenerator:\s*(\(req\) => [^\n]*),\n/)[1];
// eslint-disable-next-line no-new-func
const { limit, key } = new Function('ipKeyGenerator', 'RATE_LIMIT_CONFIG',
  `${helpers}; return { limit: ${maxExpr}, key: ${keyExpr} };`)((ip) => ip, { authenticated: { max: 300 } });

const student = (method) => ({ method, session: { student: { employeeId: 'TEN-0001' } }, ip: '10.0.0.1' });
const stranger = (method) => ({ method, session: {}, ip: '10.0.0.9' });

test('a signed-in read draws on a separate, larger allowance', () => {
  expect(key(student('GET'))).toBe('u:TEN-0001:read');
  expect(limit(student('GET'))).toBe(900);
});

test('writes keep the original allowance, apart from the reads', () => {
  expect(key(student('POST'))).toBe('u:TEN-0001');
  expect(limit(student('POST'))).toBe(300);
});

test('an anonymous caller still shares one allowance per IP for everything', () => {
  expect(key(stranger('GET'))).toBe('ip:10.0.0.9');
  expect(key(stranger('POST'))).toBe('ip:10.0.0.9');
  expect(limit(stranger('GET'))).toBe(300);
});

/*
 * A router mounted at /api/v2 itself sees every /api/v2 request that reaches
 * it, not only its own routes. routes/v2/studentPortal.js had a limiter of its
 * own, keyed by IP, so all of /api/v2 shared 300 requests per 15 minutes per
 * network: a college Wi-Fi or a mobile carrier's address, for everyone on it.
 */
test('no router mounted at /api/v2 itself adds a limiter of its own', () => {
  const mounted = [...server.matchAll(/const (\w+) = require\("(\.\/routes\/v2\/\w+)"\);\s*app\.use\("\/api\/v2", \1\);/g)]
    .map((m) => m[2]);
  expect(mounted).toEqual(expect.arrayContaining(['./routes/v2/studentPortal', './routes/v2/documents', './routes/v2/certificates']));
  for (const file of mounted) {
    const src = fs.readFileSync(path.join(__dirname, '../..', file + '.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/router\.use\(\s*\w*[Ll]imiter/);
  }
});
