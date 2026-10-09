const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBackground, badgeText, NOTIFICATION_PREFIX } = require('../../src/lib/background.js');
const { createFakeChrome, flush } = require('../helpers/fake-chrome.js');

const MIN = 60000;
const NOW = new Date(2026, 9, 9, 12).getTime();

function setup(opts = {}) {
  const fake = createFakeChrome(opts);
  const bg = createBackground({ chrome: fake.chrome, now: () => NOW });
  bg.init();
  return { fake, bg };
}

const sender = (overrides = {}) => ({ tab: { id: 42, windowId: 9, active: true, ...overrides } });

describe('badgeText', () => {
  it('formats staring minutes compactly', () => {
    assert.equal(badgeText(0), '');
    assert.equal(badgeText(59 * 1000), '');
    assert.equal(badgeText(5 * MIN), '5m');
    assert.equal(badgeText(90 * MIN), '1h');
    assert.equal(badgeText(20 * 60 * MIN), '20h');
  });
});

describe('background', () => {
  it('stores stats deltas and returns ok', async () => {
    const { fake } = setup();
    const res = await fake.chrome.runtime.sendMessage(
      { type: 'stats-delta', day: '2026-10-09', chatId: 'c', delta: { idleMs: 3 * MIN }, title: 'T' },
      sender()
    );
    assert.deepEqual(res, { ok: true });
    const data = await fake.chrome.storage.local.get('stats:2026-10-09');
    assert.equal(data['stats:2026-10-09'].chats.c.idleMs, 3 * MIN);
    assert.equal(data['stats:2026-10-09'].chats.c.title, 'T');
  });

  it('rejects malformed stats messages', async () => {
    const { fake } = setup();
    const res = await fake.chrome.runtime.sendMessage({ type: 'stats-delta', day: 'nope', chatId: 'c', delta: {} }, sender());
    assert.equal(res.ok, false);
  });

  it("updates the badge with today's staring time, green under budget", async () => {
    const { fake } = setup();
    await fake.chrome.runtime.sendMessage(
      { type: 'stats-delta', day: '2026-10-09', chatId: 'c', delta: { idleMs: 3 * MIN, waitingMs: 2 * MIN } },
      sender()
    );
    await flush();
    assert.equal(fake.badge.text, '5m');
    assert.equal(fake.badge.color, '#2e7d32');
  });

  it('turns the badge red when over the daily budget', async () => {
    const { fake } = setup({ sync: { settings: { dailyStaringBudgetMin: 4 } } });
    await fake.chrome.runtime.sendMessage(
      { type: 'stats-delta', day: '2026-10-09', chatId: 'c', delta: { idleMs: 5 * MIN } },
      sender()
    );
    await flush();
    assert.equal(fake.badge.color, '#c62828');
  });

  it('notifies when a response completes while you are away', async () => {
    const { fake } = setup();
    await fake.chrome.runtime.sendMessage(
      { type: 'response-complete', chatId: 'c', title: 'Refactor plan', focused: false, durationMs: 90000 },
      sender()
    );
    assert.equal(fake.notifications.length, 1);
    const n = fake.notifications[0];
    assert.equal(n.id, `${NOTIFICATION_PREFIX}42:9`);
    assert.match(n.title, /Claude/);
    assert.match(n.message, /Refactor plan/);
    assert.match(n.message, /1m 30s/);
    assert.equal(n.type, 'basic');
    assert.ok(n.iconUrl.startsWith('chrome-extension://'));
  });

  it('does not notify when you are looking at the tab', async () => {
    const { fake } = setup();
    await fake.chrome.runtime.sendMessage({ type: 'response-complete', chatId: 'c', title: 'x', focused: true }, sender());
    assert.equal(fake.notifications.length, 0);
  });

  it('does not notify when notifications are disabled', async () => {
    const { fake } = setup({ sync: { settings: { notifyOnComplete: false } } });
    await fake.chrome.runtime.sendMessage({ type: 'response-complete', chatId: 'c', title: 'x', focused: false }, sender());
    assert.equal(fake.notifications.length, 0);
  });

  it('focuses the chat tab when the notification is clicked', async () => {
    const { fake } = setup();
    for (const fn of fake.chrome.notifications.onClicked.fns) fn(`${NOTIFICATION_PREFIX}42:9`);
    await flush();
    assert.deepEqual(fake.tabUpdates, [{ id: 42, active: true }]);
    assert.deepEqual(fake.windowUpdates, [{ id: 9, focused: true }]);
    assert.deepEqual(fake.cleared, [`${NOTIFICATION_PREFIX}42:9`]);
  });

  it('ignores clicks on other notifications', async () => {
    const { fake } = setup();
    for (const fn of fake.chrome.notifications.onClicked.fns) fn('something-else');
    await flush();
    assert.deepEqual(fake.tabUpdates, []);
  });

  it('ignores unknown messages', async () => {
    const { fake } = setup();
    const res = await fake.chrome.runtime.sendMessage({ type: 'what' }, sender());
    assert.equal(res, undefined);
  });

  it('ignores messages from other extensions', async () => {
    const { fake } = setup();
    const res = await fake.chrome.runtime.sendMessage(
      { type: 'stats-delta', day: '2026-10-09', chatId: 'c', delta: { idleMs: 1 } },
      { id: 'other-extension', tab: { id: 1 } }
    );
    assert.equal(res, undefined);
    assert.deepEqual(await fake.chrome.storage.local.get(null), {});
  });

  it('schedules and runs pruning of old stats', async () => {
    const { fake } = setup({ local: { 'stats:2020-01-01': { chats: {} }, 'stats:2026-10-09': { chats: {} } } });
    await flush();
    assert.ok(fake.alarms.some((a) => a.name === 'ccf-maintenance'));
    for (const fn of fake.chrome.alarms.onAlarm.fns) fn({ name: 'ccf-maintenance' });
    await flush();
    await flush();
    const keys = Object.keys(await fake.chrome.storage.local.get(null));
    assert.deepEqual(keys, ['stats:2026-10-09']);
  });
});

