/* Shared "Forgot Password" modal used by login.html, coordinator-login.html
 * and hr-login.html. Call TenForgotPassword.init({ role: "student" })
 * after the page loads. The script auto-injects a "Forgot password?" link
 * after every visible password input on the page if the page does not
 * already include one with the id `tfp-link`.
 */
(function (w) {
    "use strict";
    if (w.TenForgotPassword) return;

    function styles() {
        if (document.getElementById("tfp-styles")) return;
        const css =
            ".tfp-link{display:inline-block;margin-top:8px;font-size:12px;color:#f5c542;cursor:pointer;text-decoration:none;font-weight:600;}"
            + ".tfp-link:hover{text-decoration:underline;}"
            + ".tfp-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:99998;align-items:center;justify-content:center;font-family:'Plus Jakarta Sans','Outfit',Segoe UI,Arial,sans-serif;}"
            + ".tfp-overlay.open{display:flex;}"
            + ".tfp-modal{background:#0c1220;border:1px solid rgba(245,197,66,0.22);border-radius:18px;padding:30px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#f0eee8;}"
            + ".tfp-title{font-size:18px;font-weight:800;color:#f5c542;margin-bottom:6px;}"
            + ".tfp-sub{font-size:13px;color:#9aa4bf;margin-bottom:16px;line-height:1.5;}"
            + ".tfp-row{margin-bottom:12px;}"
            + ".tfp-row label{display:block;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#9aa4bf;margin-bottom:6px;}"
            + ".tfp-row input{width:100%;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(245,197,66,0.18);border-radius:10px;color:#f0eee8;font-size:14px;outline:none;font-family:inherit;}"
            + ".tfp-row input:focus{border-color:#f5c542;box-shadow:0 0 0 3px rgba(245,197,66,0.10);}"
            + ".tfp-actions{display:flex;gap:10px;margin-top:18px;}"
            + ".tfp-btn{flex:1;padding:11px;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px;}"
            + ".tfp-btn-primary{background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;}"
            + ".tfp-btn-secondary{background:rgba(255,255,255,0.05);color:#cdd9ec;border:1px solid rgba(255,255,255,0.1);}"
            + ".tfp-msg{margin-top:12px;font-size:13px;line-height:1.4;}"
            + ".tfp-msg.ok{color:#10b981;}.tfp-msg.err{color:#f43f5e;}";
        const s = document.createElement("style");
        s.id = "tfp-styles"; s.textContent = css;
        document.head.appendChild(s);
    }

    function injectLink(role) {
        let a = document.getElementById("tfp-link");
        if (a) return;
        const pwd = document.querySelector('input[type="password"]');
        if (!pwd) return;
        a = document.createElement("a");
        a.id = "tfp-link";
        a.className = "tfp-link";
        a.href = "#";
        a.textContent = "Forgot password?";
        a.addEventListener("click", e => { e.preventDefault(); openModal(cfgRole); });
        let host = pwd.closest(".form-group, .field-group, .field-inner") || pwd.parentNode;
        host.appendChild(a);
    }

    function buildModal() {
        if (document.getElementById("tfp-overlay")) return;
        const wrap = document.createElement("div");
        wrap.id = "tfp-overlay";
        wrap.className = "tfp-overlay";
        wrap.innerHTML =
            '<div class="tfp-modal">'
            + '<div class="tfp-title">🔐 Reset your password</div>'
            + '<div class="tfp-sub">Enter the email associated with your <span id="tfp-role">account</span>. We will send you a password reset link that expires in 1 hour.</div>'
            + '<div class="tfp-row"><label>Email</label><input id="tfp-email" type="email" placeholder="you@example.com" autocomplete="email"></div>'
            + '<div class="tfp-actions">'
            +   '<button class="tfp-btn tfp-btn-primary" id="tfp-send">Send Reset Link</button>'
            +   '<button class="tfp-btn tfp-btn-secondary" id="tfp-cancel">Cancel</button>'
            + '</div>'
            + '<div class="tfp-msg" id="tfp-msg"></div>'
            + '</div>';
        document.body.appendChild(wrap);
        wrap.addEventListener("click", e => { if (e.target === wrap) closeModal(); });
        document.getElementById("tfp-cancel").addEventListener("click", closeModal);
    }

    let cfgRole = "student";
    function openModal(role) {
        cfgRole = role || cfgRole;
        buildModal();
        document.getElementById("tfp-role").textContent = cfgRole;
        document.getElementById("tfp-msg").className = "tfp-msg";
        document.getElementById("tfp-msg").textContent = "";
        document.getElementById("tfp-email").value = "";
        document.getElementById("tfp-send").onclick = submit;
        document.getElementById("tfp-overlay").classList.add("open");
        setTimeout(() => document.getElementById("tfp-email").focus(), 100);
    }

    function closeModal() {
        const o = document.getElementById("tfp-overlay");
        if (o) o.classList.remove("open");
    }

    async function submit() {
        const email = (document.getElementById("tfp-email").value || "").trim();
        const msg = document.getElementById("tfp-msg");
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            msg.className = "tfp-msg err";
            msg.textContent = "Please enter a valid email address.";
            return;
        }
        const btn = document.getElementById("tfp-send");
        btn.disabled = true; btn.textContent = "Sending…";
        try {
            const r = await fetch("/auth/forgot-password", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, role: cfgRole })
            });
            const d = await r.json();
            if (d && d.success) {
                msg.className = "tfp-msg ok";
                msg.textContent = d.message || "A password reset link has been sent to your email inbox.";
            } else {
                msg.className = "tfp-msg err";
                msg.textContent = (d && d.message) ? d.message : "Error sending password reset email.";
            }
        } catch (e) {
            msg.className = "tfp-msg err";
            msg.textContent = "Network error. Please try again.";
        }
        btn.disabled = false; btn.textContent = "Send Reset Link";
    }

    w.TenForgotPassword = {
        init: function (opts) {
            styles();
            const role = (opts && opts.role) || "student";
            cfgRole = role;
            injectLink(role);
        }
    };
})(window);
