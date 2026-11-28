'use strict';

/**
 * @jest-environment node
 *
 * /app is where the installed TEN app opens. One app for the whole site means
 * it must open each person's own space: started on the student dashboard, a
 * founder or HR user lands on a login page every time they open it.
 */

const express = require('express');
const request = require('supertest');
const appStart = require('../../routes/appStart');

function appWith(session) {
    const app = express();
    app.use((req, res, next) => { req.session = session; next(); });
    app.use(appStart);
    return app;
}

test.each([
    ['nobody signed in', undefined, '/'],
    ['an empty session', {}, '/'],
    ['a student', { student: { employeeId: 'TEN/WEB/1001' } }, '/student-dashboard'],
    ['a founder', { ecosystemUserRole: 'founder' }, '/founder-os'],
    ['a mentor', { ecosystemUserRole: 'mentor' }, '/mentor-dashboard'],
    ['an investor', { ecosystemUserRole: 'investor' }, '/investor-dashboard'],
    ['a contractor', { ecosystemUserRole: 'contractor' }, '/contractor-dashboard'],
    ['a coordinator', { coordinator: { username: 'web_admin' } }, '/coordinator-dashboard.html'],
    ['HR', { hr: { email: 'hr@example.org' } }, '/hr-portal'],
    ['the admin', { adminUser: { username: 'tenadmin' } }, '/ten-admin'],
    ['a learner on the LLM portal', { learner: { id: 'l1' } }, '/learn'],
    ['the growth team', { growthUser: { email: 'g@example.org' } }, '/growth'],
    ['a student session without an id', { student: {} }, '/'],
    ['an unknown ecosystem role', { ecosystemUserRole: 'astronaut' }, '/'],
])('%s opens on %s', async (_who, session, where) => {
    const res = await request(appWith(session)).get('/app');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(where);
    // Per person: a cached copy would open one user's dashboard for the next.
    expect(res.headers['cache-control']).toBe('no-store');
});

test('a student signed in twice still opens on the student dashboard', () => {
    expect(appStart.startPage({ student: { employeeId: 'TEN/WEB/1001' }, ecosystemUserRole: 'founder' }))
        .toBe('/student-dashboard');
});
