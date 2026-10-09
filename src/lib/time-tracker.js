/*
 * Classifies each moment a chat tab is open into one of:
 *   active  - you interacted recently (typing, scrolling, clicking) or are
 *             within the reading allowance for a reply that just arrived
 *   waiting - you are not interacting and Claude is generating (watching it type)
 *   idle    - you are not interacting and nothing is happening (staring)
 *   hidden  - the tab is in the background or the window is unfocused
 * and accumulates how long was spent in each.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  const STATE_FIELD = { active: 'activeMs', waiting: 'waitingMs', idle: 'idleMs', hidden: 'hiddenMs' };

  function zero() {
    return { activeMs: 0, waitingMs: 0, idleMs: 0, hiddenMs: 0 };
  }

  function classify(now, signals, { idleAfterMs }) {
    if (!signals.visible || !signals.focused) return 'hidden';
    const last = Number.isFinite(signals.lastInteractionAt) ? signals.lastInteractionAt : -Infinity;
    if (now - last <= idleAfterMs) return 'active';
    if (Number.isFinite(signals.readingUntil) && now <= signals.readingUntil) return 'active';
    return signals.generating ? 'waiting' : 'idle';
  }

  // maxGapMs: longer gaps between updates (e.g. the laptop slept) are dropped. It sits
  // above Chrome's one-update-per-minute throttling of background tabs.
  function createTracker({ idleAfterMs = 30000, maxGapMs = 90000 } = {}) {
    let opts = { idleAfterMs };
    let lastTick = null;
    let current = null;
    let streak = 0;
    const total = zero();
    let pending = zero();

    function update(now, signals) {
      const state = classify(now, signals, opts);
      if (lastTick !== null) {
        const elapsed = now - lastTick;
        if (elapsed > 0 && elapsed <= maxGapMs) {
          const field = STATE_FIELD[state];
          total[field] += elapsed;
          pending[field] += elapsed;
        }
      }
      if (state === 'idle' || state === 'waiting') {
        if (lastTick !== null && now > lastTick && now - lastTick <= maxGapMs) streak += now - lastTick;
      } else {
        streak = 0;
      }
      if (lastTick === null || now >= lastTick) lastTick = now;
      current = state;
      return state;
    }

    function drain() {
      const out = pending;
      pending = zero();
      return out;
    }

    return {
      update,
      drain,
      peek: () => ({ ...pending }),
      totals: () => ({ ...total }),
      state: () => current,
      staringStreakMs: () => streak,
      setIdleAfterMs(ms) {
        opts = { ...opts, idleAfterMs: ms };
      },
    };
  }

  return { classify, createTracker };
});
