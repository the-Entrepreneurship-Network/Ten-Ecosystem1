'use strict';
/* globals window, document, fetch, FormData, AbortController, setTimeout, clearTimeout */

/*
 * The one resume uploader.
 *
 * Both registration pages had their own copy of this, and both copies carried
 * the same two faults: they trusted the browser's mimetype label, and they read
 * the reply with a bare `res.json()`. A phone that hands over a PDF labelled
 * `application/octet-stream` was turned away before it ever left the device, and
 * anything that answered with something other than JSON — an nginx 413 page, a
 * 502 during a restart — threw inside the parse, so every one of those distinct
 * failures reached the student as the same sentence: "Upload failed. Tap to
 * retry." Nobody could act on it, so it kept happening.
 */
(function initResumeUpload() {
  var MAX_BYTES = 5 * 1024 * 1024;
  var TIMEOUT_MS = 60000;

  /*
   * Is this a PDF?
   *
   * The extension decides, not `file.type`. The type is whatever the operating
   * system's file picker chose to say, and Android routinely says
   * `application/octet-stream` or nothing at all for a file downloaded from
   * WhatsApp, Drive or Gmail. Rejecting on that label turns away a real PDF.
   * The label is still consulted for a positive contradiction — a file calling
   * itself an image is not a PDF whatever its name says — and the server checks
   * the actual bytes, which is the only claim that cannot be faked.
   */
  function validate(file) {
    if (!file) return 'Choose a PDF file to upload.';
    if (!/\.pdf$/i.test(file.name || '')) {
      return 'Registration accepts PDF files only. Rename or re-export your resume as a .pdf and try again.';
    }
    var type = (file.type || '').toLowerCase();
    if (type && type !== 'application/pdf' && type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
      return 'That file is a ' + type + ', not a PDF. Export your resume as a PDF and try again.';
    }
    if (!file.size) return 'That file is empty. Pick the resume again.';
    if (file.size > MAX_BYTES) {
      return 'Maximum resume size is 5MB. Yours is ' + (file.size / 1048576).toFixed(1) + 'MB.';
    }
    return null;
  }

  // What the student should be told, per status. A number they cannot act on is
  // no better than the generic line it replaces.
  function messageForStatus(status) {
    if (status === 413) return 'The server refused the file for being too large. Try a PDF under 5MB.';
    if (status === 429) return 'Too many uploads from this network just now. Wait a minute and try again.';
    if (status === 401 || status === 403) return 'The server refused the upload. Reload the page and try again.';
    if (status === 502 || status === 503 || status === 504) return 'The server is busy or restarting. Try again in a moment.';
    if (status >= 500) return 'The server hit an error saving the file. Try again in a moment.';
    return 'Upload failed (error ' + status + '). Please try again.';
  }

  async function send(file) {
    var body = new FormData();
    body.append('resume', file);

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    // Without this a stalled mobile connection leaves "Uploading..." on screen
    // for ever, which reads as a hang rather than a failure worth retrying.
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    try {
      var res = await fetch('/api/v2/upload-resume', {
        method: 'POST',
        body: body,
        signal: controller ? controller.signal : undefined
      });

      // Parse defensively: an error from in front of the app — nginx, a load
      // balancer — is an HTML page, and that is exactly the case this used to
      // throw on instead of reporting.
      var data = null;
      try { data = await res.json(); } catch (_) { data = null; }

      if (!res.ok) {
        return { ok: false, message: (data && data.message) || messageForStatus(res.status), status: res.status };
      }
      if (!data || !data.success || !data.filePath) {
        return { ok: false, message: (data && data.message) || 'The server did not return a saved file. Please try again.', status: res.status };
      }
      return { ok: true, filePath: data.filePath };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /*
   * Upload, with exactly one retry.
   *
   * The retry is for the dropped connection only — a phone changing towers
   * mid-upload, which is the ordinary condition this form is filled in under. A
   * refusal is not retried: the server has already answered and will answer the
   * same way again.
   */
  async function upload(file) {
    var invalid = validate(file);
    if (invalid) return { ok: false, message: invalid, rejected: true };

    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        return await send(file);
      } catch (err) {
        if (attempt === 0) continue;
        var aborted = err && err.name === 'AbortError';
        return {
          ok: false,
          message: aborted
            ? 'The upload timed out. Check your connection and try again.'
            : 'Could not reach the server. Check your connection and try again.'
        };
      }
    }
  }

  window.TENResumeUpload = { validate: validate, upload: upload, MAX_BYTES: MAX_BYTES };
})();
