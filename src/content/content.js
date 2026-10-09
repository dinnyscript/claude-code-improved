/* Content-script entry point: runs on every claude.ai page. */
(function () {
  'use strict';
  // A controller left behind by a previous version of the extension (after an
  // update or reload) can no longer talk to the extension; replace it.
  globalThis.__ccfController?.destroy();
  const controller = globalThis.CCF.createController({ window, document, chrome });
  globalThis.__ccfController = controller;
  controller.start().catch((err) => console.warn('[Claude Chat Focus] failed to start', err));
})();
