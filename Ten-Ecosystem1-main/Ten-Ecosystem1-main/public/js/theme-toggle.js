'use strict';
/* globals window, document, localStorage */

(function initTENTheme() {
  const STORAGE_KEY = 'ten-theme';
  const VALID_THEMES = ['light', 'dark'];

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const preferred = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    const theme = VALID_THEMES.includes(saved) ? saved : preferred;
    applyTheme(theme);
  }

  function toggleTheme() {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  window.TENTheme = { initTheme, toggleTheme, getTheme };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  document.addEventListener('click', function handleThemeClick(e) {
    if (e.target && e.target.id === 'theme-toggle-btn') {
      toggleTheme();
    }
  });
}());
