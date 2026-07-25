/* Feature 15 — Session timeout (vanilla JS, no deps).
 * Auto logout after 30 min idle, with a 2-min warning popup at 28 min.
 * Activity events: mousemove, click, keydown, scroll, touchstart.
 *
 * Usage in a dashboard <script> after sessionStorage has been read:
 *   <script src="/session-timeout.js"></script>
 *   <script>TenSessionTimeout.start({ logoutUrl: "/login.html" });</script>
 *
 * The popup is created once, then shown/hidden as needed.
 */
(function (w) {
    "use strict";
    if (w.TenSessionTimeout) return;

    const IDLE_LIMIT_MS = 30 * 60 * 1000;       // 30 min
    const WARN_AT_MS    = 28 * 60 * 1000;       // show warning at 28 min
    const COUNTDOWN_MS  = 2  * 60 * 1000;       // 2-min countdown after warning
    const KEY = "ten_last_activity_at";

    let cfg = null;
    let warnEl, countdownEl;
    let warnTimer, logoutTimer, countdownTicker;

    function now() { return Date.now(); }
    function setLastActivity() {
        try { localStorage.setItem(KEY, String(now())); } catch (e) {}
    }
    function lastActivity() {
        try { return parseInt(localStorage.getItem(KEY) || "0", 10) || now(); }
        catch (e) { return now(); }
    }

    function buildPopup() {
        const wrap = document.createElement("div");
        wrap.id = "ten-stm-overlay";
        wrap.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);z-index:99999;align-items:center;justify-content:center;font-family:'Plus Jakarta Sans','Outfit',sans-serif;";
        wrap.innerHTML = '<div style="background:#0c1220;border:1px solid rgba(245,197,66,0.22);border-radius:18px;padding:32px 30px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.6);text-align:center;color:#f0eee8;">'
            + '<div style="font-size:36px;margin-bottom:8px;">⏰</div>'
            + '<div style="font-size:18px;font-weight:800;color:#f5c542;margin-bottom:8px;">Your session is about to expire</div>'
            + '<div style="font-size:13px;color:#9aa4bf;line-height:1.55;margin-bottom:18px;">Due to inactivity, you will be logged out in <span id="ten-stm-countdown" style="color:#f5c542;font-weight:700;">2:00</span>.</div>'
            + '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">'
            + '<button id="ten-stm-stay" style="padding:11px 22px;border:none;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">Stay Logged In</button>'
            + '<button id="ten-stm-logout" style="padding:11px 22px;border:1px solid rgba(244,63,94,0.3);background:rgba(244,63,94,0.1);color:#f43f5e;border-radius:10px;font-weight:600;cursor:pointer;font-family:inherit;">Log Out Now</button>'
            + '</div></div>';
        document.body.appendChild(wrap);
        warnEl = wrap;
        countdownEl = wrap.querySelector("#ten-stm-countdown");
        wrap.querySelector("#ten-stm-stay").addEventListener("click", stay);
        wrap.querySelector("#ten-stm-logout").addEventListener("click", logout);
    }

    function showWarning() {
        if (!warnEl) buildPopup();
        warnEl.style.display = "flex";
        let remaining = COUNTDOWN_MS;
        countdownTicker = setInterval(() => {
            remaining -= 1000;
            if (remaining <= 0) { clearInterval(countdownTicker); return; }
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            countdownEl.textContent = m + ":" + (s < 10 ? "0" : "") + s;
        }, 1000);
        logoutTimer = setTimeout(logout, COUNTDOWN_MS);
    }
    function hideWarning() {
        if (warnEl) warnEl.style.display = "none";
        clearInterval(countdownTicker);
        clearTimeout(logoutTimer);
    }
    function stay() {
        hideWarning();
        setLastActivity();
        scheduleNextCheck();
    }
    function logout() {
        hideWarning();
        try {
            sessionStorage.removeItem("student");
            sessionStorage.removeItem("hrUser");
            sessionStorage.removeItem("coordinatorLoggedIn");
            sessionStorage.removeItem("coordinatorDomain");
            sessionStorage.removeItem("coordinatorUsername");
            sessionStorage.removeItem("coordinator");
        } catch (e) {}
        try { localStorage.removeItem(KEY); } catch (e) {}
        const url = (cfg && cfg.logoutUrl) || "/index.html";
        window.location.href = url;
    }

    function scheduleNextCheck() {
        clearTimeout(warnTimer);
        const elapsed = now() - lastActivity();
        const untilWarn = Math.max(WARN_AT_MS - elapsed, 1000);
        warnTimer = setTimeout(() => {
            const e2 = now() - lastActivity();
            if (e2 >= IDLE_LIMIT_MS) logout();
            else if (e2 >= WARN_AT_MS) showWarning();
            else scheduleNextCheck();
        }, untilWarn);
    }

    function onActivity() {
        // If the warning is showing we don't auto-dismiss on activity — user
        // must explicitly click "Stay Logged In" so they notice the dialog.
        if (warnEl && warnEl.style.display === "flex") return;
        setLastActivity();
    }

    w.TenSessionTimeout = {
        start: function (config) {
            cfg = config || {};
            setLastActivity();
            ["mousemove", "click", "keydown", "scroll", "touchstart"].forEach(
                ev => window.addEventListener(ev, onActivity, { passive: true })
            );
            // Also re-check when the tab becomes visible again
            document.addEventListener("visibilitychange", () => {
                if (!document.hidden) {
                    const e2 = now() - lastActivity();
                    if (e2 >= IDLE_LIMIT_MS) logout();
                    else if (e2 >= WARN_AT_MS) showWarning();
                    else scheduleNextCheck();
                }
            });
            scheduleNextCheck();
        },
        // For tests / manual triggers
        _show: showWarning,
        _logout: logout
    };
})(window);
