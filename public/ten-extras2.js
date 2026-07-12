/* TEN extras (Phase 2) — additional client widgets:
 *   - TenExtras2.injectStudent({ student, mountId })
 *       My Coordinator card + My Domains switcher (only renders if there
 *       are linked domains beyond the current one).
 *   - TenExtras2.bulkDeleteSelector({ tableSelector }) — adds checkboxes
 *       to existing submission rows (renderSubmissions output) and a
 *       floating action bar.
 *
 * Keeps the same gold/dark theme as ten-extras.js.
 */
(function (w) {
    "use strict";
    if (w.TenExtras2) return;

    function styles() {
        if (document.getElementById("tx2-styles")) return;
        const css =
            ".tx2-card{background:#0c1220;border:1px solid rgba(245,197,66,0.18);border-radius:18px;padding:20px 22px;margin-bottom:18px;color:#e2eaf7;font-family:'Plus Jakarta Sans','Outfit',sans-serif;}"
            + ".tx2-card h3{font-family:'Syne','Plus Jakarta Sans',sans-serif;font-size:15px;font-weight:800;color:#f5c542;letter-spacing:.5px;margin:0 0 12px;text-transform:uppercase;display:flex;align-items:center;gap:8px;}"
            + ".tx2-coord{display:flex;align-items:center;gap:14px;}"
            + ".tx2-avatar{width:50px;height:50px;border-radius:14px;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;}"
            + ".tx2-coord-name{font-size:15px;font-weight:700;color:#cdd9ec;}"
            + ".tx2-coord-meta{font-size:12px;color:#8aa4c8;margin-top:3px;}"
            + ".tx2-coord-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;}"
            + ".tx2-btn{padding:8px 14px;background:rgba(99,140,210,0.08);border:1px solid rgba(99,140,210,0.25);border-radius:9px;color:#cdd9ec;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:6px;}"
            + ".tx2-btn:hover{border-color:#f5c542;color:#f5c542;}"
            + ".tx2-btn-primary{background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border:none;}"
            + ".tx2-domains{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}"
            + ".tx2-domain{background:rgba(99,140,210,0.06);border:1px solid rgba(99,140,210,0.20);border-radius:12px;padding:14px;cursor:pointer;transition:transform .15s,border-color .15s;}"
            + ".tx2-domain:hover{transform:translateY(-2px);border-color:#f5c542;}"
            + ".tx2-domain.current{border-color:rgba(245,197,66,0.45);background:rgba(245,197,66,0.06);}"
            + ".tx2-domain-name{font-weight:700;font-size:13px;color:#cdd9ec;margin-bottom:4px;}"
            + ".tx2-domain-id{font-family:'JetBrains Mono',monospace;font-size:11px;color:#f5c542;}"
            + ".tx2-domain-cur{font-size:10px;color:#10b981;font-weight:700;margin-top:4px;letter-spacing:1px;text-transform:uppercase;}"
            + ".tx2-empty{color:#5a7299;font-size:12px;padding:14px 0;}"
            + ".tx2-bar{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#0c1220;border:1px solid rgba(245,197,66,0.32);border-radius:14px;padding:10px 16px;display:none;align-items:center;gap:10px;z-index:9997;box-shadow:0 14px 40px rgba(0,0,0,.5);}"
            + ".tx2-bar.show{display:flex;}"
            + ".tx2-bar .count{font-size:13px;color:#cdd9ec;font-weight:700;}";
        const s = document.createElement("style");
        s.id = "tx2-styles"; s.textContent = css;
        document.head.appendChild(s);
    }

    function esc(x){ return String(x==null?"":x).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

    async function loadCoordCard(student, root) {
        try {
            const r = await fetch("/student/coordinator-details?domain=" + encodeURIComponent(student.domain || ""));
            const d = await r.json();
            if (!d.success || !d.assigned) {
                root.innerHTML = '<div class="tx2-empty">Coordinator not yet assigned for ' + esc(student.domain) + '.</div>';
                return;
            }
            const c = d.coordinator || {};
            const name = c.name || "Coordinator";
            const initial = (name[0] || "C").toUpperCase();
            root.innerHTML =
                '<div class="tx2-coord">'
                + '<div class="tx2-avatar">' + esc(initial) + '</div>'
                + '<div>'
                +   '<div class="tx2-coord-name">' + esc(name) + '</div>'
                +   '<div class="tx2-coord-meta">' + esc(c.domain || "") + (c.email ? ' · ' + esc(c.email) : "") + (c.whatsapp ? ' · ' + esc(c.whatsapp) : "") + '</div>'
                + '</div>'
                + '<div class="tx2-coord-actions">'
                +   '<button class="tx2-btn tx2-btn-primary" id="tx2-msg-coord">💬 Message Coordinator</button>'
                + '</div>'
                + '</div>';
            const btn = document.getElementById("tx2-msg-coord");
            if (btn) btn.addEventListener("click", () => {
                // Open the existing TenChat domain chat popup if it's loaded.
                if (window.TenChat) {
                    // Fallback: simulate a click on the dock's domain-chat button.
                    const dom = document.querySelector('#tc-dock [data-room^="domain_"]');
                    if (dom) dom.click();
                } else {
                    alert("Domain chat is not loaded yet.");
                }
            });
        } catch (e) {
            root.innerHTML = '<div class="tx2-empty">Could not load coordinator details.</div>';
        }
    }

    function renderDomainsCard(student, root) {
        const linked = Array.isArray(student.linkedDomains) ? student.linkedDomains : [];
        // Only render the card if the student has more than one linked domain.
        if (linked.length < 2) { root.innerHTML = ""; return; }
        root.innerHTML = '<div class="tx2-domains">'
            + linked.map(ld => {
                const isCurrent = (ld.domain === student.domain);
                return '<div class="tx2-domain ' + (isCurrent ? "current" : "") + '" data-domain="' + esc(ld.domain) + '">'
                    + '<div class="tx2-domain-name">' + esc(ld.domain) + '</div>'
                    + '<div class="tx2-domain-id">' + esc(ld.employeeId || "") + '</div>'
                    + (isCurrent
                        ? '<div class="tx2-domain-cur">✓ Currently viewing</div>'
                        : '<div class="tx2-domain-cur" style="color:#9aa4bf;">Click to switch →</div>')
                    + '</div>';
            }).join("")
            + '</div>';
        root.querySelectorAll(".tx2-domain").forEach(el => {
            el.addEventListener("click", async () => {
                const target = el.dataset.domain;
                if (target === student.domain) return;
                try {
                    const r = await fetch("/student/switch-domain", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ 
                            email: student.email, 
                            employeeId: student.employeeId, 
                            targetDomain: target 
                        })
                    });
                    const d = await r.json();
                    if (d.success) {
                        // Update both localStorage and sessionStorage and reload
                        const next = Object.assign({}, student, d.student, { linkedDomains: student.linkedDomains });
                        localStorage.setItem("student", JSON.stringify(next));
                        localStorage.setItem("employeeId", next.employeeId);
                        sessionStorage.setItem("student", JSON.stringify(next));
                        window.location.reload();
                    } else {
                        alert(d.message || "Could not switch domain.");
                    }
                } catch (e) { alert("Network error."); }
            });
        });
    }

    function injectStudent(opts) {
        styles();
        const mount = document.getElementById(opts.mountId);
        if (!mount) return;
        mount.innerHTML =
              '<div class="tx2-card"><h3>👤 My Coordinator</h3><div id="tx2-coord-root"></div></div>'
            + '<div class="tx2-card" id="tx2-domains-card"><h3>🏢 My Domains</h3><div id="tx2-domains-root"></div></div>';
        loadCoordCard(opts.student, document.getElementById("tx2-coord-root"));
        const drRoot = document.getElementById("tx2-domains-root");
        renderDomainsCard(opts.student, drRoot);
        // Hide the whole card if there's nothing to show
        if (!drRoot.innerHTML.trim()) {
            document.getElementById("tx2-domains-card").style.display = "none";
        }
    }

    /* Adds checkboxes + a floating action bar to existing submission cards.
     * Expects the dashboard's renderSubmissions output where each card has
     * data-id and data-status attributes.
     */
    function bulkSubmissionsToolbar(opts) {
        styles();
        const containerSel = opts && opts.containerSel || "#submissionContainer";
        const employeeId = opts.employeeId;
        if (!document.getElementById("tx2-bar")) {
            const bar = document.createElement("div");
            bar.id = "tx2-bar"; bar.className = "tx2-bar";
            bar.innerHTML =
                '<span class="count" id="tx2-count">0 selected</span>'
                + '<button class="tx2-btn" id="tx2-delete" style="background:linear-gradient(135deg,#b91c1c,#ef4444);color:#fff;border:none;">🗑 Delete Selected</button>'
                + '<button class="tx2-btn" id="tx2-clear">Clear</button>';
            document.body.appendChild(bar);
            document.getElementById("tx2-clear").addEventListener("click", () => {
                document.querySelectorAll('.tx2-cb:checked').forEach(c => c.checked = false);
                refreshBar();
            });
            document.getElementById("tx2-delete").addEventListener("click", async () => {
                const ids = Array.from(document.querySelectorAll('.tx2-cb:checked')).map(c => c.dataset.id);
                if (!ids.length) return;
                const msg = "Delete " + ids.length + " reviewed submission" + (ids.length === 1 ? "" : "s") + "? This cannot be undone.";
                if (!confirm(msg)) return;
                try {
                    const r = await fetch("/submissions/bulk-delete", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ids, employeeId })
                    });
                    const d = await r.json();
                    if (d.success) {
                        if (opts.onDeleted) opts.onDeleted(d.deleted, d.skipped);
                        else if (window.loadStudentSubmissions) window.loadStudentSubmissions();
                    } else {
                        alert(d.message || "Bulk delete failed.");
                    }
                } catch (e) { alert("Network error."); }
            });
        }
        // Decorate each existing submission card with a checkbox if it doesn't have one yet
        const container = document.querySelector(containerSel);
        if (!container) return;
        container.querySelectorAll("[data-sub-id]").forEach(card => {
            if (card.querySelector(".tx2-cb-wrap")) return;
            const status = card.dataset.subStatus;
            if (status !== "Approved" && status !== "Rejected") return;     // pending: no checkbox
            const wrap = document.createElement("label");
            wrap.className = "tx2-cb-wrap";
            wrap.style.cssText = "display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#9aa4bf;margin-top:6px;cursor:pointer;";
            wrap.innerHTML = '<input type="checkbox" class="tx2-cb" data-id="' + esc(card.dataset.subId) + '"> Select for bulk delete';
            card.appendChild(wrap);
            wrap.querySelector("input").addEventListener("change", refreshBar);
        });

        function refreshBar() {
            const sel = document.querySelectorAll('.tx2-cb:checked').length;
            const bar = document.getElementById("tx2-bar");
            const count = document.getElementById("tx2-count");
            if (sel > 0) { bar.classList.add("show"); count.textContent = sel + " selected"; }
            else { bar.classList.remove("show"); }
        }
    }

    w.TenExtras2 = { injectStudent, bulkSubmissionsToolbar };
})(window);
