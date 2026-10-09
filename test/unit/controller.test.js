const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createController } = require('../../src/lib/controller.js');
const { createFakeChrome, flush } = require('../helpers/fake-chrome.js');
const { TINT_ID, STYLE_ID } = require('../../src/lib/theme.js');
const { HOST_ID } = require('../../src/lib/widget.js');
const { chatPalette } = require('../../src/lib/color.js');
const { STATUS_PREFIX } = require('../../src/lib/title.js');

const S = 1000;

function setup({ url = 'https://claude.ai/chat/chat-a', sync = {}, local = {}, start = 1_000_000 } = {}) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat A - Claude</title></head><body><main></main></body></html>', { url });
  const { window } = dom;
  const { document } = window;
  let visible = true;
  let focused = true;
  Object.defineProperty(document, 'visibilityState', { get: () => (visible ? 'visible' : 'hidden'), configurable: true });
  document.hasFocus = () => focused;
  const fake = createFakeChrome({ sync, local });
  let t = start;
  const ctl = createController({ window, document, chrome: fake.chrome, now: () => t, autoTick: false });
  const env = {
    window,
    document,
    fake,
    ctl,
    advance(ms, step = S) {
      for (let i = 0; i < ms; i += step) {
        t += Math.min(step, ms - i);
        ctl.tick();
      }
    },
    setVisible(v) {
      visible = v;
      document.dispatchEvent(new window.Event('visibilitychange'));
    },
    setFocused(f) {
      focused = f;
    },
    shadow: () => document.getElementById(HOST_ID)?.shadowRoot,
    css: () => document.getElementById(STYLE_ID)?.textContent || '',
    stream(on) {
      const existing = document.querySelector('[data-is-streaming]');
      if (on && !existing) {
        const el = document.createElement('div');
        el.setAttribute('data-is-streaming', 'true');
        document.querySelector('main').append(el);
      } else if (!on && existing) {
        existing.setAttribute('data-is-streaming', 'false');
      }
    },
    deltas: () => fake.sent.filter((m) => m.type === 'stats-delta'),
    now: () => t,
  };
  return env;
}

