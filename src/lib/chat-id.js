/*
 * Work out which claude.ai conversation a URL points at.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  // Time on claude.ai pages that aren't a specific chat (new chat, recents, ...).
  const OTHER_CHAT = '__other__';
  const CHAT_PATH = /^\/chat\/([A-Za-z0-9-]{1,100})\/?$/;

  function parseChatId(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.hostname !== 'claude.ai' && !url.hostname.endsWith('.claude.ai')) return null;
    const match = CHAT_PATH.exec(url.pathname);
    return match ? match[1] : null;
  }

  // Keys we are willing to store stats under.
  function isTrackableChatKey(key) {
    return key === OTHER_CHAT || (typeof key === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(key));
  }

  return { OTHER_CHAT, parseChatId, isTrackableChatKey };
});
