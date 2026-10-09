/* Content-script entry point: runs on every claude.ai page. */
(function () {
  'use strict';
  if (globalThis.__ccfController) return;
  const controller = globalThis.CCF.createController({ window, document, chrome });
  globalThis.__ccfController = controller;
  controller.start().catch((err) => console.warn('[Claude Chat Focus] failed to start', err));
})();