describe('controller', () => {
  let env;
  afterEach(() => env?.ctl.destroy());

  describe('chat colours', () => {
    it('tints the page with the chat colour', async () => {
      env = setup();
      await env.ctl.start();
      assert.ok(env.document.getElementById(TINT_ID));
      const { background } = chatPalette('chat-a', { dark: false, intensity: 0.6 });
      assert.ok(env.css().includes(background), env.css());
    });

    it('switches colour on in-app navigation to another chat', async () => {
      env = setup();
      await env.ctl.start();
      const before = env.css();
      env.window.history.pushState({}, '', '/chat/chat-b');
      env.advance(S);
      assert.notEqual(env.css(), before);
      assert.ok(env.css().includes(chatPalette('chat-b', { intensity: 0.6 }).background));
    });

    it('does not tint pages that are not a chat', async () => {
      env = setup({ url: 'https://claude.ai/new' });
      await env.ctl.start();
      assert.equal(env.document.getElementById(TINT_ID), null);
    });

    it('respects colorsEnabled=false and reacts to settings changes', async () => {
      env = setup({ sync: { settings: { colorsEnabled: false } } });
      await env.ctl.start();
      assert.equal(env.document.getElementById(TINT_ID), null);
      await env.fake.chrome.storage.sync.set({ settings: { colorsEnabled: true } });
      await flush();
      assert.ok(env.document.getElementById(TINT_ID));
    });

    it('uses a stored hue override and picks up new ones live', async () => {
      env = setup({ local: { hueOverrides: { 'chat-a': 123 } } });
      await env.ctl.start();
      assert.ok(env.css().includes('hsl(123 '));
      await env.fake.chrome.storage.local.set({ hueOverrides: { 'chat-a': 222 } });
      await flush();
      assert.ok(env.css().includes('hsl(222 '));
    });
  });

  describe('time tracking', () => {
    it('counts idle staring and reports it in the widget', async () => {
      env = setup();
      await env.ctl.start();
      env.advance(40 * S);
      const root = env.shadow();
      assert.match(root.querySelector('.ccf-state').textContent, /idle/i);
      assert.equal(env.ctl.tracker().totals().idleMs, 10 * S);
      assert.equal(env.ctl.tracker().totals().activeMs, 30 * S);
    });

    it('treats keyboard and wheel input as activity', async () => {
      env = setup();
      await env.ctl.start();
      for (let i = 0; i < 4; i++) {
        env.advance(20 * S);
        env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'a' }));
      }
      env.window.dispatchEvent(new env.window.WheelEvent('wheel'));
      assert.equal(env.ctl.tracker().totals().idleMs, 0);
      assert.equal(env.ctl.tracker().totals().activeMs, 80 * S);
    });

    it('counts watching Claude generate as waiting', async () => {
      env = setup();
      await env.ctl.start();
      env.stream(true);
      env.advance(45 * S);
      assert.equal(env.ctl.tracker().totals().waitingMs, 15 * S);
    });

    it('does not count time while the tab is hidden as staring', async () => {
      env = setup();
      await env.ctl.start();
      env.setVisible(false);
      env.advance(60 * S);
      const totals = env.ctl.tracker().totals();
      assert.equal(totals.idleMs, 0);
      assert.equal(totals.hiddenMs, 60 * S);
    });

    it('flushes stats deltas to the background periodically', async () => {
      env = setup();
      await env.ctl.start();
      env.advance(40 * S);
      await env.ctl.flush();
      const deltas = env.deltas();
      assert.ok(deltas.length >= 2, 'expected periodic and explicit flushes');
      const sum = (f) => deltas.reduce((acc, d) => acc + d.delta[f], 0);
      assert.ok(deltas.every((d) => d.chatId === 'chat-a' && d.title === 'Chat A'));
      assert.ok(deltas.every((d) => /^\d{4}-\d\d-\d\d$/.test(d.day)));
      assert.equal(sum('idleMs'), 10 * S);
      assert.equal(sum('activeMs'), 30 * S);
    });

    it('flushes automatically every 5 seconds so little is lost if the tab closes', async () => {
      env = setup();
      await env.ctl.start();
      env.advance(16 * S);
      await flush();
      assert.equal(env.deltas().length, 3);
    });

    it('flushes when the tab is hidden', async () => {
      env = setup();
      await env.ctl.start();
      env.advance(3 * S);
      env.setVisible(false);
      await flush();
      assert.equal(env.deltas().length, 1);
      assert.equal(env.deltas()[0].delta.activeMs, 3 * S);
    });

    it('does not send empty deltas', async () => {
      env = setup();
      await env.ctl.start();
      await env.ctl.flush();
      assert.equal(env.deltas().length, 0);
    });

    it('attributes time to the right chat across navigation', async () => {
      env = setup();
      await env.ctl.start();
      env.advance(10 * S);
      env.window.history.pushState({}, '', '/chat/chat-b');
      env.advance(5 * S);
      await env.ctl.flush();
      await flush();
      const byChat = {};
      for (const d of env.deltas()) byChat[d.chatId] = (byChat[d.chatId] || 0) + d.delta.activeMs;
      assert.equal(byChat['chat-a'], 10 * S);
      assert.equal(byChat['chat-b'], 5 * S);
    });

    it('records non-chat pages under a shared bucket', async () => {
      env = setup({ url: 'https://claude.ai/new' });
      await env.ctl.start();
      env.advance(5 * S);
      await env.ctl.flush();
      assert.equal(env.deltas()[0].chatId, '__other__');
    });

    it("shows today's staring total from storage plus the live session", async () => {
      const { dayKey } = require('../../src/lib/format.js');
      env = setup();
      const key = `stats:${dayKey(env.now())}`;
      await env.fake.chrome.storage.local.set({ [key]: { chats: { x: { idleMs: 5 * 60 * S } } } });
      await env.ctl.start();
      env.advance(40 * S);
      assert.match(env.shadow().querySelector('.ccf-today').textContent, /5m 10s/);
    });

    it('hides the widget when widgetEnabled is false', async () => {
      env = setup({ sync: { settings: { widgetEnabled: false } } });
      await env.ctl.start();
      assert.equal(env.document.getElementById(HOST_ID), null);
    });
  });

  describe('more lifecycle', () => {
    it('starts a new day at midnight', async () => {
      const { dayKey } = require('../../src/lib/format.js');
      const beforeMidnight = new Date(2026, 9, 9, 23, 59, 50).getTime();
      env = setup({ start: beforeMidnight, local: { 'stats:2026-10-09': { chats: { x: { idleMs: 60 * S } } } } });
      await env.ctl.start();
      assert.match(env.shadow().querySelector('.ccf-today').textContent, /1m 0s/);
      env.advance(20 * S);
      await env.ctl.flush();
      await flush();
      const days = new Set(env.deltas().map((d) => d.day));
      assert.deepEqual([...days].sort(), ['2026-10-09', '2026-10-10']);
      assert.equal(dayKey(env.now()), '2026-10-10');
      assert.match(env.shadow().querySelector('.ccf-today').textContent, /Today staring: 0s/);
    });

    it("updates today's total when another tab records stats", async () => {
      const { dayKey } = require('../../src/lib/format.js');
      env = setup();
      await env.ctl.start();
      await env.fake.chrome.storage.local.set({ [`stats:${dayKey(env.now())}`]: { chats: { z: { waitingMs: 120 * S } } } });
      await flush();
      env.advance(S);
      assert.match(env.shadow().querySelector('.ccf-today').textContent, /2m 0s/);
    });

    it('remembers whether the widget is collapsed', async () => {
      env = setup();
      await env.ctl.start();
      env.shadow().querySelector('.ccf-toggle').click();
      await flush();
      assert.deepEqual(await env.fake.chrome.storage.local.get('widgetCollapsed'), { widgetCollapsed: true });
      env.ctl.destroy();
      env = setup({ local: { widgetCollapsed: true } });
      await env.ctl.start();
      await flush();
      assert.equal(env.shadow().querySelector('.ccf-widget').classList.contains('collapsed'), true);
    });

    it('removes the widget when it is switched off in settings', async () => {
      env = setup();
      await env.ctl.start();
      await env.fake.chrome.storage.sync.set({ settings: { widgetEnabled: false } });
      await flush();
      assert.equal(env.document.getElementById(HOST_ID), null);
    });

    it('flushes on pagehide', async () => {
      env = setup();
      await env.ctl.start();
      env.advance(2 * S);
      env.window.dispatchEvent(new env.window.Event('pagehide'));
      await flush();
      assert.equal(env.deltas().length, 1);
    });

    it('re-colours when claude.ai switches to dark mode', async () => {
      env = setup();
      await env.ctl.start();
      assert.match(env.css(), /multiply/);
      env.document.documentElement.setAttribute('data-mode', 'dark');
      env.advance(S);
      assert.match(env.css(), /screen/);
    });
  });

  describe('nudges', () => {
    it('nudges after the configured staring time and can be dismissed', async () => {
      env = setup({ sync: { settings: { idleAfterSec: 10, nudgeAfterSec: 30 } } });
      await env.ctl.start();
      env.advance(39 * S);
      assert.equal(env.ctl.widget().isNudgeVisible(), false);
      env.advance(2 * S);
      assert.equal(env.ctl.widget().isNudgeVisible(), true);
      assert.match(env.shadow().querySelector('.ccf-nudge-title').textContent, /staring/i);
      env.shadow().querySelector('.ccf-dismiss').click();
      assert.equal(env.ctl.widget().isNudgeVisible(), false);
    });

    it('hides the nudge once you become active again', async () => {
      env = setup({ sync: { settings: { idleAfterSec: 10, nudgeAfterSec: 30 } } });
      await env.ctl.start();
      env.advance(41 * S);
      env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'a' }));
      env.advance(S);
      assert.equal(env.ctl.widget().isNudgeVisible(), false);
    });

    it('snooze suppresses nudges for ten minutes', async () => {
      env = setup({ sync: { settings: { idleAfterSec: 10, nudgeAfterSec: 30 } } });
      await env.ctl.start();
      env.advance(41 * S);
      env.shadow().querySelector('.ccf-snooze').click();
      env.advance(5 * 60 * S);
      assert.equal(env.ctl.widget().isNudgeVisible(), false);
      env.advance(6 * 60 * S);
      assert.equal(env.ctl.widget().isNudgeVisible(), true);
    });

    it('does not nudge when disabled', async () => {
      env = setup({ sync: { settings: { idleAfterSec: 10, nudgeAfterSec: 30, nudgeEnabled: false } } });
      await env.ctl.start();
      env.advance(120 * S);
      assert.equal(env.ctl.widget().isNudgeVisible(), false);
    });
  });

  describe('response completion', () => {
    it('marks the tab title while generating', async () => {
      env = setup();
      await env.ctl.start();
      env.stream(true);
      env.advance(S);
      assert.equal(env.document.title, `${STATUS_PREFIX.generating}Chat A - Claude`);
    });

    it('re-applies the marker if the page rewrites the title', async () => {
      env = setup();
      await env.ctl.start();
      env.stream(true);
      env.advance(S);
      env.document.title = 'Renamed - Claude';
      env.advance(S);
      assert.equal(env.document.title, `${STATUS_PREFIX.generating}Renamed - Claude`);
    });

    it('notifies the background and marks done when you are away', async () => {
      env = setup();
      await env.ctl.start();
      env.stream(true);
      env.advance(5 * S);
      env.setFocused(false);
      env.stream(false);
      env.advance(3 * S);
      const msg = env.fake.sent.find((m) => m.type === 'response-complete');
      assert.ok(msg, 'expected response-complete message');
      assert.equal(msg.chatId, 'chat-a');
      assert.equal(msg.focused, false);
      assert.equal(msg.title, 'Chat A');
      assert.ok(msg.durationMs >= 5 * S);
      assert.equal(env.document.title, `${STATUS_PREFIX.done}Chat A - Claude`);
    });

    it('clears the done marker once you come back', async () => {
      env = setup();
      await env.ctl.start();
      env.stream(true);
      env.advance(2 * S);
      env.setFocused(false);
      env.stream(false);
      env.advance(3 * S);
      env.setFocused(true);
      env.advance(S);
      assert.equal(env.document.title, 'Chat A - Claude');
    });

    it('leaves the title alone when titleStatus is off', async () => {
      env = setup({ sync: { settings: { titleStatus: false } } });
      await env.ctl.start();
      env.stream(true);
      env.advance(S);
      assert.equal(env.document.title, 'Chat A - Claude');
    });
  });

  describe('lifecycle', () => {
    it('destroy() removes everything it added and stops ticking', async () => {
      env = setup();
      await env.ctl.start();
      env.stream(true);
      env.advance(S);
      env.ctl.destroy();
      assert.equal(env.document.getElementById(HOST_ID), null);
      assert.equal(env.document.getElementById(TINT_ID), null);
      assert.equal(env.document.title, 'Chat A - Claude');
      env = null;
    });

    it('survives the extension context being invalidated', async () => {
      env = setup();
      await env.ctl.start();
      env.fake.chrome.runtime.sendMessage = () => {
        throw new Error('Extension context invalidated.');
      };
      env.advance(5 * S);
      await assert.doesNotReject(() => env.ctl.flush());
    });
  });
});
