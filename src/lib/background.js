/*
 * Service-worker logic: the single writer for stats (so tabs never race),
 * the toolbar badge, "Claude finished" and over-budget notifications.
 */
(function (root, factory) {
  const deps =
    typeof require === 'function'
      ? Object.assign({}, require('./format.js'), require('./chat-id.js'), require('./settings.js'), require('./stats.js'))
      : root.CCF;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (L) {
  'use strict';

  const NOTIFICATION_PREFIX = 'ccf-done:';
  const BUDGET_NOTIFICATION_PREFIX = 'ccf-budget:';
  const BUDGET_ALERTED_KEY = 'budgetAlertedDay';
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

  function createBackground({ chrome, now = Date.now, contentScripts }) {
    const local = chrome.storage.local;
    let budgetCheck = Promise.resolve();

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

    // One notification per day, the first time staring goes over the budget.
    function checkBudget(day, dayStats) {
      budgetCheck = budgetCheck.then(async () => {
        const settings = await L.readSettings(chrome.storage.sync);
        const budgetMs = settings.dailyStaringBudgetMin * 60000;
        const { staringMs } = L.summarizeDay(dayStats).totals;
        if (!settings.budgetAlert || budgetMs <= 0 || staringMs <= budgetMs || day !== L.dayKey(now())) return;
        if ((await local.get(BUDGET_ALERTED_KEY))[BUDGET_ALERTED_KEY] === day) return;
        await local.set({ [BUDGET_ALERTED_KEY]: day });
        await chrome.notifications.create(`${BUDGET_NOTIFICATION_PREFIX}${day}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'Daily staring budget used up',
          message: `You've spent ${L.formatDuration(staringMs)} staring at Claude chats today, over your ${L.formatDuration(
            budgetMs
          )} budget. Start a focused task, or step away for a bit.`,
          priority: 1,
        });
      });
      return budgetCheck.catch(() => {});
    }

    async function handleStatsDelta(msg) {
      if (!DAY_RE.test(String(msg.day)) || !L.isTrackableChatKey(msg.chatId) || !msg.delta || typeof msg.delta !== 'object') {
        return { ok: false, error: 'invalid stats-delta' };
      }
      const title = typeof msg.title === 'string' ? msg.title.slice(0, 200) : undefined;
      const dayStats = await L.addDelta(local, msg.day, msg.chatId, msg.delta, { title, now: now() });
      await checkBudget(msg.day, dayStats);
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
      else if (msg.type === 'reset-stats') {
        // Only the extension's own pages (options), never a claude.ai tab.
        const fromExtensionPage = Boolean(sender && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('')));
        work = fromExtensionPage
          ? L.clearAllStats(local, [BUDGET_ALERTED_KEY]).then(() => ({ ok: true }))
          : Promise.resolve({ ok: false, error: 'not allowed' });
      }
      else return false;
      work.then(sendResponse, (err) => sendResponse({ ok: false, error: String(err && err.message) }));
      return true;
    }

    async function onNotificationClicked(id) {
      if (id.startsWith(BUDGET_NOTIFICATION_PREFIX)) await chrome.notifications.clear(id);
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

    // Tabs that were already open when the extension was installed or updated
    // have no (working) content script until they reload; give them one now.
    async function injectIntoOpenTabs() {
      const files = contentScripts || chrome.runtime.getManifest().content_scripts[0].js;
      const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
      for (const tab of tabs) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files }).catch(() => {});
      }
    }

    async function ensureAlarm() {
      if (!(await chrome.alarms.get(MAINTENANCE_ALARM))) {
        await chrome.alarms.create(MAINTENANCE_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
      }
    }

    function init() {
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.notifications.onClicked.addListener(onNotificationClicked);
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === MAINTENANCE_ALARM) maintenance().catch(() => {});
      });
      chrome.runtime.onInstalled.addListener(({ reason }) => {
        if (reason === 'install' || reason === 'update') injectIntoOpenTabs().catch(() => {});
      });
      // Any change to settings or today's stats (new time, "Delete all stats") refreshes the badge.
      chrome.storage.onChanged.addListener((changes, area) => {
        if ((area === 'sync' && changes[L.SETTINGS_KEY]) || (area === 'local' && changes[L.statsKey(L.dayKey(now()))])) {
          updateBadge();
        }
      });
      ensureAlarm().catch(() => {});
      updateBadge();
    }

    return { init };
  }

  return { createBackground, badgeText, NOTIFICATION_PREFIX };
});
