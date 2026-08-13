/* TEN Chat widget — included by student / coordinator / HR portals.
 *
 * Usage (call once after sessionStorage identity is known):
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script src="/chat-widget.js"></script>
 *   <script>
 *     TenChat.init({
 *       role: "student" | "coordinator" | "hr",
 *       name: "Display Name",
 *       employeeId: "TEN/WEB/1001",        // students only
 *       username:   "web_admin",            // coordinator/HR only
 *       domain:     "Web Development"       // student/coordinator
 *     });
 *   </script>
 *
 * Visible chats per role (matches the spec):
 *   student     -> Domain Chat + General Chat
 *   coordinator -> Domain Chat + General Chat + Staff Chat
 *   hr          -> General Chat + Staff Chat + HR Internal
 */
(function (window) {
    "use strict";
    if (window.TenChat) return;

    var cfg = null;
    var socket = null;
    var chats = [];      // [{id,room,label}]
    var openWin = null;  // currently visible window {room,el,msgsEl,inputEl,unread}
    var unreadByRoom = {};
    var dockEl = null;

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
        });
    }
    function fmtTime(t) {
        try {
            var d = new Date(t);
            return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        } catch (e) { return ""; }
    }
    function ownId() { return cfg.role === "student" ? cfg.employeeId : cfg.username; }

    /** Small JSON helper that surfaces the server's message rather than a status code. */
    function postJSON(url, body) {
        return fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
                if (!r.ok || d.success === false) throw new Error(d.message || ("Request failed (" + r.status + ")"));
                return d;
            });
        });
    }

    /**
     * Open a private one-to-one conversation.
     *
     * The room name is derived on the server from both ids, sorted, so both
     * people land in the same room whichever of them starts it.
     */
    function openDirectMessage(userId, userName) {
        postJSON("/api/chat/dm/open", { userId: userId })
            .then(function (d) {
                toggleChat(d.room, "🔒 " + (userName || userId));
            })
            .catch(function (e) { alert(e.message); });
    }
    // Portals expose this so a "Message privately" button can live outside the
    // widget — e.g. beside a student row in the HR portal.
    window.TenChatDM = openDirectMessage;

    function chatsForRole(role) {
        var out = [];
        if (role === "student") {
            if (cfg.domain) out.push({ id: "domain", room: "domain_" + cfg.domain, label: "Domain Chat" });
            out.push({ id: "general", room: "general", label: "General Chat" });
        } else if (role === "coordinator") {
            if (cfg.domain) out.push({ id: "domain", room: "domain_" + cfg.domain, label: "Domain Chat" });
            out.push({ id: "general", room: "general", label: "General Chat" });
            out.push({ id: "staff", room: "hr_coordinators", label: "Staff Chat" });
        } else if (role === "hr") {
            out.push({ id: "hr_center", room: "general", label: "Intern Chat Center" });
        }
        return out;
    }

    function injectStyles() {
        if (document.getElementById("tc-styles")) return;
        var css = [
            "#tc-dock{position:fixed;right:18px;bottom:18px;display:flex;flex-direction:column;gap:8px;z-index:9998;align-items:flex-end;}",
            ".tc-tab{flex:1;background:transparent;border:none;color:#9aa4bf;font-weight:700;font-size:11px;padding:8px;cursor:pointer;outline:none;text-align:center;transition:all 0.15s;border-bottom:2px solid transparent;}",
            ".tc-tab.active{color:#f5c542;border-bottom-color:#f5c542;background:rgba(245,197,66,0.06);}",
            ".tc-tab:hover{color:#e2eaf7;}",
            ".tc-btn{background:linear-gradient(135deg,#0d1a2e,#112240);color:#e2eaf7;border:1px solid rgba(245,197,66,0.25);padding:10px 16px;border-radius:24px;cursor:pointer;font:600 13px 'Plus Jakarta Sans','Outfit',sans-serif;display:inline-flex;align-items:center;gap:8px;box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .15s,border-color .15s;}",
            ".tc-btn:hover{transform:translateY(-1px);border-color:#f5c542;}",
            ".tc-badge{background:#f43f5e;color:#fff;font-size:11px;font-weight:700;border-radius:10px;padding:2px 7px;display:none;}",
            ".tc-badge.has{display:inline-block;}",
            ".tc-win{position:fixed;right:18px;bottom:18px;width:380px;height:500px;background:#0c1220;border:1px solid rgba(245,197,66,0.18);border-radius:16px;display:none;flex-direction:column;z-index:9999;box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden;font-family:'Plus Jakarta Sans','Outfit',sans-serif;color:#e2eaf7;}",
            ".tc-win.open{display:flex;}",
            ".tc-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(135deg,#0d1a2e,#112240);border-bottom:1px solid rgba(245,197,66,0.15);}",
            ".tc-h .t{font-weight:700;font-size:14px;letter-spacing:.3px;color:#f5c542;}",
            ".tc-h .x{background:transparent;border:none;color:#9aa4bf;font-size:20px;cursor:pointer;padding:0 6px;line-height:1;}",
            ".tc-h .x:hover{color:#f43f5e;}",
            ".tc-msgs{flex:1;min-height:0;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:8px;background:#080d1a;}",
            ".tc-row{display:flex;flex-direction:column;max-width:78%;}",
            ".tc-row.mine{align-self:flex-end;align-items:flex-end;}",
            ".tc-row.theirs{align-self:flex-start;align-items:flex-start;}",
            ".tc-meta{font-size:11px;color:#8aa4c8;display:flex;gap:6px;margin-bottom:3px;align-items:center;}",
            ".tc-meta b{color:#cdd9ec;font-weight:700;}",
            ".tc-tag{font-size:9px;font-weight:800;letter-spacing:.5px;border:1px solid;padding:1px 6px;border-radius:99px;text-transform:uppercase;}",
            ".tc-bubble{padding:8px 12px;border-radius:14px;line-height:1.4;font-size:13px;white-space:pre-wrap;word-wrap:break-word;background:rgba(99,140,210,0.13);border:1px solid rgba(99,140,210,0.2);}",
            ".tc-row.mine .tc-bubble{background:rgba(59,130,246,0.18);border-color:rgba(59,130,246,0.32);}",
            ".tc-bubble.coord{background:rgba(16,185,129,0.16);border-color:rgba(16,185,129,0.28);}",
            ".tc-bubble.hr{background:rgba(245,197,66,0.13);border-color:rgba(245,197,66,0.28);}",
            ".tc-time{color:#5a7299;font-size:10px;}",
            ".tc-del{margin-left:4px;border:none;background:transparent;color:#5a7299;cursor:pointer;font-size:12px;}",
            ".tc-del:hover{color:#f43f5e;}",
            ".tc-dm,.tc-block,.tc-report{margin-left:2px;border:none;background:transparent;color:#5a7299;cursor:pointer;font-size:12px;padding:0 2px;}",
            ".tc-dm:hover{color:#3b82f6;}",
            ".tc-block:hover{color:#f59e0b;}",
            ".tc-report:hover{color:#f43f5e;}",
            ".tc-launcher{background:#101a2e;border:1px solid rgba(99,140,210,0.3);color:#cdd9ec;border-radius:20px;padding:8px 14px;font:600 12px \'Plus Jakarta Sans\',sans-serif;cursor:pointer;}",
            ".tc-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(245,197,66,0.12);background:#0c1220;}",
            ".tc-form input{flex:1;background:#101a2e;border:1px solid rgba(99,140,210,0.25);color:#e2eaf7;border-radius:10px;padding:9px 12px;outline:none;font:500 13px 'Plus Jakarta Sans','Outfit',sans-serif;}",
            ".tc-form input:focus{border-color:#f5c542;}",
            ".tc-form button{background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;border:none;font-weight:700;padding:0 16px;border-radius:10px;cursor:pointer;font-family:inherit;}",
            ".tc-empty{color:#5a7299;font-size:12px;text-align:center;padding:20px 8px;}",
            // Date divider — a centred pill between days, WhatsApp style.
            ".tc-datesep{display:flex;align-items:center;justify-content:center;margin:14px 0 8px;}",
            ".tc-datesep span{background:rgba(99,140,210,0.14);color:#8aa4c8;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:3px 12px;border-radius:99px;text-transform:uppercase;}",
            // Image messages sit in the same bubble as text, so the sender
            // name and role badge above them are identical either way.
            ".tc-img{display:block;max-width:220px;max-height:220px;width:auto;height:auto;border-radius:8px;margin-bottom:4px;cursor:pointer;object-fit:cover;}",
            ".tc-text{white-space:pre-wrap;}",
            ".tc-attach{background:transparent !important;color:#8aa4c8 !important;padding:0 8px !important;font-size:17px;line-height:1;border-radius:8px;}",
            ".tc-attach:hover{color:#f5c542 !important;}",
            ".tc-attach:disabled{opacity:0.4;cursor:wait;}",
            ".tc-preview{position:relative;padding:8px 12px 0;background:#0c1220;}",
            ".tc-preview img{max-height:70px;border-radius:8px;border:1px solid rgba(245,197,66,0.25);}",
            ".tc-preview-x{position:absolute;top:4px;left:66px;background:#0c1220;color:#f43f5e;border:1px solid rgba(244,63,94,0.4);border-radius:99px;width:20px;height:20px;line-height:1;cursor:pointer;font-weight:700;}",
            "@media (max-width:600px){.tc-win{right:0;left:0;bottom:0;width:100%;height:90vh;border-radius:14px 14px 0 0;}#tc-dock{right:10px;bottom:10px;}.tc-btn{padding:8px 12px;font-size:12px;}}"
        ].join("\n");
        var s = document.createElement("style");
        s.id = "tc-styles"; s.textContent = css;
        document.head.appendChild(s);
    }

    function render() {
        injectStyles();
        if (dockEl) dockEl.remove();
        dockEl = document.createElement("div");
        dockEl.id = "tc-dock";
        chats.forEach(function (c) {
            var btn = document.createElement("button");
            btn.className = "tc-btn";
            btn.dataset.room = c.room;
            btn.dataset.label = c.label;
            btn.innerHTML = "💬 " + escapeHtml(c.label) +
                ' <span class="tc-badge" data-badge="' + escapeHtml(c.room) + '">0</span>';
            btn.addEventListener("click", function () { toggleChat(c.room, c.label); });
            dockEl.appendChild(btn);
        });
        document.body.appendChild(dockEl);
    }

    function setBadge(room, n) {
        unreadByRoom[room] = n;
        var b = dockEl && dockEl.querySelector('[data-badge="' + cssEsc(room) + '"]');
        if (b) {
            b.textContent = n;
            b.classList.toggle("has", n > 0);
        }
    }
    function bumpBadge(room) {
        if (!unreadByRoom[room]) unreadByRoom[room] = 0;
        setBadge(room, unreadByRoom[room] + 1);
    }
    function cssEsc(s) {
        return String(s).replace(/(["\\])/g, "\\$1");
    }

    var winsByRoom = {};
    function toggleChat(room, label) {
        if (openWin && openWin.room === room) {
            openWin.el.classList.remove("open");
            openWin = null;
            return;
        }
        // Close whatever is open and open this one
        if (openWin) openWin.el.classList.remove("open");
        var w = winsByRoom[room];
        if (!w) { w = createWindow(room, label); winsByRoom[room] = w; loadHistory(room, w); }
        w.el.classList.add("open");
        openWin = w;
        setBadge(room, 0);
        setTimeout(function () { w.inputEl && w.inputEl.focus(); }, 50);
    }

    function createWindow(room, label) {
        var win = document.createElement("div");
        win.className = "tc-win";
        
        var headerHtml = '<div class="tc-h"><span class="t">' + escapeHtml(label) + '</span>' +
            '<button class="x" aria-label="Close">×</button></div>';
            
        if (cfg.role === "hr" && room === "general") {
            win.dataset.currentRoom = "general";
            headerHtml += '<div class="tc-tabs" style="display:flex;background:#0d1a2e;border-bottom:1px solid rgba(245,197,66,0.15);padding:4px;">' +
                '<button type="button" class="tc-tab active" data-room="general">General</button>' +
                '<button type="button" class="tc-tab" data-room="doubts">Doubts</button>' +
                '<button type="button" class="tc-tab" data-room="feedback_support">Feedback</button>' +
                '</div>';
        }

        win.innerHTML = headerHtml +
            '<div class="tc-msgs"></div>' +
            '<div class="tc-preview" hidden><img alt="Selected image"><button type="button" class="tc-preview-x" title="Remove">×</button></div>' +
            '<form class="tc-form">' +
              '<input type="file" class="tc-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>' +
              '<button type="button" class="tc-attach" title="Send an image" aria-label="Send an image">📎</button>' +
              '<input type="text" placeholder="Type a message…" maxlength="2000" autocomplete="off"/>' +
              '<button type="submit">Send</button>' +
            '</form>';
            
        document.body.appendChild(win);
        var msgsEl = win.querySelector(".tc-msgs");
        var form = win.querySelector(".tc-form");
        var inputEl = form.querySelector('input[type="text"]');
        var fileEl = form.querySelector(".tc-file");
        var attachBtn = form.querySelector(".tc-attach");
        var previewEl = win.querySelector(".tc-preview");
        var previewImg = previewEl.querySelector("img");
        var pendingImage = null;   // { imageUrl, imageName, imageMime }

        function clearPendingImage() {
            pendingImage = null;
            fileEl.value = "";
            previewEl.hidden = true;
            previewImg.removeAttribute("src");
        }

        win.querySelector(".tc-preview-x").addEventListener("click", clearPendingImage);
        attachBtn.addEventListener("click", function () { fileEl.click(); });

        fileEl.addEventListener("change", function () {
            var file = fileEl.files && fileEl.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                alert("That image is larger than 5MB.");
                fileEl.value = "";
                return;
            }
            // Show it immediately, upload in the background.
            previewImg.src = URL.createObjectURL(file);
            previewEl.hidden = false;
            attachBtn.disabled = true;

            var fd = new FormData();
            fd.append("image", file);
            fetch("/chat/upload-image", { method: "POST", body: fd, credentials: "same-origin" })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d || !d.success) throw new Error((d && d.message) || "Upload failed");
                    pendingImage = { imageUrl: d.imageUrl, imageName: d.imageName, imageMime: d.imageMime };
                })
                .catch(function (err) {
                    alert(err.message || "Could not upload that image.");
                    clearPendingImage();
                })
                .finally(function () { attachBtn.disabled = false; });
        });

        win.querySelector(".x").addEventListener("click", function () {
            win.classList.remove("open"); openWin = null;
        });

        if (cfg.role === "hr" && room === "general") {
            var tabs = win.querySelectorAll(".tc-tab");
            tabs.forEach(function (tab) {
                tab.addEventListener("click", function () {
                    tabs.forEach(t => t.classList.remove("active"));
                    tab.classList.add("active");
                    tab.innerHTML = tab.textContent.replace(" •", "").trim();
                    
                    var targetRoom = tab.dataset.room;
                    win.dataset.currentRoom = targetRoom;
                    loadHistory(targetRoom, { msgsEl: msgsEl });
                });
            });
        }

        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var t = inputEl.value.trim();
            // An image on its own is a valid message.
            if (!t && !pendingImage) return;

            var targetRoom = (cfg.role === "hr" && room === "general") ? (win.dataset.currentRoom || "general") : room;
            var payload = { room: targetRoom, text: t };
            if (pendingImage) {
                payload.imageUrl  = pendingImage.imageUrl;
                payload.imageName = pendingImage.imageName;
                payload.imageMime = pendingImage.imageMime;
            }
            socket.emit("send_message", payload);
            inputEl.value = "";
            clearPendingImage();
        });
        return { room: room, label: label, el: win, msgsEl: msgsEl, inputEl: inputEl };
    }

    // ── WhatsApp-style date grouping ────────────────────────────────────────
    // Computed from the VIEWER's clock, so "Today" stays correct as days pass
    // without any stored flag — a message sent today reads "Today" now and
    // "Yesterday" tomorrow, with no server involvement.
    function dayKeyOf(ts) {
        var d = new Date(ts);
        if (isNaN(d.getTime())) return "";
        return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    }

    function dayLabelOf(ts) {
        var d = new Date(ts);
        if (isNaN(d.getTime())) return "";
        var today = new Date();
        var yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (dayKeyOf(d) === dayKeyOf(today)) return "Today";
        if (dayKeyOf(d) === dayKeyOf(yesterday)) return "Yesterday";

        // Within the last week, the weekday is friendlier than a date.
        var daysAgo = Math.floor((today.setHours(0,0,0,0) - new Date(d).setHours(0,0,0,0)) / 86400000);
        if (daysAgo > 0 && daysAgo < 7) {
            return d.toLocaleDateString(undefined, { weekday: "long" });
        }
        return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    }

    /** Insert a divider if this message starts a new calendar day. */
    function maybeAppendDateDivider(w, ts) {
        var key = dayKeyOf(ts);
        if (!key || w._lastDayKey === key) return;
        w._lastDayKey = key;

        var sep = document.createElement("div");
        sep.className = "tc-datesep";
        sep.innerHTML = '<span>' + escapeHtml(dayLabelOf(ts)) + '</span>';
        w.msgsEl.appendChild(sep);
    }

    function appendMessage(w, m) {
        maybeAppendDateDivider(w, m.timestamp);
        var mine = (m.senderId === ownId() && m.senderRole === cfg.role);
        var roleTag =
            m.senderRole === "student" ? "INTERN" :
            m.senderRole === "coordinator" ? "COORDINATOR" : "HR";
        var roleColor =
            m.senderRole === "student" ? "#3b82f6" :
            m.senderRole === "coordinator" ? "#10b981" : "#f5c542";
        var bubbleClass =
            m.senderRole === "coordinator" ? "tc-bubble coord" :
            m.senderRole === "hr" ? "tc-bubble hr" : "tc-bubble";

        // Permission to delete: coordinator/HR can delete; show button only when current user has permission.
        var canDelete = false;
        if (cfg.role === "hr") canDelete = true;
        else if (cfg.role === "coordinator") {
            // Coordinator can delete in their domain chat, general, hr_coordinators (any room they can access).
            canDelete = true;
        }
        var delBtn = canDelete
            ? '<button class="tc-del" title="Delete" data-id="' + escapeHtml(m._id) + '">🗑</button>'
            : "";

        // Anyone can protect themselves from anyone else — including a student
        // from a member of staff. These appear on other people's messages only:
        // there is nothing to block or report about your own.
        var safetyBtns = mine ? "" :
            '<button class="tc-dm" title="Message privately">✉</button>' +
            '<button class="tc-block" title="Block this person">🚫</button>' +
            '<button class="tc-report" title="Report this message">⚑</button>';

        var row = document.createElement("div");
        row.className = "tc-row " + (mine ? "mine" : "theirs");
        row.dataset.id = m._id;
        row.innerHTML =
            '<div class="tc-meta">' +
                '<b>' + escapeHtml(m.senderName) + '</b>' +
                '<span class="tc-tag" style="color:' + roleColor + ';border-color:' + roleColor + ';">' + roleTag + '</span>' +
                '<span class="tc-time">' + escapeHtml(fmtTime(m.timestamp)) + '</span>' +
                safetyBtns +
                delBtn +
            '</div>' +
            '<div class="' + bubbleClass + '">' + bubbleBody(m) + '</div>';
        var dEl = row.querySelector(".tc-del");
        if (dEl) dEl.addEventListener("click", function () {
            if (!confirm("Delete this message for everyone?")) return;
            socket.emit("delete_message", { messageId: m._id }, function (ack) {
                if (!ack || !ack.success) alert("Delete failed: " + (ack && ack.message || "forbidden"));
            });
        });

        var dmEl = row.querySelector(".tc-dm");
        if (dmEl) dmEl.addEventListener("click", function () { openDirectMessage(m.senderId, m.senderName); });

        var blockEl = row.querySelector(".tc-block");
        if (blockEl) blockEl.addEventListener("click", function () {
            if (!confirm("Block " + m.senderName + "?\n\nYou will not see their messages and they will not see yours. You can undo this at any time.")) return;
            postJSON("/api/chat/block", { userId: m.senderId, userName: m.senderName, userRole: m.senderRole })
                .then(function (d) {
                    alert(d.message || "Blocked.");
                    // Their messages must disappear now, not on next reload.
                    Array.prototype.forEach.call(
                        w.msgsEl.querySelectorAll('.tc-row'),
                        function (r) { if (r.dataset.senderId === m.senderId) r.remove(); }
                    );
                })
                .catch(function (e) { alert(e.message); });
        });

        var reportEl = row.querySelector(".tc-report");
        if (reportEl) reportEl.addEventListener("click", function () {
            var reason = prompt("Report this message to an admin.\n\nWhat is wrong with it?");
            if (reason === null) return;
            postJSON("/api/chat/report", {
                userId: m.senderId, userName: m.senderName, userRole: m.senderRole,
                messageId: m._id, room: w.room || m.chatRoom, reason: reason
            })
                .then(function (d) { alert(d.message || "Reported."); })
                .catch(function (e) { alert(e.message); });
        });

        row.dataset.senderId = m.senderId;
        w.msgsEl.appendChild(row);
        w.msgsEl.scrollTop = w.msgsEl.scrollHeight;
    }

    /**
     * The contents of a message bubble: an image, text, or both.
     * Image messages go through the SAME row markup as text, so the sender name
     * and role badge are identical — which is what section 8 asks for.
     */
    function bubbleBody(m) {
        var html = "";
        if (m.imageUrl && /^\/uploads\/chat\//.test(m.imageUrl)) {
            var alt = escapeHtml(m.imageName || "shared image");
            html += '<a href="' + escapeHtml(m.imageUrl) + '" target="_blank" rel="noopener noreferrer">' +
                    '<img class="tc-img" src="' + escapeHtml(m.imageUrl) + '" alt="' + alt + '" loading="lazy">' +
                    '</a>';
        }
        if (m.message) {
            html += '<div class="tc-text">' + escapeHtml(m.message) + '</div>';
        }
        return html;
    }

    function loadHistory(room, w) {
        // Identity comes from the session cookie now. It used to be passed as
        // ?role=&employeeId=, so anyone who knew an employee ID could read that
        // student's domain room.
        fetch("/chat/messages/" + encodeURIComponent(room), { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                w.msgsEl.innerHTML = "";
                w._lastDayKey = null;   // dividers restart with the list
                if (!d.success || !d.messages || !d.messages.length) {
                    w.msgsEl.innerHTML = '<div class="tc-empty">No messages yet — say hi 👋</div>';
                    return;
                }
                d.messages.forEach(function (m) { appendMessage(w, m); });
            })
            .catch(function () {
                w.msgsEl.innerHTML = '<div class="tc-empty">Failed to load messages.</div>';
            });
    }

    function connectSocket() {
        if (typeof io !== "function") {
            console.warn("[TenChat] socket.io client not loaded; chat disabled");
            return;
        }
        var auth = { role: cfg.role };
        if (cfg.role === "student") auth.employeeId = cfg.employeeId;
        else auth.username = cfg.username;

        socket = io({ auth: auth });
        socket.on("connect_error", function (e) { console.warn("[TenChat] connect_error:", e.message); });

        socket.on("receive_message", function (m) {
            if (cfg.role === "hr" && (m.chatRoom === "general" || m.chatRoom === "doubts" || m.chatRoom === "feedback_support")) {
                var w = winsByRoom["general"];
                if (w) {
                    var empty = w.msgsEl.querySelector(".tc-empty");
                    if (empty) empty.remove();
                    if (m.chatRoom === w.el.dataset.currentRoom) {
                        appendMessage(w, m);
                    } else {
                        var tab = w.el.querySelector('.tc-tab[data-room="' + m.chatRoom + '"]');
                        if (tab && tab.innerHTML.indexOf("•") === -1) {
                            tab.innerHTML = tab.textContent.trim() + ' <span style="color:#f43f5e;">•</span>';
                        }
                    }
                } else {
                    bumpBadge("general");
                }
                return;
            }

            var w = winsByRoom[m.chatRoom];
            if (w) {
                // Remove "no messages" placeholder if present
                var empty = w.msgsEl.querySelector(".tc-empty");
                if (empty) empty.remove();
                appendMessage(w, m);
                if (!openWin || openWin.room !== m.chatRoom) bumpBadge(m.chatRoom);
            } else {
                bumpBadge(m.chatRoom);
            }
        });
        // A private message from someone whose conversation is not open yet.
        // Without this the first DM anyone receives is invisible until they
        // happen to look for it.
        socket.on("dm_notice", function (p) {
            if (!p || !p.room) return;
            if (winsByRoom[p.room]) { bumpBadge(p.room); return; }
            bumpBadge(p.room);
            try {
                var host = document.querySelector(".tc-launchers") || document.body;
                if (host && !host.querySelector('[data-dm-room="' + cssEsc(p.room) + '"]')) {
                    var b = document.createElement("button");
                    b.className = "tc-launcher";
                    b.dataset.dmRoom = p.room;
                    b.textContent = "🔒 " + (p.from || "Private");
                    b.addEventListener("click", function () { toggleChat(p.room, "🔒 " + (p.from || "Private")); });
                    host.appendChild(b);
                }
            } catch (e) { /* the badge alone is enough */ }
        });

        socket.on("message_deleted", function (p) {
            if (cfg.role === "hr" && (p.room === "general" || p.room === "doubts" || p.room === "feedback_support")) {
                var w = winsByRoom["general"];
                if (!w) return;
                var el = w.msgsEl.querySelector('[data-id="' + cssEsc(p.messageId) + '"]');
                if (el) el.remove();
                return;
            }

            var w = winsByRoom[p.room];
            if (!w) return;
            var el = w.msgsEl.querySelector('[data-id="' + cssEsc(p.messageId) + '"]');
            if (el) el.remove();
        });
    }

    window.TenChat = {
        init: function (config) {
            if (!config || !config.role) { console.warn("[TenChat] init: missing role"); return; }
            cfg = config;
            chats = chatsForRole(cfg.role);
            render();
            connectSocket();
        }
    };
})(window);
