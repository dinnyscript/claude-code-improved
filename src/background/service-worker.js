/* Background service worker entry point. */
importScripts('../lib/format.js', '../lib/chat-id.js', '../lib/settings.js', '../lib/stats.js', '../lib/background.js');

globalThis.CCF.createBackground({ chrome }).init();
