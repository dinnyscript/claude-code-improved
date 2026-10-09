/*
 * Work out which claude.ai conversation a URL points at.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCF = Object.assign(root.CCF || {}, api);
})(globalThis, function () {
  'use strict';

  const CHAT_PATH = /^\/chat\/([^/]+)\/?$/;

  function parseChatId(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.hostname !== 'claude.ai' && !url.hostname.endsWith('.claude.ai')) return null;
    const match = CHAT_PATH.exec(url.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }

  return { parseChatId };
});
