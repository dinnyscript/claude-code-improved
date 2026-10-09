/*
 * Service-worker logic: the single writer for stats (so tabs never race),
 * the toolbar badge, and "Claude finished" notifications.
 */
(function (root, factory) {
  const deps =
    typeof require === 'function'
      ? Object.assign({}, require('./format.js'), require('./settings.js'), require('./stats.js'))
      : root.CCF;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (L) {
  'use strict';

  const NOTIFICATION_PREFIX = 'ccf-done:';
  const MAINTENANCE_ALARM = 'ccf-maintenance';
  const KEEP_DAYS = 90;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const GREEN = '#2e7d32';
  const RED = '#c62828';

  function badgeText(staringMs) {
    const minutes = Math.floor((staringMs || 0) / 60000);
    if (minutes < 1) return '';
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  function createBackground({ chrome, now = Date.now }) {
    const local = chrome.storage.local;

    async function updateBadge() {
      try {
        const settings = await L.readSettings(chrome.storage.sync);
        const key = L.statsKey(L.dayKey(now()));
        const { totals } = L.summarizeDay((await local.get(key))[key]);
        const budgetMs = settings.dailyStaringBudgetMin * 60000;
        await chrome.action.setBadgeText({ text: badgeText(totals.staringMs) });
        await chrome.action.setBadgeBackgroundColor({
          color: budgetMs > 0 && totals.staringMs > budgetMs ? RED : GREEN,
        });
      } catch {
        // Badge is cosmetic; never let it break message handling.
      }
    }

    async function handleStatsDelta(msg) {
      if (!DAY_RE.test(String(msg.day)) || typeof msg.chatId !== 'string' || !msg.chatId || !msg.delta) {
        return { ok: false, error: 'invalid stats-delta' };
      }
      const title = typeof msg.title === 'string' ? msg.title.slice(0, 200) : undefined;
      await L.addDelta(local, msg.day, msg.chatId.slice(0, 200), msg.delta, { title, now: now() });
      await updateBadge();
      return { ok: true };
    }

    async function handleResponseComplete(msg, sender) {
      const settings = await L.readSettings(chrome.storage.sync);
      if (!settings.notifyOnComplete || msg.focused || !sender.tab) return { ok: true, notified: false };
      const title = (typeof msg.title === 'string' && msg.title) || 'Your chat';
      const took = Number.isFinite(msg.durationMs) ? ` (took ${L.formatDuration(msg.durationMs)})` : '';
      await chrome.notifications.create(`${NOTIFICATION_PREFIX}${sender.tab.id}:${sender.tab.windowId}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Claude finished replying',
        message: `“${title.slice(0, 120)}” is ready${took}.`,
        priority: 1,
      });
      return { ok: true, notified: true };
    }

    function onMessage(msg, sender, sendResponse) {
      if (sender && sender.id && sender.id !== chrome.runtime.id) return false;
      if (!msg || typeof msg !== 'object') return false;
      let work;
      if (msg.type === 'stats-delta') work = handleStatsDelta(msg);
      else if (msg.type === 'response-complete') work = handleResponseComplete(msg, sender || {});
      else return false;
      work.then(sendResponse, (err) => sendResponse({ ok: false, error: String(err && err.message) }));
      return true;
    }

    async function onNotificationClicked(id) {
      if (!id.startsWith(NOTIFICATION_PREFIX)) return;
      const [tabId, windowId] = id.slice(NOTIFICATION_PREFIX.length).split(':').map(Number);
      try {
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(windowId, { focused: true });
      } catch {
        // The tab may have been closed since.
      }
      await chrome.notifications.clear(id);
    }

    async function maintenance() {
      await L.pruneOldDays(local, KEEP_DAYS, new Date(now()));
      await updateBadge();
    }

    function init() {
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.notifications.onClicked.addListener(onNotificationClicked);
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === MAINTENANCE_ALARM) maintenance().catch(() => {});
      });
      chrome.alarms.create(MAINTENANCE_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[L.SETTINGS_KEY]) updateBadge();
      });
      updateBadge();
    }

    return { init, updateBadge, maintenance };
  }

  return { createBackground, badgeText, NOTIFICATION_PREFIX, MAINTENANCE_ALARM };
});
