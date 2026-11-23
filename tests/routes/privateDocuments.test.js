'use strict';

/**
 * HR opens a student's address proof or marksheet from the pending list, or a
 * coordinator applicant's resume. Since #263 every one of those links 404'd.
 * The folder must still be closed to everybody who is not HR or an admin.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const DIR = path.join(__dirname, '..', '..', 'uploads', 'documents');
const PDF_NAME = 'jest-private-doc_address_proof.pdf';
const SVG_NAME = 'jest-private-doc_address_proof.svg';
const PDF = Buffer.from('%PDF-1.4 jest');

function mount(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/uploads/documents', require('../../routes/privateDocuments'));
  app.use('/uploads', (_req, res) => res.status(404).end());   // the guard behind it
  return app;
}

const get = (session, name) => request(mount(session)).get('/uploads/documents/' + name)
  .buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, PDF_NAME), PDF);
  fs.writeFileSync(path.join(DIR, SVG_NAME), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
});
afterAll(() => {
  for (const f of [PDF_NAME, SVG_NAME]) fs.rmSync(path.join(DIR, f), { force: true });
  console.warn.mockRestore();
});

describe('GET /uploads/documents/:name', () => {
  test('HR opens the document', async () => {
    const res = await get({ hr: { username: 'hr1' } }, PDF_NAME);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.equals(PDF)).toBe(true);
  });

  test('so does an admin', async () => {
    expect((await get({ adminUser: { username: 'admin' } }, PDF_NAME)).status).toBe(200);
  });

  test('a student, a coordinator and a stranger get nothing', async () => {
    for (const session of [{ student: { employeeId: 'TEN/WEB/1' } }, { coordinator: { username: 'c1' } }, {}, undefined]) {
      const res = await get(session, PDF_NAME);
      expect(res.status).toBe(401);
      expect(res.body.includes(PDF)).toBe(false);
    }
  });

  test('a file that is not there is a 404', async () => {
    expect((await get({ hr: { username: 'hr1' } }, 'nobody_address_proof.pdf')).status).toBe(404);
  });

  test('never serves a type that could run as this site, even to HR', async () => {
    expect((await get({ hr: { username: 'hr1' } }, SVG_NAME)).status).toBe(404);
  });

  test('cannot climb out of the folder', async () => {
    for (const name of ['..%2F..%2Fpackage.json', '..%2F..%2Fserver.js', '%2E%2E%2Fsecret.pdf']) {
      const res = await get({ hr: { username: 'hr1' } }, name);
      expect(res.status).toBe(404);
    }
  });
});

describe('server.js', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

  test('mounts it ahead of the guard, which still closes the folder to everyone else', () => {
    const mountAt = server.indexOf("app.use('/uploads/documents', require('./routes/privateDocuments'));");
    expect(mountAt).toBeGreaterThan(-1);
    expect(mountAt).toBeLessThan(server.indexOf('const UPLOADS_PRIVATE'));
    expect(server).toMatch(/const UPLOADS_PRIVATE = .*\|documents\)/);
    expect(server).not.toMatch(/static\(\s*["']uploads\/documents/);
  });
});
