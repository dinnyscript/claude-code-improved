/*
 * Paints the current chat's colour over claude.ai: a translucent tint blended
 * over the whole page (so it works regardless of claude.ai's own markup) plus
 * a solid accent bar along the top edge.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  const TINT_ID = 'ccf-tint';
  const BAR_ID = 'ccf-accent-bar';
  const STYLE_ID = 'ccf-theme-style';
  const SAFE_COLOR = /^[#a-zA-Z0-9\s%(),./-]+$/;

  function safe(color, fallback) {
    return typeof color === 'string' && SAFE_COLOR.test(color) ? color : fallback;
  }

  function ensure(doc, id, tag, parent) {
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElement(tag);
      el.id = id;
      if (tag === 'div') el.setAttribute('aria-hidden', 'true');
      parent.append(el);
    }
    return el;
  }

  function applyChatColor(doc, palette) {
    if (!palette) {
      for (const id of [TINT_ID, BAR_ID, STYLE_ID]) doc.getElementById(id)?.remove();
      delete doc.documentElement.dataset.ccfTinted;
      return;
    }
    const background = safe(palette.background, 'transparent');
    const accent = safe(palette.accent, 'transparent');
    const blend = palette.dark ? 'screen' : 'multiply';
    const style = ensure(doc, STYLE_ID, 'style', doc.head || doc.documentElement);
    style.textContent = [
      `#${TINT_ID} { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;`,
      `  background: ${background}; mix-blend-mode: ${blend}; transition: background 300ms ease; }`,
      `#${BAR_ID} { position: fixed; top: 0; left: 0; right: 0; height: 4px; pointer-events: none;`,
      `  z-index: 2147483001; background: ${accent}; }`,
    ].join('\n');
    const container = doc.body || doc.documentElement;
    ensure(doc, TINT_ID, 'div', container);
    ensure(doc, BAR_ID, 'div', container);
    doc.documentElement.dataset.ccfTinted = 'true';
  }

  function detectDarkMode(doc, win) {
    const html = doc.documentElement;
    const mode = html.getAttribute('data-mode') || html.getAttribute('data-theme');
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    if (html.classList.contains('dark')) return true;
    if (win && typeof win.matchMedia === 'function') {
      try {
        return Boolean(win.matchMedia('(prefers-color-scheme: dark)').matches);
      } catch {
        return false;
      }
    }
    return false;
  }

  return { TINT_ID, BAR_ID, STYLE_ID, applyChatColor, detectDarkMode };
});
