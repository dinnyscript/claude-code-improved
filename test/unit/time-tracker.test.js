const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTracker, classify } = require('../../src/lib/time-tracker.js');

const S = 1000;
const base = { visible: true, focused: true, generating: false };

describe('classify', () => {
  const opts = { idleAfterMs: 30 * S };

  it('is hidden when the tab is not visible or the window is not focused', () => {
    assert.equal(classify(0, { ...base, visible: false, lastInteractionAt: 0 }, opts), 'hidden');
    assert.equal(classify(0, { ...base, focused: false, lastInteractionAt: 0 }, opts), 'hidden');
  });

  it('is active shortly after an interaction', () => {
    assert.equal(classify(10 * S, { ...base, lastInteractionAt: 0 }, opts), 'active');
  });

  it('is idle once the idle threshold passes with nothing happening', () => {
    assert.equal(classify(31 * S, { ...base, lastInteractionAt: 0 }, opts), 'idle');
  });

  it('is waiting when idle but Claude is generating', () => {
    assert.equal(classify(31 * S, { ...base, generating: true, lastInteractionAt: 0 }, opts), 'waiting');
  });

  it('treats a missing interaction time as no interaction', () => {
    assert.equal(classify(31 * S, { ...base }, opts), 'idle');
  });
});

describe('createTracker', () => {
  function run(tracker, steps) {
    for (const [t, signals] of steps) tracker.update(t, signals);
  }

  it('starts empty', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    assert.deepEqual(t.totals(), { activeMs: 0, waitingMs: 0, idleMs: 0, hiddenMs: 0 });
    assert.equal(t.staringStreakMs(), 0);
  });

  it('attributes elapsed time to the state observed at each tick', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    const sig = { ...base, lastInteractionAt: 0 };
    run(t, [
      [0, sig],
      [10 * S, sig], // active
      [20 * S, sig], // active
      [40 * S, sig], // idle (20s)
      [50 * S, { ...sig, generating: true }], // waiting (10s)
      [60 * S, { ...sig, visible: false }], // hidden (10s)
    ]);
    assert.deepEqual(t.totals(), { activeMs: 20 * S, waitingMs: 10 * S, idleMs: 20 * S, hiddenMs: 10 * S });
  });

  it('ignores gaps longer than maxGapMs (e.g. laptop sleep)', () => {
    const t = createTracker({ idleAfterMs: 30 * S, maxGapMs: 60 * S });
    const sig = { ...base, lastInteractionAt: 0 };
    run(t, [
      [0, sig],
      [3600 * S, sig],
    ]);
    assert.deepEqual(t.totals(), { activeMs: 0, waitingMs: 0, idleMs: 0, hiddenMs: 0 });
  });

  it('ignores time going backwards', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    const sig = { ...base, lastInteractionAt: 0 };
    run(t, [
      [10 * S, sig],
      [5 * S, sig],
    ]);
    assert.equal(t.totals().activeMs, 0);
  });

  it('tracks a continuous staring streak across idle and waiting', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    const sig = { ...base, lastInteractionAt: 0 };
    run(t, [
      [0, sig],
      [40 * S, sig], // idle 40s -> streak 40
      [50 * S, { ...sig, generating: true }], // waiting -> streak 50
    ]);
    assert.equal(t.staringStreakMs(), 50 * S);
    assert.equal(t.state(), 'waiting');
  });

  it('resets the staring streak on activity or when hidden', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    run(t, [
      [0, { ...base, lastInteractionAt: 0 }],
      [40 * S, { ...base, lastInteractionAt: 0 }],
      [45 * S, { ...base, lastInteractionAt: 44 * S }],
    ]);
    assert.equal(t.staringStreakMs(), 0);
    run(t, [
      [100 * S, { ...base, lastInteractionAt: 44 * S }],
      [110 * S, { ...base, visible: false, lastInteractionAt: 44 * S }],
    ]);
    assert.equal(t.staringStreakMs(), 0);
  });

  it('drain() returns time accumulated since the previous drain', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    const sig = { ...base, lastInteractionAt: 0 };
    run(t, [
      [0, sig],
      [10 * S, sig],
    ]);
    assert.deepEqual(t.drain(), { activeMs: 10 * S, waitingMs: 0, idleMs: 0, hiddenMs: 0 });
    assert.deepEqual(t.drain(), { activeMs: 0, waitingMs: 0, idleMs: 0, hiddenMs: 0 });
    run(t, [[50 * S, sig]]);
    assert.deepEqual(t.drain(), { activeMs: 0, waitingMs: 0, idleMs: 40 * S, hiddenMs: 0 });
    // totals keep the session-wide sum
    assert.equal(t.totals().activeMs, 10 * S);
    assert.equal(t.totals().idleMs, 40 * S);
  });

  it('allows the idle threshold to change at runtime', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    t.setIdleAfterMs(5 * S);
    run(t, [
      [0, { ...base, lastInteractionAt: 0 }],
      [10 * S, { ...base, lastInteractionAt: 0 }],
    ]);
    assert.equal(t.totals().idleMs, 10 * S);
  });
});

describe('createTracker peek', () => {
  it('reports pending time without draining it', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    t.update(0, { ...base, lastInteractionAt: 0 });
    t.update(5 * S, { ...base, lastInteractionAt: 0 });
    assert.equal(t.peek().activeMs, 5 * S);
    assert.equal(t.peek().activeMs, 5 * S);
    assert.equal(t.drain().activeMs, 5 * S);
  });
});

describe('review fixes', () => {
  it('counts time inside a reading allowance as active', () => {
    const opts = { idleAfterMs: 10 * S };
    assert.equal(classify(60 * S, { ...base, lastInteractionAt: 0, readingUntil: 70 * S }, opts), 'active');
    assert.equal(classify(71 * S, { ...base, lastInteractionAt: 0, readingUntil: 70 * S }, opts), 'idle');
    assert.equal(classify(60 * S, { ...base, visible: false, readingUntil: 70 * S }, opts), 'hidden');
  });

  it('tolerates background-tab timer throttling of up to a minute and a half', () => {
    const t = createTracker({ idleAfterMs: 30 * S });
    const sig = { ...base, visible: false };
    t.update(0, sig);
    t.update(61 * S, sig);
    t.update(150 * S, sig);
    assert.equal(t.totals().hiddenMs, 150 * S);
  });
});