describe('background review fixes', () => {
  it('does not reschedule the maintenance alarm every time the worker wakes', async () => {
    const fake = createFakeChrome();
    createBackground({ chrome: fake.chrome, now: () => NOW }).init();
    await flush();
    createBackground({ chrome: fake.chrome, now: () => NOW }).init();
    await flush();
    assert.equal(fake.alarms.filter((a) => a.name === 'ccf-maintenance').length, 1);
  });

  it('rejects chat ids that could clobber object prototypes', async () => {
    const { fake } = setup();
    const res = await fake.chrome.runtime.sendMessage(
      { type: 'stats-delta', day: '2026-10-09', chatId: '__proto__', delta: { idleMs: 1 } },
      sender()
    );
    assert.equal(res.ok, false);
  });

  it('alerts once per day when you go over the staring budget', async () => {
    const { fake } = setup({ sync: { settings: { dailyStaringBudgetMin: 5 } } });
    const send = (ms) =>
      fake.chrome.runtime.sendMessage({ type: 'stats-delta', day: '2026-10-09', chatId: 'c', delta: { idleMs: ms } }, sender());
    await send(4 * MIN);
    assert.equal(fake.notifications.length, 0);
    await send(2 * MIN);
    await send(2 * MIN);
    const alerts = fake.notifications.filter((n) => n.id.startsWith('ccf-budget'));
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].message, /5m 0s/);
  });

  it('does not alert about the budget when that is switched off', async () => {
    const { fake } = setup({ sync: { settings: { dailyStaringBudgetMin: 1, budgetAlert: false } } });
    await fake.chrome.runtime.sendMessage({ type: 'stats-delta', day: '2026-10-09', chatId: 'c', delta: { idleMs: 5 * MIN } }, sender());
    assert.equal(fake.notifications.length, 0);
  });

  it('re-injects the content scripts into open claude.ai tabs after install or update', async () => {
    const fake = createFakeChrome({ tabs: [{ id: 1, url: 'https://claude.ai/chat/x' }, { id: 2, url: 'https://claude.ai/new' }] });
    createBackground({ chrome: fake.chrome, now: () => NOW, contentScripts: ['a.js', 'b.js'] }).init();
    for (const fn of fake.chrome.runtime.onInstalled.fns) fn({ reason: 'update' });
    await flush();
    assert.deepEqual(fake.injected, [
      { tabId: 1, files: ['a.js', 'b.js'] },
      { tabId: 2, files: ['a.js', 'b.js'] },
    ]);
  });
});

describe('badge freshness', () => {
  it('clears the badge when stats are deleted from the options page', async () => {
    const { fake } = setup({ local: { 'stats:2026-10-09': { chats: { c: { idleMs: 9 * MIN } } } } });
    await flush();
    assert.equal(fake.badge.text, '9m');
    await fake.chrome.storage.local.remove(['stats:2026-10-09']);
    await flush();
    assert.equal(fake.badge.text, '');
  });
});

describe('reset-stats message', () => {
  it('deletes all stats and the budget alert marker from an extension page', async () => {
    const { fake } = setup({ local: { 'stats:2026-10-09': { chats: {} }, budgetAlertedDay: '2026-10-09', hueOverrides: {} } });
    const optionsTab = { id: 'fake-extension-id', url: 'chrome-extension://fake-extension-id/src/options/options.html', tab: { id: 5 } };
    const res = await fake.chrome.runtime.sendMessage({ type: 'reset-stats' }, optionsTab);
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(Object.keys(await fake.chrome.storage.local.get(null)), ['hueOverrides']);
  });

  it('is refused from content scripts', async () => {
    const { fake } = setup({ local: { 'stats:2026-10-09': { chats: {} } } });
    const res = await fake.chrome.runtime.sendMessage({ type: 'reset-stats' }, { ...sender(), url: 'https://claude.ai/chat/x' });
    assert.equal(res.ok, false);
    assert.ok('stats:2026-10-09' in (await fake.chrome.storage.local.get(null)));
  });
});
