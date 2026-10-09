/*
 * User settings: defaults plus validation of whatever comes out of storage.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  const SCHEMA = {
    colorsEnabled: { type: 'boolean', default: true },
    colorIntensity: { type: 'number', default: 0.6, min: 0, max: 1 },
    widgetEnabled: { type: 'boolean', default: true },
    idleAfterSec: { type: 'number', default: 30, min: 5, max: 600 },
    nudgeEnabled: { type: 'boolean', default: true },
    nudgeAfterSec: { type: 'number', default: 120, min: 15, max: 3600 },
    notifyOnComplete: { type: 'boolean', default: true },
    titleStatus: { type: 'boolean', default: true },
    dailyStaringBudgetMin: { type: 'number', default: 30, min: 0, max: 24 * 60 },
  };

  const DEFAULT_SETTINGS = Object.freeze(
    Object.fromEntries(Object.entries(SCHEMA).map(([k, v]) => [k, v.default]))
  );

  function normalizeValue(spec, value) {
    if (spec.type === 'boolean') return typeof value === 'boolean' ? value : spec.default;
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return spec.default;
    return Math.min(spec.max, Math.max(spec.min, n));
  }

  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const [key, spec] of Object.entries(SCHEMA)) out[key] = normalizeValue(spec, src[key]);
    return out;
  }

  const SETTINGS_KEY = 'settings';

  async function readSettings(syncStorage) {
    const raw = (await syncStorage.get(SETTINGS_KEY))[SETTINGS_KEY];
    return normalizeSettings(raw);
  }

  return { DEFAULT_SETTINGS, SETTINGS_SCHEMA: SCHEMA, SETTINGS_KEY, normalizeSettings, readSettings };
});
