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

  const SNOOZE_MS = 10 * 60 * 1000;
  const INTERACTION_EVENTS = ['keydown', 'mousedown', 'pointerdown', 'wheel', 'touchstart'];
  // claude.ai updates the URL before the title when you switch chats; until the
  // title changes (or this long passes) it still belongs to the previous chat.
  const TITLE_SETTLE_MS = 3000;
  // Reading allowance after a reply arrives: 240 words per minute, at most 5 minutes.
  const WORDS_PER_SECOND = 4;
  const MAX_READING_MS = 5 * 60 * 1000;

  function readingTimeMs(text) {
    const words = String(text || '').split(/\s+/).filter(Boolean).length;
    return Math.min(MAX_READING_MS, (words / WORDS_PER_SECOND) * 1000);
  }

  function createController({
    window,
    document,
    chrome,
    now = Date.now,
    autoTick = true,
    tickMs = 1000,
    flushEveryMs = 5000,
    settleMs = 1500,
  }) {
    let settings = L.normalizeSettings({});
    let overrides = {};
    let widget = null;
    let destroyed = false;
    const timers = new Set();

    const trackers = new Map();
    const titles = new Map();
    let chatKey = null;
    let navTitle = null;
    let navAt = 0;
    let lastTickAt = null;
    let lastFlushAt = now();
    let lastInteractionAt = now();
    let readingUntil = null;
    let pendingReadingMs = 0;

    const nudger = L.createNudger({});
    let snoozedUntil = 0;
    let watcher = L.createCompletionWatcher({ settleMs });
    let lastGenerating = false;
    let titleStatus = 'none';

    let todayKey = L.dayKey(now());
    let todayBaseStaringMs = 0;
    let inFlightStaringMs = 0;
    let appliedColorKey = null;
    let faviconApplied = false;

    const cleanups = [];
    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      cleanups.push(() => target.removeEventListener(type, fn, opts));
    }

    function later(fn, ms) {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    }

    function contextAlive() {
      try {
        return Boolean(chrome.runtime && chrome.runtime.id);
      } catch {
        return false;
      }
    }

    function safeSend(message) {
      try {
        const result = chrome.runtime.sendMessage(message);
        return Promise.resolve(result).catch(() => undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    }

    function pageTitle() {
      const title = L.stripStatus(document.title)
        .replace(/\s+[-–—]\s+Claude\s*$/, '')
        .trim();
      return title === 'Claude' ? '' : title;
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

    function signals(t, generating) {
      const visible = document.visibilityState === 'visible';
      const focused = document.hasFocus();
      // Keystrokes inside an artifact iframe never reach this document, so
      // treat having focus in one as working with it.
      if (visible && focused && document.activeElement && document.activeElement.tagName === 'IFRAME') {
        lastInteractionAt = t;
      }
      return { visible, focused, generating, lastInteractionAt, readingUntil };
    }

    // --- colours -----------------------------------------------------------

    function applyColor(chatId, dark) {
      if (!settings.colorsEnabled || !chatId) {
        if (appliedColorKey !== null) L.applyChatColor(document, null);
        appliedColorKey = null;
        if (faviconApplied) L.applyFavicon(document, null);
        faviconApplied = false;
        return null;
      }
      const palette = L.chatPalette(chatId, { dark, intensity: settings.colorIntensity, hueOverride: overrides[chatId] });
      const key = `${palette.background}|${palette.accent}|${dark}`;
      if (key !== appliedColorKey) {
        L.applyChatColor(document, { ...palette, dark });
        appliedColorKey = key;
      }
      if (settings.colorFavicon) {
        L.applyFavicon(document, palette.accent);
        faviconApplied = true;
      } else if (faviconApplied) {
        L.applyFavicon(document, null);
        faviconApplied = false;
      }
      return palette;
    }

    function refreshAppearance() {
      const dark = L.detectDarkMode(document, window);
      renderWidget(applyColor(L.parseChatId(window.location.href), dark), dark);
    }

    // --- title -------------------------------------------------------------

    function applyTitle() {
      const desired = settings.titleStatus ? L.decorateTitle(document.title, titleStatus) : L.stripStatus(document.title);
      if (document.title !== desired) document.title = desired;
    }

    function rememberTitle(t) {
      if (chatKey === L.OTHER_CHAT) return;
      const title = pageTitle();
      if (title && (navTitle === null || title !== navTitle || t - navAt >= TITLE_SETTLE_MS)) titles.set(chatKey, title);
    }

    // --- widget ------------------------------------------------------------

    function persist(values) {
      Promise.resolve()
        .then(() => chrome.storage.local.set(values))
        .catch(() => {});
    }

    function ensureWidget() {
      if (settings.widgetEnabled && !widget) {
        widget = L.createWidget(document, {
          onSnooze: () => {
            snoozedUntil = now() + SNOOZE_MS;
          },
          onToggle: (collapsed) => persist({ widgetCollapsed: collapsed }),
          onMove: (position) => persist({ widgetPosition: position }),
        });
        chrome.storage.local
          .get(['widgetCollapsed', 'widgetPosition'])
          .then((v) => {
            if (!widget) return;
            widget.setCollapsed(Boolean(v.widgetCollapsed));
            if (v.widgetPosition) widget.setPosition(v.widgetPosition);
          })
          .catch(() => {});
      } else if (!settings.widgetEnabled && widget) {
        widget.destroy();
        widget = null;
      }
    }

    function staringOf(t) {
      return (t.waitingMs || 0) + (t.idleMs || 0);
    }

    function renderWidget(palette, dark) {
      if (!widget || chatKey === null) return;
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
        dark,
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

    function flush(day = L.dayKey(now())) {
      const sends = [];
      for (const [key, tracker] of trackers) {
        const delta = tracker.drain();
        const total = delta.activeMs + delta.waitingMs + delta.idleMs + delta.hiddenMs;
        if (total <= 0) continue;
        inFlightStaringMs += staringOf(delta);
        sends.push(safeSend({ type: 'stats-delta', day, chatId: key, delta, title: titles.get(key) }));
      }
      lastFlushAt = now();
      return Promise.all(sends).then(() => undefined);
    }

    // --- main loop ---------------------------------------------------------

    function switchChat(key, t, sig) {
      if (chatKey !== null) flush();
      const next = trackerFor(key);
      if (lastTickAt !== null) next.update(lastTickAt, sig);
      navTitle = chatKey === null ? null : pageTitle();
      navAt = t;
      chatKey = key;
      // A response still streaming in the chat we left can't be followed any more.
      watcher = L.createCompletionWatcher({ settleMs });
      titleStatus = 'none';
      readingUntil = null;
      pendingReadingMs = 0;
      nudger.check(0);
      widget?.hideNudge();
    }

    function onResponseEvent(event, t) {
      if (event === 'started') titleStatus = 'generating';
      if (event !== 'completed') return;
      const looking = isLooking();
      titleStatus = looking ? 'none' : 'done';
      const replies = document.querySelectorAll('[data-is-streaming]');
      const readingMs = readingTimeMs(replies.length ? replies[replies.length - 1].textContent : '');
      if (looking) readingUntil = t + readingMs;
      else pendingReadingMs = readingMs;
      safeSend({
        type: 'response-complete',
        chatId: chatKey,
        title: titles.get(chatKey),
        focused: looking,
        durationMs: watcher.lastDurationMs(),
      });
    }

    function tick() {
      if (destroyed) return;
      if (!contextAlive()) {
        destroy();
        return;
      }
      const t = now();
      const generating = L.isGenerating(document);
      lastGenerating = generating;

      if (L.dayKey(t) !== todayKey) {
        flush(todayKey); // time before this tick belongs to the day that just ended
        loadToday().then(refreshAppearance);
      }

      const key = L.parseChatId(window.location.href) || L.OTHER_CHAT;
      if (key !== chatKey) switchChat(key, t, signals(t, generating));
      rememberTitle(t);

      onResponseEvent(watcher.update(generating, t), t);
      if (pendingReadingMs && isLooking()) {
        readingUntil = t + pendingReadingMs;
        pendingReadingMs = 0;
      }
      const tracker = trackerFor(chatKey);
      tracker.update(t, signals(t, generating));

      if (titleStatus === 'done' && isLooking()) titleStatus = 'none';
      applyTitle();
      // Background tabs only tick about once a minute; make sure a finished
      // response is noticed (and notified) promptly anyway.
      if (watcher.isRunning() && !generating) later(tick, settleMs + 25);

      const streak = tracker.staringStreakMs();
      const level = nudger.check(streak);
      if (streak === 0) widget?.hideNudge();
      else if (level && t >= snoozedUntil && widget) {
        widget.showNudge(L.nudgeMessage({ level, state: tracker.state(), streakMs: streak }));
      }

      refreshAppearance();

      lastTickAt = t;
      if (t - lastFlushAt >= flushEveryMs) flush();
    }

    function applySettings(next) {
      settings = L.normalizeSettings(next);
      for (const t of trackers.values()) t.setIdleAfterMs(settings.idleAfterSec * 1000);
      nudger.configure({ nudgeAfterMs: settings.nudgeAfterSec * 1000, enabled: settings.nudgeEnabled });
      ensureWidget();
      applyTitle();
      refreshAppearance();
    }

    function onStorageChanged(changes, area) {
      if (destroyed) return;
      if (area === 'sync' && changes[L.SETTINGS_KEY]) applySettings(changes[L.SETTINGS_KEY].newValue);
      if (area === 'local' && changes[L.OVERRIDES_KEY]) {
        overrides = changes[L.OVERRIDES_KEY].newValue || {};
        refreshAppearance();
      }
      const statsChange = area === 'local' && changes[L.statsKey(todayKey)];
      if (statsChange) {
        todayBaseStaringMs = L.summarizeDay(statsChange.newValue).totals.staringMs;
        inFlightStaringMs = 0;
      }
    }

    // Streaming starts and stops are seen straight away rather than on the
    // next (possibly heavily throttled) timer tick.
    function watchStreaming() {
      if (typeof window.MutationObserver !== 'function') return;
      let scheduled = false;
      const observer = new window.MutationObserver(() => {
        if (scheduled || L.isGenerating(document) === lastGenerating) return;
        scheduled = true;
        later(() => {
          scheduled = false;
          tick();
        }, 0);
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-is-streaming', 'aria-label'],
      });
      cleanups.push(() => observer.disconnect());
    }

    async function start() {
      const [loaded, local] = await Promise.all([
        L.readSettings(chrome.storage.sync).catch(() => L.normalizeSettings({})),
        L.getHueOverrides(chrome.storage.local).catch(() => ({})),
      ]);
      if (destroyed) return;
      overrides = local;
      await loadToday();
      lastFlushAt = now();
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
      watchStreaming();

      tick();
      if (autoTick) {
        const id = window.setInterval(tick, tickMs);
        cleanups.push(() => window.clearInterval(id));
      }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          // chrome.* may already be gone when the extension was unloaded.
        }
      });
      widget?.destroy();
      widget = null;
      L.applyChatColor(document, null);
      L.applyFavicon(document, null);
      document.title = L.stripStatus(document.title);
    }

    return {
      start,
      tick,
      flush,
      destroy,
      tracker: () => trackerFor(chatKey),
      widget: () => widget,
    };
  }

  return { createController, readingTimeMs };
});
