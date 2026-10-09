/*
 * Tab-title status markers so you can see from another tab whether Claude
 * is still working or has finished.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  const STATUS_PREFIX = Object.freeze({ generating: '⏳ ', done: '✅ ' });

  function stripStatus(title) {
    let t = String(title || '');
    for (const p of Object.values(STATUS_PREFIX)) if (t.startsWith(p)) t = t.slice(p.length);
    return t;
  }

  function decorateTitle(title, status) {
    const clean = stripStatus(title);
    const prefix = STATUS_PREFIX[status];
    return prefix ? prefix + clean : clean;
  }

  return { STATUS_PREFIX, stripStatus, decorateTitle };
});
