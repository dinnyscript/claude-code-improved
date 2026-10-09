/*
 * Decides when to gently interrupt you for staring at a chat, and what to say.
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./format.js') : root.CCF);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (fmt) {
  'use strict';

  function createNudger({ nudgeAfterMs = 120000, enabled = true } = {}) {
    let opts = { nudgeAfterMs, enabled };
    let lastLevel = 0;

    return {
      check(streakMs) {
        const level = opts.nudgeAfterMs > 0 ? Math.floor(streakMs / opts.nudgeAfterMs) : 0;
        if (level < lastLevel || level === 0) {
          lastLevel = level;
          return null;
        }
        if (!opts.enabled || level === lastLevel) return null;
        lastLevel = level;
        return level;
      },
      configure(next) {
        opts = { ...opts, ...next };
      },
    };
  }

  const IDLE_BODIES = [
    'Decide your next step: reply, start a new task, or close this tab.',
    'Still here? Write the next prompt now or move on to something else.',
    'This tab is eating your time. Close it and come back when you have a next step.',
  ];

  function nudgeMessage({ level, state, streakMs }) {
    const duration = fmt.formatDuration(streakMs);
    if (state === 'waiting') {
      return {
        title: `You've watched Claude type for ${duration}`,
        body:
          level > 1
            ? 'Watching won\'t make it faster. Switch tasks - you\'ll get a notification when it is done.'
            : 'Switch to something else while you wait - you\'ll get a notification when the reply is done.',
      };
    }
    const body = IDLE_BODIES[Math.min(IDLE_BODIES.length, Math.max(1, level)) - 1];
    return { title: `You've been staring at this chat for ${duration}`, body };
  }

  return { createNudger, nudgeMessage };
});
