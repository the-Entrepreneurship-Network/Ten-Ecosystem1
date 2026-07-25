'use strict';
/* globals window, document */

(function initComingSoon() {
  const MODAL_ID = 'coming-soon-modal';

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id        = MODAL_ID;
    overlay.className = 'modal-overlay';
    overlay.innerHTML = [
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="cs-title">',
      '  <div class="modal__header">',
      '    <h3 id="cs-title">🚧 Coming Soon</h3>',
      '    <button class="modal__close" data-modal-close aria-label="Close">✕</button>',
      '  </div>',
      '  <div class="modal__body">',
      '    <p id="cs-feature-name" style="font-weight:600;font-size:1.1rem;margin-bottom:0.5rem;"></p>',
      '    <p id="cs-phase-info" style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:1rem;"></p>',
      '    <p style="color:var(--text-secondary);font-size:0.875rem;">',
      '      This feature is actively being built. Stay tuned for updates!',
      '    </p>',
      '  </div>',
      '  <div class="modal__footer">',
      '    <button class="btn btn--secondary btn--sm" id="cs-notify-btn">🔔 Notify Me</button>',
      '    <button class="btn btn--primary btn--sm" data-modal-close>Got it</button>',
      '  </div>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);

    const notifyBtn = overlay.querySelector('#cs-notify-btn');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', function() {
        notifyBtn.textContent = '✅ Noted!';
        notifyBtn.disabled    = true;
      });
    }
  }

  function show(featureName, phase) {
    ensureModal();
    const overlay = document.getElementById(MODAL_ID);
    const nameEl  = overlay.querySelector('#cs-feature-name');
    const phaseEl = overlay.querySelector('#cs-phase-info');

    if (nameEl)  nameEl.textContent  = featureName || 'This feature';
    if (phaseEl) phaseEl.textContent = phase ? `Expected: ${phase}` : 'Expected in an upcoming phase';

    overlay.classList.add('is-open');
    document.body.classList.add('modal--open');
  }

  function initTriggers() {
    document.addEventListener('click', function(e) {
      const trigger = e.target.closest('[data-coming-soon]');
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      const feature = trigger.getAttribute('data-coming-soon') || trigger.textContent.trim();
      const phase   = trigger.getAttribute('data-phase') || 'Phase 2';
      show(feature, phase);
    });

    document.addEventListener('click', function(e) {
      const overlay = document.getElementById(MODAL_ID);
      if (!overlay) return;
      if (e.target === overlay || e.target.closest('[data-modal-close]')) {
        overlay.classList.remove('is-open');
        document.body.classList.remove('modal--open');
      }
    });
  }

  window.TEN = window.TEN || {};
  window.TEN.ComingSoon = { show };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTriggers);
  } else {
    initTriggers();
  }
}());
