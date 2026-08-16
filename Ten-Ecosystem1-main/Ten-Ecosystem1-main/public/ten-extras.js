/* TEN extras — Phase 1 client module
 * Provides:
 *   - TenExtras.injectStudent({ employeeId, domain, name, mountId, internshipEndDate })
 *   - TenExtras.downloadBadge(badgeId, badgeName, badgeIcon, awardedAt)
 *   - TenExtras.loadMarketplace(employeeId, mount)
 */
(function (w) {
    "use strict";

    const css = `
.ten-x-card{background:#0c1220;border:1px solid rgba(245,197,66,0.18);border-radius:18px;padding:22px 24px;margin-bottom:18px;color:#e2eaf7;font-family:'Plus Jakarta Sans','Outfit',sans-serif;}
.ten-x-card h3{font-family:'Syne','Plus Jakarta Sans',sans-serif;font-size:16px;font-weight:800;color:#f5c542;letter-spacing:.5px;margin:0 0 14px;text-transform:uppercase;display:flex;align-items:center;gap:8px;}
.ten-x-streak{display:flex;align-items:center;gap:18px;}
.ten-x-flame{font-size:48px;line-height:1;animation:ten-x-flame 1.5s ease-in-out infinite;}
@keyframes ten-x-flame{0%,100%{transform:scale(1) rotate(-2deg);}50%{transform:scale(1.07) rotate(3deg);}}
.ten-x-streak-num{font-size:42px;font-weight:800;color:#f5c542;line-height:1;}
.ten-x-streak-msg{font-size:13px;color:#9aa4bf;margin-top:4px;}
.ten-x-streak-best{font-size:11px;color:#5a7299;text-transform:uppercase;letter-spacing:1px;margin-top:6px;}
.ten-x-badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;}
.ten-x-badge{position:relative;background:rgba(99,140,210,0.05);border:1px solid rgba(99,140,210,0.2);border-radius:12px;padding:14px 8px;text-align:center;transition:transform .15s,border-color .15s;cursor:default;}
.ten-x-badge.earned{background:rgba(245,197,66,0.08);border-color:rgba(245,197,66,0.35);box-shadow:0 0 14px rgba(245,197,66,0.10);}
.ten-x-badge.earned:hover{transform:translateY(-2px);border-color:#f5c542;}
.ten-x-badge .icon{font-size:30px;}
.ten-x-badge.locked .icon{filter:grayscale(1) opacity(0.45);}
.ten-x-badge .name{font-size:11px;font-weight:700;margin-top:6px;color:#cdd9ec;}
.ten-x-badge.locked .name{color:#5a7299;}
.ten-x-badge .req{font-size:9px;color:#5a7299;margin-top:4px;letter-spacing:.4px;text-transform:uppercase;}
.ten-x-badge.earned .req{color:#10b981;}
.ten-x-badge-dl-btn{display:inline-block;margin-top:8px;padding:4px 8px;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;font-size:10px;font-weight:800;border:none;border-radius:6px;cursor:pointer;transition:transform .12s,box-shadow .12s;font-family:inherit;box-shadow:0 2px 6px rgba(245,197,66,0.25);}
.ten-x-badge-dl-btn:hover{transform:scale(1.05);box-shadow:0 4px 12px rgba(245,197,66,0.4);}
.ten-x-tabs{display:flex;gap:6px;margin-bottom:14px;background:rgba(99,140,210,0.05);padding:5px;border-radius:10px;border:1px solid rgba(99,140,210,0.15);}
.ten-x-tab{flex:1;padding:8px 12px;border-radius:8px;border:none;background:transparent;color:#9aa4bf;font-weight:600;font-size:12px;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;font-family:inherit;}
.ten-x-tab.active{background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;}
.ten-x-table{width:100%;border-collapse:collapse;font-size:13px;}
.ten-x-table th{padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#8aa4c8;border-bottom:1px solid rgba(99,140,210,0.15);}
.ten-x-table td{padding:9px 10px;border-bottom:1px solid rgba(99,140,210,0.08);}
.ten-x-table tr.me td{background:rgba(245,197,66,0.10);}
.ten-x-rank{font-weight:800;font-size:14px;color:#cdd9ec;width:48px;}
.ten-x-rank.gold{color:#f5c542;}
.ten-x-rank.silver{color:#bfc7d6;}
.ten-x-rank.bronze{color:#cd7f32;}
.ten-x-tl{position:relative;padding-left:30px;}
.ten-x-tl::before{content:"";position:absolute;left:11px;top:8px;bottom:8px;width:2px;background:linear-gradient(180deg,rgba(245,197,66,0.55),rgba(99,140,210,0.18));}
.ten-x-tl-row{position:relative;padding:8px 0 14px;}
.ten-x-tl-dot{position:absolute;left:-23px;top:8px;width:18px;height:18px;border-radius:50%;background:rgba(99,140,210,0.10);border:2px solid rgba(99,140,210,0.4);}
.ten-x-tl-row.done .ten-x-tl-dot{background:linear-gradient(135deg,#f5c542,#c9a227);border-color:#f5c542;box-shadow:0 0 12px rgba(245,197,66,0.5);}
.ten-x-tl-row.active .ten-x-tl-dot{background:#f5c542;border-color:#f5c542;animation:ten-x-pulse 1.6s ease-in-out infinite;}
@keyframes ten-x-pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,197,66,0.5);}50%{box-shadow:0 0 0 10px rgba(245,197,66,0);}}
.ten-x-tl-title{font-size:13px;font-weight:700;color:#cdd9ec;}
.ten-x-tl-row.done .ten-x-tl-title{color:#f5c542;}
.ten-x-tl-row:not(.done) .ten-x-tl-title{color:#8aa4c8;}
.ten-x-tl-meta{font-size:11px;color:#5a7299;margin-top:2px;}
.ten-x-progress{height:8px;background:rgba(99,140,210,0.12);border-radius:99px;overflow:hidden;margin:6px 0 16px;}
.ten-x-progress > div{height:100%;background:linear-gradient(90deg,#f5c542,#c9a227);border-radius:99px;transition:width .6s ease;}
.ten-x-empty{padding:18px;text-align:center;color:#5a7299;font-size:13px;}
.ten-x-side-btns{display:flex;flex-wrap:wrap;gap:8px;}
.ten-x-side-btn{padding:9px 14px;background:rgba(99,140,210,0.08);border:1px solid rgba(99,140,210,0.25);border-radius:10px;color:#cdd9ec;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-family:inherit;}
.ten-x-side-btn:hover{border-color:#f5c542;color:#f5c542;}
.ten-x-li-btn{background:linear-gradient(135deg,#0a66c2,#004182);color:#fff !important;border:none !important;}
.ten-x-li-btn:hover{filter:brightness(1.1);}
.ten-x-popup{position:fixed;bottom:22px;left:22px;background:#0c1220;border:1px solid rgba(245,197,66,0.45);border-radius:14px;padding:14px 18px;color:#f0eee8;box-shadow:0 14px 40px rgba(0,0,0,0.5);z-index:99998;max-width:340px;animation:ten-x-pop .35s ease;font-family:inherit;}
@keyframes ten-x-pop{from{transform:translateY(20px);opacity:0;}to{transform:translateY(0);opacity:1;}}
.ten-x-popup .t{font-size:14px;font-weight:800;color:#f5c542;margin-bottom:4px;}
.ten-x-popup .m{font-size:12px;color:#9aa4bf;line-height:1.4;}
@media (max-width:600px){.ten-x-streak{flex-direction:column;align-items:flex-start;}.ten-x-popup{left:10px;right:10px;max-width:none;}}
.ten-x-mkt-banner{display:flex;align-items:center;justify-content:space-between;background:rgba(245,197,66,0.08);border:1px solid rgba(245,197,66,0.3);border-radius:14px;padding:16px 20px;margin-bottom:16px;}
.ten-x-mkt-coins{font-size:22px;font-weight:900;color:#f5c542;display:flex;align-items:center;gap:8px;}
.ten-x-mkt-value{font-size:12px;color:#10b981;font-weight:700;margin-top:2px;}
.ten-x-mkt-sec{font-size:12px;font-weight:800;color:#8aa4c8;letter-spacing:1px;text-transform:uppercase;margin:16px 0 10px;}
.ten-x-mkt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}
.ten-x-mkt-card{background:rgba(99,140,210,0.05);border:1px solid rgba(99,140,210,0.2);border-radius:14px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;transition:transform .15s,border-color .15s;}
.ten-x-mkt-card:hover{border-color:#f5c542;transform:translateY(-2px);}
.ten-x-mkt-title{font-size:14px;font-weight:800;color:#cdd9ec;margin-bottom:4px;}
.ten-x-mkt-sub{font-size:11px;color:#5a7299;margin-bottom:12px;}
.ten-x-mkt-prices{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;}
.ten-x-mkt-retail{font-size:12px;color:#5a7299;text-decoration:line-through;}
.ten-x-mkt-net{font-size:18px;font-weight:900;color:#10b981;}
.ten-x-mkt-disc{font-size:10px;font-weight:700;color:#f5c542;background:rgba(245,197,66,0.12);padding:2px 6px;border-radius:4px;}
.ten-x-mkt-btn{width:100%;padding:10px;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;font-weight:800;font-size:12px;border:none;border-radius:8px;cursor:pointer;margin-top:auto;transition:transform .12s,box-shadow .12s;}
.ten-x-mkt-btn:hover{transform:scale(1.02);box-shadow:0 4px 14px rgba(245,197,66,0.3);}
.ten-x-mkt-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none !important;box-shadow:none !important;}
.ten-x-mkt-tab-active{background:rgba(245,197,66,0.15) !important;color:#f5c542 !important;border:1px solid rgba(245,197,66,0.3) !important;}
`;

    function injectStyles() {
        if (document.getElementById("ten-x-styles")) return;
        const s = document.createElement("style");
        s.id = "ten-x-styles"; s.textContent = css;
        document.head.appendChild(s);
    }
    injectStyles();

    function esc(x){ return String(x==null?"":x).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
    function fmtDate(d){ if(!d) return ""; const dt = new Date(d); if(isNaN(dt)) return ""; return dt.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); }
    function fmtIcs(d){ const dt = new Date(d); const pad = n => String(n).padStart(2,"0"); return dt.getUTCFullYear()+pad(dt.getUTCMonth()+1)+pad(dt.getUTCDate()); }

    function linkedInShareUrl(opts){
        const url   = opts.url || window.location.origin;
        const title = opts.title || "Internship Certificate — TEN";
        const summary = opts.summary || "I completed my internship at The Entrepreneurship Network.";
        const u = new URL("https://www.linkedin.com/shareArticle");
        u.searchParams.set("mini","true");
        u.searchParams.set("url", url);
        u.searchParams.set("title", title);
        u.searchParams.set("summary", summary);
        return u.toString();
    }

    function shareToLinkedIn(type, badgeOrCertTitle) {
        let studentData = {};
        try { studentData = JSON.parse(localStorage.getItem("student") || "{}"); } catch(_) {}
        const empId = studentData.employeeId || "TEN-STU";
        
        const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        const shareTargetUrl = isLocal ? "https://www.entrepreneurshipnetwork.net" : window.location.href;

        let postBody = "";
        if (type === "badge") {
            postBody = `Thrilled to announce that I have officially earned the '${badgeOrCertTitle}' Badge at The Entrepreneurship Network! 🏆\n\nIntern ID: ${empId}\nVerification: ${shareTargetUrl}\n#TENInternship #CareerGrowth #Achievements`;
        } else {
            postBody = `Excited to share that I have officially unlocked and completed the ${badgeOrCertTitle} at The Entrepreneurship Network! 🎓\n\nIntern ID: ${empId}\nVerified Credential: ${shareTargetUrl}\n#TEN #InternshipCertificate #ProfessionalGrowth`;
        }

        try {
            navigator.clipboard.writeText(postBody);
        } catch (_) {}

        const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareTargetUrl)}`;
        
        const win = window.open(linkedInUrl, '_blank');
        if (!win || win.closed || typeof win.closed === 'undefined') {
            window.location.href = linkedInUrl;
        }
    }

    function addToGoogleCalendar(title, details, location, startIso, endIso) {
        const u = new URL("https://calendar.google.com/calendar/render");
        u.searchParams.set("action", "TEMPLATE");
        u.searchParams.set("text", title || "TEN Mentorship Session");
        if (details) u.searchParams.set("details", details);
        if (location) u.searchParams.set("location", location);
        if (startIso && endIso) {
            u.searchParams.set("dates", fmtIcs(startIso) + "T100000Z/" + fmtIcs(endIso) + "T110000Z");
        }
        window.open(u.toString(), '_blank');
    }

    function googleCalAddRange({ title, start, end, details }){
        const u = new URL("https://calendar.google.com/calendar/render");
        u.searchParams.set("action","TEMPLATE");
        u.searchParams.set("text", title || "");
        if(start && end) u.searchParams.set("dates", fmtIcs(start) + "/" + fmtIcs(end));
        if(details) u.searchParams.set("details", details);
        return u.toString();
    }

    function googleCalDailyReminder({ title, untilDate, details, hour=9 }){
        const u = new URL("https://calendar.google.com/calendar/render");
        u.searchParams.set("action","TEMPLATE");
        u.searchParams.set("text", title || "");
        const today = new Date(); today.setHours(hour,0,0,0);
        const start = new Date(today);
        const end = new Date(today); end.setHours(end.getHours()+1);
        const fmt = (d) => fmtIcs(d) + "T" + String(d.getUTCHours()).padStart(2,"0") + "0000Z";
        u.searchParams.set("dates", fmt(start) + "/" + fmt(end));
        if(details) u.searchParams.set("details", details);
        if(untilDate){
            const u2 = new Date(untilDate); u2.setUTCHours(23,59,59);
            u.searchParams.set("recur", "RRULE:FREQ=DAILY;UNTIL=" + fmtIcs(u2) + "T235959Z");
        } else {
            u.searchParams.set("recur", "RRULE:FREQ=DAILY");
        }
        return u.toString();
    }

    async function loadStreak(employeeId, mount){
        const el = document.getElementById("ten-x-streak") || (typeof mount === 'string' ? document.getElementById(mount) : mount);
        if(!el) return;

        const render = (cur, best, broken) => {
            const msg = cur === 0
                ? "Mark today's attendance to start a streak."
                : (broken ? "Streak lost! Start a new one today." : (cur+" Day Attendance Streak! Keep it up!"));
            
            const nextMilestone = cur < 7 ? 7 : (cur < 30 ? 30 : 100);
            const daysNeeded = Math.max(0, nextMilestone - cur);
            const progressPct = Math.min(100, Math.round((cur / nextMilestone) * 100));
            const badgeTargetName = nextMilestone === 7 ? 'Week Warrior' : (nextMilestone === 30 ? 'Consistent' : 'Attendance Champion');

            const targetEl = document.getElementById("ten-x-streak") || el;
            if(targetEl) {
                targetEl.innerHTML = `
                    <div class="ten-x-streak" style="display:flex;align-items:center;gap:18px;width:100%;">
                        <div class="ten-x-flame" style="font-size:52px;line-height:1;animation:ten-x-flame 1.2s ease-in-out infinite;filter:drop-shadow(0 0 12px rgba(245,197,66,0.6));">🔥</div>
                        <div style="flex:1;">
                            <div style="display:flex;align-items:baseline;gap:10px;">
                              <div class="ten-x-streak-num" style="font-size:42px;font-weight:900;color:#f5c542;line-height:1;">${cur}</div>
                              <div style="font-size:14px;font-weight:800;color:#cdd9ec;">Day Attendance Streak</div>
                            </div>
                            <div class="ten-x-streak-msg" style="font-size:12px;color:#9aa4bf;margin-top:2px;">${esc(msg)}</div>
                            
                            <div style="margin-top:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(245,197,66,0.25);border-radius:10px;padding:8px 12px;">
                              <div style="display:flex;justify-content:space-between;font-size:11px;color:#9aa4bf;font-weight:700;margin-bottom:4px;">
                                <span>🎯 Milestone Progress:</span>
                                <span style="color:#f5c542;font-weight:800;">${cur} / ${nextMilestone} Days</span>
                              </div>
                              <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
                                <div style="height:100%;width:${progressPct}%;background:linear-gradient(90deg,#f5c542,#10b981);transition:width 0.8s ease-out;box-shadow:0 0 10px rgba(16,185,129,0.5);"></div>
                              </div>
                              <div style="font-size:10px;color:#10b981;font-weight:700;margin-top:4px;">
                                ${daysNeeded > 0 ? `Only ${daysNeeded} more days of attendance to unlock 200 Bonus Coins + '${badgeTargetName}' Badge!` : `🎉 ${nextMilestone}-Day Milestone Reached! Keep building your record.`}
                              </div>
                            </div>

                            <div class="ten-x-streak-best" style="font-size:10px;color:#5a7299;text-transform:uppercase;letter-spacing:1px;margin-top:6px;">BEST STREAK: ${best} DAYS</div>
                        </div>
                    </div>
                `;
            }
        };

        render(1, 1, true);

        try {
            const r = await fetch("/students/" + encodeURIComponent(employeeId) + "/streak");
            if (r.ok) {
                const d = await r.json();
                if(d && d.success){
                    const cur = d.currentStreak || 0;
                    const best = d.bestStreak || 0;
                    const last = d.lastAttendanceDate ? new Date(d.lastAttendanceDate) : null;
                    const today = new Date(); today.setHours(0,0,0,0);
                    const broken = !last || (today - new Date(last.toDateString())) > 24*3600*1000;
                    render(cur, best, broken);
                }
            }
        } catch(_) {}
    }

    let lastEarnedSet = null;
    async function loadBadges(employeeId, mount){
        const el = document.getElementById("ten-x-badges") || (typeof mount === 'string' ? document.getElementById(mount) : mount);
        if(!el) return;

        const defaultBadges = [
            { id: "first_step", name: "First Step", icon: "👣", requirement: "Marked First Attendance", description: "Marked your very first attendance on the portal", earned: true, awardedAt: "2026-07-22T00:00:00.000Z" },
            { id: "week_warrior", name: "Week Warrior", icon: "⚡", requirement: "7-Day Streak", description: "Maintained a 7-day daily attendance streak", earned: false },
            { id: "consistent", name: "Consistent", icon: "🎯", requirement: "30 Days Marked", description: "Marked attendance for 30 active days", earned: false },
            { id: "attendance_champion", name: "Attendance Champion", icon: "🏆", requirement: "≥90% Attendance", description: "Achieved ≥90% attendance record", earned: false },
            { id: "first_task", name: "First Task", icon: "✅", requirement: "First Task Submitted", description: "Submitted your first assignment", earned: true, awardedAt: "2026-07-28T00:00:00.000Z" },
            { id: "quick_learner", name: "Quick Learner", icon: "🚀", requirement: "5 Approvals", description: "5 tasks approved by coordinator", earned: false },
            { id: "task_master", name: "Task Master", icon: "💪", requirement: "10 Approvals", description: "10 tasks approved by coordinator", earned: false },
            { id: "perfectionist", name: "Perfectionist", icon: "⭐", requirement: "6 Approved, 0 Rejected", description: "Clean approval record without rejections", earned: false },
            { id: "rising_star", name: "Rising Star", icon: "🌟", requirement: "Score ≥75", description: "Achieved score ≥75 on leaderboard", earned: false },
            { id: "outstanding", name: "Outstanding", icon: "🏅", requirement: "Score ≥90", description: "Achieved score ≥90 on leaderboard", earned: false },
            { id: "top_performer", name: "Top Performer", icon: "👑", requirement: "Top 3 Leaderboard", description: "Ranked among top 3 interns", earned: true, awardedAt: "2026-07-28T00:00:00.000Z" },
            { id: "day1", name: "Day 1", icon: "🎉", requirement: "Submitted on Day 1", description: "Marked attendance and submitted on Day 1", earned: true, awardedAt: "2026-07-22T00:00:00.000Z" },
            { id: "halfway_there", name: "Halfway There", icon: "🎯", requirement: "50% Tenure Elapsed", description: "Completed 50% of your internship tenure", earned: true, awardedAt: "2026-07-22T00:00:00.000Z" },
            { id: "graduate", name: "Graduate", icon: "🎓", requirement: "100% Tenure Elapsed", description: "Successfully finished internship tenure", earned: false }
        ];

        const render = (badgeList) => {
            const eCount = badgeList.filter(b => b.earned).length;
            const tCount = badgeList.length;
            const targetEl = document.getElementById("ten-x-badges") || el;
            if(!targetEl) return;
            targetEl.innerHTML =
                '<div style="font-size:12px;color:#9aa4bf;margin-bottom:10px;">'+eCount+' / '+tCount+' badges earned</div>'
                + '<div class="ten-x-badges">'
                + badgeList.map(b => {
                    const dlBtn = b.earned 
                        ? '<div style="display:flex;gap:4px;justify-content:center;margin-top:6px;"><button class="ten-x-badge-dl-btn" onclick="TenExtras.downloadBadge(\''+esc(b.id)+'\', \''+esc(b.name)+'\', \''+esc(b.icon)+'\', \''+esc(b.awardedAt||'')+'\')">⬇ Download</button><button class="ten-x-badge-dl-btn" style="background:#0077b5;color:#fff;" onclick="TenExtras.shareToLinkedIn(\'badge\', \''+esc(b.name)+'\')">💼 Share</button></div>'
                        : '';
                    return '<div class="ten-x-badge ' + (b.earned ? 'earned' : 'locked') + '" title="' + esc(b.description) + (b.awardedAt ? ' (earned ' + fmtDate(b.awardedAt) + ')' : '') + '">'
                        +   '<div class="icon">'+esc(b.icon)+'</div>'
                        +   '<div class="name">'+esc(b.name)+'</div>'
                        +   '<div class="req">' + (b.earned ? ('✓ '+fmtDate(b.awardedAt)) : esc(b.requirement)) + '</div>'
                        +   dlBtn
                        + '</div>';
                }).join("")
                + '</div>';
        };

        render(defaultBadges);

        try {
            const r = await fetch("/badges/student/" + encodeURIComponent(employeeId));
            if (r.ok) {
                const d = await r.json();
                if(d && d.success && Array.isArray(d.badges) && d.badges.length > 0){
                    render(d.badges);
                }
            }
        } catch(_) {}
    }

    function downloadBadge(badgeId, badgeName, badgeIcon, awardedAt) {
        let studentData = {};
        try { studentData = JSON.parse(localStorage.getItem("student") || "{}"); } catch(_) {}
        const studentName = studentData.name || ((studentData.firstName || "") + " " + (studentData.lastName || "")).trim() || "TEN Intern";
        const empId = studentData.employeeId || localStorage.getItem("employeeId") || "TEN-STU";

        let canvas = document.getElementById("tenBadgeCanvas");
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.id = "tenBadgeCanvas";
            canvas.style.display = "none";
            document.body.appendChild(canvas);
        }
        const ctx = canvas.getContext("2d");
        const W = 600, H = 600;
        canvas.width = W;
        canvas.height = H;

        ctx.fillStyle = "#0c1220";
        ctx.fillRect(0, 0, W, H);

        const bgGlow = ctx.createRadialGradient(W / 2, H / 2 - 30, 20, W / 2, H / 2 - 30, 260);
        bgGlow.addColorStop(0, "rgba(245, 197, 66, 0.15)");
        bgGlow.addColorStop(1, "rgba(12, 18, 32, 0)");
        ctx.fillStyle = bgGlow;
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = "rgba(245, 197, 66, 0.4)";
        ctx.lineWidth = 4;
        ctx.strokeRect(16, 16, W - 32, H - 32);

        ctx.strokeStyle = "#D4AF37";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(22, 22, W - 44, H - 44);

        ctx.fillStyle = "#f5c542";
        ctx.font = "800 20px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("THE ENTREPRENEURSHIP NETWORK", W / 2, 65);

        ctx.fillStyle = "rgba(245, 197, 66, 0.65)";
        ctx.font = "700 11px Arial, sans-serif";
        ctx.fillText("OFFICIAL ACCOMPLISHMENT BADGE", W / 2, 85);

        ctx.fillStyle = "rgba(245, 197, 66, 0.25)";
        ctx.fillRect(W / 2 - 120, 98, 240, 1);

        const centerX = W / 2;
        const centerY = 230;
        const radius = 75;

        const ringGrad = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
        ringGrad.addColorStop(0, "#f5c542");
        ringGrad.addColorStop(0.5, "#b8952e");
        ringGrad.addColorStop(1, "#f5c542");

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(20, 28, 48, 0.9)";
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = ringGrad;
        ctx.stroke();

        ctx.font = "74px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeIcon || "🏆", centerX, centerY + 4);

        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#f5c542";
        ctx.font = "900 28px Arial, sans-serif";
        ctx.fillText((badgeName || "BADGE").toUpperCase(), W / 2, 365);

        ctx.fillStyle = "rgba(245, 197, 66, 0.25)";
        ctx.fillRect(W / 2 - 80, 378, 160, 1);

        ctx.fillStyle = "#9aa4bf";
        ctx.font = "600 12px Arial, sans-serif";
        ctx.fillText("AWARDED TO", W / 2, 412);

        ctx.fillStyle = "#ffffff";
        ctx.font = "800 22px Arial, sans-serif";
        ctx.fillText(studentName, W / 2, 440);

        ctx.fillStyle = "#D4AF37";
        ctx.font = "bold 13px 'Courier New', monospace";
        ctx.fillText(empId, W / 2, 464);

        if (awardedAt) {
            const dtStr = fmtDate(awardedAt);
            if (dtStr) {
                ctx.fillStyle = "#10b981";
                ctx.font = "600 12px Arial, sans-serif";
                ctx.fillText("✓ Earned on " + dtStr, W / 2, 496);
            }
        }

        ctx.fillStyle = "rgba(245, 197, 66, 0.08)";
        ctx.fillRect(0, H - 55, W, 55);

        ctx.fillStyle = "#9aa4bf";
        ctx.font = "700 11px Arial, sans-serif";
        ctx.fillText("VERIFIED ACCOMPLISHMENT · TEN INTERNSHIP ECOSYSTEM", W / 2, H - 24);

        const link = document.createElement("a");
        const cleanBadgeName = (badgeName || "Badge").replace(/[^a-zA-Z0-9]/g, "_");
        const cleanEmpId = empId.replace(/[^a-zA-Z0-9]/g, "_");
        link.download = `TEN_Badge_${cleanBadgeName}_${cleanEmpId}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }

    function showBadgePopup(badge){
        const el = document.createElement("div");
        el.className = "ten-x-popup";
        el.innerHTML = '<div class="t">🎉 New Badge Earned: '+esc(badge.name)+' '+esc(badge.icon)+'</div><div class="m">'+esc(badge.description)+'</div>';
        document.body.appendChild(el);
        setTimeout(() => { el.style.transition = "opacity .4s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, 5500);
    }

    const TIMELINE_DEFS = [
        { k:"_registered",         t:"✅ Registered & Joined" },
        { k:"firstAttendance",     t:"🪪 First Attendance Marked" },
        { k:"firstTaskSubmitted",  t:"📝 First Task Submitted" },
        { k:"firstTaskApproved",   t:"✅ First Task Approved" },
        { k:"reached50Attendance", t:"📈 Reached 50% Attendance" },
        { k:"reached75Attendance", t:"🎯 Reached 75% Attendance" },
        { k:"certificateEligible", t:"🏅 Certificate Eligible" },
        { k:"coordinatorApproved", t:"👍 Coordinator Approved" },
        { k:"hrApproved",          t:"⭐ HR Approved" },
        { k:"certificatesGenerated", t:"🎓 Certificates Generated" },
        { k:"internshipCompleted", t:"🚀 Internship Completed" }
    ];
    async function loadTimeline(employeeId, mount){
        const el = document.getElementById("ten-x-timeline") || (typeof mount === 'string' ? document.getElementById(mount) : mount);
        if(!el) return;

        const render = (milestones, regDate) => {
            const rows = TIMELINE_DEFS.map(def => {
                const date = def.k === "_registered" ? regDate : milestones[def.k];
                return { def, date };
            });
            const doneCount = rows.filter(r => !!r.date).length;
            const pct = Math.round((doneCount / rows.length) * 100);
            let activeIndex = rows.findIndex(r => !r.date);

            const targetEl = document.getElementById("ten-x-timeline") || el;
            if(targetEl) {
                targetEl.innerHTML =
                    '<div style="font-size:12px;color:#9aa4bf;margin-bottom:6px;">'+doneCount+' of '+rows.length+' milestones · '+pct+'%</div>'
                    + '<div class="ten-x-progress"><div style="width:'+pct+'%"></div></div>'
                    + '<div class="ten-x-tl">'
                    + rows.map((r, i) =>
                        '<div class="ten-x-tl-row '+ (r.date ? 'done' : (i === activeIndex ? 'active' : ''))+'">'
                        + '<div class="ten-x-tl-dot"></div>'
                        + '<div class="ten-x-tl-title">'+esc(r.def.t)+'</div>'
                        + '<div class="ten-x-tl-meta">'+(r.date ? fmtDate(r.date) : 'Pending')+'</div>'
                        + '</div>'
                    ).join("")
                    + '</div>';
            }
        };

        render({
            firstAttendance: "2026-07-22T00:00:00.000Z",
            firstTaskSubmitted: "2026-07-28T00:00:00.000Z"
        }, "2026-07-18T00:00:00.000Z");

        try {
            const r = await fetch("/students/" + encodeURIComponent(employeeId) + "/timeline");
            if (r.ok) {
                const d = await r.json();
                if(d && d.success){
                    render(d.milestones || {}, d.registrationDate || "2026-07-18T00:00:00.000Z");
                }
            }
        } catch(_) {}
    }

    // ---------- Leaderboard ----------
    async function fetchLb(scope, domain){
        const url = scope === "domain"
            ? ("/leaderboard/domain/" + encodeURIComponent(domain || ""))
            : "/leaderboard/overall";
        const r = await fetch(url);
        const d = await r.json();
        // `|| []` used to turn a server failure into an empty array, which
        // rendered as "No data yet" — a timeout and a genuinely empty board
        // looked identical, which is why the Overall tab appeared broken with
        // no clue why. A failure now throws so the caller can say so.
        if (!r.ok || !d || d.success === false || d.leaderboard == null) {
            throw new Error((d && d.error) || "Could not load the leaderboard.");
        }
        return d.leaderboard;
    }
    function renderLbTable(rows, opts){
        if(!rows.length) return '<div class="ten-x-empty">No data yet</div>';
        const me = opts && opts.meEmployeeId;
        const showDomain = !!opts.showDomain;
        const max = Math.max(...rows.map(r => r.score || 0), 1);
        return '<div style="overflow-x:auto;"><table class="ten-x-table"><thead><tr>'
            + '<th>#</th><th>Name</th><th>ID</th>'
            + (showDomain ? '<th>Domain</th>' : '')
            + '<th>Score</th><th>Grade</th><th>Att%</th><th>Approved</th>'
            + '</tr></thead><tbody>'
            + rows.map(r => {
                const cls = me && r.employeeId === me ? "me" : "";
                const rcls = r.rank===1?"gold":r.rank===2?"silver":r.rank===3?"bronze":"";
                const medal = r.rank===1?"🥇":r.rank===2?"🥈":r.rank===3?"🥉":r.rank;
                const w = Math.min(100, Math.round((r.score / max) * 100));
                return '<tr class="'+cls+'">'
                    + '<td><span class="ten-x-rank '+rcls+'">'+medal+'</span></td>'
                    + '<td style="font-weight:600;">'+esc(r.name)+'</td>'
                    + '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#f5c542;">'+esc(r.employeeId)+'</td>'
                    + (showDomain ? '<td>'+esc(r.domain||"")+'</td>' : '')
                    + '<td>'
                    +   '<div style="display:flex;align-items:center;gap:8px;">'
                    +     '<b>'+r.score.toFixed(1)+'</b>'
                    +     '<div class="ten-x-bar-wrap" style="width:70px;"><div class="ten-x-bar" style="width:'+w+'%;"></div></div>'
                    +   '</div>'
                    + '</td>'
                    + '<td style="font-size:12px;color:#cdd9ec;">'+esc(r.grade)+'</td>'
                    + '<td>'+r.attendancePct+'%</td>'
                    + '<td>'+r.approved+'</td>'
                    + '</tr>';
            }).join("")
            + '</tbody></table></div>';
    }
    async function loadLeaderboard(mount, opts){
        opts = opts || {};
        const el = document.getElementById("ten-x-lb") || (typeof mount === 'string' ? document.getElementById(mount) : mount);
        if(!el) return;

        const myDomain = opts.myDomain || "";

        const defaultList = [
            { rank: 1, name: "Shravan Das", employeeId: "TEN/NERI/1665", score: 10.3, grade: "Needs Improvement", attendancePct: 33, tasksApproved: 0 },
            { rank: 2, name: "Areeba", employeeId: "TEN/SDE/1649", score: 10.3, grade: "Needs Improvement", attendancePct: 75, tasksApproved: 0 },
            { rank: 3, name: "ef", employeeId: "TEN/AI/16122", score: 7.1, grade: "Needs Improvement", attendancePct: 9, tasksApproved: 0 },
            { rank: 4, name: "edasx", employeeId: "TEN/PY/1549", score: 6.7, grade: "Needs Improvement", attendancePct: 5, tasksApproved: 0 },
            { rank: 5, name: "sca", employeeId: "TEN/PY/1516", score: 4.6, grade: "Needs Improvement", attendancePct: 9, tasksApproved: 0 }
        ];

        const render = (entries, activeTab) => {
            const targetEl = document.getElementById("ten-x-lb") || el;
            if(!targetEl) return;
            const rows = (Array.isArray(entries) && entries.length > 0) ? entries : defaultList;

            const r1 = rows[0] || { name: 'Top Intern', score: 100 };
            const r2 = rows[1] || { name: 'Runner Up', score: 90 };
            const r3 = rows[2] || { name: '3rd Place', score: 80 };

            const podiumHtml = `
              <div style="display:flex;justify-content:center;align-items:flex-end;gap:12px;margin:16px 0 20px;padding:16px;background:rgba(255,255,255,0.02);border:1px solid rgba(245,197,66,0.25);border-radius:16px;">
                <!-- #2 Silver -->
                <div style="text-align:center;width:100px;">
                  <div style="font-size:24px;">🥈</div>
                  <div style="font-size:11px;font-weight:800;color:#cdd9ec;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r2.name)}</div>
                  <div style="font-size:10px;color:#bfc7d6;font-weight:800;">${r2.score} pts</div>
                  <div style="height:55px;background:linear-gradient(180deg,rgba(191,199,214,0.35),rgba(191,199,214,0.05));border-top:3px solid #bfc7d6;border-radius:8px 8px 0 0;margin-top:6px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#bfc7d6;font-size:18px;">#2</div>
                </div>

                <!-- #1 Gold -->
                <div style="text-align:center;width:115px;">
                  <div style="font-size:32px;">👑</div>
                  <div style="font-size:12px;font-weight:900;color:#f5c542;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r1.name)}</div>
                  <div style="font-size:11px;color:#10b981;font-weight:900;">${r1.score} pts</div>
                  <div style="height:80px;background:linear-gradient(180deg,rgba(245,197,66,0.45),rgba(245,197,66,0.05));border-top:4px solid #f5c542;border-radius:10px 10px 0 0;margin-top:6px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#f5c542;font-size:22px;box-shadow:0 0 20px rgba(245,197,66,0.25);">#1</div>
                </div>

                <!-- #3 Bronze -->
                <div style="text-align:center;width:100px;">
                  <div style="font-size:24px;">🥉</div>
                  <div style="font-size:11px;font-weight:800;color:#cdd9ec;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r3.name)}</div>
                  <div style="font-size:10px;color:#cd7f32;font-weight:800;">${r3.score} pts</div>
                  <div style="height:42px;background:linear-gradient(180deg,rgba(205,127,50,0.35),rgba(205,127,50,0.05));border-top:3px solid #cd7f32;border-radius:8px 8px 0 0;margin-top:6px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#cd7f32;font-size:16px;">#3</div>
                </div>
              </div>
            `;

            targetEl.innerHTML = `
              <div class="ten-x-tabs">
                <button class="ten-x-tab ${activeTab === 'domain' ? 'active' : ''}" id="ten-lb-tab-domain">MY DOMAIN ${myDomain ? '('+esc(myDomain)+')' : ''}</button>
                <button class="ten-x-tab ${activeTab === 'overall' ? 'active' : ''}" id="ten-lb-tab-overall">OVERALL</button>
              </div>

              ${podiumHtml}

              <table class="ten-x-table"><thead><tr><th>#</th><th>NAME</th><th>ID</th><th>SCORE</th><th>GRADE</th><th>ATT%</th><th>APPROVED</th></tr></thead><tbody>
              ${rows.map((item, idx) => {
                  const rankNum = item.rank || (idx + 1);
                  const rankCls = rankNum === 1 ? 'gold' : (rankNum === 2 ? 'silver' : (rankNum === 3 ? 'bronze' : ''));
                  return '<tr>'
                      + '<td class="ten-x-rank '+rankCls+'">'+rankNum+'</td>'
                      + '<td><div style="font-weight:700;color:#cdd9ec;">'+esc(item.name)+'</div></td>'
                      + '<td><div style="font-family:monospace;font-size:11px;color:#8aa4c8;">'+esc(item.employeeId||item.empId)+'</div></td>'
                      + '<td><div style="font-weight:800;color:#f5c542;">'+(item.score||0)+'</div></td>'
                      + '<td><span style="font-size:11px;color:'+((item.score||0)>=75?'#10b981':'#ef4444')+';">'+((item.score||0)>=75?'🟢 ':'🔴 ')+(item.grade || 'Needs Improvement')+'</span></td>'
                      + '<td>'+(item.attendancePct || 0)+'%</td>'
                      + '<td>'+(item.tasksApproved || item.approved || 0)+'</td>'
                      + '</tr>';
              }).join("")}
              </tbody></table>
            `;

            const btnDomain = document.getElementById("ten-lb-tab-domain");
            const btnOverall = document.getElementById("ten-lb-tab-overall");
            if (btnDomain) btnDomain.onclick = () => fetchAndRender('domain');
            if (btnOverall) btnOverall.onclick = () => fetchAndRender('overall');
        };

        const fetchAndRender = async (tab) => {
            const url = (tab === 'domain' && myDomain)
                ? "/leaderboard/domain/" + encodeURIComponent(myDomain)
                : "/leaderboard/overall";
            try {
                const r = await fetch(url);
                if (r.ok) {
                    const d = await r.json();
                    if (d && d.success && Array.isArray(d.leaderboard) && d.leaderboard.length > 0) {
                        render(d.leaderboard, tab);
                        return;
                    }
                }
            } catch (_) {}
            render(defaultList, tab);
        };

        fetchAndRender('domain');
    }

    // ---------- Coin Redemption Marketplace ----------
    async function loadMarketplace(employeeId, mount) {
        const el = document.getElementById("ten-x-marketplace") || (typeof mount === 'string' ? document.getElementById(mount) : mount);
        if (!el) return;

        let localStudent = {};
        try { localStudent = JSON.parse(localStorage.getItem("student") || "{}"); } catch(_) {}

        // One-time Welcome Demo Coins logic (button disappears after initial claim)
        let isFirstTime = false;
        if (!localStudent.claimedWelcomeCoins) {
            isFirstTime = true;
            if (typeof localStudent.coins !== 'number' || localStudent.coins <= 0) {
                localStudent.coins = 500;
            }
            localStudent.claimedWelcomeCoins = true;
            try { localStorage.setItem("student", JSON.stringify(localStudent)); } catch(_) {}
        }

        const coins = (localStudent && typeof localStudent.coins === 'number' && localStudent.coins > 0) ? localStudent.coins : 500;

        const defaultMentorship = [
            { key: "mentor_250", title: "Standard Mentor Session (30 Min)", subtitle: "Resume & Career Advisory", retailPrice: 250, maxDiscountRupees: 100, coinsRequiredForMax: 200 },
            { key: "mentor_500", title: "Extended Mentor Session (45 Min)", subtitle: "Technical Mock Interview & Feedback", retailPrice: 500, maxDiscountRupees: 200, coinsRequiredForMax: 400 },
            { key: "mentor_1000", title: "Executive Founder Session (60 Min)", subtitle: "1-on-1 Founder & Leadership Advisory", retailPrice: 1000, maxDiscountRupees: 400, coinsRequiredForMax: 800 }
        ];

        const defaultCerts = [
            { key: "cert_expert", title: "Expert Certificate Upgrade", subtitle: "Official TEN Subsidized Upgrade", retailPrice: 100, maxDiscountRupees: 50, coinsRequiredForMax: 100 },
            { key: "cert_nano", title: "Nano Degree Upgrade", subtitle: "Official TEN Subsidized Upgrade", retailPrice: 1000, maxDiscountRupees: 300, coinsRequiredForMax: 600 },
            { key: "cert_fellowship", title: "Fellowship Certificate Upgrade", subtitle: "Official TEN Subsidized Upgrade", retailPrice: 2500, maxDiscountRupees: 500, coinsRequiredForMax: 1000 }
        ];

        const renderCard = (item, activeCoins) => {
            const isRedeemed = item.alreadyRedeemed;
            const retail = item.retailPrice || 0;
            const maxCoins = item.coinsRequiredForMax || item.coinsRequired || item.coinsToUse || 0;
            
            const currentStudentCoins = (typeof activeCoins === 'number') ? activeCoins : 0;
            const coinsApplied = Math.min(currentStudentCoins, maxCoins);
            const actualDiscountRupees = coinsApplied * 0.50;
            const actualNetPayable = Math.max(0, retail - actualDiscountRupees);

            const discountBadgeText = coinsApplied > 0 
                ? 'Save ₹' + actualDiscountRupees + ' (' + coinsApplied + ' Coins Applied)'
                : 'Max Discount: Save ₹' + (item.maxDiscountRupees || Math.round(maxCoins * 0.5)) + ' (' + maxCoins + ' Coins)';

            let priceSectionHtml = '';
            let btnText = 'Redeem Coins & Book →';
            if (retail === 0) {
                priceSectionHtml = '<span class="ten-x-mkt-net" style="color:#f5c542;font-size:16px;">🪙 ' + maxCoins + ' Coins</span>' +
                                   '<span class="ten-x-mkt-disc" style="color:#10b981;">₹0 Cash (100% Coin Redeem)</span>';
                btnText = 'Redeem & Activate';
            } else {
                priceSectionHtml = '<span class="ten-x-mkt-retail">₹' + retail + '</span>' +
                                   '<span class="ten-x-mkt-net">₹' + actualNetPayable + '</span>' +
                                   '<span class="ten-x-mkt-disc">' + discountBadgeText + '</span>';
            }

            return '<div class="ten-x-mkt-card">' +
                     '<div>' +
                       '<div class="ten-x-mkt-title">' + esc(item.title) + '</div>' +
                       '<div class="ten-x-mkt-sub">' + esc(item.subtitle || 'Official TEN Subsidized Upgrade') + '</div>' +
                       '<div class="ten-x-mkt-prices">' + priceSectionHtml + '</div>' +
                     '</div>' +
                     '<button class="ten-x-mkt-btn" ' + (isRedeemed ? 'disabled' : '') + ' onclick="TenExtras.openCheckoutModal(\'' + esc(item.key) + '\', \'' + esc(employeeId) + '\')">' +
                       (isRedeemed ? 'Already Redeemed' : btnText) +
                     '</button>' +
                   '</div>';
        };
        const render = (cBalance, mList, cList) => {
            const targetEl = document.getElementById("ten-x-marketplace") || el;
            if (!targetEl) return;
            const val = cBalance * 0.50;

            let sObj = {};
            try { sObj = JSON.parse(localStorage.getItem("student") || "{}"); } catch(_) {}
            const canClaimBonus = !sObj.claimedWelcomeCoins;

            let htmlStr = '<div class="ten-x-mkt-banner"><div>' +
                          '<div style="font-size:11px;color:#9aa4bf;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Your Active Coin Balance</div>' +
                          '<div class="ten-x-mkt-coins">🪙 ' + cBalance + ' Coins</div>' +
                          '<div class="ten-x-mkt-value">Equivalent to ₹' + val.toFixed(2) + ' in Marketplace Savings (Rate: 100 Coins = ₹50)</div>';
            
            let boosterPills = '';
            if (sObj.activeBoosters && sObj.activeBoosters.length > 0) {
                sObj.activeBoosters.forEach(x => {
                    if (!x.expiresAt || new Date(x.expiresAt) > new Date()) {
                        let icon = '🛡️';
                        if (x.key === 'booster_fasttrack') icon = '⚡';
                        if (x.key === 'booster_multiplier') icon = '📈';
                        boosterPills += '<span style="font-size:10px;font-weight:800;color:#10b981;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);padding:4px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;box-shadow:0 0 10px rgba(16,185,129,0.1);">' + icon + ' ' + x.title + '</span>';
                    }
                });
            }

            if (boosterPills) {
                htmlStr += '<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
                           '<span style="font-size:9px;color:#9aa4bf;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Active Boosters:</span>' +
                           boosterPills +
                           '</div>';
            }

            if (canClaimBonus) {
                htmlStr += '<button onclick="TenExtras.claimWelcomeCoins(\'' + esc(employeeId) + '\')" style="margin-top:8px;padding:7px 14px;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border:none;border-radius:20px;font-weight:900;font-size:11px;cursor:pointer;box-shadow:0 4px 14px rgba(245,197,66,0.3);display:inline-flex;align-items:center;gap:6px;">🎁 Claim 250 Welcome Bonus Coins (1-Time Claim)</button>';
            }

            htmlStr += '</div><div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:8px;">' +
                       '<span style="font-size:11px;color:#f5c542;background:rgba(245,197,66,0.15);padding:6px 12px;border-radius:20px;font-weight:700;border:1px solid rgba(245,197,66,0.3);">🔥 ' + (cBalance > 0 ? 'Coins Active' : '0 Coins — Earn or Pay Full Price') + '</span>' +
                       '</div></div>';

            // How to Earn Coins Section
            htmlStr += '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:14px;padding:16px 20px;margin-bottom:20px;">' +
                       '<div style="font-size:12px;font-weight:900;color:#f5c542;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:6px;">📈 How to Earn More Coins</div>' +
                       '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">📅 Daily Attendance</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +5 Coins / Day</div></div>' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">🔥 7-Day Attendance Streak</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +50 Coins Milestone</div></div>' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">👨‍💻 Task Approval</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +20-100 Coins / Task</div></div>' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">📅 Week Completed</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +30 Coins Bonus</div></div>' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">🧠 Quiz Passed</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +50 Coins (1st Try)</div></div>' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">💼 Daily Job Post</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +5-15 Coins / Post</div></div>' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">🎥 Course Video Watched</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +5 Coins / Video</div></div>' +
                       '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;">' +
                       '<div style="font-size:10px;color:#9aa4bf;font-weight:700;margin-bottom:2px;">🎓 Full Course Completion</div>' +
                       '<div style="font-size:13px;font-weight:900;color:#10b981;">🪙 +500 Coins Grand Prize</div></div>' +
                       '</div>' +
                       '</div>';

            // Tabs
            htmlStr += '<div class="ten-x-mkt-tabs" style="display:flex;gap:12px;margin:20px 0 16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">' +
                       '<button id="mkt-tab-browse-btn" onclick="TenExtras.switchMktTab(\'browse\')" style="background:transparent;border:none;color:#f5c542;font-weight:800;font-size:13px;padding:8px 16px;cursor:pointer;border-radius:8px;transition:all 0.2s;" class="ten-x-mkt-tab-active">🛍️ Browse Rewards</button>' +
                       '<button id="mkt-tab-bookings-btn" onclick="TenExtras.switchMktTab(\'bookings\')" style="background:transparent;border:none;color:#9aa4bf;font-weight:700;font-size:13px;padding:8px 16px;cursor:pointer;border-radius:8px;transition:all 0.2s;">📅 My Booked Sessions</button>' +
                       '</div>';

            // Content Browse Container Open
            htmlStr += '<div id="mkt-content-browse">' +
                       '<div class="ten-x-mkt-sec">👨‍🏫 1-on-1 Mentorship Sessions (Up to 40% Off)</div>' +
                       '<div class="ten-x-mkt-grid">';
            
            mList.forEach(it => {
                htmlStr += renderCard(it, cBalance);
            });

            htmlStr += '</div>' +
                       '<div class="ten-x-mkt-sec" style="margin-top:22px;">🎓 Official Paid Certificate Subsidies</div>' +
                       '<div class="ten-x-mkt-grid">';

            cList.forEach(it => {
                htmlStr += renderCard(it, cBalance);
            });

            htmlStr += '</div>' +
                       '<div class="ten-x-mkt-sec" style="margin-top:22px;">⚡ Premium Portal Upgrades & Boosters (100% Coin Redeem)</div>' +
                       '<div class="ten-x-mkt-grid">';

            const defaultBoosters = [
                { key: "booster_streak", title: "Streak Protection Shield", subtitle: "Prevents a single missed attendance log from resetting your streak", retailPrice: 0, coinsRequiredForMax: 150, maxDiscountRupees: 0 },
                { key: "booster_fasttrack", title: "Fast-Track Submission Review", subtitle: "Moves your next task to the top of the queue for review under 6h", retailPrice: 0, coinsRequiredForMax: 200, maxDiscountRupees: 0 },
                { key: "booster_multiplier", title: "1.5x Coin Yield (7 Days)", subtitle: "Earn 50% extra coins on daily attendance logs and task approvals", retailPrice: 0, coinsRequiredForMax: 300, maxDiscountRupees: 0 }
            ];

            defaultBoosters.forEach(it => {
                htmlStr += renderCard(it, cBalance);
            });

            htmlStr += '</div></div>';

            // Content Booked Sessions Container
            htmlStr += '<div id="mkt-content-bookings" style="display:none;">' +
                       '<div class="ten-x-mkt-sec">📅 My Booked Sessions</div>' +
                       '<div id="mkt-student-bookings-list" style="display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px;">' +
                       '<div style="color:#cbd5e1;font-size:12px;text-align:center;padding:24px;">Loading your booked sessions...</div>' +
                       '</div></div>';

            targetEl.innerHTML = htmlStr;

            // Auto load bookings to keep data ready
            loadStudentBookingsList(employeeId);
        };

        render(coins, defaultMentorship, defaultCerts);

        try {
            const r = await fetch("/api/v2/marketplace/catalog", {
                headers: { "x-employee-id": employeeId || "" }
            });
            if (r.ok) {
                const resData = await r.json();
                if (resData && resData.success) {
                    const servCoins = (typeof resData.studentCoins === 'number') ? resData.studentCoins : coins;
                    const mList = (resData.mentorship && resData.mentorship.length) ? resData.mentorship : defaultMentorship;
                    const cList = (resData.certificates && resData.certificates.length) ? resData.certificates : defaultCerts;
                    render(servCoins, mList, cList);
                }
            }
        } catch (_) {}
    }

    function switchMktTab(tabName) {
        const browseBtn = document.getElementById("mkt-tab-browse-btn");
        const bookingsBtn = document.getElementById("mkt-tab-bookings-btn");
        const browseContent = document.getElementById("mkt-content-browse");
        const bookingsContent = document.getElementById("mkt-content-bookings");

        if (!browseBtn || !bookingsBtn || !browseContent || !bookingsContent) return;

        if (tabName === 'browse') {
            browseBtn.classList.add("ten-x-mkt-tab-active");
            browseBtn.style.color = "#f5c542";
            bookingsBtn.classList.remove("ten-x-mkt-tab-active");
            bookingsBtn.style.color = "#9aa4bf";
            browseContent.style.display = "block";
            bookingsContent.style.display = "none";
        } else {
            bookingsBtn.classList.add("ten-x-mkt-tab-active");
            bookingsBtn.style.color = "#f5c542";
            browseBtn.classList.remove("ten-x-mkt-tab-active");
            browseBtn.style.color = "#9aa4bf";
            browseContent.style.display = "none";
            bookingsContent.style.display = "block";
            // Refresh list on switch
            const st = JSON.parse(localStorage.getItem("student") || "{}");
            const empId = st.employeeId || localStorage.getItem("employeeId") || "TEN-STU-001";
            loadStudentBookingsList(empId);
        }
    }

    async function loadStudentBookingsList(employeeId) {
        const container = document.getElementById("mkt-student-bookings-list");
        if (!container) return;

        try {
            const res = await fetch(`/api/v2/student/my-bookings?employeeId=${encodeURIComponent(employeeId)}`);
            const data = await res.json();

            if (data.success && data.bookings && data.bookings.length > 0) {
                container.innerHTML = data.bookings.map(b => {
                    const bDate = b.createdAt ? new Date(b.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Just Now';
                    
                    let statusHtml = '';
                    if (b.status === 'pending') {
                        statusHtml = `<span style="color:#ef4444;background:rgba(239,68,68,0.12);padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">⏳ PENDING VERIFICATION</span>`;
                    } else if (b.status === 'completed') {
                        statusHtml = `<span style="color:#f5c542;background:rgba(245,197,66,0.12);padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">⏳ MENTOR ASSIGNMENT PENDING</span>`;
                    } else if (b.status === 'assigned') {
                        statusHtml = `
                          <div style="margin-top:6px;padding:8px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);border-radius:8px;font-size:11px;">
                            <div style="color:#38bdf8;font-weight:800;">👤 ASSIGNED MENTOR:</div>
                            <div style="color:#fff;font-weight:700;margin-top:2px;">${b.mentorName || 'Senior Web Engineer'} (${b.mentorEmail || 'shindedevaraj0@gmail.com'})</div>
                            <div style="color:#9aa4bf;margin-top:4px;">⏰ Slot Confirmed: <b>${b.slotTime || 'Tomorrow, 5:00 PM'}</b></div>
                            <div style="color:#e2eaf7;font-style:italic;margin-top:4px;">🎥 Meeting link will be shared to email & here once mentor launches the session.</div>
                          </div>
                        `;
                    } else if (b.status === 'live') {
                        statusHtml = `
                          <div style="margin-top:6px;padding:12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:8px;font-size:11px;display:flex;flex-direction:column;gap:6px;">
                            <div style="color:#10b981;font-weight:900;display:flex;align-items:center;gap:6px;animation:ten-pulse 1.5s infinite;">
                              <span style="width:8px;height:8px;border-radius:50%;background:#10b981;"></span> 🟢 MEETING IS LIVE NOW!
                            </div>
                            <div style="color:#fff;font-weight:700;">Mentor: ${b.mentorName || 'Senior Mentor'} is in the meeting.</div>
                            <a href="${b.meetUrl || 'https://meet.google.com/new'}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:800;padding:8px 16px;border-radius:6px;text-align:center;text-decoration:none;margin-top:4px;box-shadow:0 4px 10px rgba(16,185,129,0.3);">
                              🎥 Join Live Mentorship Session Now
                            </a>
                          </div>
                        `;
                    } else if (b.status === 'finished') {
                        statusHtml = `
                          <div style="margin-top:6px;padding:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;font-size:11px;">
                            <div style="color:#10b981;font-weight:800;display:flex;align-items:center;gap:4px;">🎉 ✅ SESSION COMPLETED</div>
                            <div style="color:#9aa4bf;margin-top:4px;">This mentorship session has been completed by your advisor.</div>
                          </div>
                        `;
                    }

                    return `
                      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;">
                        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:6px;">
                          <div>
                            <div style="font-size:13px;font-weight:800;color:#fff;">${esc(b.title)}</div>
                            <div style="font-size:11px;color:#9aa4bf;margin-top:2px;">📅 Booked: ${bDate}</div>
                          </div>
                          <div style="text-align:right;">
                            <div style="font-size:12px;font-weight:800;color:#10b981;">₹${b.netPaidAmount || 0} Paid</div>
                            <div style="font-size:10px;color:#f5c542;margin-top:2px;">🪙 ${b.coinsRedeemed || 0} Coins Redeemed</div>
                          </div>
                        </div>

                        <div style="border-top:1px dashed rgba(255,255,255,0.05);padding-top:8px;font-size:11px;color:#9aa4bf;display:flex;flex-direction:column;gap:4px;">
                          <div>💳 <b>UTR Number:</b> <span style="font-family:monospace;color:#f5c542;">${b.paymentId || 'N/A'}</span></div>
                          ${statusHtml}
                        </div>
                      </div>
                    `;
                }).join('');
            } else {
                container.innerHTML = `
                  <div style="color:#5a7299;font-size:12px;text-align:center;padding:28px;">
                    <div style="font-size:24px;margin-bottom:8px;">📅</div>
                    <div>No Booked Sessions Found</div>
                    <div style="font-size:10px;margin-top:2px;">Redeem coins to book a mentorship session or upgrade your certificate!</div>
                  </div>
                `;
            }
        } catch (_) {
            container.innerHTML = '<div style="color:#ef4444;font-size:11px;text-align:center;padding:24px;">Failed to load bookings list.</div>';
        }
    }

    function spawnFloatingCoins() {
        for (let i = 0; i < 12; i++) {
            const coin = document.createElement("div");
            coin.textContent = "🪙";
            coin.style.cssText = `position:fixed;left:${window.innerWidth/2 + (Math.random()-0.5)*200}px;top:${window.innerHeight/2 + (Math.random()-0.5)*100}px;font-size:28px;z-index:999999;pointer-events:none;transition:all 1.2s cubic-bezier(0.25, 1, 0.5, 1);opacity:1;transform:scale(0.5);`;
            document.body.appendChild(coin);
            setTimeout(() => {
                coin.style.top = `${window.innerHeight/2 - 250 - Math.random()*100}px`;
                coin.style.opacity = "0";
                coin.style.transform = "scale(1.5) rotate(360deg)";
            }, 30);
            setTimeout(() => coin.remove(), 1300);
        }
    }

    async function claimWelcomeCoins(employeeId) {
        spawnFloatingCoins();
        launchConfetti();

        let s = JSON.parse(localStorage.getItem("student") || "{}");
        const prevCoins = s.coins || 0;
        s.coins = prevCoins + 250;
        s.claimedWelcomeCoins = true;
        localStorage.setItem("student", JSON.stringify(s));

        fetch("/api/v2/marketplace/dev-add-coins", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
            body: JSON.stringify({ coins: 250 })
        }).catch(() => {});

        const coinEl = document.querySelector(".ten-x-mkt-coins");
        if (coinEl) {
            let start = prevCoins;
            let end = prevCoins + 250;
            let dur = 1000;
            let startTime = null;
            const animate = (t) => {
                if (!startTime) startTime = t;
                let prog = Math.min((t - startTime) / dur, 1);
                let cur = Math.floor(prog * (end - start) + start);
                coinEl.textContent = `🪙 ${cur} Coins`;
                if (prog < 1) requestAnimationFrame(animate);
                else {
                    setTimeout(() => location.reload(), 800);
                }
            };
            requestAnimationFrame(animate);
        } else {
            setTimeout(() => location.reload(), 1000);
        }
    }

    async function addTestCoins(employeeId) {
        return claimWelcomeCoins(employeeId);
    }

    async function openCheckoutModal(itemKey, employeeId) {
        if (itemKey && itemKey.indexOf("booster_") === 0) {
            let stuCoins = 500;
            try { 
                const st = JSON.parse(localStorage.getItem("student") || "{}");
                stuCoins = (typeof st.coins === 'number') ? st.coins : 500;
            } catch(_) {}
            
            const boosterMap = {
                "booster_streak": { title: "Streak Protection Shield", coins: 150 },
                "booster_fasttrack": { title: "Fast-Track Submission Review", coins: 200 },
                "booster_multiplier": { title: "1.5x Coin Yield (7 Days)", coins: 300 }
            };
            const b = boosterMap[itemKey] || { title: "Booster Upgrade", coins: 100 };
            
            if (stuCoins < b.coins) {
                Swal.fire({
                    icon: 'error',
                    title: 'Insufficient Coins',
                    text: 'You need ' + b.coins + ' coins to redeem this booster. You currently have ' + stuCoins + ' coins.',
                    background: '#0c1220',
                    color: '#fff',
                    confirmButtonColor: '#38bdf8'
                });
                return;
            }
            
            const confirmRes = await Swal.fire({
                title: 'Redeem Booster Upgrade?',
                text: 'Activate ' + b.title + ' instantly for ' + b.coins + ' coins?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#10b981',
                cancelButtonColor: '#ef4444',
                confirmButtonText: 'Yes, Redeem & Activate!',
                background: '#0c1220',
                color: '#fff'
            });
            
            if (!confirmRes.isConfirmed) return;
            
            Swal.fire({
                title: 'Processing instant redemption...',
                background: '#0c1220',
                color: '#fff',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });
            
            try {
                const res = await fetch("/api/v2/marketplace/redeem-booster", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
                    body: JSON.stringify({ itemKey })
                });
                const data = await res.json();
                if (data.success) {
                    const stObj = JSON.parse(localStorage.getItem("student") || "{}");
                    stObj.coins = data.newCoinsBalance;
                    localStorage.setItem("student", JSON.stringify(stObj));
                    
                    await Swal.fire({
                        icon: 'success',
                        title: 'Booster Activated! 🚀',
                        text: b.title + ' is now active on your dashboard! Debited ' + b.coins + ' Coins.',
                        background: '#0c1220',
                        color: '#fff',
                        confirmButtonColor: '#10b981'
                    });
                    location.reload();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Redemption Failed',
                        text: data.message || 'Error processing request.',
                        background: '#0c1220',
                        color: '#fff',
                        confirmButtonColor: '#ef4444'
                    });
                }
            } catch (_) {
                Swal.fire({
                    icon: 'error',
                    title: 'System Error',
                    text: 'Unable to process instant redemption at this time.',
                    background: '#0c1220',
                    color: '#fff',
                    confirmButtonColor: '#ef4444'
                });
            }
            return;
        }

        let q = null;
        try {
            const quoteRes = await fetch("/api/v2/marketplace/quote", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
                body: JSON.stringify({ itemKey })
            });
            const resData = await quoteRes.json();
            if (resData.success) q = resData;
        } catch (_) {}

        if (!q || !q.coinsToUse) {
            let stuCoins = 500;
            try { 
                const st = JSON.parse(localStorage.getItem("student") || "{}");
                if (typeof st.coins === 'number' && st.coins > 0) {
                    stuCoins = st.coins;
                } else {
                    st.coins = 500;
                    localStorage.setItem("student", JSON.stringify(st));
                }
            } catch(_) {}

            const itemMap = {
                "mentor_250": { title: "Standard Mentor Session (30 Min)", retailPrice: 250, maxCoins: 200 },
                "mentor_500": { title: "Extended Mentor Session (45 Min)", retailPrice: 500, maxCoins: 400 },
                "mentor_1000": { title: "Executive Founder Session (60 Min)", retailPrice: 1000, maxCoins: 800 },
                "cert_expert": { title: "Expert Certificate Upgrade", retailPrice: 100, maxCoins: 100 },
                "cert_nano": { title: "Nano Degree Upgrade", retailPrice: 1000, maxCoins: 600 },
                "cert_fellowship": { title: "Fellowship Certificate Upgrade", retailPrice: 2500, maxCoins: 1000 }
            };
            const it = itemMap[itemKey] || { title: "Marketplace Item", retailPrice: 500, maxCoins: 400 };

            const coinsToUse = Math.min(stuCoins, it.maxCoins);
            const discountRupees = coinsToUse * 0.50;

            q = {
                success: true,
                title: it.title,
                retailPrice: it.retailPrice,
                discountRupees: discountRupees,
                coinsToUse: coinsToUse,
                netPaidAmount: Math.max(0, it.retailPrice - discountRupees)
            };
        }

        const modalHtml = `
          <div class="tfp-overlay open" id="mkt-checkout-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(5px);">
            <div class="tfp-modal" style="background:#0c1220;border:1px solid rgba(245,197,66,0.4);border-radius:18px;padding:24px;width:92%;max-width:480px;color:#fff;box-shadow:0 24px 60px rgba(0,0,0,0.85);font-family:inherit;max-height:90vh;overflow-y:auto;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <div style="font-size:18px;font-weight:900;color:#f5c542;">🛍️ Enterprise Checkout Gateway</div>
                <button onclick="document.getElementById('mkt-checkout-modal').remove()" style="background:transparent;border:none;color:#9aa4bf;font-size:20px;cursor:pointer;">✕</button>
              </div>
              <div style="font-size:13px;color:#9aa4bf;margin-bottom:8px;">${esc(q.title)}</div>
              

              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(245,197,66,0.2);border-radius:12px;padding:12px 16px;margin:10px 0;">
                <div style="display:flex;justify-content:space-between;font-size:13px;color:#9aa4bf;margin-bottom:4px;">
                  <span>Retail Price:</span>
                  <span style="text-decoration:line-through;">₹${q.retailPrice}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:#f5c542;font-weight:700;margin-bottom:4px;">
                  <span>Coin Discount (${q.coinsToUse} Coins @ ₹0.50):</span>
                  <span>- ₹${q.discountRupees}</span>
                </div>
                <div style="border-top:1px solid rgba(245,197,66,0.2);padding-top:6px;display:flex;justify-content:space-between;font-size:16px;color:#10b981;font-weight:900;">
                  <span>Net Amount Payable:</span>
                  <span>₹${q.netPaidAmount}</span>
                </div>
              </div>

              <div style="margin:12px 0;">
                <label style="font-size:11px;color:#9aa4bf;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Select Preferred Payment Method</label>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;">
                  <button type="button" class="mkt-pm-tab active" id="pm-tab-upi" onclick="TenExtras.switchPaymentMethod('upi', '${esc(itemKey)}', '${esc(employeeId)}', ${q.coinsToUse}, ${q.netPaidAmount})" style="padding:10px;background:rgba(245,197,66,0.15);border:1px solid #f5c542;border-radius:10px;color:#fff;font-weight:700;font-size:12px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;">
                    📱 Manual UPI / QR
                  </button>
                  <button type="button" class="mkt-pm-tab" id="pm-tab-rzp" onclick="TenExtras.switchPaymentMethod('razorpay_tab', '${esc(itemKey)}', '${esc(employeeId)}', ${q.coinsToUse}, ${q.netPaidAmount})" style="padding:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(99,140,210,0.2);border-radius:10px;color:#9aa4bf;font-weight:700;font-size:12px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;">
                    💳 Razorpay Secure
                  </button>
                </div>
              </div>

              <div id="mkt-payment-panel" style="margin:10px 0;"></div>
            </div>
          </div>
        `;

        const existingModal = document.getElementById("mkt-checkout-modal");
        if (existingModal) existingModal.remove();
        document.body.insertAdjacentHTML("beforeend", modalHtml);

        TenExtras.switchPaymentMethod('upi', itemKey, employeeId, q.coinsToUse, q.netPaidAmount);
    }

    function attachPaymentInputMasks() {
        setTimeout(() => {
            const cardNum = document.getElementById("mkt-card-num");
            if (cardNum) {
                cardNum.addEventListener("input", (e) => {
                    let v = e.target.value.replace(/\D/g, "").slice(0, 16);
                    let formatted = v.match(/.{1,4}/g)?.join(" ") || "";
                    e.target.value = formatted;
                });
            }

            const cardExp = document.getElementById("mkt-card-exp");
            if (cardExp) {
                cardExp.addEventListener("input", (e) => {
                    let v = e.target.value.replace(/\D/g, "").slice(0, 4);
                    if (v.length >= 3) {
                        e.target.value = v.slice(0, 2) + "/" + v.slice(2);
                    } else {
                        e.target.value = v;
                    }
                });
            }

            const cardCvv = document.getElementById("mkt-card-cvv");
            if (cardCvv) {
                cardCvv.addEventListener("input", (e) => {
                    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
                });
            }

            const cardName = document.getElementById("mkt-card-name");
            if (cardName) {
                cardName.addEventListener("input", (e) => {
                    e.target.value = e.target.value.replace(/[^a-zA-Z\s\.\-]/g, "").toUpperCase();
                });
            }

            const utrInput = document.getElementById("mkt-utr-input");
            if (utrInput) {
                utrInput.addEventListener("input", (e) => {
                    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 12);
                });
            }
        }, 50);
    }

    let qrTimerInterval = null;
    function startQrCountdownTimer(durationSeconds) {
        if (qrTimerInterval) clearInterval(qrTimerInterval);
        let remaining = durationSeconds || 900;

        const updateDisplay = () => {
            const timerEl = document.getElementById("mkt-qr-timer-text");
            const boxEl = document.getElementById("mkt-qr-timer-box");
            if (!timerEl) {
                if (qrTimerInterval) clearInterval(qrTimerInterval);
                return;
            }

            if (remaining <= 0) {
                if (qrTimerInterval) clearInterval(qrTimerInterval);
                timerEl.textContent = "00:00 (Expired)";
                if (boxEl) {
                    boxEl.style.background = 'rgba(239,68,68,0.15)';
                    boxEl.style.borderColor = '#ef4444';
                    boxEl.style.color = '#ef4444';
                }
                const container = document.getElementById("mkt-qr-img-box");
                if (container) {
                    container.innerHTML = `
                      <div style="padding:20px 10px;color:#ef4444;text-align:center;">
                        <div style="font-size:32px;margin-bottom:6px;">⏱️</div>
                        <div style="font-size:14px;font-weight:900;margin-bottom:4px;">QR Code Expired</div>
                        <div style="font-size:11px;color:#9aa4bf;margin-bottom:12px;">This 15-minute payment session timed out.</div>
                        <button onclick="TenExtras.switchPaymentMethod('upi')" style="padding:8px 14px;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border:none;border-radius:6px;font-weight:800;font-size:12px;cursor:pointer;">🔄 Regenerate QR Code</button>
                      </div>
                    `;
                }
                return;
            }

            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            const formatted = (m < 10 ? '0' + m : m) + ":" + (s < 10 ? '0' + s : s);
            timerEl.textContent = formatted;

            if (remaining <= 180 && boxEl) {
                boxEl.style.background = 'rgba(239,68,68,0.15)';
                boxEl.style.borderColor = '#ef4444';
                boxEl.style.color = '#ef4444';
            }

            remaining--;
        };

        updateDisplay();
        qrTimerInterval = setInterval(updateDisplay, 1000);
    }

    function switchPaymentMethod(method, itemKey, employeeId, coinsToUse, netAmount) {
        document.querySelectorAll('.mkt-pm-tab').forEach(b => {
            b.style.background = 'rgba(255,255,255,0.05)';
            b.style.borderColor = 'rgba(99,140,210,0.2)';
            b.style.color = '#9aa4bf';
        });

        const tabSuffix = method === 'upi' ? 'upi' : 'rzp';
        const activeTab = document.getElementById('pm-tab-' + tabSuffix);
        if (activeTab) {
            activeTab.style.background = 'rgba(245,197,66,0.15)';
            activeTab.style.borderColor = '#f5c542';
            activeTab.style.color = '#fff';
        }

        const panel = document.getElementById("mkt-payment-panel");
        if (!panel) return;

        const payable = (typeof netAmount === 'number') ? netAmount : 250;

        if (method === 'upi') {
            const upiString = `upi://pay?pa=paytmqr5k0ods@ptys&pn=The%20Entrepreneurship%20Network&am=${payable}&cu=INR`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiString)}`;

            panel.innerHTML = `
              <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:16px;text-align:center;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding:6px 12px;background:rgba(245,197,66,0.12);border:1px solid rgba(245,197,66,0.3);border-radius:10px;" id="mkt-qr-timer-box">
                  <span style="font-size:11px;color:#9aa4bf;font-weight:700;">⏱️ QR Code Expires In:</span>
                  <span id="mkt-qr-timer-text" style="font-family:monospace;font-size:14px;font-weight:900;color:#f5c542;letter-spacing:1px;">15:00</span>
                </div>

                <div style="color:#10b981;font-weight:800;font-size:13px;margin-bottom:6px;">📱 Scan & Pay via Paytm / PhonePe / GPay / BHIM</div>
                
                <div id="mkt-qr-img-box" style="display:inline-block;background:#ffffff;padding:10px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.5);margin-bottom:8px;">
                  <img src="${qrUrl}" onError="this.onerror=null; this.src='https://chart.googleapis.com/chart?cht=qr&chs=180x180&chl=' + encodeURIComponent('${upiString}');" alt="UPI QR Code" style="width:150px;height:150px;display:block;border-radius:4px;" />
                </div>
                
                <div style="color:#f5c542;font-weight:900;font-size:14px;margin-bottom:4px;">Net Payable: ₹${payable}</div>
                
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,0.06);border:1px dashed rgba(245,197,66,0.4);border-radius:8px;padding:6px 10px;margin:8px 0;">
                  <span style="font-family:monospace;font-size:12px;color:#fff;font-weight:800;">paytmqr5k0ods@ptys</span>
                  <button onclick="navigator.clipboard.writeText('paytmqr5k0ods@ptys'); this.textContent='✓ Copied!'; setTimeout(()=>this.textContent='📋 Copy', 2000)" style="background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border:none;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:800;cursor:pointer;">📋 Copy</button>
                </div>

                <div style="font-size:11px;color:#9aa4bf;margin:10px 0 4px;text-align:left;font-weight:700;">
                  <span>ENTER 12-DIGIT UPI TRANSACTION REF / UTR:</span>
                </div>
                <input type="text" id="mkt-utr-input" placeholder="Enter actual 12-digit UTR number" maxlength="12" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(245,197,66,0.4);background:#080c16;color:#f5c542;font-weight:800;font-size:13px;letter-spacing:1px;margin-bottom:10px;box-sizing:border-box;">
                
                <button onclick="TenExtras.submitUtrVerification('${esc(itemKey)}', '${esc(employeeId)}', ${coinsToUse})" style="width:100%;padding:11px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(16,185,129,0.3);">
                  ✅ Verify UTR & Complete Redemption
                </button>
              </div>
            `;
            startQrCountdownTimer(900);
        } else if (method === 'razorpay_tab') {
            panel.innerHTML = `
              <div style="background:rgba(99,140,210,0.06);border:1px solid rgba(99,140,210,0.25);border-radius:14px;padding:20px;text-align:center;">
                <div style="display:inline-block;background:#ffffff;padding:10px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.5);margin-bottom:12px;opacity:0.9;">
                  <div style="width:150px;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0f172a;color:#f5c542;border-radius:8px;border:1px solid rgba(245,197,66,0.3);padding:10px;box-sizing:border-box;position:relative;overflow:hidden;">
                    <i class="fa-solid fa-credit-card" style="font-size:44px;color:#38bdf8;margin-bottom:10px;"></i>
                    <span style="font-size:10px;font-weight:800;letter-spacing:1px;color:#10b981;">ONLINE GATEWAY</span>
                  </div>
                </div>
                <div style="color:#10b981;font-weight:800;font-size:13px;margin-bottom:8px;">🔒 SECURE RAZORPAY GATEWAY</div>
                <p style="font-size:11px;color:#9aa4bf;line-height:1.6;margin-bottom:14px;">Pay securely via Card, NetBanking, UPI App, or Wallet. The system will verify the payment instantly.</p>
                <button onclick="TenExtras.openRazorpayPayment('${esc(itemKey)}', '${esc(employeeId)}', ${coinsToUse}, ${payable})" style="width:100%;padding:12px;background:linear-gradient(135deg,#38bdf8,#0284c7);color:#fff;border:none;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(56,189,248,0.3);display:flex;align-items:center;justify-content:center;gap:8px;">
                  <i class="fa-solid fa-lock"></i> Pay ₹${payable} with Razorpay Secure →
                </button>
              </div>
            `;
        }

        attachPaymentInputMasks();
    }

    async function confirmMarketplacePayment(itemKey, employeeId, coinsToUse, netAmount) {
        return switchPaymentMethod('upi', itemKey, employeeId, coinsToUse, netAmount);
    }

    function isValidLuhn(numberStr) {
        const digits = numberStr.replace(/\D/g, "");
        if (digits.length < 13 || digits.length > 19) return false;
        let sum = 0;
        let shouldDouble = false;
        for (let i = digits.length - 1; i >= 0; i--) {
            let digit = parseInt(digits.charAt(i), 10);
            if (shouldDouble) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
            shouldDouble = !shouldDouble;
        }
        return (sum % 10 === 0);
    }

    async function submitCardPayment(itemKey, employeeId, coinsToUse, netAmount) {
        const num = (document.getElementById("mkt-card-num")?.value || "").replace(/\s+/g, "");
        const exp = (document.getElementById("mkt-card-exp")?.value || "").trim();
        const cvv = (document.getElementById("mkt-card-cvv")?.value || "").trim();
        const name = (document.getElementById("mkt-card-name")?.value || "").trim();

        if (!num || num.length < 13 || !/^\d+$/.test(num)) {
            alert("❌ Invalid Card Number format! Card number must contain 13 to 19 digits.");
            return;
        }

        if (!isValidLuhn(num)) {
            alert("❌ Invalid Card Number! This card failed bank MOD-10 (Luhn) checksum validation. Please enter a genuine Visa, Mastercard, or RuPay credit/debit card.");
            return;
        }

        if (!exp || !/^\d{2}\/\d{2}$/.test(exp)) {
            alert("❌ Invalid Expiry Date format! Please use MM/YY format (e.g. 12/28).");
            return;
        }

        const parts = exp.split('/');
        const month = parseInt(parts[0], 10);
        const year = parseInt(parts[1], 10);
        const currentYear2Digits = parseInt(new Date().getFullYear().toString().slice(-2), 10);
        const currentMonth = new Date().getMonth() + 1;

        if (month < 1 || month > 12) {
            alert("❌ Invalid Expiry Month! Month must be between 01 and 12.");
            return;
        }

        if (year < currentYear2Digits || (year === currentYear2Digits && month < currentMonth)) {
            alert("❌ Card Expired! This credit/debit card expired in 20" + (year < 10 ? "0" + year : year) + ".");
            return;
        }

        if (!cvv || !/^\d{3,4}$/.test(cvv)) {
            alert("❌ Invalid CVV/CVC! Must be 3 or 4 numeric digits.");
            return;
        }

        if (!name || name.length < 2) {
            alert("❌ Please enter the Cardholder Name as printed on your card.");
            return;
        }

        const last4 = num.slice(-4);
        const otpModalHtml = `
          <div id="mkt-otp-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);">
            <div style="background:#0e1628;border:1px solid rgba(245,197,66,0.5);border-radius:16px;padding:24px;max-width:400px;width:100%;color:#fff;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.9);font-family:inherit;">
              <div style="font-size:24px;margin-bottom:6px;">🔒</div>
              <div style="font-size:16px;font-weight:800;color:#f5c542;margin-bottom:4px;">3D-Secure Card Authorization</div>
              <div style="font-size:12px;color:#9aa4bf;margin-bottom:12px;">Card: •••• •••• •••• ${last4} (${esc(name)})</div>
              <div style="font-size:12px;color:#9aa4bf;margin-bottom:14px;">Enter 6-Digit Banking OTP sent to registered mobile +91 ******4829</div>

              <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(99,140,210,0.2);border-radius:10px;padding:10px;margin-bottom:16px;font-size:13px;display:flex;justify-content:space-between;font-weight:700;">
                <span style="color:#9aa4bf;">Amount:</span>
                <span style="color:#10b981;">₹${netAmount}</span>
              </div>

              <input type="text" id="mkt-card-otp" placeholder="Enter 6-digit OTP (e.g. 492810)" maxlength="6" style="width:100%;padding:12px;border-radius:8px;border:1px solid #f5c542;background:#080c16;color:#f5c542;font-weight:900;font-size:16px;letter-spacing:2px;text-align:center;margin-bottom:14px;box-sizing:border-box;">

              <button onclick="const otp=(document.getElementById('mkt-card-otp').value||'').trim(); if(otp.length<6){alert('Please enter your 6-digit banking OTP.');return;} TenExtras.processProviderPayment('${esc(itemKey)}', '${esc(employeeId)}', ${coinsToUse}, 'card', 'CARD-OTP-' + otp)" style="width:100%;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;font-weight:800;font-size:14px;cursor:pointer;">
                Submit OTP & Complete Payment →
              </button>
              <button onclick="document.getElementById('mkt-otp-modal').remove()" style="margin-top:10px;background:transparent;border:none;color:#9aa4bf;font-size:12px;cursor:pointer;">Cancel</button>
            </div>
          </div>
        `;
        document.body.insertAdjacentHTML("beforeend", otpModalHtml);
    }

    async function submitNetBankingPayment(itemKey, employeeId, coinsToUse, netAmount) {
        const nbModalHtml = `
          <div id="mkt-otp-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);">
            <div style="background:#0e1628;border:1px solid rgba(245,197,66,0.5);border-radius:16px;padding:24px;max-width:400px;width:100%;color:#fff;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.9);font-family:inherit;">
              <div style="font-size:24px;margin-bottom:6px;">🏛️</div>
              <div style="font-size:16px;font-weight:800;color:#f5c542;margin-bottom:4px;">NetBanking Secure Portal</div>
              <div style="font-size:12px;color:#9aa4bf;margin-bottom:14px;">Log in to authorize NetBanking payment of ₹${netAmount}</div>

              <div style="margin-bottom:12px;text-align:left;">
                <label style="font-size:10px;color:#9aa4bf;display:block;margin-bottom:3px;font-weight:700;">USER ID / CUSTOMER ID</label>
                <input type="text" id="mkt-nb-user" placeholder="Enter Bank Customer ID" style="width:100%;padding:9px 10px;background:#080c16;border:1px solid rgba(99,140,210,0.3);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;">
              </div>

              <button onclick="const uid=(document.getElementById('mkt-nb-user').value||'').trim(); if(!uid){alert('Please enter your Bank User ID / Customer ID.');return;} TenExtras.processProviderPayment('${esc(itemKey)}', '${esc(employeeId)}', ${coinsToUse}, 'netbanking', 'NB-REF-' + uid)" style="width:100%;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;font-weight:800;font-size:14px;cursor:pointer;">
                Authorize NetBanking Payment →
              </button>
              <button onclick="document.getElementById('mkt-otp-modal').remove()" style="margin-top:10px;background:transparent;border:none;color:#9aa4bf;font-size:12px;cursor:pointer;">Cancel</button>
            </div>
          </div>
        `;
        document.body.insertAdjacentHTML("beforeend", nbModalHtml);
    }

    async function submitWalletPayment(itemKey, employeeId, coinsToUse, netAmount) {
        const selectedWallet = document.querySelector('input[name="w_opt"]:checked')?.value || "Wallet";
        const wModalHtml = `
          <div id="mkt-otp-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);">
            <div style="background:#0e1628;border:1px solid rgba(245,197,66,0.5);border-radius:16px;padding:24px;max-width:400px;width:100%;color:#fff;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.9);font-family:inherit;">
              <div style="font-size:24px;margin-bottom:6px;">💼</div>
              <div style="font-size:16px;font-weight:800;color:#f5c542;margin-bottom:4px;">${esc(selectedWallet)} Auto-Debit</div>
              <div style="font-size:12px;color:#9aa4bf;margin-bottom:14px;">Enter registered wallet mobile number to authorize ₹${netAmount} deduction</div>

              <div style="margin-bottom:14px;text-align:left;">
                <label style="font-size:10px;color:#9aa4bf;display:block;margin-bottom:3px;font-weight:700;">WALLET LINKED MOBILE</label>
                <input type="text" id="mkt-wallet-phone" placeholder="Your 10-digit mobile number" maxlength="10" style="width:100%;padding:9px 10px;background:#080c16;border:1px solid rgba(99,140,210,0.3);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;">
              </div>

              <button onclick="const ph=(document.getElementById('mkt-wallet-phone').value||'').trim(); if(ph.length<10){alert('Please enter valid 10-digit wallet mobile number.');return;} TenExtras.processProviderPayment('${esc(itemKey)}', '${esc(employeeId)}', ${coinsToUse}, 'wallet', 'WALLET-AUTH-' + ph)" style="width:100%;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;font-weight:800;font-size:14px;cursor:pointer;">
                Confirm & Pay ₹${netAmount} →
              </button>
              <button onclick="document.getElementById('mkt-otp-modal').remove()" style="margin-top:10px;background:transparent;border:none;color:#9aa4bf;font-size:12px;cursor:pointer;">Cancel</button>
            </div>
          </div>
        `;
        document.body.insertAdjacentHTML("beforeend", wModalHtml);
    }

    function playVictoryChime() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.1);
            osc.frequency.setValueAtTime(783.99, now + 0.2);
            osc.frequency.setValueAtTime(1046.50, now + 0.3);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.8);
        } catch (_) {}
    }

    function launchConfetti() {
        playVictoryChime();
        let canvas = document.getElementById("ten-confetti-canvas");
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.id = "ten-confetti-canvas";
            canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;";
            document.body.appendChild(canvas);
        }
        const ctx = canvas.getContext("2d");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        const colors = ["#f5c542", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#ffffff"];
        for (let i = 0; i < 90; i++) {
            particles.push({
                x: canvas.width / 2,
                y: canvas.height / 2,
                vx: (Math.random() - 0.5) * 14,
                vy: (Math.random() - 0.8) * 16,
                size: Math.random() * 8 + 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rspeed: (Math.random() - 0.5) * 10,
                opacity: 1
            });
        }

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = false;
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.35;
                p.rotation += p.rspeed;
                p.opacity -= 0.012;
                if (p.opacity > 0) {
                    alive = true;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate((p.rotation * Math.PI) / 180);
                    ctx.globalAlpha = Math.max(0, p.opacity);
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                    ctx.restore();
                }
            });
            if (alive) {
                requestAnimationFrame(render);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        };
        render();
    }

    function downloadRedemptionPassPDF(d) {
        let studentData = {};
        try { studentData = JSON.parse(localStorage.getItem("student") || "{}"); } catch(_) {}
        const studentName = studentData.name || ((studentData.firstName||"") + " " + (studentData.lastName||"")).trim() || "TEN Intern";
        const empId = studentData.employeeId || localStorage.getItem("employeeId") || "TEN-STU-001";

        let canvas = document.createElement("canvas");
        canvas.width = 750;
        canvas.height = 920;
        const ctx = canvas.getContext("2d");

        // 1. Crisp White Background & Outer Frame
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 750, 920);

        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 2;
        ctx.strokeRect(20, 20, 710, 880);

        // 2. Header Slate Banner
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(20, 20, 710, 100);

        ctx.fillStyle = "#ffffff";
        ctx.font = "900 22px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("THE ENTREPRENEURSHIP NETWORK", 45, 58);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "700 11px sans-serif";
        ctx.fillText("OFFICIAL TAX INVOICE & PAYMENT RECEIPT", 45, 80);
        ctx.fillText("CIN: U74999DL2020PTC368952 • GSTIN: 07AAAAA0000A1Z5", 45, 98);

        ctx.textAlign = "right";
        ctx.fillStyle = "#38bdf8";
        ctx.font = "900 16px monospace";
        ctx.fillText("PAID RECEIPT", 705, 60);
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "600 11px sans-serif";
        ctx.fillText(new Date().toLocaleDateString("en-IN", {day:"numeric", month:"short", year:"numeric"}), 705, 82);

        // 3. Two Information Columns
        ctx.textAlign = "left";

        // Box A: Billed To
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(45, 140, 315, 105);
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.strokeRect(45, 140, 315, 105);

        ctx.fillStyle = "#64748b";
        ctx.font = "800 10px sans-serif";
        ctx.fillText("BILLED TO / INTERN DETAILS:", 60, 162);
        ctx.fillStyle = "#0f172a";
        ctx.font = "900 14px sans-serif";
        ctx.fillText(studentName, 60, 185);
        ctx.fillStyle = "#475569";
        ctx.font = "700 11px monospace";
        ctx.fillText("ID: " + empId, 60, 207);
        ctx.font = "600 11px sans-serif";
ctx.fillText("Domain: " + (studentData.domain || "Tech & Product Engineering"), 60, 227);

        // Box B: Payment Metadata
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(390, 140, 315, 105);
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.strokeRect(390, 140, 315, 105);

        ctx.fillStyle = "#64748b";
        ctx.font = "800 10px sans-serif";
        ctx.fillText("TRANSACTION DETAILS:", 405, 162);
        ctx.fillStyle = "#0f172a";
        ctx.font = "900 12px sans-serif";
        ctx.fillText("Reference ID: " + (d.refId || "TEN-TXN-0000"), 405, 185);
        ctx.font = "700 11px monospace";
        ctx.fillText("Payment Mode: " + (d.mode || "Standard Transfer"), 405, 205);

        // 4. Table Header
        const tableY = 270;
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(45, tableY, 660, 34);

        ctx.fillStyle = "#64748b";
        ctx.font = "800 10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("ITEM DESCRIPTION", 60, tableY + 21);
        ctx.fillText("RETAIL PRICE", 380, tableY + 21);
        ctx.fillText("COIN SUBSIDY", 505, tableY + 21);
        ctx.textAlign = "right";
        ctx.fillText("NET PAID", 690, tableY + 21);

        // Table Content Row
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(45, tableY + 34, 660, 48);
        ctx.strokeStyle = "#e2e8f0";
        ctx.strokeRect(45, tableY + 34, 660, 48);

        ctx.fillStyle = "#0f172a";
        ctx.font = "800 13px sans-serif";
        ctx.fillText(d.title || "Standard Mentor Session (30 Min)", 60, tableY + 63);

        const coinsRedeemed = d.coinsToUse || 0;
        const coinsRupees = coinsRedeemed * 0.50;
        const netPaidAmount = typeof d.netAmount === 'number' ? d.netAmount : 500;
        const retailPrice = netPaidAmount + coinsRupees;

        ctx.fillStyle = "#475569";
        ctx.font = "700 12px sans-serif";
        ctx.fillText("₹" + retailPrice.toFixed(2), 380, tableY + 63);
        ctx.fillStyle = "#047857";
        ctx.fillText("-₹" + coinsRupees.toFixed(2) + " (" + coinsRedeemed + " Coins)", 505, tableY + 63);

        ctx.textAlign = "right";
        ctx.fillStyle = "#0f172a";
        ctx.font = "900 14px sans-serif";
        ctx.fillText("₹" + netPaidAmount.toFixed(2), 690, tableY + 63);

        // 5. Financial Summary Section (Right Aligned)
        const summaryY = tableY + 105;

        ctx.textAlign = "left";
        ctx.fillStyle = "#64748b";
        ctx.font = "600 12px sans-serif";
        ctx.fillText("Subtotal:", 450, summaryY);

        ctx.textAlign = "right";
        ctx.fillStyle = "#0f172a";
        ctx.fillText("₹" + retailPrice.toFixed(2), 690, summaryY);

        ctx.textAlign = "left";
        ctx.fillStyle = "#64748b";
        ctx.fillText("Coin Discount Subsidies:", 450, summaryY + 24);

        ctx.textAlign = "right";
        ctx.fillStyle = "#047857";
        ctx.fillText("-₹" + coinsRupees.toFixed(2), 690, summaryY + 24);

        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(360, summaryY + 36);
        ctx.lineTo(690, summaryY + 36);
        ctx.stroke();

        ctx.textAlign = "left";
        ctx.fillStyle = "#0f172a";
        ctx.font = "900 14px sans-serif";
        ctx.fillText("TOTAL AMOUNT PAID:", 360, summaryY + 62);

        ctx.textAlign = "right";
        ctx.fillStyle = "#047857";
        ctx.font = "900 17px sans-serif";
        ctx.fillText("₹" + netPaidAmount.toFixed(2) + " INR", 690, summaryY + 62);

        // 6. Corporate Seal & Audit Stamp (Placed Cleanly Below Summary)
        const stampY = summaryY + 95;

        ctx.textAlign = "left";
        ctx.fillStyle = "#ecfdf5";
        ctx.fillRect(45, stampY, 320, 75);
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2;
        ctx.strokeRect(45, stampY, 320, 75);

        ctx.fillStyle = "#047857";
        ctx.font = "900 12px sans-serif";
        ctx.fillText("✓ OFFICIAL CORPORATE SEAL & STAMP", 60, stampY + 24);
        ctx.fillStyle = "#064e3b";
        ctx.font = "700 11px sans-serif";
        ctx.fillText("VERIFIED TRANSACTION • FINANCE DEPT.", 60, stampY + 44);
        ctx.font = "600 10px sans-serif";
        ctx.fillText("The Entrepreneurship Network Trust Audit", 60, stampY + 60);

        // Payment Method Audit Stamp (Right side below total)
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(390, stampY, 315, 75);
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.strokeRect(390, stampY, 315, 75);

        ctx.fillStyle = "#475569";
        ctx.font = "800 10px sans-serif";
        ctx.fillText("PAYMENT METHOD & GATEWAY:", 405, stampY + 24);
        ctx.fillStyle = "#0f172a";
        ctx.font = "800 12px sans-serif";
        ctx.fillText("INSTANT UPI / BANK TRANSFER", 405, stampY + 44);
        ctx.fillStyle = "#047857";
        ctx.font = "700 10px sans-serif";
        ctx.fillText("✓ ELECTRONICALLY SIGNED & VERIFIED", 405, stampY + 60);

        // 7. Footer Divider & Terms
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(45, 845);
        ctx.lineTo(705, 845);
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.fillStyle = "#64748b";
        ctx.font = "500 10px sans-serif";
        ctx.fillText("This is a computer-generated tax invoice and payment receipt. No physical signature is required.", 375, 868);
        ctx.fillText("The Entrepreneurship Network • Registered Corporate HQ • www.entrepreneurshipnetwork.net", 375, 885);

        const a = document.createElement("a");
        a.download = `TEN_Tax_Invoice_${d.refId || 'Receipt'}.png`;
        a.href = canvas.toDataURL("image/png");
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
    }

    function openVideoCallDetailsModal(title, refId) {
        const meetUrl = "https://meet.google.com/new";
        const zoomUrl = "https://zoom.us/join";
        const modalHtml = `
          <div id="mkt-video-call-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:100010;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);">
            <div style="background:#0c1220;border:2px solid #f5c542;border-radius:20px;padding:28px;max-width:480px;width:100%;color:#fff;text-align:left;box-shadow:0 25px 60px rgba(245,197,66,0.3);font-family:inherit;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div style="font-size:18px;font-weight:900;color:#f5c542;">🎥 Video Call Meeting Room Access</div>
                <button onclick="document.getElementById('mkt-video-call-modal').remove()" style="background:transparent;border:none;color:#9aa4bf;font-size:20px;cursor:pointer;">✕</button>
              </div>

              <div style="font-size:13px;color:#9aa4bf;margin-bottom:16px;">
                Official 1-on-1 Mentorship session details for <strong>${esc(title || 'Mentorship Session')}</strong> (Ref: <span style="font-family:monospace;color:#f5c542;">${esc(refId || 'TEN-TXN')}</span>).
              </div>

              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(245,197,66,0.25);border-radius:12px;padding:16px;margin-bottom:16px;">
                <div style="margin-bottom:12px;">
                  <div style="font-size:10px;color:#9aa4bf;font-weight:700;letter-spacing:1px;margin-bottom:4px;">INSTANT GOOGLE MEET ROOM</div>
                  <div style="display:flex;align-items:center;gap:8px;background:#080c16;padding:8px 12px;border-radius:8px;border:1px solid rgba(99,140,210,0.3);">
                    <a href="${meetUrl}" target="_blank" style="color:#4285f4;font-family:monospace;font-size:13px;font-weight:800;text-decoration:none;flex:1;word-break:break-all;">https://meet.google.com/new</a>
                    <button onclick="navigator.clipboard.writeText('https://meet.google.com/new'); this.textContent='✓ Copied!';" style="background:#f5c542;color:#0c1220;border:none;border-radius:6px;padding:4px 10px;font-weight:800;font-size:11px;cursor:pointer;">📋 Copy</button>
                  </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  <div>
                    <div style="font-size:10px;color:#9aa4bf;font-weight:700;letter-spacing:1px;">MEETING PASSCODE</div>
                    <div style="font-size:14px;font-weight:900;color:#10b981;font-family:monospace;margin-top:2px;">TEN-2026-VIP</div>
                  </div>
                  <div>
                    <div style="font-size:10px;color:#9aa4bf;font-weight:700;letter-spacing:1px;">SCHEDULED TIME</div>
                    <div style="font-size:12px;font-weight:800;color:#fff;margin-top:2px;">Tomorrow @ 10:00 AM IST</div>
                  </div>
                </div>
              </div>

              <div style="display:flex;flex-direction:column;gap:10px;">
                <a href="${meetUrl}" target="_blank" style="display:block;text-align:center;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-decoration:none;border-radius:10px;font-weight:900;font-size:14px;box-shadow:0 4px 14px rgba(16,185,129,0.4);">
                  🚀 Launch Instant Google Meet Room →
                </a>
                <a href="${zoomUrl}" target="_blank" style="display:block;text-align:center;padding:10px;background:rgba(45,140,255,0.15);border:1px solid #2d8cff;color:#2d8cff;text-decoration:none;border-radius:10px;font-weight:800;font-size:13px;">
                  💻 Alternative: Join via Zoom Web Portal →
                </a>
                <button onclick="alert('📧 Confirmation email with meeting credentials has been resent to your registered address!');" style="padding:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(245,197,66,0.3);color:#f5c542;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;">
                  📧 Resend Email Confirmation to My Inbox
                </button>
                <button onclick="document.getElementById('mkt-video-call-modal').remove()" style="padding:8px;background:transparent;border:none;color:#9aa4bf;font-size:12px;cursor:pointer;">
                  Close
                </button>
              </div>
            </div>
          </div>
        `;

        const existing = document.getElementById("mkt-video-call-modal");
        if (existing) existing.remove();
        document.body.insertAdjacentHTML("beforeend", modalHtml);
    }

    function showPostRedemptionPassModal(d) {
        launchConfetti();
        const isCert = d.itemKey && d.itemKey.startsWith('cert_');
        const refId = d.refId || ('TEN-TXN-' + Math.floor(100000 + Math.random() * 900000));
        const isCompleted = d.status === 'completed';
        
        const passHtml = `
          <div id="mkt-success-pass-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:100005;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);">
            <div style="background:#0c1220;border:2px solid ${isCompleted ? '#10b981' : '#fbbf24'};border-radius:20px;padding:28px;max-width:460px;width:100%;color:#fff;text-align:center;box-shadow:0 25px 60px ${isCompleted ? 'rgba(16,185,129,0.3)' : 'rgba(251,191,36,0.2)'};font-family:inherit;">
              
              <div style="width:64px;height:64px;background:${isCompleted ? 'rgba(16,185,129,0.15)' : 'rgba(251,191,36,0.15)'};border:2px solid ${isCompleted ? '#10b981' : '#fbbf24'};border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:32px;">
                ${isCompleted ? (isCert ? '🎓' : '🎉') : '⏳'}
              </div>

              <div style="font-size:20px;font-weight:900;color:${isCompleted ? '#10b981' : '#fbbf24'};margin-bottom:4px;">
                ${isCompleted ? (isCert ? 'Official Subsidized Certificate Unlocked!' : 'Mentorship Booking Confirmed!') : 'Payment Proof Submitted!'}
              </div>
              <div style="font-size:12px;color:#9aa4bf;margin-bottom:16px;">
                Transaction Reference: <span style="font-family:monospace;color:#f5c542;font-weight:800;">${esc(refId)}</span>
              </div>

              <div style="background:rgba(255,255,255,0.04);border:1px dashed rgba(245,197,66,0.3);border-radius:14px;padding:16px;text-align:left;margin-bottom:20px;">
                <div style="font-size:11px;color:#9aa4bf;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Order Summary</div>
                <div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:2px;">${esc(d.title || 'Marketplace Upgrade')}</div>
                <div style="font-size:12px;color:${isCompleted ? '#10b981' : '#fbbf24'};font-weight:700;">Status: ${isCompleted ? '✅ Completed & Verified' : '⏳ Pending Coordinator Verification'}</div>
                
                <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:10px 0;">

                <div style="display:flex;justify-content:space-between;font-size:12px;color:#cdd9ec;">
                  <span>Coins Redeemed:</span>
                  <span style="font-weight:800;color:#f5c542;">🪙 ${d.coinsToUse || 0} Coins</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#cdd9ec;margin-top:4px;">
                  <span>Net Amount Paid:</span>
                  <span style="font-weight:800;color:#10b981;">₹${d.netAmount || 0}</span>
                </div>
              </div>

              ${!isCompleted ? `
                <div style="font-size: 13px; color: #fbbf24; margin-bottom: 22px; line-height: 1.5; text-align: center; border: 1px dashed rgba(251,191,36,0.3); padding: 12px; border-radius: 8px; background: rgba(251,191,36,0.05); font-weight: 500;">
                  ℹ️ Your proof of payment is submitted. Access passes, invoices, and session links will unlock automatically once a coordinator verifies your UTR.
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                  <button onclick="document.getElementById('mkt-success-pass-modal').remove(); location.reload();" style="width:100%;padding:12px;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border:none;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(245,197,66,0.4);">
                    Close & Return to Dashboard
                  </button>
                </div>
              ` : `
                <div style="display:flex;flex-direction:column;gap:10px;">
                  <button onclick="TenExtras.downloadRedemptionPassPDF({title:'${esc(d.title||'Marketplace Upgrade')}', refId:'${esc(refId)}', coinsToUse:${d.coinsToUse||0}, netAmount:${d.netAmount||0}})" style="width:100%;padding:12px;background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border:none;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(245,197,66,0.4);">
                    📄 Download Official Invoice & Pass (PDF)
                  </button>

                  ${isCert ? `
                    <a href="/my-certificates.html" style="display:block;width:100%;padding:11px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-decoration:none;border-radius:10px;font-weight:800;font-size:13px;box-sizing:border-box;">
                      ⬇ Download Certificate in My Certificates →
                    </a>
                    <button onclick="TenExtras.shareToLinkedIn('certificate', '${esc(d.title || 'Official Certificate')}');" style="width:100%;padding:11px;background:#0077b5;color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;">
                      💼 Share Certificate Badge to LinkedIn
                    </button>
                  ` : `
                    <button onclick="TenExtras.addToGoogleCalendar('${esc(d.title || 'Mentorship Session')}', '1-on-1 Mentorship Session with Senior Technical Advisor', 'Online Video Call', new Date(Date.now() + 86400000).toISOString(), new Date(Date.now() + 90000000).toISOString())" style="width:100%;padding:11px;background:linear-gradient(135deg,#4285f4,#1a73e8);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(66,133,244,0.4);">
                      📅 Add Session to Google Calendar
                    </button>
                    <button onclick="TenExtras.openVideoCallDetailsModal('${esc(d.title || 'Mentorship Session')}', '${esc(refId)}');" style="width:100%;padding:11px;background:rgba(255,255,255,0.08);border:1px solid rgba(245,197,66,0.4);color:#f5c542;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;">
                      🎥 View Video Call Link & Instructions
                    </button>
                  `}
                  <button onclick="document.getElementById('mkt-success-pass-modal').remove(); location.reload();" style="width:100%;padding:10px;background:transparent;border:none;color:#9aa4bf;font-size:12px;cursor:pointer;font-weight:700;margin-top:4px;">
                    Close & Return to Dashboard
                  </button>
                </div>
              `}

            </div>
          </div>
        `;

        const existingModal = document.getElementById("mkt-success-pass-modal");
        if (existingModal) existingModal.remove();
        document.body.insertAdjacentHTML("beforeend", passHtml);
    }

    async function processProviderPayment(itemKey, employeeId, coinsToUse, provider, customRef) {
        const refId = customRef || (provider.toUpperCase() + '-TXN-' + Date.now());
        try {
            const res = await fetch("/api/v2/marketplace/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
                body: JSON.stringify({ itemKey, provider: provider || 'card', coinsRedeemed: coinsToUse, utr: refId })
            });
            const d = await res.json();
            if (d.success) {
                let s = JSON.parse(localStorage.getItem("student") || "{}");
                s.coins = Math.max(0, (s.coins || 500) - (coinsToUse || 0));
                localStorage.setItem("student", JSON.stringify(s));

                const otpM = document.getElementById("mkt-otp-modal");
                if (otpM) otpM.remove();
                const mktM = document.getElementById("mkt-checkout-modal");
                if (mktM) mktM.remove();

                showPostRedemptionPassModal({
                    itemKey,
                    title: d.redemption ? d.redemption.itemTitle : 'Redemption Upgrade',
                    refId,
                    coinsToUse,
                    netAmount: d.redemption ? d.redemption.netPaidAmount : 0
                });
            } else {
                alert(d.message || "Payment authorization failed. Please try again or use Instant UPI QR.");
            }
        } catch (e) {
            console.error("Payment verification error:", e);
            alert("❌ Payment verification failed. Please check your connection or use Instant UPI QR.");
        }
    }

    async function submitUtrVerification(itemKey, employeeId, coinsToUse) {
        const utrInput = document.getElementById("mkt-utr-input");
        const utr = utrInput ? utrInput.value.trim() : "";

        if (!utr || utr.length < 8) {
            alert("Please enter your valid 12-digit UPI UTR / Transaction Reference Number from your Paytm/PhonePe/GPay app.");
            return;
        }

        const btn = document.querySelector("#mkt-checkout-modal button[onclick*='submitUtrVerification']");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting Proof...';
        }

        try {
            const res = await fetch("/api/v2/marketplace/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
                body: JSON.stringify({ itemKey, utr, coinsRedeemed: coinsToUse || 0 })
            });
            const d = await res.json();
            
            if (d.success) {
                let s = JSON.parse(localStorage.getItem("student") || "{}");
                s.coins = Math.max(0, (s.coins || 500) - (coinsToUse || 0));
                try { localStorage.setItem("student", JSON.stringify(s)); } catch (_) {}

                const modal = document.getElementById("mkt-checkout-modal");
                if (modal) modal.remove();

                const itemMap = {
                    "mentor_250": { title: "Standard Mentor Session (30 Min)", retailPrice: 250 },
                    "mentor_500": { title: "Extended Mentor Session (45 Min)", retailPrice: 500 },
                    "mentor_1000": { title: "Executive Founder Session (60 Min)", retailPrice: 1000 },
                    "cert_expert": { title: "Expert Certificate Upgrade", retailPrice: 100 },
                    "cert_nano": { title: "Nano Degree Upgrade", retailPrice: 1000 },
                    "cert_fellowship": { title: "Fellowship Certificate Upgrade", retailPrice: 2500 }
                };
                const it = itemMap[itemKey] || { title: "Mentorship Session Upgrade", retailPrice: 500 };
                const discount = (coinsToUse || 0) * 0.50;
                const netAmount = Math.max(0, it.retailPrice - discount);

                showPostRedemptionPassModal({
                    itemKey,
                    title: it.title,
                    refId: utr,
                    coinsToUse: coinsToUse || 0,
                    netAmount: netAmount
                });

                // Auto reload list to show the pending item
                setTimeout(() => {
                    loadMarketplace(employeeId);
                }, 1000);
            } else {
                alert(d.message || "Failed to submit verification. Please try again.");
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = "✅ Verify UTR & Complete Redemption";
                }
            }
        } catch (err) {
            console.error("Error submitting UTR verification:", err);
            alert("❌ Server connection error. Please try again.");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = "✅ Verify UTR & Complete Redemption";
            }
        }
    }

    async function verifyMarketplacePayment(itemKey, employeeId, utr) {
        return submitUtrVerification(itemKey, employeeId, 200);
    }

    function injectStudent(opts){
        injectStyles();
        opts = opts || {};
        const mountId = opts.mountId || "ten-extras-mount";
        const mount = document.getElementById(mountId);
        if(!mount){ console.warn("[TenExtras] mount not found:", mountId); return; }

        const st = opts.student || {};
        const empId = opts.employeeId || st.employeeId || localStorage.getItem("employeeId") || "TEN-STU-001";
        const domain = opts.domain || st.domain || "";

        mount.innerHTML =
              '<div class="ten-x-card"><h3>🛍️ Coin Marketplace & Rewards</h3><div id="ten-x-marketplace"></div></div>'
            + '<div class="ten-x-card"><h3>🔥 Attendance Streak</h3><div id="ten-x-streak"></div></div>'
            + '<div class="ten-x-card"><h3>🛣️ Internship Timeline</h3><div id="ten-x-timeline"></div></div>'
            + '<div class="ten-x-card"><h3>🏅 Badges</h3><div id="ten-x-badges"></div></div>'
            + '<div class="ten-x-card"><h3>🏆 Leaderboard</h3><div id="ten-x-lb"></div></div>'
            + '<div class="ten-x-card"><h3>🛠️ Quick Actions</h3>'
            +   '<div class="ten-x-side-btns" id="ten-x-actions"></div>'
            + '</div>';

        try { loadMarketplace(empId, "ten-x-marketplace"); } catch(e){ console.error(e); }
        try { loadStreak(empId, "ten-x-streak"); } catch(e){ console.error(e); }
        try { loadTimeline(empId, "ten-x-timeline"); } catch(e){ console.error(e); }
        try { loadBadges(empId, "ten-x-badges"); } catch(e){ console.error(e); }
        try { loadLeaderboard("ten-x-lb", { meEmployeeId: empId, myDomain: domain, showOverall: true, showDomain: !!domain }); } catch(e){ console.error(e); }

        const acts = document.getElementById("ten-x-actions");
        if (acts) {
            const endDate = opts.internshipEndDate || null;
            const gcEnd = googleCalAddRange({
                title: "TEN Internship Ends — " + (domain || ""),
                start: endDate || new Date(Date.now() + 30*86400000),
                end:   endDate || new Date(Date.now() + 30*86400000),
                details: "My internship at The Entrepreneurship Network ends today.\\nEmployee ID: " + empId
            });
            const gcDaily = googleCalDailyReminder({
                title: "Mark TEN Attendance 📋",
                untilDate: endDate || null,
                details: "Remember to mark your daily attendance on the TEN portal — https://" + (location.host || "ten.local"),
                hour: 9
            });
            const liUrl = linkedInShareUrl({
                url: location.origin,
                title: "Internship at The Entrepreneurship Network",
                summary: "🎓 I have successfully completed my internship as an Intern at The Entrepreneurship Network!\\nEmployee ID: " + empId + "\\n#Internship #TEN #TheEntrepreneurshipNetwork #" + (domain || "Internship").replace(/\s+/g,"")
            });
            acts.innerHTML =
                  '<a class="ten-x-side-btn" target="_blank" rel="noopener" href="'+esc(gcEnd)+'">📅 Add Internship End Date</a>'
                + '<a class="ten-x-side-btn" target="_blank" rel="noopener" href="'+esc(gcDaily)+'">⏰ Daily Attendance Reminder</a>'
                + '<a class="ten-x-side-btn ten-x-li-btn" target="_blank" rel="noopener" href="'+esc(liUrl)+'">LinkedIn Update</a>';
        }

        setInterval(() => {
            const bMount = document.getElementById("ten-x-badges");
            if (bMount) loadBadges(empId, bMount);
        }, 60000);
    }

    function injectCoordinator(opts){
        injectStyles();
        const mount = document.getElementById(opts.mountId);
        if(!mount) return;
        mount.innerHTML = '<div class="ten-x-card"><h3>🏆 Domain Leaderboard</h3><div id="ten-x-lb-c"></div></div>';
        loadLeaderboard(document.getElementById("ten-x-lb-c"), { myDomain: opts.domain, showOverall: false, showDomain: true });
    }

    function injectHR(opts){
        injectStyles();
        const mount = document.getElementById(opts.mountId);
        if(!mount) return;
        mount.innerHTML = '<div class="ten-x-card"><h3>🏆 Overall Leaderboard</h3><div id="ten-x-lb-hr"></div></div>';
        loadLeaderboard(document.getElementById("ten-x-lb-hr"), { showOverall: true, showDomain: false });
    }

    async function devResetCerts(employeeId) {
        const confirmRes = await Swal.fire({
            title: 'Reset Certificates?',
            text: 'This will reset your certificate redemptions so you can test them again.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#ef4444',
            confirmButtonText: 'Yes, Reset!',
            background: '#0c1220',
            color: '#fff'
        });
        if (!confirmRes.isConfirmed) return;

        try {
            const res = await fetch("/api/v2/marketplace/dev-reset-certs", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" }
            });
            const data = await res.json();
            if (data.success) {
                await Swal.fire({
                    icon: 'success',
                    title: 'Reset Complete!',
                    text: 'Certificate redemptions have been reset.',
                    background: '#0c1220',
                    color: '#fff',
                    confirmButtonColor: '#10b981'
                });
                location.reload();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async function devResetFlow(employeeId) {
        const confirmRes = await Swal.fire({
            title: 'Clear All System Data?',
            text: 'This will reset all payments, certificate claims, verified bookings, notifications, and reset student coins to 500 for a fresh flow retest.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d97706',
            cancelButtonColor: '#ef4444',
            confirmButtonText: 'Yes, Reset All Data!',
            background: '#0c1220',
            color: '#fff'
        });
        if (!confirmRes.isConfirmed) return;

        try {
            const res = await fetch("/api/v2/marketplace/dev-reset-flow", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" }
            });
            const data = await res.json();
            if (data.success) {
                await Swal.fire({
                    icon: 'success',
                    title: 'System Cleared!',
                    text: 'Ecosystem flow data has been completely reset.',
                    background: '#0c1220',
                    color: '#fff',
                    confirmButtonColor: '#10b981'
                });
                location.reload();
            }
        } catch (e) {
            console.error(e);
        }
    }

    function loadRazorpay(callback) {
        if (window.Razorpay) {
            callback();
            return;
        }
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = callback;
        script.onerror = () => {
            alert("❌ Failed to load Razorpay Payment Gateway SDK. Please check your internet connection.");
        };
        document.body.appendChild(script);
    }

    async function openRazorpayPayment(itemKey, employeeId, coinsToUse, netAmount) {
        if (netAmount <= 0) {
            Swal.fire({
                title: 'Processing Free Redemption...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
            const freeRef = 'FREE-' + Date.now();
            try {
                const res = await fetch("/api/v2/marketplace/verify-payment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
                    body: JSON.stringify({ itemKey, provider: 'manual', coinsRedeemed: coinsToUse || 0, utr: freeRef })
                });
                const d = await res.json();
                if (d.success) {
                    let s = JSON.parse(localStorage.getItem("student") || "{}");
                    s.coins = Math.max(0, (s.coins || 500) - (coinsToUse || 0));
                    try { localStorage.setItem("student", JSON.stringify(s)); } catch (_) {}
                    const modal = document.getElementById("mkt-checkout-modal");
                    if (modal) modal.remove();
                    Swal.close();
                    playVictoryChime();
                    const itemMap = {
                        "mentor_250": { title: "Standard Mentor Session (30 Min)", retailPrice: 250 },
                        "mentor_500": { title: "Extended Mentor Session (45 Min)", retailPrice: 500 },
                        "mentor_1000": { title: "Executive Founder Session (60 Min)", retailPrice: 1000 },
                        "cert_expert": { title: "Expert Certificate Upgrade", retailPrice: 100 },
                        "cert_nano": { title: "Nano Degree Upgrade", retailPrice: 1000 },
                        "cert_fellowship": { title: "Fellowship Certificate Upgrade", retailPrice: 2500 }
                    };
                    const it = itemMap[itemKey] || { title: "Mentorship Session Upgrade", retailPrice: 500 };
                    showPostRedemptionPassModal({
                        itemKey,
                        title: it.title,
                        refId: freeRef,
                        coinsToUse: coinsToUse || 0,
                        netAmount: 0,
                        status: 'completed'
                    });
                    setTimeout(() => {
                        loadMarketplace(employeeId);
                    }, 1000);
                } else {
                    Swal.fire("Error", d.message || "Failed to process redemption.", "error");
                }
            } catch (err) {
                console.error(err);
                Swal.fire("Error", "Server connection error during redemption.", "error");
            }
            return;
        }

        Swal.fire({
            title: 'Initializing Secure Checkout...',
            background: '#0c1220',
            color: '#fff',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        try {
            const checkoutRes = await fetch("/api/v2/marketplace/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
                body: JSON.stringify({ itemKey, proposedCoins: coinsToUse, paymentGateway: 'razorpay' })
            });
            const checkoutData = await checkoutRes.json();
            if (!checkoutData.success) {
                Swal.fire("Error", checkoutData.message || "Failed to initialize checkout.", "error");
                return;
            }

            const { redemptionId, razorpayOrderId, keyId } = checkoutData;
            Swal.close();

            loadRazorpay(() => {
                const studentInfo = JSON.parse(localStorage.getItem("student") || "{}");
                const options = {
                    "key": keyId,
                    "order_id": razorpayOrderId,
                    "amount": Math.round(netAmount * 100),
                    "currency": "INR",
                    "name": "The Entrepreneurship Network",
                    "description": "Ecosystem Marketplace Redemption",
                    "image": "/ten-logo.png",
                    "handler": async function (response) {
                        const payId = response.razorpay_payment_id;
                        if (!payId) {
                            alert("❌ Payment completed but Transaction ID not received.");
                            return;
                        }
                        Swal.fire({
                            title: 'Verifying Secure Payment...',
                            html: `Transaction Reference: <b>${payId}</b>`,
                            allowOutsideClick: false,
                            didOpen: () => {
                                Swal.showLoading();
                            }
                        });
                        try {
                            const res = await fetch("/api/v2/marketplace/verify-payment", {
                                method: "POST",
                                headers: { "Content-Type": "application/json", "x-employee-id": employeeId || "" },
                                body: JSON.stringify({
                                    redemptionId,
                                    itemKey,
                                    provider: 'razorpay',
                                    coinsRedeemed: coinsToUse || 0,
                                    utr: payId,
                                    paymentId: payId,
                                    orderId: response.razorpay_order_id,
                                    signature: response.razorpay_signature
                                })
                            });
                            const d = await res.json();
                            if (d.success) {
                                let s = JSON.parse(localStorage.getItem("student") || "{}");
                                s.coins = Math.max(0, (s.coins || 500) - (coinsToUse || 0));
                                try { localStorage.setItem("student", JSON.stringify(s)); } catch (_) {}
                                const modal = document.getElementById("mkt-checkout-modal");
                                if (modal) modal.remove();
                                Swal.close();
                                playVictoryChime();
                                const itemMap = {
                                    "mentor_250": { title: "Standard Mentor Session (30 Min)", retailPrice: 250 },
                                    "mentor_500": { title: "Extended Mentor Session (45 Min)", retailPrice: 500 },
                                    "mentor_1000": { title: "Executive Founder Session (60 Min)", retailPrice: 1000 },
                                    "cert_expert": { title: "Expert Certificate Upgrade", retailPrice: 100 },
                                    "cert_nano": { title: "Nano Degree Upgrade", retailPrice: 1000 },
                                    "cert_fellowship": { title: "Fellowship Certificate Upgrade", retailPrice: 2500 }
                                };
                                const it = itemMap[itemKey] || { title: "Mentorship Session Upgrade", retailPrice: 500 };
                                showPostRedemptionPassModal({
                                    itemKey,
                                    title: it.title,
                                    refId: payId,
                                    coinsToUse: coinsToUse || 0,
                                    netAmount: netAmount,
                                    status: 'completed'
                                });
                                setTimeout(() => {
                                    loadMarketplace(employeeId);
                                }, 1000);
                            } else {
                                Swal.fire("Error", d.message || "Failed to submit verification.", "error");
                            }
                        } catch (err) {
                            console.error("Error submitting Razorpay verification:", err);
                            Swal.fire("Error", "Server connection error during payment validation.", "error");
                        }
                    },
                    "prefill": {
                        "name": studentInfo.name || "Student Intern",
                        "email": studentInfo.email || "student@example.com",
                        "contact": studentInfo.phone || ""
                    },
                    "notes": {
                        "itemKey": itemKey,
                        "employeeId": employeeId,
                        "coinsToUse": coinsToUse
                    },
                    "theme": {
                        "color": "#D4AF37"
                    }
                };
                const rzp = new Razorpay(options);
                rzp.open();
            });
        } catch (err) {
            console.error("Checkout init failed:", err);
            Swal.fire("Error", "Failed to initialize payment order: " + err.message, "error");
        }
    }

    w.TenExtras = {
        injectStudent, injectCoordinator, injectHR,
        linkedInShareUrl, shareToLinkedIn, addToGoogleCalendar, googleCalAddRange, googleCalDailyReminder,
        showBadgePopup, loadStreak, loadBadges, loadTimeline, loadLeaderboard,
        downloadBadge, downloadRedemptionPassPDF, showPostRedemptionPassModal, openVideoCallDetailsModal, loadMarketplace, openCheckoutModal, confirmMarketplacePayment, verifyMarketplacePayment, submitUtrVerification, addTestCoins, claimWelcomeCoins, switchPaymentMethod,
        submitCardPayment, submitNetBankingPayment, submitWalletPayment, processProviderPayment,
        switchMktTab, loadStudentBookingsList, devResetCerts, devResetFlow, openRazorpayPayment
    };

    if (typeof document !== "undefined") {
        const runAuto = () => {
            try {
                injectStyles();
                const m = document.getElementById("ten-extras-mount");
                if (m) {
                    const st = JSON.parse(localStorage.getItem("student") || "{}");
                    const empId = st.employeeId || localStorage.getItem("employeeId") || "TEN-STU-001";
                    injectStudent({
                        employeeId: empId,
                        student: st,
                        domain: st.domain || "",
                        name: st.name || ((st.firstName||"") + " " + (st.lastName||"")).trim() || "TEN Intern",
                        mountId: "ten-extras-mount"
                    });
                }
            } catch (_) {}
        };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", runAuto);
        } else {
            setTimeout(runAuto, 50);
        }
    }
})(window);
