/*
 * Data + rendering for the toolbar popup: today's focus score, staring budget,
 * a 7-day chart, per-chat breakdown and the current chat's colour picker.
 */
(function (root, factory) {
  const deps =
    typeof require === 'function'
      ? Object.assign(
          {},
          require('./format.js'),
          require('./chat-id.js'),
          require('./color.js'),
          require('./settings.js'),
          require('./stats.js'),
          require('./overrides.js')
        )
      : root.CCF;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (L) {
  'use strict';

  const OTHER_CHAT = '__other__';
  const MAX_CHATS = 8;

  async function buildPopupModel({ local, sync, activeUrl, now = Date.now() }) {
    const today = new Date(now);
    const [settings, overrides, week] = await Promise.all([
      L.readSettings(sync),
      L.getHueOverrides(local),
      L.recentDays(local, 7, today),
    ]);
    const chatId = L.parseChatId(activeUrl || '');
    const currentChat = chatId
      ? { chatId, hue: L.chatHue(chatId, overrides[chatId]), overridden: chatId in overrides }
      : null;
    return {
      settings,
      overrides,
      week,
      today: week[week.length - 1],
      budgetMs: settings.dailyStaringBudgetMin * 60000,
      currentChat,
    };
  }

  function h(doc, tag, attrs = {}, children = []) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  }

  function renderPopup(container, model, handlers = {}) {
    const doc = container.ownerDocument;
    container.textContent = '';
    const { totals, chats, focusScore } = model.today;

    const optionsBtn = h(doc, 'button', { id: 'open-options', type: 'button', text: 'Settings' });
    optionsBtn.addEventListener('click', () => handlers.onOpenOptions?.());
    const header = h(doc, 'header', {}, [h(doc, 'h1', { text: 'Claude Chat Focus' }), optionsBtn]);

    const score = h(doc, 'section', { class: 'score' }, [
      h(doc, 'div', { id: 'focus-score', text: focusScore === null ? '—' : `${focusScore}%` }),
      h(doc, 'div', { class: 'label', text: 'focus score today (active ÷ active + staring)' }),
    ]);

    const totalsEl = h(doc, 'section', { class: 'totals' }, [
      h(doc, 'div', { class: 'stat' }, [
        h(doc, 'span', { class: 'label', text: 'Active' }),
        h(doc, 'span', { id: 'today-active', text: L.formatDuration(totals.activeMs) }),
      ]),
      h(doc, 'div', { class: 'stat' }, [
        h(doc, 'span', { class: 'label', text: 'Staring' }),
        h(doc, 'span', { id: 'today-staring', text: L.formatDuration(totals.staringMs) }),
      ]),
      h(doc, 'div', { class: 'stat sub' }, [
        h(doc, 'span', { class: 'label', text: '\u21b3 watching Claude' }),
        h(doc, 'span', { id: 'today-waiting', text: L.formatDuration(totals.waitingMs) }),
      ]),
      h(doc, 'div', { class: 'stat sub' }, [
        h(doc, 'span', { class: 'label', text: '\u21b3 idle' }),
        h(doc, 'span', { id: 'today-idle', text: L.formatDuration(totals.idleMs) }),
      ]),
    ]);

    let budgetEl = null;
    if (model.budgetMs > 0) {
      const ratio = totals.staringMs / model.budgetMs;
      const fill = h(doc, 'div', { id: 'budget-fill' });
      fill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
      budgetEl = h(doc, 'section', { id: 'budget' }, [
        h(doc, 'div', {
          class: 'label',
          text: `Staring budget: ${L.formatDuration(totals.staringMs)} of ${L.formatDuration(model.budgetMs)}`,
        }),
        h(doc, 'div', { class: 'bar' }, [fill]),
      ]);
      budgetEl.classList.toggle('over', ratio > 1);
    }

    const max = Math.max(1, ...model.week.map((d) => d.totals.activeMs + d.totals.staringMs));
    const bars = model.week.map((d) => {
      const active = h(doc, 'div', { class: 'seg active' });
      const staring = h(doc, 'div', { class: 'seg staring' });
      active.style.height = `${(d.totals.activeMs / max) * 100}%`;
      staring.style.height = `${(d.totals.staringMs / max) * 100}%`;
      return h(
        doc,
        'div',
        {
          class: 'week-bar',
          title: `${d.day}: active ${L.formatDuration(d.totals.activeMs)}, staring ${L.formatDuration(d.totals.staringMs)}`,
        },
        [staring, active]
      );
    });
    const week = h(doc, 'section', { class: 'week' }, [
      h(doc, 'h2', { text: 'Last 7 days' }),
      h(doc, 'div', { class: 'bars' }, bars),
      h(doc, 'div', { class: 'legend' }, [
        h(doc, 'span', { class: 'key active', text: 'active' }),
        h(doc, 'span', { class: 'key staring', text: 'staring' }),
      ]),
    ]);

    const list = h(doc, 'ul', { class: 'chats' });
    for (const chat of chats.slice(0, MAX_CHATS)) {
      const isOther = chat.chatId === OTHER_CHAT;
      const dot = h(doc, 'span', { class: 'dot' });
      dot.style.background = isOther
        ? '#9e9e9e'
        : L.chatPalette(chat.chatId, { intensity: 1, hueOverride: model.overrides[chat.chatId] }).accent;
      const row = h(doc, 'li', { class: `chat-row${isOther ? ' other' : ''}` }, [
        dot,
        h(doc, 'span', { class: 'chat-title', text: isOther ? 'Other claude.ai pages' : chat.title || 'Untitled chat' }),
        h(doc, 'span', {
          class: 'chat-time',
          text: `${L.formatDuration(chat.activeMs)} / ${L.formatDuration(chat.staringMs)}`,
          title: 'active / staring',
        }),
      ]);
      if (!isOther) row.addEventListener('click', () => handlers.onOpenChat?.(chat.chatId));
      list.append(row);
    }
    const chatsEl = h(doc, 'section', { class: 'chat-list' }, [
      h(doc, 'h2', { text: "Today's chats (active / staring)" }),
      chats.length ? list : h(doc, 'p', { class: 'empty', text: 'No chat time recorded yet today.' }),
    ]);

    const current = h(doc, 'section', { id: 'current-chat' });
    if (model.currentChat) {
      const { chatId, hue, overridden } = model.currentChat;
      const swatch = h(doc, 'span', { class: 'swatch' });
      const paint = (value) => {
        swatch.style.background = L.chatPalette(chatId, { intensity: 1, hueOverride: value }).accent;
      };
      paint(hue);
      const slider = h(doc, 'input', { id: 'hue-slider', type: 'range', min: '0', max: '359', step: '1', 'aria-label': 'Chat hue' });
      slider.value = String(hue);
      slider.addEventListener('input', () => {
        const value = Number(slider.value);
        paint(value);
        reset.disabled = false;
        handlers.onHueChange?.(chatId, value);
      });
      const reset = h(doc, 'button', { id: 'hue-reset', type: 'button', text: 'Auto' });
      reset.disabled = !overridden;
      reset.addEventListener('click', () => {
        reset.disabled = true;
        const auto = L.chatHue(chatId);
        slider.value = String(auto);
        paint(auto);
        handlers.onResetHue?.(chatId);
      });
      current.append(h(doc, 'h2', { text: 'This chat’s colour' }), h(doc, 'div', { class: 'hue-row' }, [swatch, slider, reset]));
    } else {
      current.append(h(doc, 'p', { class: 'empty', text: 'Open a Claude chat to change its colour.' }));
    }

    container.append(header, score, totalsEl, budgetEl, week, chatsEl, current);
  }

  return { buildPopupModel, renderPopup };
});
