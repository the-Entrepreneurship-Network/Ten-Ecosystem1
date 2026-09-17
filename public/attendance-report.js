/*
 * Attendance report panels, shared by the student, coordinator and HR
 * dashboards. Everything comes from /api/v2/attendance-agent, which reads the
 * attendance Google Form's response sheet: one column per day, a count per
 * cell, a tick once the day's required number of submissions is reached.
 *
 *   TENAttendanceReport.mountStudent(el, { headers })   my days
 *   TENAttendanceReport.mountStaff(el, { headers })     everyone, with filters
 */
(function () {
  "use strict";

  var API = "/api/v2/attendance-agent";
  var STYLE_ID = "ten-attendance-report-style";

  var CSS = [
    ".ar{font-family:inherit;color:inherit}",
    ".ar-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px}",
    ".ar-field{display:flex;flex-direction:column;gap:4px;font-size:12px;opacity:.9}",
    ".ar-field input,.ar-field select{padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;font:inherit;min-width:150px}",
    ".ar-btn{padding:9px 14px;border-radius:8px;border:1px solid rgba(212,175,55,.6);background:rgba(212,175,55,.15);color:inherit;font:inherit;font-weight:600;cursor:pointer}",
    ".ar-btn:hover{background:rgba(212,175,55,.3)}",
    ".ar-btn.ar-primary{background:#d4af37;color:#111;border-color:#d4af37}",
    ".ar-stats{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 14px}",
    ".ar-stat{padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);min-width:120px}",
    ".ar-stat b{display:block;font-size:20px}",
    ".ar-stat span{font-size:12px;opacity:.75}",
    ".ar-wrap{overflow:auto;max-height:70vh;border:1px solid rgba(255,255,255,.1);border-radius:10px}",
    ".ar table{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}",
    ".ar th,.ar td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);white-space:nowrap;text-align:left}",
    ".ar thead th{position:sticky;top:0;background:#141a2e;z-index:2;font-weight:600}",
    ".ar th.ar-sticky,.ar td.ar-sticky{position:sticky;left:0;background:#141a2e;z-index:1}",
    ".ar th.ar-sticky2,.ar td.ar-sticky2{position:sticky;left:170px;background:#141a2e;z-index:1}",
    ".ar thead th.ar-sticky{z-index:3}.ar thead th.ar-sticky2{z-index:3}",
    ".ar td.ar-day{text-align:center}",
    ".ar-ok{color:#4ade80;font-weight:700}.ar-part{color:#fbbf24;font-weight:700}.ar-none{opacity:.35}",
    ".ar-note{font-size:12px;opacity:.7;margin-top:8px}",
    ".ar-search{position:relative}",
    ".ar-suggest{position:absolute;top:100%;left:0;right:0;z-index:5;background:#141a2e;border:1px solid rgba(255,255,255,.18);border-radius:8px;margin-top:4px;max-height:220px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.4)}",
    ".ar-suggest-item{padding:8px 10px;cursor:pointer;font-size:13px}.ar-suggest-item:hover{background:rgba(212,175,55,.2)}.ar-suggest-item small{opacity:.55}",
    ".ar-err{padding:12px 14px;border-radius:10px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4)}",
    ".ar-empty{padding:18px;text-align:center;opacity:.7}",
    ".ar-card{margin-top:12px;padding:14px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04)}",
    ".ar-wide{width:100%}.ar-wide input{width:100%;box-sizing:border-box}",
    ".ar-card input:disabled{opacity:.55}",
  ].join("\n");

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function monthStart(key) { return key.slice(0, 7) + "-01"; }
  function ddmm(key) { return key.slice(8, 10) + "/" + key.slice(5, 7); }
  function human(key) {
    var d = new Date(key + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  function query(params) {
    return Object.keys(params).filter(function (k) { return params[k] !== "" && params[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
  }

  function getJson(path, params, headers) {
    return fetch(API + path + "?" + query(params), { credentials: "same-origin", headers: headers || {} })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || ("HTTP " + r.status)); return j; }); });
  }

  // Downloads go through fetch so the HR bearer header travels with them.
  function download(path, params, headers, filename) {
    return fetch(API + path + "?" + query(params), { credentials: "same-origin", headers: headers || {} })
      .then(function (r) { if (!r.ok) throw new Error("Download failed (HTTP " + r.status + ")"); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = h("a", { href: url, download: filename });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });
  }

  function cell(count, required) {
    if (!count) return h("td", { class: "ar-day ar-none", text: "–" });
    if (count >= required) return h("td", { class: "ar-day ar-ok", title: count + " response" + (count === 1 ? "" : "s") }, ["✓ " + count]);
    return h("td", { class: "ar-day ar-part", title: count + " of " + required }, [count + "/" + required]);
  }

  function errorBox(err) {
    return h("div", { class: "ar-err" }, [
      h("b", { text: "Attendance report unavailable. " }),
      h("span", { text: err && err.message ? err.message : String(err) }),
    ]);
  }

  // ---------- student ----------

  function mountStudent(el, opts) {
    if (!el) return;
    opts = opts || {};
    css();
    var to = todayKey();
    var state = { from: monthStart(to), to: to };
    el.innerHTML = "";
    var root = h("div", { class: "ar" });
    el.appendChild(root);

    function render(data) {
      root.innerHTML = "";
      var bar = h("div", { class: "ar-bar" }, [
        h("label", { class: "ar-field" }, ["From", h("input", { type: "date", value: state.from, onchange: function (e) { state.from = e.target.value; } })]),
        h("label", { class: "ar-field" }, ["To", h("input", { type: "date", value: state.to, onchange: function (e) { state.to = e.target.value; } })]),
        h("button", { class: "ar-btn", onclick: load, text: "Check my attendance" }),
        h("button", { class: "ar-btn ar-primary", text: "Download CSV", onclick: function () {
          download("/my.csv", { from: state.from, to: state.to }, opts.headers, "my-attendance-" + state.from + "-to-" + state.to + ".csv").catch(function (e) { alert(e.message); });
        } }),
      ]);
      root.appendChild(bar);
      if (!data) return;

      root.appendChild(h("div", { class: "ar-stats" }, [
        h("div", { class: "ar-stat" }, [h("b", { text: String(data.totals.daysComplete) }), h("span", { text: "days complete (" + data.required + "x)" })]),
        h("div", { class: "ar-stat" }, [h("b", { text: String(data.totals.daysMarked) }), h("span", { text: "days with a response" })]),
        h("div", { class: "ar-stat" }, [h("b", { text: String(data.totals.responses) }), h("span", { text: "responses in range" })]),
        h("div", { class: "ar-stat" }, [h("b", { text: data.employeeId || "—" }), h("span", { text: data.domain || "" })]),
      ]));

      if (!data.days.length) { root.appendChild(h("div", { class: "ar-empty", text: "No form responses recorded in this range." })); return; }
      var tbody = h("tbody");
      data.days.slice().reverse().forEach(function (d) {
        tbody.appendChild(h("tr", null, [
          h("td", { text: human(d.date) + "  (" + d.date + ")" }),
          h("td", { class: "ar-day", text: String(d.count) }),
          d.complete ? h("td", { class: "ar-ok", text: "✓ Marked" }) : d.count ? h("td", { class: "ar-part", text: "Partial " + d.count + "/" + data.required }) : h("td", { class: "ar-none", text: "Not marked" }),
        ]));
      });
      root.appendChild(h("div", { class: "ar-wrap" }, [h("table", null, [
        h("thead", null, [h("tr", null, [h("th", { text: "Date" }), h("th", { text: "Responses" }), h("th", { text: "Status" })])]),
        tbody,
      ])]));
      root.appendChild(h("div", { class: "ar-note", text: "A day counts as marked once the form has been filled " + data.required + " time" + (data.required === 1 ? "" : "s") + "." }));
    }

    function load() {
      render(null);
      root.appendChild(h("div", { class: "ar-empty", text: "Loading…" }));
      getJson("/my", { from: state.from, to: state.to }, opts.headers)
        .then(render)
        .catch(function (e) { render(null); root.appendChild(errorBox(e)); });
    }
    load();
  }

  // ---------- staff ----------

  function mountStaff(el, opts) {
    if (!el) return;
    opts = opts || {};
    css();
    var to = todayKey();
    var state = { from: monthStart(to), to: to, domain: "", q: "" };
    var last = null;
    el.innerHTML = "";
    var root = h("div", { class: "ar" });
    el.appendChild(root);
    var settingsHost = h("div", { class: "ar" });
    el.appendChild(settingsHost);
    mountSettings(settingsHost);

    // HR only: the sheet link, the number, the time and the token, saved on
    // the server. Coordinators get a 401 here and see no card.
    function mountSettings(host) {
      getJson("/settings", {}, opts.headers)
        .then(function (data) { renderSettings(host, data.settings); })
        .catch(function () { host.remove(); });
    }

    function renderSettings(host, s) {
      host.innerHTML = "";
      var card = h("div", { class: "ar-card" });
      card.hidden = true;
      var toggle = h("button", { class: "ar-btn", text: "Agent settings", onclick: function () { card.hidden = !card.hidden; } });
      var fields = [
        ["sheetUrl", "Responses sheet link (shared as: Anyone with the link, Viewer)", "url", "https://docs.google.com/spreadsheets/d/.../edit"],
        ["reportTo", "Report goes to (WhatsApp number with country code; comma for several)", "text", "918317873609"],
        ["reportTime", "Send time, 24-hour, " + (s.tz || "Asia/Kolkata"), "time", "23:05"],
        ["requiredPerDay", "Submissions required per day for a tick", "number", "2"],
        ["phoneNumberId", "WhatsApp sender: phone number ID", "text", "1243779175483305"],
        ["whatsappToken", "WhatsApp access token" + (s.tokenSet ? " (set: " + s.values.whatsappToken + "; retype to replace)" : " (not set)"), "password", ""],
        ["n8nWebhookUrl", "n8n webhook URL (optional; used instead of Meta when set)", "url", ""],
      ];
      var inputs = {};
      fields.forEach(function (f) {
        var locked = s.source && s.source[f[0]] === "env";
        var inp = h("input", { type: f[2], placeholder: f[3], autocomplete: "off", value: f[0] === "whatsappToken" ? "" : String(s.values[f[0]] || "") });
        if (locked) inp.disabled = true;
        inputs[f[0]] = inp;
        card.appendChild(h("label", { class: "ar-field ar-wide" }, [f[1] + (locked ? "  (set on the server; change it there)" : ""), inp]));
      });
      var msg = h("div", { class: "ar-note" });
      var status = "Report at " + (s.reportTime || "?") + " " + (s.tz || "") + " to " + (s.recipients && s.recipients.length ? s.recipients.join(", ") : "nobody yet") + ". Sheet " + (s.formConfigured ? "configured" : "not set") + ". Sending via " + s.transport + ".";
      var save = h("button", { class: "ar-btn ar-primary", text: "Save", onclick: function () {
        var body = {};
        Object.keys(inputs).forEach(function (k) { if (!inputs[k].disabled) body[k] = inputs[k].value; });
        if (!body.whatsappToken) delete body.whatsappToken;
        msg.textContent = "Saving\u2026";
        fetch(API + "/settings", { method: "PUT", credentials: "same-origin", headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}), body: JSON.stringify(body) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.success) throw new Error(j.message || ("HTTP " + r.status)); return j; }); })
          .then(function (j) { renderSettings(host, j.settings); host.querySelector(".ar-card").hidden = false; host.querySelector(".ar-note").textContent = "Saved. " + host.querySelector(".ar-note").textContent; load(); })
          .catch(function (e) { msg.textContent = "Not saved: " + e.message; });
      } });
      var test = h("button", { class: "ar-btn", text: "Send test WhatsApp", onclick: function () {
        msg.textContent = "Sending\u2026";
        fetch(API + "/settings/test-send", { method: "POST", credentials: "same-origin", headers: opts.headers || {} })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            msg.textContent = j.success
              ? "Test message delivered to " + j.results.map(function (x) { return x.to; }).join(", ") + "."
              : "Not delivered: " + (j.message || (j.results || []).map(function (x) { return x.to + ": " + (x.error || "failed"); }).join("; "));
          })
          .catch(function (e) { msg.textContent = "Not delivered: " + e.message; });
      } });
      card.appendChild(h("div", { class: "ar-bar" }, [save, test]));
      msg.textContent = status;
      card.appendChild(msg);
      host.appendChild(toggle);
      host.appendChild(card);
    }

    // Suggestions are domains only, the same rule as the server: a domain
    // starting with what was typed ranks first ("s" lists every S domain), a
    // word starting with it next ("d" lists Web Development), then a
    // substring, then the typed characters in order ("softe").
    function fuzzy(needle, hay) {
      var n = String(needle || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      var s = String(hay || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!n) return false;
      if (s.indexOf(n) !== -1) return true;
      var i = 0;
      for (var k = 0; k < s.length && i < n.length; k++) if (s[k] === n[i]) i++;
      return i === n.length;
    }
    function rank(q, domain) {
      var n = String(q || "").trim().toLowerCase();
      var d = String(domain || "").trim().toLowerCase();
      if (!n || !d) return -1;
      if (d.indexOf(n) === 0) return 0;
      if (d.split(/[^a-z0-9]+/).some(function (w) { return w && w.indexOf(n) === 0; })) return 1;
      if (d.indexOf(n) !== -1) return 2;
      if (fuzzy(n, d)) return 3;
      return -1;
    }

    function suggestBox(input, data) {
      var box = h("div", { class: "ar-suggest" });
      var domains = (data.domains || []).slice();
      function refresh() {
        box.innerHTML = "";
        var q = input.value.trim();
        if (!q) { box.hidden = true; return; }
        var hits = domains.map(function (d) { return { d: d, r: rank(q, d) }; })
          .filter(function (x) { return x.r >= 0; })
          .sort(function (a, b) { return a.r - b.r || a.d.localeCompare(b.d); })
          .slice(0, 10);
        if (!hits.length) { box.hidden = true; return; }
        hits.forEach(function (x) {
          box.appendChild(h("div", { class: "ar-suggest-item", text: x.d, onmousedown: function (e) {
            e.preventDefault();
            state.domain = x.d; state.q = ""; input.value = x.d;
            box.hidden = true;
            load();
          } }));
        });
        box.hidden = false;
      }
      input.addEventListener("input", refresh);
      input.addEventListener("focus", refresh);
      input.addEventListener("blur", function () { setTimeout(function () { box.hidden = true; }, 150); });
      box.hidden = true;
      return box;
    }

    function render(data) {
      root.innerHTML = "";
      // Typing narrows by domain as typed; picking a suggestion pins it.
      var search = h("input", { type: "search", autocomplete: "off", placeholder: "Type a domain, e.g. s or softe", value: state.domain || state.q,
        oninput: function (e) { state.q = e.target.value; state.domain = ""; },
        onkeydown: function (e) { if (e.key === "Enter") load(); } });
      var searchField = h("label", { class: "ar-field ar-search" }, ["Search domain", search]);
      if (data) searchField.appendChild(suggestBox(search, data));
      var bar = h("div", { class: "ar-bar" }, [
        searchField,
        h("label", { class: "ar-field" }, ["From", h("input", { type: "date", value: state.from, onchange: function (e) { state.from = e.target.value; } })]),
        h("label", { class: "ar-field" }, ["To", h("input", { type: "date", value: state.to, onchange: function (e) { state.to = e.target.value; } })]),
        h("button", { class: "ar-btn", text: "Apply", onclick: load }),
        h("button", { class: "ar-btn", text: "Reset", onclick: function () { state.domain = ""; state.q = ""; state.from = monthStart(todayKey()); state.to = todayKey(); load(); } }),
        h("button", { class: "ar-btn ar-primary", text: "Download CSV", onclick: function () {
          download("/all.csv", params(), opts.headers, "attendance-" + state.from + "-to-" + state.to + ".csv").catch(function (e) { alert(e.message); });
        } }),
      ]);
      root.appendChild(bar);
      if (!data) return;

      root.appendChild(h("div", { class: "ar-stats" }, [
        h("div", { class: "ar-stat" }, [h("b", { text: String(data.total) }), h("span", { text: "students shown" + (data.total !== data.totalPeople ? " of " + data.totalPeople : "") })]),
        h("div", { class: "ar-stat" }, [h("b", { text: String(data.dates.length) }), h("span", { text: "days with responses" })]),
        h("div", { class: "ar-stat" }, [h("b", { text: String(data.responses) }), h("span", { text: "responses in range" })]),
        h("div", { class: "ar-stat" }, [h("b", { text: data.required + "x" }), h("span", { text: "per day to count" })]),
      ]));

      if (!data.people.length) { root.appendChild(h("div", { class: "ar-empty", text: "No responses match." })); return; }

      var head = h("tr", null, [h("th", { class: "ar-sticky", text: "Student" }), h("th", { class: "ar-sticky2", text: "Employee ID" }), h("th", { text: "Domain" })]);
      data.dates.forEach(function (d) { head.appendChild(h("th", { title: d, text: ddmm(d) })); });
      head.appendChild(h("th", { text: "Days" })); head.appendChild(h("th", { text: "Complete" })); head.appendChild(h("th", { text: "Responses" }));

      var tbody = h("tbody");
      data.people.forEach(function (p) {
        var tr = h("tr", null, [h("td", { class: "ar-sticky", text: p.name || "—" }), h("td", { class: "ar-sticky2", text: p.employeeId || "—" }), h("td", { text: p.domain || "" })]);
        data.dates.forEach(function (d) { tr.appendChild(cell(p.days[d] || 0, data.required)); });
        tr.appendChild(h("td", { class: "ar-day", text: String(p.daysMarked) }));
        tr.appendChild(h("td", { class: "ar-day", text: String(p.daysComplete) }));
        tr.appendChild(h("td", { class: "ar-day", text: String(p.responses) }));
        tbody.appendChild(tr);
      });
      root.appendChild(h("div", { class: "ar-wrap" }, [h("table", null, [h("thead", null, [head]), tbody])]));
      root.appendChild(h("div", { class: "ar-note", text: "✓ = filled " + data.required + " time" + (data.required === 1 ? "" : "s") + " that day; n/" + data.required + " = fewer; – = no response." }));
    }

    function params() { return { from: state.from, to: state.to, domain: state.domain, q: state.domain ? "" : state.q }; }

    function load() {
      render(last);
      root.appendChild(h("div", { class: "ar-empty", text: "Loading…" }));
      getJson("/all", params(), opts.headers)
        .then(function (data) { last = data; render(data); })
        .catch(function (e) { render(last); root.appendChild(errorBox(e)); });
    }
    load();
  }

  window.TENAttendanceReport = { mountStudent: mountStudent, mountStaff: mountStaff };
})();
