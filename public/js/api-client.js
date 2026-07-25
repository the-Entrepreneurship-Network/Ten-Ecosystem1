'use strict';
/* globals window, document, localStorage, fetch */

(function initTENAPI() {
  const TOKEN_KEY    = 'ten-token';
  const LOGIN_ROUTE  = '/login';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function buildHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const token   = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async function request(method, path, body) {
    const opts = {
      method:      method,
      headers:     buildHeaders(),
      credentials: 'include',
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(path, opts);
    } catch (networkErr) {
      if (window.TEN && window.TEN.Toast) {
        window.TEN.Toast.show({ message: 'Network error. Please check your connection.', type: 'error' });
      }
      throw networkErr;
    }

    if (res.status === 401) {
      window.location.href = LOGIN_ROUTE;
      return null;
    }

    const data = await res.json().catch(() => ({ success: false, error: 'Invalid server response' }));

    if (!res.ok && window.TEN && window.TEN.Toast) {
      window.TEN.Toast.show({ message: data.error || 'Request failed', type: 'error' });
    }

    return data;
  }

  const TEN_API = {
    get:    function(path) { return request('GET', path); },
    post:   function(path, body) { return request('POST', path, body); },
    patch:  function(path, body) { return request('PATCH', path, body); },
    delete: function(path) { return request('DELETE', path); },
    setToken: function(token) { localStorage.setItem(TOKEN_KEY, token); },
    clearToken: function() { localStorage.removeItem(TOKEN_KEY); },
  };

  window.TEN = window.TEN || {};
  window.TEN.API = TEN_API;
}());
