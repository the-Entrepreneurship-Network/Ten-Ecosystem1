(function () {
  'use strict';

  // ── User context from localStorage ──────────────────────────────
  const userId   = localStorage.getItem('employeeId')          || '';
  const userType = localStorage.getItem('userType')            || 'student';
  const userName = localStorage.getItem('userName')            || '';
  const domain   = localStorage.getItem('domain')              || '';
  const coordId  = localStorage.getItem('coordinatorUsername') || '';

  // ── Inject all CSS ───────────────────────────────────────────────
  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
/* ── Keyframes ────────────────────────────────────────────────── */
@keyframes botPop {
  0%   { transform: scale(0) translateY(20px); opacity: 0; }
  70%  { transform: scale(1.12) translateY(-4px); opacity: 1; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes panelSlideUp {
  from { transform: translateY(30px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes msgIn {
  from { transform: translateY(10px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes dotBounce {
  0%,80%,100% { transform: translateY(0);    opacity: .4; }
  40%         { transform: translateY(-6px); opacity: 1;  }
}
@keyframes orbPulse {
  0%,100% { box-shadow: 0 0 18px 4px rgba(139,92,246,.5), 0 0 40px 10px rgba(99,102,241,.2); }
  50%     { box-shadow: 0 0 30px 8px rgba(139,92,246,.8), 0 0 70px 20px rgba(99,102,241,.35); }
}
@keyframes orbListen {
  0%,100% { box-shadow: 0 0 24px 6px rgba(168,85,247,.8),  0 0 60px 16px rgba(139,92,246,.4); transform: scale(1); }
  50%     { box-shadow: 0 0 40px 14px rgba(192,38,211,.9), 0 0 90px 30px rgba(168,85,247,.5); transform: scale(1.08); }
}
@keyframes orbThink {
  0%   { filter: hue-rotate(0deg)   brightness(1); }
  50%  { filter: hue-rotate(120deg) brightness(1.2); }
  100% { filter: hue-rotate(360deg) brightness(1); }
}
@keyframes typewave {
  0%,60%,100% { transform: scaleY(1);   }
  30%         { transform: scaleY(2.2); }
}
@keyframes voiceOverlayIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Launcher ──────────────────────────────────────────────────── */
.ten-bot-launcher {
  position: fixed;
  bottom: 32px;
  right: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  z-index: 99990;
}
.ten-bot-launcher-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 24px 13px 18px;
  border: none;
  border-radius: 50px;
  cursor: pointer;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  letter-spacing: 0.02em;
  min-width: 155px;
  justify-content: flex-start;
  animation: botPop .5s cubic-bezier(.34,1.56,.64,1) both;
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
}
.ten-bot-launcher-btn:hover {
  transform: translateX(-6px) scale(1.05);
  filter: brightness(1.12);
}
.ten-bot-launcher-btn:active { transform: translateX(-2px) scale(.98); }
.ten-bot-launcher-btn span:first-child { font-size: 20px; line-height: 1; flex-shrink: 0; }
.ten-lbtn-ten-task  {
  background: linear-gradient(120deg, #6366f1 0%, #8b5cf6 100%);
  box-shadow: 0 6px 22px rgba(99,102,241,.55), 0 2px 8px rgba(139,92,246,.35);
  animation-delay: .1s;
}
.ten-lbtn-ten-query {
  background: linear-gradient(120deg, #0ea5e9 0%, #6366f1 100%);
  box-shadow: 0 6px 22px rgba(14,165,233,.5), 0 2px 8px rgba(99,102,241,.3);
  animation-delay: .2s;
}
.ten-lbtn-ten-voice {
  background: linear-gradient(120deg, #a855f7 0%, #ec4899 100%);
  box-shadow: 0 6px 22px rgba(168,85,247,.55), 0 2px 8px rgba(236,72,153,.35);
  animation-delay: .3s;
}

/* ── Panel ─────────────────────────────────────────────────────── */
.ten-bot-panel {
  position: fixed;
  bottom: 180px;
  right: 20px;
  width: 360px;
  max-height: 520px;
  display: flex;
  flex-direction: column;
  background: rgba(10,10,25,.97);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 20px;
  z-index: 99991;
  box-shadow: 0 24px 60px rgba(0,0,0,.7);
  animation: panelSlideUp .35s cubic-bezier(.34,1.2,.64,1) both;
  overflow: hidden;
}
.ten-bot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.ten-task-header  { background: linear-gradient(135deg,rgba(79,70,229,.25),rgba(124,58,237,.15)); }
.ten-query-header { background: linear-gradient(135deg,rgba(8,145,178,.25),rgba(37,99,235,.15)); }
.ten-bot-header-info { display: flex; align-items: center; gap: 10px; }
.ten-bot-avatar { font-size: 22px; }
.ten-bot-name { font-size: 14px; font-weight: 800; color: #f1f5f9; }
.ten-bot-sub  { font-size: 11px; color: #64748b; margin-top: 1px; }
.ten-bot-close {
  background: rgba(255,255,255,.06);
  border: none;
  color: #94a3b8;
  width: 28px; height: 28px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: background .15s, color .15s;
}
.ten-bot-close:hover { background: rgba(239,68,68,.2); color: #ef4444; }

/* ── Thread ────────────────────────────────────────────────────── */
.ten-bot-thread {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.1) transparent;
}
.ten-bot-thread::-webkit-scrollbar { width: 4px; }
.ten-bot-thread::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

/* ── Messages ──────────────────────────────────────────────────── */
.ten-bot-msg {
  display: flex;
  animation: msgIn .25s ease both;
}
.ten-bot-msg--user { justify-content: flex-end; }
.ten-bot-msg--bot  { justify-content: flex-start; }
.ten-bot-msg span {
  max-width: 80%;
  padding: 9px 13px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}
.ten-bot-msg--user.ten-task span  { background: linear-gradient(135deg,#4f46e5,#7c3aed); color: #fff; border-bottom-right-radius: 4px; }
.ten-bot-msg--user.ten-query span { background: linear-gradient(135deg,#0891b2,#2563eb); color: #fff; border-bottom-right-radius: 4px; }
.ten-bot-msg--bot span { background: rgba(255,255,255,.07); color: #e2e8f0; border-bottom-left-radius: 4px; }

/* ── Typing indicator ──────────────────────────────────────────── */
.ten-bot-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  background: rgba(255,255,255,.07);
  border-radius: 14px;
  border-bottom-left-radius: 4px;
}
.ten-bot-typing span {
  width: 6px; height: 6px;
  background: #94a3b8;
  border-radius: 50%;
  display: block;
  animation: dotBounce 1.2s infinite ease;
  padding: 0;
}
.ten-bot-typing span:nth-child(2) { animation-delay: .2s; }
.ten-bot-typing span:nth-child(3) { animation-delay: .4s; }
.ten-bot-msg--bot .ten-bot-typing { background: transparent; padding: 0; }

/* ── Footer / Input ────────────────────────────────────────────── */
.ten-bot-footer {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255,255,255,.07);
  background: rgba(0,0,0,.2);
}
.ten-bot-input {
  flex: 1;
  padding: 9px 13px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px;
  color: #e2e8f0;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color .2s;
}
.ten-bot-input:focus { border-color: rgba(139,92,246,.5); }
.ten-bot-input::placeholder { color: #475569; }
.ten-bot-send {
  padding: 9px 14px;
  border: none;
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  transition: opacity .15s, transform .1s;
}
.ten-bot-send:disabled { opacity: .45; cursor: not-allowed; }
.ten-bot-send:not(:disabled):hover { opacity: .85; transform: scale(1.05); }
.ten-task-send  { background: linear-gradient(135deg,#4f46e5,#7c3aed); }
.ten-query-send { background: linear-gradient(135deg,#0891b2,#2563eb); }

/* ── Escalation box ────────────────────────────────────────────── */
.ten-bot-escalate {
  margin: 0 12px 10px;
  padding: 12px;
  background: rgba(239,68,68,.06);
  border: 1px solid rgba(239,68,68,.2);
  border-radius: 12px;
}
.ten-bot-esc-label { font-size: 12px; font-weight: 700; color: #f87171; margin: 0 0 8px; }
.ten-bot-esc-ta {
  width: 100%;
  padding: 8px 10px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 12px;
  font-family: inherit;
  resize: none;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 8px;
}
.ten-bot-esc-btn {
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  transition: opacity .15s;
}
.ten-bot-esc-btn:disabled { opacity: .5; cursor: not-allowed; }

/* ── Voice overlay ─────────────────────────────────────────────── */
#ten-voice-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5,5,15,.96);
  backdrop-filter: blur(16px);
  z-index: 99995;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  animation: voiceOverlayIn .3s ease both;
}
.ten-voice-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 32px 20px;
  width: 100%;
  max-width: 400px;
  position: relative;
}
.ten-voice-close {
  position: absolute;
  top: 0;
  right: 16px;
  background: rgba(255,255,255,.08);
  border: none;
  color: #94a3b8;
  width: 36px; height: 36px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  transition: background .15s;
}
.ten-voice-close:hover { background: rgba(239,68,68,.2); color: #ef4444; }

/* ── Orb ───────────────────────────────────────────────────────── */
.ten-orb-wrap {
  position: relative;
  width: 140px; height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ten-orb {
  width: 110px; height: 110px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, #a78bfa, #6d28d9 60%, #4c1d95);
  cursor: pointer;
  animation: orbPulse 2.4s ease-in-out infinite;
  transition: transform .2s;
  position: relative;
  z-index: 1;
}
.ten-orb:hover { transform: scale(1.06); }
.ten-orb--listen { animation: orbListen 1s ease-in-out infinite; }
.ten-orb--think  { animation: orbThink  1.6s linear infinite; }

/* ── Wave bars ─────────────────────────────────────────────────── */
.ten-wave-bars {
  position: absolute;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 28px;
  opacity: 0;
  transition: opacity .3s;
}
.ten-wave-bars span {
  width: 4px;
  height: 100%;
  background: linear-gradient(to top, #8b5cf6, #c084fc);
  border-radius: 2px;
  transform-origin: bottom;
  animation: typewave 1s ease-in-out infinite;
}
.ten-wave-bars span:nth-child(2) { animation-delay: .15s; }
.ten-wave-bars span:nth-child(3) { animation-delay: .30s; }
.ten-wave-bars span:nth-child(4) { animation-delay: .45s; }
.ten-wave-bars span:nth-child(5) { animation-delay: .60s; }

/* ── Voice text ────────────────────────────────────────────────── */
.ten-voice-status {
  font-size: 14px;
  color: #94a3b8;
  text-align: center;
  font-weight: 600;
}
.ten-voice-text {
  font-size: 15px;
  color: #e2e8f0;
  text-align: center;
  line-height: 1.6;
  min-height: 48px;
  max-width: 340px;
  padding: 0 16px;
}
.ten-voice-fallback {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 0 4px;
}
.ten-voice-send { background: linear-gradient(135deg,#7c3aed,#c026d3); }

/* ── Mobile responsive ─────────────────────────────────────────── */
@media (max-width: 480px) {
  .ten-bot-panel {
    width: 100vw;
    right: 0;
    bottom: 0;
    border-radius: 20px 20px 0 0;
    max-height: 70vh;
  }
  .ten-bot-launcher { right: 10px; bottom: 14px; gap: 8px; }
  .ten-bot-launcher-btn { font-size: 13px; padding: 11px 18px 11px 14px; min-width: 130px; }
  .ten-bot-launcher-btn span:first-child { font-size: 17px; }
}
    `;
    document.head.appendChild(s);
  }

  // ── HTML escape to prevent XSS ───────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── API POST helper ──────────────────────────────────────────────
  async function apiPost(url, payload) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ error: 'Invalid response' }));
    if (!res.ok) { throw new Error(data.error || `HTTP ${res.status}`); }
    return data;
  }

  // ── Add message bubble to thread ─────────────────────────────────
  function addMsg(thread, text, isUser, colorCls) {
    const wrap   = document.createElement('div');
    wrap.className = `ten-bot-msg ${isUser ? 'ten-bot-msg--user' : 'ten-bot-msg--bot'} ${colorCls}`;
    const bubble = document.createElement('span');
    bubble.textContent = text;
    wrap.appendChild(bubble);
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
    return wrap;
  }

  // ── Add typing indicator ─────────────────────────────────────────
  function addTyping(thread) {
    const wrap = document.createElement('div');
    wrap.className = 'ten-bot-msg ten-bot-msg--bot';
    const inner = document.createElement('span');
    inner.className = 'ten-bot-typing';
    inner.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(inner);
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
    return wrap;
  }

  // ── Build a generic chat panel ───────────────────────────────────
  function buildPanel(cfg) {
    const panel = document.createElement('div');
    panel.className = 'ten-bot-panel';
    panel.style.display = 'none';

    const header = document.createElement('div');
    header.className = `ten-bot-header ${cfg.colorCls}-header`;
    header.innerHTML = `
      <div class="ten-bot-header-info">
        <span class="ten-bot-avatar">${esc(cfg.emoji)}</span>
        <div>
          <div class="ten-bot-name">${esc(cfg.name)}</div>
          <div class="ten-bot-sub">${esc(cfg.subtitle)}</div>
        </div>
      </div>`;
    const closeBtn = document.createElement('button');
    closeBtn.className   = 'ten-bot-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    header.appendChild(closeBtn);

    const thread = document.createElement('div');
    thread.className = 'ten-bot-thread';

    const footer = document.createElement('div');
    footer.className = 'ten-bot-footer';

    const input = document.createElement('input');
    input.type         = 'text';
    input.className    = 'ten-bot-input';
    input.placeholder  = 'Type your question…';
    input.autocomplete = 'off';

    const sendBtn = document.createElement('button');
    sendBtn.className   = `ten-bot-send ${cfg.colorCls}-send`;
    sendBtn.textContent = '➤';
    sendBtn.setAttribute('aria-label', 'Send');

    footer.appendChild(input);
    footer.appendChild(sendBtn);
    panel.appendChild(header);
    panel.appendChild(thread);
    panel.appendChild(footer);

    closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });

    const doSend = async () => {
      const text = input.value.trim();
      if (!text) { return; }
      input.value    = '';
      input.disabled = true;
      sendBtn.disabled = true;
      addMsg(thread, text, true, cfg.colorCls);
      const typing = addTyping(thread);
      try {
        await cfg.onSend(text, thread, typing, panel, footer);
      } finally {
        typing.remove();
        input.disabled   = false;
        sendBtn.disabled = false;
        input.focus();
      }
    };

    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { doSend(); } });

    panel.openPanel = () => {
      panel.style.display = 'flex';
      if (thread.childElementCount === 0) {
        addMsg(thread, cfg.greeting, false, cfg.colorCls);
      }
      setTimeout(() => input.focus(), 60);
    };

    return panel;
  }

  // ── Escalation UI (query bot only) ──────────────────────────────
  function showEscalation(panel, footer, queryId, originalQ, thread) {
    const old = panel.querySelector('.ten-bot-escalate');
    if (old) { old.remove(); }

    const box    = document.createElement('div');
    box.className = 'ten-bot-escalate';

    const label = document.createElement('p');
    label.className   = 'ten-bot-esc-label';
    label.textContent = '📨 Submit to HR';

    const ta    = document.createElement('textarea');
    ta.className  = 'ten-bot-esc-ta';
    ta.placeholder = 'Describe your issue in detail…';
    ta.rows        = 3;
    ta.value       = originalQ || '';

    const btn   = document.createElement('button');
    btn.className   = 'ten-bot-esc-btn ten-query-send';
    btn.textContent = 'Submit to HR';

    box.appendChild(label);
    box.appendChild(ta);
    box.appendChild(btn);
    footer.insertAdjacentElement('beforebegin', box);

    btn.addEventListener('click', async () => {
      const details = ta.value.trim();
      if (!details) { return; }
      btn.disabled    = true;
      btn.textContent = 'Submitting…';
      try {
        await apiPost('/api/v2/bots/escalate', {
          queryId, details, userId, userType, userName, domain, coordinatorId: coordId,
        });
        box.innerHTML = '<p style="color:#34d399;font-size:13px;padding:4px 0">✅ Submitted to HR — you\'ll be notified when they respond.</p>';
        addMsg(thread, '✅ Your query has been sent to HR. They\'ll get back to you shortly.', false, 'ten-query');
      } catch (e) {
        btn.disabled    = false;
        btn.textContent = 'Submit to HR';
        addMsg(thread, `⚠️ Submit failed: ${e.message}`, false, 'ten-query');
      }
    });
  }

  // ── Task Bot panel ───────────────────────────────────────────────
  function buildTaskPanel() {
    return buildPanel({
      emoji:    '🛠️',
      name:     'Task Assistant',
      subtitle: 'Tasks, deadlines & portal features',
      colorCls: 'ten-task',
      greeting: '👋 Hi! Ask me about your tasks, deadlines, attendance, or portal features.',
      onSend: async (question, thread, typing) => {
        try {
          const data = await apiPost('/api/v2/bots/task-bot', {
            question, userId, userType, userName, domain,
          });
          addMsg(thread, data.answer || 'Sorry, no response received.', false, 'ten-task');
        } catch (e) {
          addMsg(thread, `⚠️ ${e.message}`, false, 'ten-task');
        }
      },
    });
  }

  // ── Query Bot panel ──────────────────────────────────────────────
  function buildQueryPanel() {
    return buildPanel({
      emoji:    '❓',
      name:     'Support Bot',
      subtitle: 'Ask anything about your internship',
      colorCls: 'ten-query',
      greeting: '💬 Ask me anything about your internship!',
      onSend: async (question, thread, typing, panel, footer) => {
        try {
          const data = await apiPost('/api/v2/bots/query-bot', {
            question, userId, userType, userName, domain, coordinatorId: coordId,
          });
          if (data.needsEscalation) {
            addMsg(thread, "I'm not sure about this — let me connect you with HR.", false, 'ten-query');
            showEscalation(panel, footer, data.queryId, question, thread);
          } else {
            addMsg(thread, data.answer || 'No response.', false, 'ten-query');
          }
        } catch (e) {
          addMsg(thread, `⚠️ ${e.message}`, false, 'ten-query');
        }
      },
    });
  }

  // ── Voice Bot overlay ────────────────────────────────────────────
  function buildVoiceOverlay() {
    const overlay = document.createElement('div');
    overlay.id    = 'ten-voice-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Voice Assistant');

    const inner = document.createElement('div');
    inner.className = 'ten-voice-inner';

    const closeBtn = document.createElement('button');
    closeBtn.className   = 'ten-voice-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close voice bot');

    const orbWrap = document.createElement('div');
    orbWrap.className = 'ten-orb-wrap';

    const orb = document.createElement('div');
    orb.id        = 'ten-orb';
    orb.className = 'ten-orb';
    orb.setAttribute('role', 'button');
    orb.setAttribute('tabindex', '0');
    orb.setAttribute('aria-label', 'Tap to speak');

    const waveBars = document.createElement('div');
    waveBars.className = 'ten-wave-bars';
    waveBars.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';

    orbWrap.appendChild(orb);
    orbWrap.appendChild(waveBars);

    const statusEl = document.createElement('div');
    statusEl.className   = 'ten-voice-status';
    statusEl.textContent = 'Tap the orb to speak';

    const textEl = document.createElement('div');
    textEl.className = 'ten-voice-text';

    const fallback = document.createElement('div');
    fallback.className = 'ten-voice-fallback';

    const fallInput = document.createElement('input');
    fallInput.type        = 'text';
    fallInput.className   = 'ten-bot-input';
    fallInput.placeholder = 'Or type here if mic unavailable…';
    fallInput.autocomplete = 'off';

    const fallSend = document.createElement('button');
    fallSend.className   = 'ten-bot-send ten-voice-send';
    fallSend.textContent = '➤';
    fallSend.setAttribute('aria-label', 'Send');

    fallback.appendChild(fallInput);
    fallback.appendChild(fallSend);
    inner.appendChild(closeBtn);
    inner.appendChild(orbWrap);
    inner.appendChild(statusEl);
    inner.appendChild(textEl);
    inner.appendChild(fallback);
    overlay.appendChild(inner);

    let recognition  = null;
    let isListening  = false;

    function setOrbState(state) {
      orb.className = 'ten-orb';
      if (state === 'listening') { orb.classList.add('ten-orb--listen'); }
      if (state === 'thinking')  { orb.classList.add('ten-orb--think'); }
      waveBars.style.opacity = state === 'listening' ? '1' : '0';
    }

    function stopListening() {
      if (recognition) {
        try { recognition.stop(); } catch (_e) { /* ignore stop errors */ }
      }
      isListening = false;
      setOrbState('idle');
    }

    function typewriterReveal(text) {
      textEl.textContent = '';
      let i = 0;
      const tick = () => {
        if (i < text.length) {
          textEl.textContent += text[i];
          i++;
          setTimeout(tick, 22);
        }
      };
      tick();
    }

    async function handleVoiceQuestion(question) {
      setOrbState('thinking');
      statusEl.textContent = 'Thinking…';
      textEl.textContent   = '';
      try {
        const data   = await apiPost('/api/v2/bots/voice-bot', { question, userId, userType, userName, domain });
        const answer = data.answer || 'Sorry, I could not get a response.';
        setOrbState('idle');
        statusEl.textContent = 'Tap orb to speak again';
        typewriterReveal(answer);
        if (window.speechSynthesis) {
          const utt  = new SpeechSynthesisUtterance(answer);
          utt.rate   = 1.05;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utt);
        }
      } catch (e) {
        setOrbState('idle');
        statusEl.textContent = 'Error — tap orb to retry';
        textEl.textContent   = `⚠️ ${e.message}`;
      }
    }

    orb.addEventListener('click', () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        statusEl.textContent = 'Mic not supported — use text below';
        return;
      }
      if (isListening) { stopListening(); return; }
      recognition = new SR();
      recognition.lang            = 'en-IN';
      recognition.interimResults  = false;
      recognition.maxAlternatives = 1;
      isListening = true;
      setOrbState('listening');
      statusEl.textContent = 'Listening… speak now';
      recognition.start();
      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        stopListening();
        handleVoiceQuestion(transcript);
      };
      recognition.onerror = () => {
        stopListening();
        statusEl.textContent = 'Could not hear you — tap to try again';
      };
      recognition.onend = () => {
        if (isListening) { stopListening(); }
      };
    });

    orb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { orb.click(); } });

    closeBtn.addEventListener('click', () => {
      stopListening();
      if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
      overlay.style.display = 'none';
    });

    const doFallback = () => {
      const q = fallInput.value.trim();
      if (!q) { return; }
      fallInput.value = '';
      handleVoiceQuestion(q);
    };
    fallSend.addEventListener('click', doFallback);
    fallInput.addEventListener('keydown', e => { if (e.key === 'Enter') { doFallback(); } });

    overlay.openVoice = () => {
      overlay.style.display = 'flex';
      setOrbState('idle');
      statusEl.textContent = 'Tap the orb to speak';
      textEl.textContent   = '';
    };

    return overlay;
  }

  // ── Launcher ─────────────────────────────────────────────────────
  function buildLauncher(taskPanel, queryPanel, voiceOverlay) {
    const launcher = document.createElement('div');
    launcher.className = 'ten-bot-launcher';

    const buttons = [
      { emoji: '🛠️', label: 'Task Bot',  cls: 'ten-task',  action: () => togglePanel(taskPanel,  queryPanel) },
      { emoji: '❓', label: 'Query Bot', cls: 'ten-query', action: () => togglePanel(queryPanel, taskPanel)  },
      { emoji: '🎤', label: 'Voice Bot', cls: 'ten-voice', action: () => voiceOverlay.openVoice()           },
    ];

    buttons.forEach(({ emoji, label, cls, action }) => {
      const btn = document.createElement('button');
      btn.className = `ten-bot-launcher-btn ten-lbtn-${cls}`;
      btn.setAttribute('aria-label', label);
      const iconSpan  = document.createElement('span');
      iconSpan.textContent = emoji;
      const labelSpan = document.createElement('span');
      labelSpan.className   = 'ten-lbtn-label';
      labelSpan.textContent = label;
      btn.appendChild(iconSpan);
      btn.appendChild(labelSpan);
      btn.addEventListener('click', action);
      launcher.appendChild(btn);
    });

    return launcher;
  }

  function togglePanel(target, other) {
    const isOpen = target.style.display === 'flex';
    other.style.display  = 'none';
    if (isOpen) {
      target.style.display = 'none';
    } else {
      target.openPanel();
    }
  }

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    const taskPanel    = buildTaskPanel();
    const queryPanel   = buildQueryPanel();
    const voiceOverlay = buildVoiceOverlay();
    const launcher     = buildLauncher(taskPanel, queryPanel, voiceOverlay);
    document.body.appendChild(launcher);
    document.body.appendChild(taskPanel);
    document.body.appendChild(queryPanel);
    document.body.appendChild(voiceOverlay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
