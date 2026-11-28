'use strict';

/**
 * GET /app — where the installed TEN app opens (manifest.webmanifest start_url).
 *
 * The app is the whole site, so it cannot open on one portal's page: started on
 * the student dashboard, a founder, mentor or HR user is bounced to a login
 * page every time. This sends each person to their own space, read from the
 * session they already have, and everyone else to the home page.
 *
 * Order matters only for someone signed in twice in one browser; students come
 * first because they are nearly everyone who installs the app.
 */
const express = require('express');

const ECOSYSTEM_HOME = {
    founder: '/founder-os',
    mentor: '/mentor-dashboard',
    investor: '/investor-dashboard',
    contractor: '/contractor-dashboard',
};

function startPage(s) {
    if (!s) return '/';
    if (s.student && s.student.employeeId) return '/student-dashboard';
    if (ECOSYSTEM_HOME[s.ecosystemUserRole]) return ECOSYSTEM_HOME[s.ecosystemUserRole];
    if (s.coordinator) return '/coordinator-dashboard.html';
    if (s.hr) return '/hr-portal';
    if (s.adminUser) return '/ten-admin';
    if (s.learner) return '/learn';
    if (s.growthUser) return '/growth';
    return '/';
}

const router = express.Router();

router.get('/app', (req, res) => {
    // Per person, so never cached: a shared copy would open one user's
    // dashboard for the next.
    res.set('Cache-Control', 'no-store');
    res.redirect(302, startPage(req.session));
});

module.exports = router;
module.exports.startPage = startPage;
