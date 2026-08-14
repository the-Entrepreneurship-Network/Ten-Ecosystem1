'use strict';

/**
 * The coding challenges.
 *
 * The reported symptom was a screenshot of a freshly opened problem already
 * reading "Tab/Window switch detected · Violations: 1". Three separate things
 * were wrong behind it:
 *
 *   1. The proctor listened on window 'blur' as well as 'visibilitychange'.
 *      window 'blur' fires for ANY loss of window focus — and the line before
 *      it called getUserMedia(), which opens the browser's camera-permission
 *      prompt, which blurs the window. So opening a problem logged a violation
 *      against a student who had done nothing, every time. When someone did
 *      switch tabs, both listeners fired and one switch counted as two.
 *
 *   2. Denying the camera disabled Run and Submit permanently, which made the
 *      section unusable on any machine without a webcam.
 *
 *   3. Nothing was recorded. The counter POSTed to a route that did not exist,
 *      and the 404 was swallowed by an empty .catch().
 *
 * And the runner itself is off by default, for a reason that has not changed —
 * so this also pins the containment that makes turning it on defensible.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8');

describe('the proctor stops accusing people of nothing', () => {
  it('listens on visibilitychange only', () => {
    // window 'blur' was the false positive. document.hidden is the accurate
    // signal and the only one kept.
    expect(page).toContain("document.addEventListener('visibilitychange', _procVisibilityHandler);");
    expect(page).not.toContain("window.addEventListener('blur', _procBlurHandler);");
    expect(page).not.toContain('_procBlurHandler = function()');
  });

  it('ignores the first few seconds, where the permission prompt lives', () => {
    expect(page).toContain('PROC_GRACE_MS');
    expect(page).toContain('if (now - _procArmedAt < PROC_GRACE_MS) return;');
  });

  it('counts one switch once', () => {
    expect(page).toContain('PROC_DEBOUNCE_MS');
    expect(page).toContain('if (now - _procLastViolationAt < PROC_DEBOUNCE_MS) return;');
  });

  it('does nothing at all when the modal is closed', () => {
    expect(page).toContain('if (!_procArmedAt) return;');
    expect(page).toContain('_procArmedAt = 0;');
  });

  it('shows the violation, not the camera state, when one happens', () => {
    // _procShowWarning overwrote the reason with the camera message, so a
    // student who switched tabs was told about their webcam.
    expect(page).not.toContain("warningText.textContent = 'Camera access denied! Camera is strictly required to run or submit code.';\n    badge.style.display = 'inline-flex';\n    return;");
    expect(page).toContain("? text + ' · attempt is unproctored'");
  });
});

describe('no camera is not the same as no coding section', () => {
  it('leaves Run and Submit enabled when the camera is refused', () => {
    const at = page.indexOf('async function startProctoring()');
    const fn = page.slice(at, page.indexOf('function stopProctoring()', at));
    const cat = fn.indexOf('} catch (err) {');
    const rest = fn.slice(cat);
    expect(rest).toContain('if (btnRun) btnRun.disabled = false;');
    expect(rest).not.toContain('if (btnRun) btnRun.disabled = true;');
  });

  it('flags the attempt instead of blocking it', () => {
    expect(page).toContain('proctored: !window._procCameraBlocked');
    expect(page).toContain('violations: _procViolations');
  });
});

describe('violations are actually recorded', () => {
  it('the route the page has always POSTed to now exists', () => {
    expect(page).toContain("fetch('/student/proctoring/violation'");
    expect(source).toContain('app.post("/student/proctoring/violation"');
  });

  it('takes the student from the session, not from the body', () => {
    // Otherwise a student can log violations against a classmate.
    const at = source.indexOf('app.post("/student/proctoring/violation"');
    const block = source.slice(at, at + 1200);
    expect(block).toContain('req.session.student.employeeId');
    expect(block).not.toMatch(/const employeeId = .*req\.body/);
  });

  it('is stored, and readable by a coordinator', () => {
    expect(source).toContain('const ProctoringEvent = mongoose.model("ProctoringEvent"');
    expect(source).toContain('app.get("/coordinator/proctoring/:employeeId", requireStaffSession');
  });

  it('the submission carries the proctoring state', () => {
    const at = source.indexOf('const codingSubmissionSchema');
    const block = source.slice(at, at + 1600);
    expect(block).toContain('proctored:');
    expect(block).toContain('violations:');
  });
});

describe('a submission is filed under the person who made it', () => {
  it('/code/submit reads the employee ID from the session', () => {
    // It was read from the request body, so a student could file an accepted
    // solution under somebody else's ID and take their score.
    const at = source.indexOf('app.post("/code/submit"');
    const block = source.slice(at, at + 1400);
    expect(block).toContain('req.session.student.employeeId');
    expect(block).not.toMatch(/const \{ employeeId, questionId/);
  });
});

describe('the runner is contained before it is switched on', () => {
  it('does not hand a student program this server\'s secrets', () => {
    // spawn() inherits process.env by default, which on this server holds
    // MONGODB_URI, SESSION_SECRET, ADMIN_PASSWORD_HASH and the SMTP password.
    // console.log(process.env) read all of them.
    expect(source).toContain('function _sandboxEnv(');
    expect(source).toContain('env: _sandboxEnv(opts && opts.cwd)');
    const at = source.indexOf('function _sandboxEnv(');
    const fn = source.slice(at, source.indexOf('\n}', at));
    expect(fn).not.toContain('...process.env');
    expect(fn).not.toContain('Object.assign({}, process.env');
    // Only an allowlist, and PATH is the most sensitive thing in it.
    expect(fn).toContain('PATH:');
    expect(fn).not.toMatch(/MONGODB_URI|SESSION_SECRET|SMTP|ADMIN_/);
  });

  it('kills a program that forks, along with its children', () => {
    expect(source).toContain("detached: process.platform !== \"win32\"");
    expect(source).toContain('process.kill(-child.pid, "SIGKILL")');
  });

  it('stays off unless the flag is explicitly true', () => {
    expect(source).toContain('const CODE_RUNNER_ENABLED = String(process.env.ENABLE_CODE_RUNNER || "").toLowerCase() === "true"');
  });

  it('says so before a student writes a whole solution', () => {
    // The refusal used to arrive only after pressing Run.
    expect(source).toContain('app.get("/api/code-runner/status"');
    expect(page).toContain('async function checkRunnerAvailability()');
    expect(page).toContain('checkRunnerAvailability();');
  });

  it('the status endpoint returns a boolean and nothing else', () => {
    const at = source.indexOf('app.get("/api/code-runner/status"');
    const block = source.slice(at, at + 400);
    expect(block).toContain('enabled: CODE_RUNNER_ENABLED');
    expect(block).not.toMatch(/process\.env\.[A-Z_]+\s*[,}]/);
  });
});

describe('"Open in Terminal" no longer prints a server path to students', () => {
  it('the endpoint that built a /tmp workspace is gone', () => {
    // It told the reader to open a terminal and cd into a directory on the
    // production host. Nobody reading the dashboard has a shell there.
    expect(source).not.toContain('/student/coding/open-terminal');
    expect(source).not.toContain('/student/coding/submit-from-terminal');
    expect(page).not.toContain('/student/coding/open-terminal');
  });

  it('the button opens the run console instead', () => {
    expect(page).toContain("function openInTerminal(){\n  switchCmTab('terminal');");
    expect(page).not.toContain('Terminal Workspace Ready');
    expect(page).not.toContain('Copy Path');
  });

  it('the terminal pane describes what it actually is', () => {
    expect(page).toContain('Run console');
    expect(page).not.toContain('bash submit.sh</span> to submit');
  });
});
