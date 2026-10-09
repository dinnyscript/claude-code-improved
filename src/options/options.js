/* Options page entry point. */
(function () {
  'use strict';
  const L = globalThis.CCF;
  const form = document.getElementById('settings-form');
  const status = document.getElementById('status');

  function flash(text) {
    status.textContent = text;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => (status.textContent = ''), 1500);
  }

  async function load() {
    L.fillForm(form, await L.readSettings(chrome.storage.sync));
  }

  async function save() {
    const settings = L.readForm(form);
    await chrome.storage.sync.set({ [L.SETTINGS_KEY]: settings });
    L.fillForm(form, settings);
    flash('Saved');
  }

  form.addEventListener('change', save);
  form.addEventListener('submit', (e) => e.preventDefault());

  document.getElementById('export-csv').addEventListener('click', async () => {
    const csv = L.statsToCsv(await chrome.storage.local.get(null));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `claude-chat-focus-${L.dayKey(new Date())}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById('reset-stats').addEventListener('click', async () => {
    if (!confirm('Delete all recorded time statistics? This cannot be undone.')) return;
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('stats:')));
    flash('Stats deleted');
  });

  load();
})();
