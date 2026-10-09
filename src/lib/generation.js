/*
 * Detects whether Claude is currently streaming a response, and turns that
 * into debounced "started" / "completed" events.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  const GENERATING_SELECTORS = Object.freeze([
    '[data-is-streaming="true"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop Response"]',
    'button[aria-label="Stop generating"]',
  ]);

  function isGenerating(doc, selectors = GENERATING_SELECTORS) {
    for (const sel of selectors) {
      try {
        if (doc.querySelector(sel)) return true;
      } catch {
        // Ignore invalid selectors so one bad entry can't break detection.
      }
    }
    return false;
  }

  function createCompletionWatcher({ settleMs = 1500 } = {}) {
    let running = false;
    let startedAt = null;
    let stoppedAt = null;
    let lastDuration = null;

    return {
      update(generating, now) {
        if (generating) {
          stoppedAt = null;
          if (!running) {
            running = true;
            startedAt = now;
            return 'started';
          }
          return null;
        }
        if (!running) return null;
        if (stoppedAt === null) stoppedAt = now;
        if (now - stoppedAt >= settleMs) {
          running = false;
          lastDuration = stoppedAt - startedAt;
          stoppedAt = null;
          return 'completed';
        }
        return null;
      },
      isRunning: () => running,
      lastDurationMs: () => lastDuration,
    };
  }

  return { GENERATING_SELECTORS, isGenerating, createCompletionWatcher };
});
