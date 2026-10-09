/*
 * Per-chat colour choices the user made in the popup.
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./color.js') : root.CCF);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (color) {
  'use strict';

  const OVERRIDES_KEY = 'hueOverrides';

  async function getHueOverrides(storage) {
    const value = (await storage.get(OVERRIDES_KEY))[OVERRIDES_KEY];
    return value && typeof value === 'object' ? value : {};
  }

  async function setHueOverride(storage, chatId, hue) {
    const normalized = color.normalizeHue(hue);
    if (normalized === null) throw new TypeError(`Invalid hue: ${hue}`);
    const all = await getHueOverrides(storage);
    all[chatId] = normalized;
    await storage.set({ [OVERRIDES_KEY]: all });
    return all;
  }

  async function clearHueOverride(storage, chatId) {
    const all = await getHueOverrides(storage);
    delete all[chatId];
    await storage.set({ [OVERRIDES_KEY]: all });
    return all;
  }

  return { OVERRIDES_KEY, getHueOverrides, setHueOverride, clearHueOverride };
});
