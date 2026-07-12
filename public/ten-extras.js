/* TEN extras — Phase 1 client module
 * Provides:
 *   - TenExtras.injectStudent({ employeeId, domain, name, mountId, internshipEndDate })
 *       Renders streak, badges, timeline, leaderboard, LinkedIn, GCal in a
 *       single mount node on the student dashboard.
 *   - TenExtras.injectCoordinator({ domain, mountId })
 *       Renders the domain leaderboard for the coordinator.
 *   - TenExtras.injectHR({ mountId })
 *       Renders the overall + per-domain leaderboards for HR.
 *   - TenExtras.linkedInShareUrl(opts) — builds a LinkedIn share URL.
 *   - TenExtras.googleCalAddRange / addDailyReminder — builds GCal URLs.
 *
 * No external deps. Uses fetch for /badges, /leaderboard, /streak, /timeline.
 */
(function (w) {
    "use strict";
    if (w.TenExtras) return;

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
.ten-x-bar-wrap{position:relative;width:100%;height:6px;background:rgba(99,140,210,0.15);border-radius:99px;overflow:hidden;}
.ten-x-bar{height:100%;background:linear-gradient(90deg,#f5c542,#c9a227);border-radius:99px;}
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
`;
    function injectStyles() {
        if (document.getElementById("ten-x-styles")) return;
        const s = document.createElement("style");
        s.id = "ten-x-styles"; s.textContent = css;
        document.head.appendChild(s);
    }
    function esc(x){ return String(x==null?"":x).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
    function fmtDate(d){ if(!d) return ""; const dt = new Date(d); if(isNaN(dt)) return ""; return dt.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); }
    function fmtIcs(d){ const dt = new Date(d); const pad = n => String(n).padStart(2,"0"); return dt.getUTCFullYear()+pad(dt.getUTCMonth()+1)+pad(dt.getUTCDate()); }

    // ---------- LinkedIn share ----------
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

    // ---------- Google Calendar ----------
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

    // ---------- Streak widget ----------
    async function loadStreak(employeeId, mount){
        try{
            const r = await fetch("/students/" + encodeURIComponent(employeeId) + "/streak");
            const d = await r.json();
            if(!d.success){ mount.innerHTML = '<div class="ten-x-empty">No streak data yet</div>'; return; }
            const cur = d.currentStreak || 0;
            const best = d.bestStreak || 0;
            const last = d.lastAttendanceDate ? new Date(d.lastAttendanceDate) : null;
            const today = new Date(); today.setHours(0,0,0,0);
            const broken = !last || (today - new Date(last.toDateString())) > 24*3600*1000;
            const msg = cur === 0
                ? "Mark today's attendance to start a streak."
                : (broken ? "Streak lost! Start a new one today." : (cur+" day streak! Keep it up!"));
            mount.innerHTML =
                '<div class="ten-x-streak">'
                +   '<div class="ten-x-flame">🔥</div>'
                +   '<div>'
                +     '<div class="ten-x-streak-num">'+cur+'</div>'
                +     '<div class="ten-x-streak-msg">'+esc(msg)+'</div>'
                +     '<div class="ten-x-streak-best">Best streak: '+best+' days</div>'
                +   '</div>'
                + '</div>';
        }catch(e){ mount.innerHTML = '<div class="ten-x-empty">Could not load streak</div>'; }
    }

    // ---------- Badge shelf ----------
    let lastEarnedSet = null;
    async function loadBadges(employeeId, mount){
        try{
            const r = await fetch("/badges/student/" + encodeURIComponent(employeeId));
            const d = await r.json();
            if(!d.success){ mount.innerHTML = '<div class="ten-x-empty">No badges yet</div>'; return; }
            const earnedNow = new Set(d.badges.filter(b => b.earned).map(b => b.id));
            // Pop a toast if we discover a newly earned badge between polls
            if(lastEarnedSet){
                d.badges.forEach(b => {
                    if(b.earned && !lastEarnedSet.has(b.id)) showBadgePopup(b);
                });
            }
            lastEarnedSet = earnedNow;
            mount.innerHTML =
                '<div style="font-size:12px;color:#9aa4bf;margin-bottom:10px;">'+d.earnedCount+' / '+d.totalCount+' badges earned</div>'
                + '<div class="ten-x-badges">'
                + d.badges.map(b =>
                    '<div class="ten-x-badge ' + (b.earned ? 'earned' : 'locked') + '" title="' + esc(b.description) + (b.awardedAt ? ' (earned ' + fmtDate(b.awardedAt) + ')' : '') + '">'
                    +   '<div class="icon">'+esc(b.icon)+'</div>'
                    +   '<div class="name">'+esc(b.name)+'</div>'
                    +   '<div class="req">' + (b.earned ? ('✓ '+fmtDate(b.awardedAt)) : esc(b.requirement)) + '</div>'
                    + '</div>'
                ).join("")
                + '</div>';
        }catch(e){ mount.innerHTML = '<div class="ten-x-empty">Could not load badges</div>'; }
    }
    function showBadgePopup(badge){
        const el = document.createElement("div");
        el.className = "ten-x-popup";
        el.innerHTML = '<div class="t">🎉 New Badge Earned: '+esc(badge.name)+' '+esc(badge.icon)+'</div><div class="m">'+esc(badge.description)+'</div>';
        document.body.appendChild(el);
        setTimeout(() => { el.style.transition = "opacity .4s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, 5500);
    }

    // ---------- Progress timeline ----------
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
        try{
            const r = await fetch("/students/" + encodeURIComponent(employeeId) + "/timeline");
            const d = await r.json();
            if(!d.success){ mount.innerHTML = '<div class="ten-x-empty">No timeline data</div>'; return; }
            const m = d.milestones || {};
            // We synthesise an 'always-done' registration milestone from registrationDate.
            const rows = TIMELINE_DEFS.map(def => {
                const date = def.k === "_registered" ? d.registrationDate : m[def.k];
                return { def, date };
            });
            const doneCount = rows.filter(r => !!r.date).length;
            const pct = Math.round((doneCount / rows.length) * 100);
            // First row that is NOT done gets the "active" pulse.
            let activeIndex = rows.findIndex(r => !r.date);
            mount.innerHTML =
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
        }catch(e){ mount.innerHTML = '<div class="ten-x-empty">Could not load timeline</div>'; }
    }

    // ---------- Leaderboard ----------
    async function fetchLb(scope, domain){
        const url = scope === "domain"
            ? ("/leaderboard/domain/" + encodeURIComponent(domain || ""))
            : "/leaderboard/overall";
        const r = await fetch(url);
        const d = await r.json();
        return (d && d.leaderboard) || [];
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
        const meId = opts && opts.meEmployeeId;
        const myDomain = opts && opts.myDomain;
        const showOverallTab = opts.showOverall !== false;
        const showDomainTab  = opts.showDomain  !== false && !!myDomain;

        const tabs = [];
        if(showDomainTab) tabs.push({ id:"domain", label:"My Domain" });
        if(showOverallTab) tabs.push({ id:"overall", label:"Overall" });
        if(!tabs.length){ mount.innerHTML = '<div class="ten-x-empty">No leaderboard available</div>'; return; }

        const tabsHtml = '<div class="ten-x-tabs">'
            + tabs.map((t, i) => '<button class="ten-x-tab '+ (i===0 ? 'active' : '') +'" data-tab="'+t.id+'">'+t.label+'</button>').join("")
            + '<button class="ten-x-tab" data-act="refresh" title="Refresh" style="flex:0 0 auto;padding:8px 12px;">↻</button>'
            + '</div>';
        mount.innerHTML = tabsHtml + '<div class="ten-x-lb-body"><div class="ten-x-empty">Loading…</div></div>';

        async function showTab(tabId){
            const body = mount.querySelector(".ten-x-lb-body");
            body.innerHTML = '<div class="ten-x-empty">Loading…</div>';
            try{
                const rows = await fetchLb(tabId, myDomain);
                body.innerHTML = renderLbTable(rows, { meEmployeeId: meId, showDomain: tabId === "overall" });
            }catch(e){ body.innerHTML = '<div class="ten-x-empty">Could not load leaderboard</div>'; }
        }
        mount.querySelectorAll(".ten-x-tab[data-tab]").forEach(b => b.addEventListener("click", () => {
            mount.querySelectorAll(".ten-x-tab").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
            showTab(b.dataset.tab);
        }));
        const refresh = mount.querySelector('[data-act="refresh"]');
        if(refresh) refresh.addEventListener("click", () => {
            const active = mount.querySelector(".ten-x-tab.active");
            showTab(active ? active.dataset.tab : tabs[0].id);
        });
        showTab(tabs[0].id);
    }

    // ---------- High-level: inject the whole student panel ----------
    function injectStudent(opts){
        injectStyles();
        const mount = document.getElementById(opts.mountId);
        if(!mount){ console.warn("[TenExtras] mount not found:", opts.mountId); return; }

        // Compose layout
        mount.innerHTML =
              '<div class="ten-x-card"><h3>🔥 Attendance Streak</h3><div id="ten-x-streak"></div></div>'
            + '<div class="ten-x-card"><h3>🛣️ Internship Timeline</h3><div id="ten-x-timeline"></div></div>'
            + '<div class="ten-x-card"><h3>🏅 Badges</h3><div id="ten-x-badges"></div></div>'
            + '<div class="ten-x-card"><h3>🏆 Leaderboard</h3><div id="ten-x-lb"></div></div>'
            + '<div class="ten-x-card"><h3>🛠️ Quick Actions</h3>'
            +   '<div class="ten-x-side-btns" id="ten-x-actions"></div>'
            + '</div>';

        loadStreak(opts.employeeId, document.getElementById("ten-x-streak"));
        loadTimeline(opts.employeeId, document.getElementById("ten-x-timeline"));
        loadBadges(opts.employeeId, document.getElementById("ten-x-badges"));
        loadLeaderboard(document.getElementById("ten-x-lb"), {
            meEmployeeId: opts.employeeId, myDomain: opts.domain, showOverall: true, showDomain: !!opts.domain
        });

        // Quick actions: Google Calendar + LinkedIn share
        const acts = document.getElementById("ten-x-actions");
        const endDate = opts.internshipEndDate || null;
        const gcEnd = googleCalAddRange({
            title: "TEN Internship Ends — " + (opts.domain || ""),
            start: endDate || new Date(Date.now() + 30*86400000),
            end:   endDate || new Date(Date.now() + 30*86400000),
            details: "My internship at The Entrepreneurship Network ends today.\\nEmployee ID: " + (opts.employeeId || "")
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
            summary: "🎓 I have successfully completed my internship as an Intern at The Entrepreneurship Network!\\nEmployee ID: " + (opts.employeeId || "") + "\\n#Internship #TEN #TheEntrepreneurshipNetwork #" + (opts.domain || "Internship").replace(/\s+/g,"")
        });
        acts.innerHTML =
              '<a class="ten-x-side-btn" target="_blank" rel="noopener" href="'+esc(gcEnd)+'">📅 Add Internship End Date</a>'
            + '<a class="ten-x-side-btn" target="_blank" rel="noopener" href="'+esc(gcDaily)+'">⏰ Daily Attendance Reminder</a>'
            + '<a class="ten-x-side-btn ten-x-li-btn" target="_blank" rel="noopener" href="'+esc(liUrl)+'">🔗 Share on LinkedIn</a>';

        // Light polling so newly-earned badges popup without a refresh
        setInterval(() => loadBadges(opts.employeeId, document.getElementById("ten-x-badges")), 60000);
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

    w.TenExtras = {
        injectStudent, injectCoordinator, injectHR,
        linkedInShareUrl, googleCalAddRange, googleCalDailyReminder,
        showBadgePopup, loadStreak, loadBadges, loadTimeline, loadLeaderboard
    };
})(window);
