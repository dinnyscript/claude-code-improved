/*
 * Options page helpers: settings form binding and CSV export of stats.
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./settings.js') : root.CCF);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (L) {
  'use strict';

  function fillForm(form, settings) {
    for (const [key, spec] of Object.entries(L.SETTINGS_SCHEMA)) {
      const input = form.elements[key];
      if (!input) continue;
      if (spec.type === 'boolean') input.checked = Boolean(settings[key]);
      else input.value = String(settings[key]);
    }
  }

  function readForm(form) {
    const raw = {};
    for (const [key, spec] of Object.entries(L.SETTINGS_SCHEMA)) {
      const input = form.elements[key];
      if (!input) continue;
      raw[key] = spec.type === 'boolean' ? input.checked : input.value;
    }
    return L.normalizeSettings(raw);
  }

  function csvCell(value) {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  const minutes = (ms) => ((Number(ms) || 0) / 60000).toFixed(1);

  function statsToCsv(all) {
    const lines = ['day,chat_id,title,active_min,waiting_min,idle_min,hidden_min'];
    const days = Object.keys(all)
      .filter((k) => k.startsWith('stats:'))
      .sort();
    for (const key of days) {
      const day = key.slice('stats:'.length);
      const chats = (all[key] && all[key].chats) || {};
      for (const id of Object.keys(chats).sort()) {
        const c = chats[id];
        lines.push(
          [day, id, csvCell(c.title), minutes(c.activeMs), minutes(c.waitingMs), minutes(c.idleMs), minutes(c.hiddenMs)].join(',')
        );
      }
    }
    return lines.join('\n') + '\n';
  }

  return { fillForm, readForm, statsToCsv };
});
