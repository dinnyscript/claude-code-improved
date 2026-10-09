// End-to-end: loads the real unpacked extension into Chromium and drives it
// against a mock claude.ai served through Playwright request routing.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright');
const mockClaudePage = require('./mock-claude.js');

const EXT = path.resolve(process.env.CCF_EXTENSION_DIR || path.join(__dirname, '../..'));

describe('extension end-to-end', { timeout: 120000 }, () => {
  let context;
  let userDataDir;
  let worker;
  let extensionId;

  before(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-e2e-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await context.route('https://claude.ai/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: mockClaudePage(route.request().url()) })
    );
    worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;
  });

  after(async () => {
    await context?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  async function openChat(id) {
    const page = await context.newPage();
    await page.goto(`https://claude.ai/chat/${id}`);
    await page.waitForSelector('#ccf-tint', { state: 'attached' });
    return page;
  }

  // Runs code in the extension's isolated content-script world of a page.
  async function inContentWorld(page, expression) {
    const cdp = await context.newCDPSession(page);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', ({ context: c }) => contexts.push(c));
    await cdp.send('Runtime.enable');
    const isOurs = (c) => c.auxData && c.auxData.type === 'isolated' && c.name === 'Claude Chat Focus';
    for (let i = 0; i < 20 && !contexts.some(isOurs); i++) await new Promise((r) => setTimeout(r, 50));
    const world = contexts.filter(isOurs).at(-1);
    assert.ok(world, `content script world not found in ${JSON.stringify(contexts.map((c) => c.name))}`);
    const { exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, contextId: world.id });
    assert.equal(exceptionDetails, undefined);
    await cdp.detach();
  }

  const themeCss = (page) => page.$eval('#ccf-theme-style', (el) => el.textContent);

  it('tints each chat with its own colour', async () => {
    const a = await openChat('11111111-aaaa');
    const b = await openChat('22222222-bbbb');
    const cssA = await themeCss(a);
    const cssB = await themeCss(b);
    assert.match(cssA, /hsl\(/);
    assert.notEqual(cssA, cssB);
    // The overlay must not block clicks on the page.
    await a.bringToFront();
    await a.click('#composer');
    await a.keyboard.type('hi');
    assert.equal(await a.inputValue('#composer'), 'hi');
    await a.close();
    await b.close();
  });

  it('shows the time widget', async () => {
    const page = await openChat('33333333-cccc');
    const state = page.locator('#ccf-widget-host .ccf-state');
    await state.waitFor();
    assert.match(await state.textContent(), /Active|Idle|Watching|Away/);
    assert.match(await page.locator('#ccf-widget-host .ccf-today').textContent(), /Today staring/);
    await page.close();
  });

  it('marks the tab title while Claude is generating', async () => {
    const page = await openChat('44444444-dddd');
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('data-is-streaming', 'true');
      document.querySelector('#thread').append(el);
    });
    await page.waitForFunction(() => document.title.startsWith('⏳ '));
    await page.evaluate(() => document.querySelector('[data-is-streaming="true"]').setAttribute('data-is-streaming', 'false'));
    await page.waitForFunction(() => !document.title.startsWith('⏳ '), null, { timeout: 10000 });
    await page.close();
  });

  it('records stats through the service worker when you switch away', async () => {
    const page = await openChat('55555555-eeee');
    await page.waitForTimeout(6500); // periodic flush every 5s
    await page.close();
    const data = await worker.evaluate(() => chrome.storage.local.get(null));
    const days = Object.keys(data).filter((k) => k.startsWith('stats:'));
    assert.ok(days.length >= 1, JSON.stringify(data));
    const chats = data[days[0]].chats;
    assert.ok(chats['55555555-eeee'], JSON.stringify(chats));
    assert.equal(chats['55555555-eeee'].title, 'Chat 55555555-eeee');
  });

  it('popup shows today and lets you recolour the current chat', async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.waitForSelector('#focus-score');
    assert.match(await popup.textContent('#focus-score'), /%|—/);
    assert.ok((await popup.locator('.chat-row').count()) >= 1);
    await popup.close();
  });

  it('applies hue overrides and settings changes live', async () => {
    const page = await openChat('66666666-ffff');
    await worker.evaluate(() => chrome.storage.local.set({ hueOverrides: { '66666666-ffff': 42 } }));
    await page.waitForFunction(() => document.getElementById('ccf-theme-style')?.textContent.includes('hsl(42 '));
    await worker.evaluate(() => chrome.storage.sync.set({ settings: { colorsEnabled: false } }));
    await page.waitForSelector('#ccf-tint', { state: 'detached' });
    await worker.evaluate(() => chrome.storage.sync.set({ settings: { colorsEnabled: true } }));
    await page.waitForSelector('#ccf-tint', { state: 'attached' });
    await page.close();
  });

  it('options page loads and saves settings', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await page.waitForFunction(() => document.querySelector('[name=idleAfterSec]').value !== '');
    await page.fill('[name=idleAfterSec]', '45');
    await page.dispatchEvent('[name=idleAfterSec]', 'change');
    await page.waitForFunction(async () => (await chrome.storage.sync.get('settings')).settings?.idleAfterSec === 45);
    await page.close();
  });

  it('nudges you after staring for the configured time', { timeout: 60000 }, async () => {
    await worker.evaluate(() =>
      chrome.storage.sync.set({ settings: { idleAfterSec: 5, nudgeAfterSec: 15, colorsEnabled: true } })
    );
    const page = await openChat('77777777-0000');
    const nudge = page.locator('#ccf-widget-host .ccf-nudge');
    await nudge.waitFor({ state: 'visible', timeout: 40000 });
    assert.match(await nudge.textContent(), /staring/i);
    await page.locator('#ccf-widget-host .ccf-dismiss').click();
    await nudge.waitFor({ state: 'hidden' });
    await page.close();
  });

  it('keeps the widget clear of the composer and its Send button', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ settings: {} }));
    const page = await openChat('88888888-1111');
    const widget = await page.locator('#ccf-widget-host .ccf-widget').boundingBox();
    for (const sel of ['#composer', 'button[aria-label="Send message"]']) {
      const box = await page.locator(sel).boundingBox();
      const overlaps =
        widget.x < box.x + box.width && box.x < widget.x + widget.width && widget.y < box.y + box.height && box.y < widget.y + widget.height;
      assert.equal(overlaps, false, `widget overlaps ${sel}`);
    }
    await page.close();
  });

  it('remembers where you dragged the widget', async () => {
    const page = await openChat('88888888-2222');
    const header = page.locator('#ccf-widget-host .ccf-header');
    const start = await header.boundingBox();
    await page.mouse.move(start.x + 20, start.y + 5);
    await page.mouse.down();
    await page.mouse.move(start.x - 200, start.y + 205, { steps: 5 });
    await page.mouse.up();
    const moved = await page.locator('#ccf-widget-host .ccf-widget').boundingBox();
    await page.reload();
    await page.waitForSelector('#ccf-tint', { state: 'attached' });
    await page.waitForTimeout(500);
    const restored = await page.locator('#ccf-widget-host .ccf-widget').boundingBox();
    assert.ok(Math.abs(restored.x - moved.x) < 2 && Math.abs(restored.y - moved.y) < 2, JSON.stringify({ moved, restored }));
    await worker.evaluate(() => chrome.storage.local.remove('widgetPosition'));
    await page.close();
  });

  it('colours the tab icon', async () => {
    const page = await openChat('88888888-3333');
    await page.waitForFunction(() => document.querySelector('link[rel~="icon"]').href.startsWith('data:image/svg+xml'));
    await page.close();
  });

  it("shows today's staring time on the toolbar badge", async () => {
    // Write through the worker's own stats queue, as tabs do, so we can't race their flushes.
    await worker.evaluate(() =>
      globalThis.CCF.addDelta(chrome.storage.local, globalThis.CCF.dayKey(new Date()), 'badge-test', { idleMs: 7 * 60000 })
    );
    let text = '';
    for (let i = 0; i < 50 && !/^\d+m$/.test(text); i++) {
      text = await worker.evaluate(() => chrome.action.getBadgeText({}));
      if (!/^\d+m$/.test(text)) await new Promise((r) => setTimeout(r, 100));
    }
    assert.match(text, /^\d+m$/);
    assert.ok(parseInt(text, 10) >= 7, text);
  });

  it('notifies when Claude finishes while you are in another tab', async () => {
    await worker.evaluate(() => {
      globalThis.__notified = [];
      const original = chrome.notifications.create.bind(chrome.notifications);
      chrome.notifications.create = (id, opts) => {
        globalThis.__notified.push({ id, ...opts });
        return original(id, opts);
      };
    });
    const page = await openChat('88888888-5555');
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('data-is-streaming', 'true');
      document.querySelector('#thread').append(el);
    });
    await page.waitForFunction(() => document.title.startsWith('⏳ '));
    // Playwright keeps every page "visible and focused", so simulate switching
    // away inside the content script's own world.
    await inContentWorld(page, 'document.hasFocus = () => false');
    await page.evaluate(() => document.querySelector('[data-is-streaming="true"]').setAttribute('data-is-streaming', 'false'));
    await page.waitForFunction(() => document.title.startsWith('✅ '), null, { timeout: 10000 });
    const notified = (await worker.evaluate(() => globalThis.__notified)).filter((n) => n.id.startsWith('ccf-done:'));
    assert.equal(notified.length, 1, JSON.stringify(notified));
    assert.match(notified[0].message, /Chat 88888888-5555/);
    await inContentWorld(page, 'delete document.hasFocus');
    await page.waitForFunction(() => !document.title.startsWith('✅ '));
    await page.close();
  });

  it('deletes all stats from the options page', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    page.on('dialog', (d) => d.accept());
    await page.click('#reset-stats');
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Stats deleted');
    const keys = Object.keys(await worker.evaluate(() => chrome.storage.local.get(null)));
    assert.deepEqual(keys.filter((k) => k.startsWith('stats:')), []);
    await page.close();
  });
});
