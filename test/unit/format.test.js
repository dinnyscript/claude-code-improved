const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, dayKey, percent } = require('../../src/lib/format.js');

describe('formatDuration', () => {
  it('formats sub-minute durations in seconds', () => {
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(999), '0s');
    assert.equal(formatDuration(45000), '45s');
  });

  it('formats minutes with seconds', () => {
    assert.equal(formatDuration(65000), '1m 5s');
    assert.equal(formatDuration(600000), '10m 0s');
  });

  it('formats hours with minutes and drops seconds', () => {
    assert.equal(formatDuration(3600000), '1h 0m');
    assert.equal(formatDuration(3725000), '1h 2m');
  });

  it('treats negative, NaN and non-numbers as zero', () => {
    assert.equal(formatDuration(-5000), '0s');
    assert.equal(formatDuration(NaN), '0s');
    assert.equal(formatDuration(undefined), '0s');
  });
});

describe('dayKey', () => {
  it('returns a local YYYY-MM-DD key', () => {
    assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(dayKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  });

  it('accepts epoch milliseconds', () => {
    const d = new Date(2026, 9, 9, 12);
    assert.equal(dayKey(d.getTime()), '2026-10-09');
  });
});

describe('percent', () => {
  it('returns a rounded integer percentage', () => {
    assert.equal(percent(1, 3), 33);
    assert.equal(percent(2, 3), 67);
  });

  it('returns 0 when the total is zero', () => {
    assert.equal(percent(5, 0), 0);
  });
});
