/*
 * The small on-page panel showing how you're spending time in this chat,
 * plus the "stop staring" nudge. Lives in a shadow root so claude.ai's CSS
 * can't affect it (and vice versa).
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./format.js') : root.CCF);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function (fmt) {
  'use strict';

  const HOST_ID = 'ccf-widget-host';
  // Top-right, below claude.ai's header, so it never covers the composer or its Send button.
  const DEFAULT_POSITION = Object.freeze({ top: 64, right: 16 });

  const STATE_LABELS = {
    active: 'Active',
    waiting: 'Watching Claude type',
    idle: 'Idle — staring',
    hidden: 'Away',
  };

  const CSS = `
    :host { all: initial; }
    .ccf-widget {
      --ccf-fg: #1f1f1f; --ccf-bg: #ffffff; --ccf-line: rgba(0,0,0,0.12); --ccf-muted: #5f5f5f;
      position: fixed; z-index: 2147483646;
      width: 260px; box-sizing: border-box; padding: 8px 12px 10px;
      font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--ccf-fg); background: var(--ccf-bg);
      border: 1px solid var(--ccf-line); border-left: 4px solid var(--ccf-accent, #888);
      border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    }
    .ccf-widget[data-theme="dark"] {
      --ccf-fg: #ececec; --ccf-bg: #262624; --ccf-line: rgba(255,255,255,0.14); --ccf-muted: #b0b0b0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    }
    .ccf-header { display: flex; align-items: center; gap: 6px; cursor: grab; user-select: none; touch-action: none; }
    .ccf-widget.dragging .ccf-header { cursor: grabbing; }
    .ccf-dot { width: 8px; height: 8px; border-radius: 50%; background: #9e9e9e; flex: none; }
    [data-state="active"] .ccf-dot { background: #2e7d32; }
    [data-state="waiting"] .ccf-dot { background: #f9a825; }
    [data-state="idle"] .ccf-dot { background: #c62828; }
    .ccf-state { font-weight: 600; white-space: nowrap; }
    .ccf-streak { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ccf-toggle {
      margin-left: auto; border: 0; background: transparent; color: inherit; cursor: pointer;
      font: inherit; font-size: 14px; line-height: 1; padding: 0 2px;
    }
    .ccf-streak:not([hidden]) + .ccf-toggle { margin-left: 4px; }
    .ccf-body { margin-top: 6px; display: grid; gap: 2px; color: var(--ccf-muted); font-variant-numeric: tabular-nums; }
    .ccf-widget.collapsed { width: auto; }
    .ccf-widget.collapsed .ccf-body, .ccf-widget.collapsed .ccf-nudge { display: none; }
    .ccf-widget.over .ccf-today { color: #d32f2f; font-weight: 600; }
    .ccf-nudge {
      margin-top: 8px; padding: 8px; border-radius: 8px;
      background: rgba(198,40,40,0.08); border: 1px solid rgba(198,40,40,0.35);
    }
    .ccf-nudge[hidden] { display: none; }
    .ccf-nudge-title { font-weight: 700; margin-bottom: 2px; }
    .ccf-actions { display: flex; gap: 6px; margin-top: 6px; }
    .ccf-actions button {
      font: inherit; cursor: pointer; border-radius: 6px; padding: 3px 8px;
      border: 1px solid var(--ccf-line); background: transparent; color: inherit;
    }
    .ccf-actions .ccf-dismiss { background: #c62828; border-color: #c62828; color: #fff; }
  `;

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createWidget(doc, handlers = {}) {
    doc.getElementById(HOST_ID)?.remove();
    const host = el(doc, 'div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = el(doc, 'style', null, CSS);

    const box = el(doc, 'div', 'ccf-widget');
    const header = el(doc, 'div', 'ccf-header');
    const stateLabel = el(doc, 'span', 'ccf-state');
    const streak = el(doc, 'span', 'ccf-streak');
    const toggle = el(doc, 'button', 'ccf-toggle', '–');
    toggle.type = 'button';
    toggle.title = 'Collapse';
    header.append(el(doc, 'span', 'ccf-dot'), stateLabel, streak, toggle);

    const body = el(doc, 'div', 'ccf-body');
    const chatLine = el(doc, 'div', 'ccf-chat');
    const todayLine = el(doc, 'div', 'ccf-today');
    body.append(chatLine, todayLine);

    const nudge = el(doc, 'div', 'ccf-nudge');
    nudge.hidden = true;
    nudge.setAttribute('role', 'alert');
    const nudgeTitle = el(doc, 'div', 'ccf-nudge-title');
    const nudgeBody = el(doc, 'div', 'ccf-nudge-body');
    const actions = el(doc, 'div', 'ccf-actions');
    const dismiss = el(doc, 'button', 'ccf-dismiss', 'Got it');
    const snooze = el(doc, 'button', 'ccf-snooze', 'Snooze 10 min');
    dismiss.type = snooze.type = 'button';
    actions.append(dismiss, snooze);
    nudge.append(nudgeTitle, nudgeBody, actions);

    box.append(header, body, nudge);
    shadow.append(style, box);
    (doc.body || doc.documentElement).append(host);

    const win = doc.defaultView;
    function setPosition({ top, right }) {
      const maxTop = Math.max(0, (win ? win.innerHeight : 600) - 40);
      const maxRight = Math.max(0, (win ? win.innerWidth : 800) - 80);
      const pos = {
        top: Math.round(Math.min(maxTop, Math.max(0, Number(top) || 0))),
        right: Math.round(Math.min(maxRight, Math.max(0, Number(right) || 0))),
      };
      box.style.top = `${pos.top}px`;
      box.style.right = `${pos.right}px`;
      return pos;
    }
    setPosition(DEFAULT_POSITION);

    // Drag by the header to move the widget out of the way.
    let drag = null;
    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === toggle) return;
      drag = { x: e.clientX, y: e.clientY, top: parseFloat(box.style.top), right: parseFloat(box.style.right), moved: false };
      box.classList.add('dragging');
      e.preventDefault();
    });
    const onPointerMove = (e) => {
      if (!drag) return;
      drag.moved = true;
      setPosition({ top: drag.top + (e.clientY - drag.y), right: drag.right - (e.clientX - drag.x) });
    };
    const onPointerUp = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      box.classList.remove('dragging');
      if (moved) handlers.onMove?.({ top: parseFloat(box.style.top), right: parseFloat(box.style.right) });
    };
    win?.addEventListener('pointermove', onPointerMove);
    win?.addEventListener('pointerup', onPointerUp);

    toggle.addEventListener('click', () => {
      const collapsed = box.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '+' : '–';
      toggle.title = collapsed ? 'Expand' : 'Collapse';
      handlers.onToggle?.(collapsed);
    });
    dismiss.addEventListener('click', () => {
      nudge.hidden = true;
      handlers.onDismiss?.();
    });
    snooze.addEventListener('click', () => {
      nudge.hidden = true;
      handlers.onSnooze?.();
    });

    function render(view) {
      const state = view.state || 'active';
      box.dataset.state = state;
      box.dataset.theme = view.dark ? 'dark' : 'light';
      if (view.accent) box.style.setProperty('--ccf-accent', view.accent);
      else box.style.removeProperty('--ccf-accent');
      stateLabel.textContent = STATE_LABELS[state] || state;

      streak.hidden = !(view.staringStreakMs > 0);
      streak.textContent = streak.hidden ? '' : `Staring ${fmt.formatDuration(view.staringStreakMs)}`;

      const chat = view.chat || {};
      const chatStaring = (chat.waitingMs || 0) + (chat.idleMs || 0);
      chatLine.textContent = `This chat: active ${fmt.formatDuration(chat.activeMs)} · staring ${fmt.formatDuration(chatStaring)}`;

      const today = fmt.formatDuration(view.todayStaringMs);
      const budget = view.budgetMs || 0;
      const over = budget > 0 && view.todayStaringMs > budget;
      box.classList.toggle('over', over);
      if (!budget) todayLine.textContent = `Today staring: ${today}`;
      else if (over) todayLine.textContent = `Today staring: ${today} — over ${fmt.formatDuration(budget)} budget`;
      else todayLine.textContent = `Today staring: ${today} / ${fmt.formatDuration(budget)} budget`;
    }

    return {
      render,
      setPosition,
      showNudge({ title, body: text }) {
        nudgeTitle.textContent = title;
        nudgeBody.textContent = text;
        nudge.hidden = false;
      },
      hideNudge() {
        nudge.hidden = true;
      },
      isNudgeVisible: () => !nudge.hidden,
      setCollapsed(collapsed) {
        box.classList.toggle('collapsed', Boolean(collapsed));
        toggle.textContent = collapsed ? '+' : '–';
      },
      destroy() {
        win?.removeEventListener('pointermove', onPointerMove);
        win?.removeEventListener('pointerup', onPointerUp);
        host.remove();
      },
    };
  }

  return { HOST_ID, createWidget };
});
