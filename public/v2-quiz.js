// NEW FEATURE: Quiz System
/* global apiFetch, studentData, Swal */

// NEW FEATURE: Quiz System
(function () {
  'use strict';

  // NEW FEATURE: Quiz System
  const state = {
    active: null,
    yt: {
      apiReady: false,
      players: {},
      tickers: {}
    }
  };

  // NEW FEATURE: Quiz System
  function ensureQuizOverlay() {
    if (document.getElementById('tenQuizOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tenQuizOverlay';
    overlay.className = 'ten-quiz-overlay';
    overlay.innerHTML = `
      <div class="ten-quiz-card" id="tenQuizCard"></div>
    `;
    document.body.appendChild(overlay);

    const cameraBox = document.createElement('div');
    cameraBox.id = 'camera-preview-box';
    cameraBox.innerHTML = `
      <video id="proctor-camera" autoplay muted playsinline></video>
      <div id="camera-preview-live">🔴 LIVE</div>
    `;
    document.body.appendChild(cameraBox);
  }

  // NEW FEATURE: Quiz System
  async function startCameraProctoring() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 320 },
          height: { ideal: 240 }
        },
        audio: false
      });

      const videoElement = document.getElementById('proctor-camera');
      videoElement.srcObject = stream;
      await videoElement.play();

      const box = document.getElementById('camera-preview-box');
      box.style.display = 'block';

      return stream;
    } catch (err) {
      return null;
    }
  }

  // NEW FEATURE: Quiz System
  function stopCameraProctoring(stream) {
    try {
      const box = document.getElementById('camera-preview-box');
      box.style.display = 'none';
    } catch (_) {}

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  }

  // NEW FEATURE: Quiz System
  function startQuizTimer(durationMinutes, onExpire) {
    let seconds = durationMinutes * 60;
    const timerEl = document.getElementById('quiz-timer');

    const interval = setInterval(() => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      const pct = seconds / (durationMinutes * 60);
      if (pct > 0.5) timerEl.style.color = '#22c55e';
      else if (pct > 0.25) timerEl.style.color = '#f59e0b';
      else timerEl.style.color = '#ef4444';

      seconds--;

      if (seconds < 0) {
        clearInterval(interval);
        onExpire();
      }
    }, 1000);

    return interval;
  }

  // NEW FEATURE: Quiz System
  function openOverlay() {
    ensureQuizOverlay();
    document.getElementById('tenQuizOverlay').style.display = 'flex';
  }

  // NEW FEATURE: Quiz System
  function closeOverlay() {
    try {
      document.getElementById('tenQuizOverlay').style.display = 'none';
      document.getElementById('tenQuizCard').innerHTML = '';
    } catch (_) {}
  }

  // NEW FEATURE: Quiz System
  function renderCameraBlocked(card) {
    card.innerHTML = `
      <div class="ten-quiz-top">
        <div>
          <div class="ten-quiz-title">Camera Required</div>
          <div class="ten-quiz-sub">Camera access is required to take this quiz. Please allow camera access and try again.</div>
        </div>
        <div class="ten-quiz-timer" id="quiz-timer">--:--</div>
      </div>
      <div style="margin-top:12px;color:var(--quiz-muted);font-size:13px;line-height:1.45">
        If you previously denied permission, update your browser site settings for this domain and refresh.
      </div>
      <div class="ten-quiz-actions" style="margin-top:16px;justify-content:flex-end">
        <button class="ten-quiz-btn" id="tenQuizCloseBtn">Close</button>
        <button class="ten-quiz-btn primary" id="tenQuizRetryCameraBtn">Request Camera Again</button>
      </div>
    `;
  }

  // NEW FEATURE: Quiz System
  function renderLoading(card, title, sub) {
    card.innerHTML = `
      <div class="ten-quiz-top">
        <div>
          <div class="ten-quiz-title">${title || 'Loading Quiz...'}</div>
          <div class="ten-quiz-sub">${sub || 'Preparing your questions and timer.'}</div>
        </div>
        <div class="ten-quiz-timer" id="quiz-timer">--:--</div>
      </div>
      <div style="margin-top:18px;color:var(--quiz-muted);font-size:13px">Please wait...</div>
    `;
  }

  // NEW FEATURE: Quiz System
  function renderQuestionScreen(ctx) {
    const card = document.getElementById('tenQuizCard');
    const q = ctx.questions[ctx.index];
    const total = ctx.questions.length;
    const answered = Object.keys(ctx.answers).length;
    const pct = total ? Math.round((answered / total) * 100) : 0;
    const selected = ctx.answers[q._id] || null;

    card.innerHTML = `
      <div class="ten-quiz-top">
        <div>
          <div class="ten-quiz-title">Week ${ctx.task.weekNumber} Quiz — ${ctx.task.domain}</div>
          <div class="ten-quiz-sub">${ctx.task.taskTitle}</div>
        </div>
        <div class="ten-quiz-timer" id="quiz-timer">--:--</div>
      </div>

      <div class="ten-quiz-qmeta">
        <div class="ten-quiz-qcount">Question ${ctx.index + 1} of ${total}</div>
        <div class="ten-quiz-progress" aria-label="Progress"><div style="width:${pct}%"></div></div>
        <div class="ten-quiz-qcount">${answered}/${total}</div>
      </div>

      <div class="ten-quiz-question">${escapeHtml(q.question_text)}</div>

      <div class="ten-quiz-options">
        ${['A','B','C','D'].map(k => `
          <div class="ten-quiz-option ${selected === k ? 'selected' : ''}" data-opt="${k}">
            <div class="ten-quiz-opt-key">${k})</div>
            <div>${escapeHtml((q.options && q.options[k]) || '')}</div>
          </div>
        `).join('')}
      </div>

      <div class="ten-quiz-actions">
        <button class="ten-quiz-btn" id="tenQuizPrevBtn" ${ctx.index === 0 ? 'disabled' : ''}>← Back</button>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="ten-quiz-btn" id="tenQuizSubmitBtn">${ctx.index === total - 1 ? 'Submit' : 'Submit Now'}</button>
          <button class="ten-quiz-btn primary" id="tenQuizNextBtn">${ctx.index === total - 1 ? 'Final Answer →' : 'Next Question →'}</button>
        </div>
      </div>
    `;

    const optEls = card.querySelectorAll('.ten-quiz-option');
    optEls.forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-opt');
        ctx.answers[q._id] = key;
        renderQuestionScreen(ctx);
      });
    });

    const prevBtn = document.getElementById('tenQuizPrevBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      ctx.index = Math.max(0, ctx.index - 1);
      renderQuestionScreen(ctx);
    });

    const nextBtn = document.getElementById('tenQuizNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', async () => {
      if (!ctx.answers[q._id]) {
        Swal.fire({ icon:'warning', title:'Select an answer', text:'Choose one option to continue.', background:'#0e1428', color:'#F0EEE8', confirmButtonColor:'#D4AF37' });
        return;
      }
      if (ctx.index < total - 1) {
        ctx.index += 1;
        renderQuestionScreen(ctx);
        return;
      }
      await submitQuizAttempt(ctx, { autoSubmitted: false, reason: "manual_final" });
    });

    const submitBtn = document.getElementById('tenQuizSubmitBtn');
    if (submitBtn) submitBtn.addEventListener('click', async () => {
      await submitQuizAttempt(ctx, { autoSubmitted: false, reason: "manual_submit" });
    });
  }

  // NEW FEATURE: Quiz System
  function renderResult(ctx, result) {
    const card = document.getElementById('tenQuizCard');
    const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
    const passed = !!result.passed;
    const title = passed ? 'Quiz Complete! ✅' : 'Quiz Complete';
    const passfail = passed ? `Passed!` : `Not quite. ❌`;
    const coins = result.coins_awarded || 0;
    const attemptText = passed ? '' : `Attempt ${Math.min((result.attempt_number || 0), 3)} of 3 used`;

    const lockText = (!passed && result.locked_until)
      ? `You have used all 3 attempts. Quiz unlocks again on ${new Date(result.locked_until).toLocaleString()}. Use this time to review the video and study the topic.`
      : '';

    card.innerHTML = `
      <div class="ten-quiz-result">
        <div class="ten-quiz-title">${title}</div>
        <div class="ten-quiz-score">${result.score} / ${result.total}</div>
        <div class="ten-quiz-passfail" style="color:${passed ? '#22c55e' : '#ef4444'}">${passfail}</div>
        <div style="margin-top:10px;color:var(--quiz-muted);font-size:13px">
          Passing score: ${result.passing_score} / ${result.total}${passed ? ' ✓' : ''}${attemptText ? ` · ${attemptText}` : ''}
        </div>
        <div style="margin-top:10px;font-weight:900">${pct}%</div>
        <div style="margin-top:8px;color:var(--quiz-muted);font-size:13px">
          Coins earned: <span style="color:var(--quiz-gold);font-weight:900">+${coins}</span>
        </div>
        ${passed ? `<div style="margin-top:8px;color:var(--quiz-muted);font-size:13px">Next week is now unlocked! 🔓</div>` : ''}
        ${lockText ? `<div style="margin-top:12px;color:var(--quiz-muted);font-size:13px;line-height:1.45">${escapeHtml(lockText)}</div>` : ''}
      </div>

      ${(!passed && result.review && result.review.length) ? `
        <div class="ten-quiz-review">
          ${result.review.map((r, idx) => `
            <div class="ten-quiz-review-item">
              <div class="ten-quiz-review-q">${idx+1}. ${escapeHtml(r.question_text)}</div>
              <div class="ten-quiz-review-meta">
                Your answer: <b>${r.selected || '-'}</b> · Correct: <b style="color:var(--quiz-gold)">${r.correct_answer}</b><br>
                ${r.explanation ? `Explanation: ${escapeHtml(r.explanation)}` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="ten-quiz-actions" style="margin-top:14px;justify-content:flex-end">
        <button class="ten-quiz-btn" id="tenQuizCloseBtn">Close</button>
        ${(!passed && !result.locked_until) ? `<button class="ten-quiz-btn primary" id="tenQuizTryAgainBtn">Try Again</button>` : ''}
        ${passed ? `<button class="ten-quiz-btn primary" id="tenQuizContinueBtn">Continue</button>` : ''}
      </div>
    `;

    const closeBtn = document.getElementById('tenQuizCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      stopAndCleanup(ctx, null);
      closeOverlay();
    });

    const tryAgainBtn = document.getElementById('tenQuizTryAgainBtn');
    if (tryAgainBtn) tryAgainBtn.addEventListener('click', async () => {
      stopAndCleanup(ctx, null);
      await startQuizFlow(ctx.task._id);
    });

    const contBtn = document.getElementById('tenQuizContinueBtn');
    if (contBtn) contBtn.addEventListener('click', async () => {
      stopAndCleanup(ctx, null);
      closeOverlay();
      if (typeof window.loadTasks === 'function') window.loadTasks();
    });
  }

  // NEW FEATURE: Quiz System
  async function submitQuizAttempt(ctx, meta) {
    if (!ctx || ctx.submitting) return;
    ctx.submitting = true;
    clearInterval(ctx.timerInterval);
    ctx.timerInterval = null;

    try {
      const payload = {
        employeeId: (studentData && studentData.employeeId) || '',
        answers: ctx.answers,
        meta
      };

      const res = await apiFetch(`/quiz/${ctx.task._id}/submit`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      stopCameraProctoring(ctx.cameraStream);
      ctx.cameraStream = null;

      if (!res.success) {
        const msg = res.message || 'Could not submit quiz.';
        Swal.fire({ icon:'error', title:'Error', text:msg, background:'#0e1428', color:'#F0EEE8', confirmButtonColor:'#D4AF37' });
        closeOverlay();
        return;
      }

      if (meta && meta.autoSubmitted && meta.reason === 'camera_disabled') {
        Swal.fire({
          icon:'warning',
          title:'Quiz submitted',
          text:'Quiz submitted — camera was disabled during your attempt. This counts as one attempt.',
          background:'#0e1428',
          color:'#F0EEE8',
          confirmButtonColor:'#D4AF37'
        });
      }

      if (meta && meta.autoSubmitted && meta.reason === 'time_expired') {
        Swal.fire({
          icon:'info',
          title:"Time's up!",
          text:"Time's up! Your answers have been submitted.",
          background:'#0e1428',
          color:'#F0EEE8',
          confirmButtonColor:'#D4AF37'
        });
      }

      renderResult(ctx, res);

      if (typeof window.loadTasks === 'function') window.loadTasks();
    } finally {
      ctx.submitting = false;
    }
  }

  // NEW FEATURE: Quiz System
  function stopAndCleanup(ctx, warningReason) {
    try {
      clearInterval(ctx.timerInterval);
    } catch (_) {}
    ctx.timerInterval = null;

    try {
      document.removeEventListener('visibilitychange', ctx._visHandler);
      window.removeEventListener('pagehide', ctx._pageHideHandler);
    } catch (_) {}

    if (warningReason) {
      try {
        submitQuizAttempt(ctx, { autoSubmitted: true, reason: warningReason });
      } catch (_) {}
    }

    stopCameraProctoring(ctx.cameraStream);
    ctx.cameraStream = null;
  }

  // NEW FEATURE: Quiz System
  async function startQuizFlow(taskId) {
    ensureQuizOverlay();
    const st = await apiFetch(`/quiz/${taskId}/status`, { method: 'GET' });
    const bankReady = st && st.success ? !!st.bank_ready : false;

    if (!bankReady) {
      const done = await completeFallbackIfNeeded(taskId, { silent: false });
      if (done && done.quiz_ready) {
        await startQuizFlow(taskId);
      }
      return;
    }

    openOverlay();

    const card = document.getElementById('tenQuizCard');
    renderLoading(card, 'Starting Quiz...', 'Requesting camera permission.');

    const cameraStream = await startCameraProctoring();
    if (!cameraStream) {
      renderCameraBlocked(card);

      const closeBtn = document.getElementById('tenQuizCloseBtn');
      if (closeBtn) closeBtn.addEventListener('click', () => closeOverlay());

      const retryBtn = document.getElementById('tenQuizRetryCameraBtn');
      if (retryBtn) retryBtn.addEventListener('click', async () => {
        renderLoading(card, 'Starting Quiz...', 'Requesting camera permission.');
        const retryStream = await startCameraProctoring();
        if (!retryStream) {
          renderCameraBlocked(card);
          return;
        }
        await beginQuizWithStream(taskId, retryStream);
      });
      return;
    }

    await beginQuizWithStream(taskId, cameraStream);
  }

  // NEW FEATURE: Quiz System
  async function beginQuizWithStream(taskId, cameraStream) {
    const card = document.getElementById('tenQuizCard');
    renderLoading(card, 'Loading Questions...', 'Preparing your quiz.');

    const qRes = await apiFetch(`/quiz/${taskId}/questions`, { method: 'GET' });
    if (!qRes.success) {
      stopCameraProctoring(cameraStream);
      closeOverlay();
      return;
    }
    if (qRes.fallback) {
      stopCameraProctoring(cameraStream);
      closeOverlay();
      try { await completeFallbackIfNeeded(taskId, { silent: false }); } catch(_) {}
      return;
    }
    if (qRes.locked) {
      stopCameraProctoring(cameraStream);
      Swal.fire({ icon:'warning', title:'Quiz locked', text:`You have used all 3 attempts. Quiz unlocks again on ${new Date(qRes.locked_until).toLocaleString()}.`, background:'#0e1428', color:'#F0EEE8', confirmButtonColor:'#D4AF37' });
      closeOverlay();
      return;
    }
    if (qRes.already_passed) {
      stopCameraProctoring(cameraStream);
      Swal.fire({ icon:'success', title:'Already passed', text:'This task is already completed.', background:'#0e1428', color:'#F0EEE8', confirmButtonColor:'#D4AF37' });
      closeOverlay();
      return;
    }

    const ctx = {
      task: qRes.task,
      quiz: qRes.quiz,
      questions: qRes.questions || [],
      index: 0,
      answers: {},
      submitting: false,
      cameraStream,
      timerInterval: null,
      _visHandler: null,
      _pageHideHandler: null
    };

    state.active = ctx;

    cameraStream.getTracks().forEach(track => {
      track.onended = () => {
        if (ctx.submitting) return;
        submitQuizAttempt(ctx, { autoSubmitted: true, reason: 'camera_disabled' });
      };
    });

    ctx._visHandler = () => {
      if (document.visibilityState === 'hidden' && !ctx.submitting) {
        submitQuizAttempt(ctx, { autoSubmitted: true, reason: 'tab_hidden' });
      }
    };
    document.addEventListener('visibilitychange', ctx._visHandler);

    ctx._pageHideHandler = () => {
      if (ctx.submitting) return;
      try {
        const body = JSON.stringify({
          employeeId: (studentData && studentData.employeeId) || '',
          answers: ctx.answers,
          meta: { autoSubmitted: true, reason: 'tab_close' }
        });
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(`/api/v2/quiz/${ctx.task._id}/submit`, blob);
      } catch (_) {}
    };
    window.addEventListener('pagehide', ctx._pageHideHandler);

    renderQuestionScreen(ctx);
    ctx.timerInterval = startQuizTimer(ctx.quiz.durationMinutes, () => submitQuizAttempt(ctx, { autoSubmitted: true, reason: 'time_expired' }));
  }

  // NEW FEATURE: Quiz System
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // NEW FEATURE: Quiz System
  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  // NEW FEATURE: Quiz System
  function ensureYouTubeApi() {
    if (window.YT && window.YT.Player) {
      state.yt.apiReady = true;
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      const existing = document.querySelector('script[data-ten-yt="1"]');
      if (existing) return;

      window.onYouTubeIframeAPIReady = function () {
        state.yt.apiReady = true;
        resolve(true);
      };

      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.setAttribute('data-ten-yt', '1');
      document.head.appendChild(tag);
    });
  }

  // NEW FEATURE: Quiz System
  function startTrackingPlayer(taskId, iframeId) {
    if (!window.YT || !window.YT.Player) return;
    if (state.yt.players[taskId]) return;

    const player = new window.YT.Player(iframeId, {
      events: {
        onStateChange: (event) => {
          const playing = event && event.data === window.YT.PlayerState.PLAYING;
          if (playing) startTicker(taskId, player);
          else stopTicker(taskId);
        }
      }
    });
    state.yt.players[taskId] = player;
  }

  // NEW FEATURE: Quiz System
  function startTicker(taskId, player) {
    stopTicker(taskId);
    state.yt.tickers[taskId] = setInterval(async () => {
      try {
        const duration = player.getDuration ? player.getDuration() : 0;
        const current = player.getCurrentTime ? player.getCurrentTime() : 0;
        if (!duration || duration <= 0) return;
        const pct = Math.min(100, Math.max(0, Math.round((current / duration) * 100)));

        updateLocalVideoProgress(taskId, pct);

        if (!state.yt._lastSent) state.yt._lastSent = {};
        const last = state.yt._lastSent[taskId] || 0;
        if (pct >= last + 3 || pct === 100) {
          state.yt._lastSent[taskId] = pct;
          await apiFetch(`/tasks/${taskId}/video-progress`, {
            method: 'PATCH',
            body: JSON.stringify({ percent: pct, employeeId: studentData.employeeId })
          });
        }
      } catch (_) {}
    }, 3000);
  }

  // NEW FEATURE: Quiz System
  function stopTicker(taskId) {
    if (state.yt.tickers[taskId]) {
      clearInterval(state.yt.tickers[taskId]);
      delete state.yt.tickers[taskId];
    }
  }

  // NEW FEATURE: Quiz System
  function updateLocalVideoProgress(taskId, pct) {
    const fill = document.getElementById(`vpf-${taskId}`);
    if (fill) fill.style.width = `${pct}%`;

    const card = document.getElementById(`card-${taskId}`);
    if (!card) return;
    const quizBtn = card.querySelector(`[data-ten-quiz-btn="${taskId}"]`);
    if (!quizBtn) return;
    const locked = quizBtn.getAttribute('data-locked') === '1';
    const passed = quizBtn.getAttribute('data-passed') === '1';
    const bankReady = quizBtn.getAttribute('data-bank-ready') === '1';
    const fallbackDone = quizBtn.getAttribute('data-fallback-done') === '1';
    if (locked || passed) return;

    if (pct >= 80) {
      if (!bankReady) {
        if (!fallbackDone) {
          quizBtn.setAttribute('data-fallback-done', '1');
          try { completeFallbackIfNeeded(taskId, { silent: true }); } catch(_) {}
        }
        quizBtn.disabled = true;
        quizBtn.textContent = 'Completed';
      } else {
        quizBtn.disabled = false;
        quizBtn.textContent = 'Start Quiz';
      }
    }
  }

  // NEW FEATURE: Quiz System
  async function completeFallbackIfNeeded(taskId, opts) {
    const container = document.getElementById(`quiz-${taskId}`);
    const payload = { employeeId: (studentData && studentData.employeeId) || '' };
    const res = await apiFetch(`/quiz/${taskId}/fallback-complete`, { method: 'POST', body: JSON.stringify(payload) });

    if (res && res.success && res.quiz_ready) {
      return { quiz_ready: true };
    }

    if (!res || !res.success) return { error: true };

    if (container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
          <div style="width:20px;height:20px;border-radius:6px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.35);display:flex;align-items:center;justify-content:center;color:#22c55e;font-weight:900">✓</div>
          <div style="color:#c7f9d4;font-weight:800">Great work! This task has been completed.</div>
        </div>
      `;
    }

    // Dynamically update the task card UI without reloading the entire page!
    const card = document.getElementById(`card-${taskId}`);
    if (card) {
      card.className = card.className.replace(/status-\S+/, 'status-approved');
      
      const pill = card.querySelector('.task-status-pill');
      if (pill) {
        pill.className = 'task-status-pill pill-approved';
        pill.textContent = 'Approved ✅';
      }
      
      const icon = card.querySelector('.task-status-icon');
      if (icon) {
        icon.className = 'task-status-icon approved';
        icon.textContent = '✅';
      }

      const gate = document.getElementById(`video-gate-${taskId}`);
      if (gate) {
        gate.innerHTML = `<span style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:6px 14px;font-size:12px;color:#10b981;font-weight:700;">✅ Video watched — Quiz unlocked</span>`;
      }
    }

    // Refresh student stats & coins silently to sync the header balance
    try {
      const status = await apiFetch('/student/status');
      if (status && typeof window.updateStats === 'function') {
        window.updateStats(status);
      }
    } catch (_) {}

    return res;
  }

  // NEW FEATURE: Quiz System
  async function renderQuizControlsForTask(task) {
    const container = document.getElementById(`quiz-${task._id}`);
    if (!container) return;

    const st = await apiFetch(`/quiz/${task._id}/status`, { method: 'GET' });
    const lockedUntil = st && st.success ? st.locked_until : null;
    const passed = st && st.success ? !!st.quiz_passed : (task.status === 'approved');
    const attempts = st && st.success ? (st.attempts_used || 0) : 0;
    const bankReady = st && st.success ? !!st.bank_ready : false;

    const btnId = `tenQuizBtn-${task._id}`;
    const locked = !!lockedUntil;
    const watchedPct = task.videoWatchedPercent || 0;
    const enabled = watchedPct >= 80 && !locked && !passed && bankReady;

    const lockMsg = locked
      ? `<div style="margin-top:8px;color:var(--text-muted);font-size:12px;line-height:1.35">
          You have used all 3 attempts. Quiz unlocks again on ${new Date(lockedUntil).toLocaleString()}.
        </div>`
      : '';

    const attemptsMsg = (!passed && !locked)
      ? `<div style="margin-top:8px;color:var(--text-muted);font-size:12px">Attempts used: ${attempts}/3</div>`
      : '';

    const hint = (!passed && !locked && watchedPct < 80)
      ? `<div style="margin-top:8px;color:var(--text-muted);font-size:12px">${bankReady ? 'Watch at least 80% of the video to unlock the quiz.' : 'Watch at least 80% of the video to complete this task (quiz will activate automatically once ready).'}</div>`
      : '';

    container.innerHTML = `
      <div class="actions-row">
        <button class="btn btn-primary btn-sm" id="${btnId}" data-ten-quiz-btn="${task._id}" data-locked="${locked ? '1' : '0'}" data-passed="${passed ? '1' : '0'}" data-bank-ready="${bankReady ? '1' : '0'}" data-fallback-done="0" ${enabled ? '' : 'disabled'}>
          ${passed ? 'Completed' : (locked ? 'Quiz Locked' : (watchedPct >= 80 ? (bankReady ? 'Start Quiz' : 'Completed') : (bankReady ? 'Start Quiz (Locked)' : 'Complete Video')))}
        </button>
      </div>
      ${hint}
      ${attemptsMsg}
      ${lockMsg}
    `;

    const btn = document.getElementById(btnId);
    if (!btn || passed || locked) return;

    if (!bankReady && watchedPct >= 80) {
      btn.setAttribute('data-fallback-done', '1');
      btn.disabled = true;
      try { await completeFallbackIfNeeded(task._id, { silent: false }); } catch(_) {}
      return;
    }

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      await startQuizFlow(task._id);
    });
  }

  // NEW FEATURE: Quiz System
  async function initAfterRender(weeks) {
    ensureQuizOverlay();

    const tasks = [];
    (weeks || []).forEach(w => (w.tasks || []).forEach(t => tasks.push(t)));

    for (const t of tasks) {
      if (['locked'].includes(t.status)) continue;
      if (!t.videoUrl) continue;
      await renderQuizControlsForTask(t);
    }

    await ensureYouTubeApi();
    tasks.forEach(t => {
      const ytId = t.videoUrl ? t.videoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) : null;
      if (!ytId) return;
      const iframeId = `yt-${t._id}`;
      const el = document.getElementById(iframeId);
      if (!el) return;
      startTrackingPlayer(t._id, iframeId);
    });
  }

  // NEW FEATURE: Quiz System
  window.TENQuiz = {
    initAfterRender
  };
})();
