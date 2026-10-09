/* Toolbar popup entry point. */
(function () {
  'use strict';
  const L = globalThis.CCF;
  const local = chrome.storage.local;

  async function activeUrl() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return (tab && tab.url) || '';
    } catch {
      return '';
    }
  }

  let pendingHue = null;
  function saveHueSoon(chatId, hue) {
    clearTimeout(pendingHue);
    pendingHue = setTimeout(() => L.setHueOverride(local, chatId, hue), 60);
  }

  const handlers = {
    onOpenOptions: () => chrome.runtime.openOptionsPage(),
    onOpenChat: (chatId) => chrome.tabs.create({ url: `https://claude.ai/chat/${encodeURIComponent(chatId)}` }),
    onHueChange: saveHueSoon,
    onResetHue: (chatId) => {
      clearTimeout(pendingHue);
      L.clearHueOverride(local, chatId);
    },
  };

  async function main() {
    const model = await L.buildPopupModel({ local, sync: chrome.storage.sync, activeUrl: await activeUrl(), now: Date.now() });
    L.renderPopup(document.getElementById('app'), model, handlers);
  }

  main().catch((err) => {
    document.getElementById('app').textContent = `Something went wrong: ${err.message}`;
  });
})();
