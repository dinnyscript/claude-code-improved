/*
 * Ties everything together inside a claude.ai tab: colours the chat, tracks
 * how you spend your time, shows the widget and nudges, marks the tab title
 * while Claude is writing, and reports stats/completions to the background.
 */
(function (root, factory) {
  const deps =
    typeof require === 'function'
      ? Object.assign(
          {},
          require('./format.js'),
          require('./chat-id.js'),
          require('./color.js'),
          require('./time-tracker.js'),
          require('./settings.js'),
          require('./nudge.js'),
          require('./stats.js'),
          require('./generation.js'),
          require('./title.js'),
          require('./theme.js'),
          require('./widget.js'),
          require('./overrides.js')
        )
      : root.CCF;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (L) {
  'use strict';

  const OTHER_CHAT = '__other__';
  const OTHER_TITLE = 'Other claude.ai pages';
  const SNOOZE_MS = 10 * 60 * 1000;
  const INTERACTION_EVENTS = ['keydown', 'mousedown', 'pointerdown', 'wheel', 'touchstart'];

  function createController({ window, document, chrome, now = Date.now, autoTick = true, tickMs = 1000, flushEvery = 5 }) {
    let settings = L.normalizeSettings({});
    let overrides = {};
    let widget = null;
    let timer = null;
    let destroyed = false;

    const trackers = new Map();
    let chatKey = null;
    let lastTickAt = null;
    let lastInteractionAt = now();
    let ticksSinceFlush = 0;

    const nudger = L.createNudger({});
    let snoozedUntil = 0;
    const watcher = L.createCompletionWatcher();
    let titleStatus = 'none';

    let todayKey = L.dayKey(now());
    let todayBaseStaringMs = 0;
    let inFlightStaringMs = 0;
    let appliedColorKey = null;

    const cleanups = [];
    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      cleanups.push(() => target.removeEventListener(type, fn, opts));
    }

    function safeSend(message) {
      try {
        const result = chrome.runtime.sendMessage(message);
        return Promise.resolve(result).catch(() => undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    }

    function currentChatId() {
      return L.parseChatId(window.location.href);
    }

    function chatTitle() {
      if (!currentChatId()) return OTHER_TITLE;
      return L.stripStatus(document.title).replace(/\s+[-–—]\s+Claude\s*$/, '').trim();
    }

    function isLooking() {
      return document.visibilityState === 'visible' && document.hasFocus();
    }

    function trackerFor(key) {
      let t = trackers.get(key);
      if (!t) {
        t = L.createTracker({ idleAfterMs: settings.idleAfterSec * 1000 });
        trackers.set(key, t);
      }
      return t;
    }

    function signals() {
      return {
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        generating: L.isGenerating(document),
        lastInteractionAt,
      };
    }

    // --- colours -----------------------------------------------------------

    function applyColor() {
      const chatId = currentChatId();
      if (!settings.colorsEnabled || !chatId) {
        if (appliedColorKey !== null) L.applyChatColor(document, null);
        appliedColorKey = null;
        return null;
      }
      const dark = L.detectDarkMode(document, window);
      const palette = L.chatPalette(chatId, { dark, intensity: settings.colorIntensity, hueOverride: overrides[chatId] });
      const key = `${palette.background}|${palette.accent}|${dark}`;
      if (key !== appliedColorKey) {
        L.applyChatColor(document, { ...palette, dark });
        appliedColorKey = key;
      }
      return palette;
    }

    // --- title -------------------------------------------------------------

    function applyTitle() {
      const desired = settings.titleStatus ? L.decorateTitle(document.title, titleStatus) : L.stripStatus(document.title);
      if (document.title !== desired) document.title = desired;
    }

    // --- widget ------------------------------------------------------------

    function ensureWidget() {
      if (settings.widgetEnabled && !widget) {
        widget = L.createWidget(document, {
          onDismiss: () => {},
          onSnooze: () => {
            snoozedUntil = now() + SNOOZE_MS;
          },
          onToggle: (collapsed) => {
            chrome.storage.local.set({ widgetCollapsed: collapsed }).catch?.(() => {});
          },
        });
        chrome.storage.local
          .get('widgetCollapsed')
          .then((v) => widget?.setCollapsed(Boolean(v && v.widgetCollapsed)))
          .catch(() => {});
      } else if (!settings.widgetEnabled && widget) {
        widget.destroy();
        widget = null;
      }
    }

    function staringOf(t) {
      return (t.waitingMs || 0) + (t.idleMs || 0);
    }

    function renderWidget(palette) {
      if (!widget) return;
      const tracker = trackerFor(chatKey);
      let pendingStaring = 0;
      for (const t of trackers.values()) pendingStaring += staringOf(t.peek());
      widget.render({
        state: tracker.state() || 'active',
        staringStreakMs: tracker.staringStreakMs(),
        chat: tracker.totals(),
        todayStaringMs: todayBaseStaringMs + inFlightStaringMs + pendingStaring,
        budgetMs: settings.dailyStaringBudgetMin * 60 * 1000,
        accent: palette ? palette.accent : undefined,
      });
    }

    // --- stats -------------------------------------------------------------

    async function loadToday() {
      todayKey = L.dayKey(now());
      const key = L.statsKey(todayKey);
      try {
        const data = await chrome.storage.local.get(key);
        todayBaseStaringMs = L.summarizeDay(data[key]).totals.staringMs;
      } catch {
        todayBaseStaringMs = 0;
      }
      inFlightStaringMs = 0;
    }

    function flush() {
      const day = L.dayKey(now());
      const sends = [];
      for (const [key, tracker] of trackers) {
        const delta = tracker.drain();
        const total = delta.activeMs + delta.waitingMs + delta.idleMs + delta.hiddenMs;
        if (total <= 0) continue;
        inFlightStaringMs += staringOf(delta);
        const title = key === chatKey ? chatTitle() : undefined;
        sends.push(safeSend({ type: 'stats-delta', day, chatId: key, delta, title }));
      }
      ticksSinceFlush = 0;
      return Promise.all(sends).then(() => undefined);
    }

    // --- main loop ---------------------------------------------------------

    function tick() {
      if (destroyed) return;
      const t = now();
      const sig = signals();

      if (L.dayKey(t) !== todayKey) {
        flush();
        loadToday();
      }

      const key = currentChatId() || OTHER_CHAT;
      if (key !== chatKey) {
        if (chatKey !== null) flush();
        const next = trackerFor(key);
        if (lastTickAt !== null) next.update(lastTickAt, sig);
        chatKey = key;
        nudger.check(0);
        widget?.hideNudge();
      }

      const tracker = trackerFor(chatKey);
      tracker.update(t, sig);

      // Response lifecycle and tab title.
      const event = watcher.update(sig.generating, t);
      if (event === 'started') titleStatus = 'generating';
      if (event === 'completed') {
        const looking = isLooking();
        titleStatus = looking ? 'none' : 'done';
        safeSend({
          type: 'response-complete',
          chatId: chatKey,
          title: chatTitle(),
          focused: looking,
          durationMs: watcher.lastDurationMs(),
        });
      }
      if (titleStatus === 'done' && isLooking()) titleStatus = 'none';
      applyTitle();

      // Nudges.
      const streak = tracker.staringStreakMs();
      const level = nudger.check(streak);
      if (streak === 0) widget?.hideNudge();
      else if (level && t >= snoozedUntil && widget) {
        widget.showNudge(L.nudgeMessage({ level, state: tracker.state(), streakMs: streak }));
      }

      const palette = applyColor();
      renderWidget(palette);

      lastTickAt = t;
      ticksSinceFlush++;
      if (ticksSinceFlush >= flushEvery) flush();
    }

    function applySettings(next) {
      settings = L.normalizeSettings(next);
      for (const t of trackers.values()) t.setIdleAfterMs(settings.idleAfterSec * 1000);
      nudger.configure({ nudgeAfterMs: settings.nudgeAfterSec * 1000, enabled: settings.nudgeEnabled });
      ensureWidget();
      applyTitle();
      renderWidget(applyColor());
    }

    function onStorageChanged(changes, area) {
      if (destroyed) return;
      if (area === 'sync' && changes[L.SETTINGS_KEY]) applySettings(changes[L.SETTINGS_KEY].newValue);
      if (area === 'local' && changes[L.OVERRIDES_KEY]) {
        overrides = changes[L.OVERRIDES_KEY].newValue || {};
        renderWidget(applyColor());
      }
      const statsChange = area === 'local' && changes[L.statsKey(todayKey)];
      if (statsChange) {
        todayBaseStaringMs = L.summarizeDay(statsChange.newValue).totals.staringMs;
        inFlightStaringMs = 0;
      }
    }

    async function start() {
      const [loaded, local] = await Promise.all([
        L.readSettings(chrome.storage.sync).catch(() => L.normalizeSettings({})),
        L.getHueOverrides(chrome.storage.local).catch(() => ({})),
      ]);
      if (destroyed) return;
      overrides = local;
      await loadToday();
      applySettings(loaded);

      const markActive = () => {
        lastInteractionAt = now();
      };
      for (const type of INTERACTION_EVENTS) on(window, type, markActive, { capture: true, passive: true });
      on(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          tick();
          flush();
        }
      });
      on(window, 'pagehide', () => {
        tick();
        flush();
      });
      chrome.storage.onChanged.addListener(onStorageChanged);
      cleanups.push(() => chrome.storage.onChanged.removeListener(onStorageChanged));

      tick();
      if (autoTick) timer = window.setInterval(tick, tickMs);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer) window.clearInterval(timer);
      cleanups.forEach((fn) => fn());
      widget?.destroy();
      widget = null;
      L.applyChatColor(document, null);
      document.title = L.stripStatus(document.title);
    }

    return {
      start,
      tick,
      flush,
      destroy,
      tracker: () => trackerFor(chatKey),
      widget: () => widget,
      settings: () => settings,
    };
  }

  return { createController, OTHER_CHAT, OTHER_TITLE };
});
