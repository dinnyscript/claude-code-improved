/*
 * Per-day, per-chat time statistics persisted in chrome.storage.local
 * (or anything with the same promise-based get/set/remove API).
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./format.js') : root.CCF);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (fmt) {
  'use strict';

  const PREFIX = 'stats:';
  const FIELDS = ['activeMs', 'waitingMs', 'idleMs', 'hiddenMs'];

  function statsKey(day) {
    return PREFIX + day;
  }

  function emptyTotals() {
    return { activeMs: 0, waitingMs: 0, idleMs: 0, hiddenMs: 0 };
  }

  // Read-modify-write must not interleave, so writes per storage are chained.
  const queues = new WeakMap();
  function serialized(storage, fn) {
    const prev = queues.get(storage) || Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(storage, next.catch(() => {}));
    return next;
  }

  function addDelta(storage, day, chatId, delta, { title, now } = {}) {
    return serialized(storage, async () => {
      const key = statsKey(day);
      const existing = (await storage.get(key))[key];
      const dayStats = existing && typeof existing === 'object' ? existing : { chats: {} };
      dayStats.chats = dayStats.chats || {};
      const chat = { ...emptyTotals(), ...dayStats.chats[chatId] };
      for (const f of FIELDS) {
        const v = delta && delta[f];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) chat[f] += v;
      }
      if (title) chat.title = title;
      if (now !== undefined) chat.lastSeen = now;
      dayStats.chats[chatId] = chat;
      await storage.set({ [key]: dayStats });
      return dayStats;
    });
  }

  // Goes through the same queue as addDelta, so a write already in flight
  // can't put deleted stats back.
  function clearAllStats(storage, extraKeys = []) {
    return serialized(storage, async () => {
      const stale = Object.keys(await storage.get(null)).filter((k) => k.startsWith(PREFIX));
      if (stale.length || extraKeys.length) await storage.remove([...stale, ...extraKeys]);
      return stale;
    });
  }

  function summarizeDay(dayStats) {
    const totals = { ...emptyTotals(), staringMs: 0 };
    const chats = [];
    const entries = Object.entries((dayStats && dayStats.chats) || {});
    for (const [chatId, c] of entries) {
      const row = { chatId, title: c.title || '', ...emptyTotals() };
      for (const f of FIELDS) {
        row[f] = Number(c[f]) || 0;
        totals[f] += row[f];
      }
      row.staringMs = row.idleMs + row.waitingMs;
      chats.push(row);
    }
    totals.staringMs = totals.idleMs + totals.waitingMs;
    chats.sort((a, b) => b.staringMs - a.staringMs || b.activeMs - a.activeMs);
    const engaged = totals.activeMs + totals.staringMs;
    const focusScore = engaged > 0 ? fmt.percent(totals.activeMs, engaged) : null;
    return { totals, chats, focusScore };
  }

  function daysBefore(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() - n);
    return d;
  }

  async function recentDays(storage, n, today = new Date()) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) days.push(fmt.dayKey(daysBefore(today, i)));
    const data = await storage.get(days.map(statsKey));
    return days.map((day) => ({ day, ...summarizeDay(data[statsKey(day)]) }));
  }

  async function pruneOldDays(storage, keepDays, today = new Date()) {
    const cutoff = statsKey(fmt.dayKey(daysBefore(today, keepDays)));
    const all = await storage.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith(PREFIX) && k < cutoff);
    if (stale.length) await storage.remove(stale);
    return stale;
  }

  return { statsKey, emptyTotals, addDelta, clearAllStats, summarizeDay, recentDays, pruneOldDays };
});
