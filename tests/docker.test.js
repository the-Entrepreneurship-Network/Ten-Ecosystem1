/**
 * The promises the Docker files make, checked so a later edit cannot quietly
 * break them: no secret or local data is baked into the image, a compose copy
 * only ever talks to its own MongoDB, and the app does not run as root.
 */
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('.dockerignore keeps secrets and local data out of the image', () => {
  const entries = read('.dockerignore').split('\n').map((line) => line.trim());
  for (const entry of ['.env', '.env.*', '.session-secret', 'credentials-to-distribute.txt', '.data', 'uploads']) {
    expect(entries).toContain(entry);
  }
});

test('a compose copy always uses its own MongoDB, whatever .env says', () => {
  expect(read('docker-compose.yml')).toMatch(/^\s+MONGODB_URI: mongodb:\/\/mongo:27017\/\w+\s*$/m);
});

test('the image installs like production and runs as the node user', () => {
  const dockerfile = read('Dockerfile');
  expect(dockerfile).toContain('npm ci --legacy-peer-deps --omit=dev');
  expect(dockerfile).toMatch(/^USER node$/m);
});
