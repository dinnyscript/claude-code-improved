const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { buildPopupModel, renderPopup } = require('../../src/lib/popup-view.js');
const { createFakeChrome } = require('../helpers/fake-chrome.js');

const MIN = 60000;
const NOW = new Date(2026, 9, 9, 12).getTime();

async function model({ local = {}, sync = {}, activeUrl = 'https://claude.ai/chat/chat-a' } = {}) {
  const { chrome } = createFakeChrome({ local, sync });
  return buildPopupModel({ local: chrome.storage.local, sync: chrome.storage.sync, activeUrl, now: NOW });
}

function render(m, handlers = {}) {
  const { document } = new JSDOM('<!doctype html><body><div id="app"></div></body>').window;
  renderPopup(document.getElementById('app'), m, handlers);
  return { document, $: (s) => document.querySelector(s), $$: (s) => [...document.querySelectorAll(s)] };
}

const todayStats = {
  'stats:2026-10-09': {
    chats: {
      'chat-a': { activeMs: 10 * MIN, idleMs: 1 * MIN, waitingMs: 0, hiddenMs: 0, title: 'Alpha' },
      'chat-b': { activeMs: 1 * MIN, idleMs: 5 * MIN, waitingMs: 5 * MIN, hiddenMs: 0, title: 'Beta' },
      __other__: { activeMs: 0, idleMs: 1 * MIN, waitingMs: 0, hiddenMs: 0 },
    },
  },
  'stats:2026-10-08': { chats: { 'chat-a': { activeMs: 20 * MIN, idleMs: 0, waitingMs: 0, hiddenMs: 0 } } },
};

describe('buildPopupModel', () => {
  it("summarises today's and this week's stats", async () => {
    const m = await model({ local: todayStats });
    assert.equal(m.today.totals.activeMs, 11 * MIN);
    assert.equal(m.today.totals.staringMs, 12 * MIN);
    assert.equal(m.week.length, 7);
    assert.equal(m.week[5].totals.activeMs, 20 * MIN);
    assert.equal(m.budgetMs, 30 * MIN);
  });

  it('describes the current chat colour', async () => {
    const m = await model({ local: { hueOverrides: { 'chat-a': 77 } } });
    assert.deepEqual(m.currentChat, { chatId: 'chat-a', hue: 77, overridden: true });
  });

  it('has no current chat off claude.ai chats', async () => {
    const m = await model({ activeUrl: 'https://example.com' });
    assert.equal(m.currentChat, null);
  });
});

describe('renderPopup', () => {
  it('shows the focus score and totals', async () => {
    const { $ } = render(await model({ local: todayStats }));
    assert.equal($('#focus-score').textContent, '48%');
    assert.equal($('#today-active').textContent, '11m 0s');
    assert.equal($('#today-staring').textContent, '12m 0s');
  });

  it('shows a dash when there is no data yet', async () => {
    const { $ } = render(await model());
    assert.equal($('#focus-score').textContent, '—');
  });

  it('shows staring against the daily budget', async () => {
    const { $ } = render(await model({ local: todayStats }));
    assert.equal($('#budget-fill').style.width, '40%');
    assert.equal($('#budget').classList.contains('over'), false);
  });

  it('caps the budget bar and flags overruns', async () => {
    const { $ } = render(await model({ local: todayStats, sync: { settings: { dailyStaringBudgetMin: 6 } } }));
    assert.equal($('#budget-fill').style.width, '100%');
    assert.equal($('#budget').classList.contains('over'), true);
  });

  it('renders seven week bars', async () => {
    const { $$ } = render(await model({ local: todayStats }));
    const bars = $$('.week-bar');
    assert.equal(bars.length, 7);
    assert.match(bars[6].getAttribute('title'), /2026-10-09/);
  });

  it('lists chats ranked by staring time and opens them on click', async () => {
    const opened = [];
    const { $$ } = render(await model({ local: todayStats }), { onOpenChat: (id) => opened.push(id) });
    const rows = $$('.chat-row');
    assert.deepEqual(rows.map((r) => r.querySelector('.chat-title').textContent), ['Beta', 'Alpha', 'Other claude.ai pages']);
    rows[0].click();
    rows[2].click();
    assert.deepEqual(opened, ['chat-b']);
  });

  it('escapes chat titles', async () => {
    const local = { 'stats:2026-10-09': { chats: { x: { activeMs: MIN, title: '<img src=x onerror=alert(1)>' } } } };
    const { $ } = render(await model({ local }));
    assert.equal($('.chat-row img'), null);
  });

  it('lets you change and reset the current chat colour', async () => {
    const changes = [];
    const resets = [];
    const { $, document } = render(await model({ local: { hueOverrides: { 'chat-a': 77 } } }), {
      onHueChange: (id, hue) => changes.push([id, hue]),
      onResetHue: (id) => resets.push(id),
    });
    const slider = $('#hue-slider');
    assert.equal(slider.value, '77');
    slider.value = '150';
    slider.dispatchEvent(new document.defaultView.Event('input'));
    assert.deepEqual(changes, [['chat-a', 150]]);
    assert.equal($('#hue-reset').disabled, false);
    $('#hue-reset').click();
    assert.deepEqual(resets, ['chat-a']);
  });

  it('disables reset when the colour is automatic', async () => {
    const { $ } = render(await model());
    assert.equal($('#hue-reset').disabled, true);
  });

  it('explains colour controls are unavailable off a chat', async () => {
    const { $ } = render(await model({ activeUrl: 'https://claude.ai/new' }));
    assert.equal($('#hue-slider'), null);
    assert.match($('#current-chat').textContent, /open a claude chat/i);
  });

  it('opens the options page', async () => {
    let opened = 0;
    const { $ } = render(await model(), { onOpenOptions: () => opened++ });
    $('#open-options').click();
    assert.equal(opened, 1);
  });
});
