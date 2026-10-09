const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, normalizeSettings } = require('../../src/lib/settings.js');

describe('normalizeSettings', () => {
  it('returns the defaults for empty input', () => {
    assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  });

  it('does not share mutable state with the defaults', () => {
    const s = normalizeSettings({});
    s.colorsEnabled = !s.colorsEnabled;
    assert.notEqual(s.colorsEnabled, DEFAULT_SETTINGS.colorsEnabled);
  });

  it('keeps valid user values', () => {
    const s = normalizeSettings({ colorsEnabled: false, idleAfterSec: 45, nudgeAfterSec: 300, dailyStaringBudgetMin: 10 });
    assert.equal(s.colorsEnabled, false);
    assert.equal(s.idleAfterSec, 45);
    assert.equal(s.nudgeAfterSec, 300);
    assert.equal(s.dailyStaringBudgetMin, 10);
  });

  it('clamps numbers into sensible ranges', () => {
    const s = normalizeSettings({ idleAfterSec: 1, nudgeAfterSec: 999999, colorIntensity: 3, dailyStaringBudgetMin: -4 });
    assert.equal(s.idleAfterSec, 5);
    assert.equal(s.nudgeAfterSec, 3600);
    assert.equal(s.colorIntensity, 1);
    assert.equal(s.dailyStaringBudgetMin, 0);
  });

  it('falls back to defaults for wrongly-typed values', () => {
    const s = normalizeSettings({ colorsEnabled: 'yes', idleAfterSec: 'ten', notifyOnComplete: null });
    assert.equal(s.colorsEnabled, DEFAULT_SETTINGS.colorsEnabled);
    assert.equal(s.idleAfterSec, DEFAULT_SETTINGS.idleAfterSec);
    assert.equal(s.notifyOnComplete, DEFAULT_SETTINGS.notifyOnComplete);
  });

  it('drops unknown keys', () => {
    assert.equal('evil' in normalizeSettings({ evil: 1 }), false);
  });

  it('accepts numeric strings from form inputs', () => {
    assert.equal(normalizeSettings({ idleAfterSec: '60' }).idleAfterSec, 60);
  });

  it('has defaults for the newer options', () => {
    assert.equal(DEFAULT_SETTINGS.colorFavicon, true);
    assert.equal(DEFAULT_SETTINGS.budgetAlert, true);
  });
});
