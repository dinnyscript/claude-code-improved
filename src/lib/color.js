/*
 * Deterministic per-chat colours so each conversation is recognisable at a glance.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  // FNV-1a, 32-bit.
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // murmur3 finaliser: full avalanche so similar ids (chat-1, chat-2) land far apart.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function normalizeHue(hue) {
    if (typeof hue !== 'number' || !Number.isFinite(hue)) return null;
    return ((hue % 360) + 360) % 360;
  }

  function chatHue(chatId, hueOverride) {
    const override = normalizeHue(hueOverride);
    if (override !== null) return override;
    return hashString(String(chatId)) % 360;
  }

  function clamp01(x) {
    if (!Number.isFinite(x)) return 1;
    return Math.min(1, Math.max(0, x));
  }

  function chatPalette(chatId, { dark = false, intensity = 0.6, hueOverride } = {}) {
    const hue = chatHue(chatId, hueOverride);
    const k = clamp01(intensity);
    const saturation = Math.round(20 + 60 * k);
    const background = dark
      ? `hsl(${hue} ${Math.round(saturation * 0.6)}% ${Math.round(9 + 6 * k)}%)`
      : `hsl(${hue} ${saturation}% ${Math.round(97 - 8 * k)}%)`;
    const accent = dark ? `hsl(${hue} 70% 62%)` : `hsl(${hue} 65% 42%)`;
    return { hue, background, accent };
  }

  return { hashString, normalizeHue, chatHue, chatPalette };
});
