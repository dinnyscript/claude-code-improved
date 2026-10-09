/*
 * Formatting helpers shared by the content script, popup and options page.
 * Loaded as a classic script in the extension (exposed on globalThis.CCF)
 * and via require() in tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  function formatDuration(ms) {
    const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function dayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  return { formatDuration, dayKey, percent };
});
