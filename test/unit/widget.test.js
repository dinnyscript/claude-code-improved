const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createWidget, HOST_ID } = require('../../src/lib/widget.js');

const MIN = 60000;

function setup(handlers) {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  const widget = createWidget(document, handlers);
  const root = document.getElementById(HOST_ID).shadowRoot;
  return { document, widget, root, $: (s) => root.querySelector(s) };
}

const view = {
  state: 'idle',
  staringStreakMs: 65000,
  chat: { activeMs: 5 * MIN, waitingMs: 1 * MIN, idleMs: 2 * MIN },
  todayStaringMs: 10 * MIN,
  budgetMs: 30 * MIN,
  accent: 'hsl(100 65% 42%)',
};

describe('createWidget', () => {
  it('mounts a single shadow-DOM host', () => {
    const { document } = setup();
    assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
  });

  it('renders the state, streak and totals', () => {
    const { widget, $ } = setup();
    widget.render(view);
    assert.match($('.ccf-state').textContent, /idle/i);
    assert.match($('.ccf-streak').textContent, /1m 5s/);
    assert.match($('.ccf-chat').textContent, /5m 0s/);
    assert.match($('.ccf-chat').textContent, /3m 0s/); // staring = waiting + idle
    assert.match($('.ccf-today').textContent, /10m 0s/);
    assert.match($('.ccf-today').textContent, /30m 0s/);
    assert.equal($('.ccf-widget').classList.contains('over'), false);
  });

  it('labels each state', () => {
    const { widget, $ } = setup();
    for (const [state, re] of [['active', /active/i], ['waiting', /watching claude/i], ['hidden', /away/i]]) {
      widget.render({ ...view, state });
      assert.match($('.ccf-state').textContent, re);
      assert.equal($('.ccf-widget').dataset.state, state);
    }
  });

  it('hides the streak when not staring', () => {
    const { widget, $ } = setup();
    widget.render({ ...view, staringStreakMs: 0, state: 'active' });
    assert.equal($('.ccf-streak').hidden, true);
  });

  it('flags going over the daily staring budget', () => {
    const { widget, $ } = setup();
    widget.render({ ...view, todayStaringMs: 31 * MIN });
    assert.equal($('.ccf-widget').classList.contains('over'), true);
    assert.match($('.ccf-today').textContent, /over/i);
  });

  it('omits the budget when it is zero', () => {
    const { widget, $ } = setup();
    widget.render({ ...view, budgetMs: 0 });
    assert.doesNotMatch($('.ccf-today').textContent, /budget|over/i);
  });

  it('collapses and expands', () => {
    let toggled = 0;
    const { widget, $ } = setup({ onToggle: () => toggled++ });
    widget.render(view);
    $('.ccf-toggle').click();
    assert.equal($('.ccf-widget').classList.contains('collapsed'), true);
    $('.ccf-toggle').click();
    assert.equal($('.ccf-widget').classList.contains('collapsed'), false);
    assert.equal(toggled, 2);
  });

  it('shows a nudge with dismiss and snooze actions', () => {
    let dismissed = 0;
    let snoozed = 0;
    const { widget, $ } = setup({ onDismiss: () => dismissed++, onSnooze: () => snoozed++ });
    widget.showNudge({ title: 'Stop staring', body: 'Do something' });
    assert.equal($('.ccf-nudge').hidden, false);
    assert.equal($('.ccf-nudge-title').textContent, 'Stop staring');
    assert.equal($('.ccf-nudge-body').textContent, 'Do something');
    $('.ccf-dismiss').click();
    assert.equal($('.ccf-nudge').hidden, true);
    assert.equal(dismissed, 1);
    widget.showNudge({ title: 'Again', body: 'x' });
    $('.ccf-snooze').click();
    assert.equal($('.ccf-nudge').hidden, true);
    assert.equal(snoozed, 1);
    assert.equal(widget.isNudgeVisible(), false);
  });

  it('does not interpret nudge text as HTML', () => {
    const { widget, $ } = setup();
    widget.showNudge({ title: '<img src=x onerror=alert(1)>', body: '<b>hi</b>' });
    assert.equal($('.ccf-nudge img'), null);
    assert.equal($('.ccf-nudge-body b'), null);
  });

  it('is removed by destroy()', () => {
    const { document, widget } = setup();
    widget.destroy();
    assert.equal(document.getElementById(HOST_ID), null);
  });
});

describe('createWidget review fixes', () => {
  it('does not announce every per-second update to screen readers', () => {
    const { $ } = setup();
    assert.equal($('.ccf-widget').getAttribute('role'), null);
    assert.notEqual($('.ccf-widget').getAttribute('aria-live'), 'polite');
    assert.equal($('.ccf-nudge').getAttribute('role'), 'alert');
  });

  it("follows the page's dark mode rather than the OS setting", () => {
    const { widget, $ } = setup();
    widget.render({ ...view, dark: true });
    assert.equal($('.ccf-widget').dataset.theme, 'dark');
    widget.render({ ...view, dark: false });
    assert.equal($('.ccf-widget').dataset.theme, 'light');
  });

  it('drops a stale accent when colours are turned off', () => {
    const { widget, $ } = setup();
    widget.render(view);
    assert.equal($('.ccf-widget').style.getPropertyValue('--ccf-accent'), view.accent);
    widget.render({ ...view, accent: undefined });
    assert.equal($('.ccf-widget').style.getPropertyValue('--ccf-accent'), '');
  });

  it('sits in the top-right corner by default, away from the composer', () => {
    const { $ } = setup();
    const box = $('.ccf-widget');
    assert.equal(box.style.top, '64px');
    assert.equal(box.style.right, '16px');
    assert.equal(box.style.bottom, '');
  });

  it('can be dragged by its header and reports the new position', () => {
    const moves = [];
    const { document, widget, $ } = setup({ onMove: (p) => moves.push(p) });
    widget.render(view);
    const win = document.defaultView;
    const fire = (target, type, x, y) =>
      target.dispatchEvent(new win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, composed: true, button: 0 }));
    fire($('.ccf-header'), 'pointerdown', 900, 100);
    fire(win, 'pointermove', 850, 300);
    fire(win, 'pointerup', 850, 300);
    assert.equal($('.ccf-widget').style.top, '264px');
    assert.equal($('.ccf-widget').style.right, '66px');
    assert.deepEqual(moves, [{ top: 264, right: 66 }]);
    // further moves after release are ignored
    fire(win, 'pointermove', 0, 0);
    assert.equal($('.ccf-widget').style.top, '264px');
  });

  it('does not start a drag from the collapse button', () => {
    const moves = [];
    const { document, $ } = setup({ onMove: (p) => moves.push(p) });
    const win = document.defaultView;
    $('.ccf-toggle').dispatchEvent(new win.MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    win.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 500, clientY: 500 }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 500, clientY: 500 }));
    assert.deepEqual(moves, []);
  });

  it('keeps a restored position on screen', () => {
    const { document, widget, $ } = setup();
    const win = document.defaultView;
    widget.setPosition({ top: 99999, right: -50 });
    assert.equal($('.ccf-widget').style.top, `${win.innerHeight - 40}px`);
    assert.equal($('.ccf-widget').style.right, '0px');
  });
});
