const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { applyChatColor, detectDarkMode, TINT_ID, BAR_ID, STYLE_ID } = require('../../src/lib/theme.js');

function dom(html = '') {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window;
}

const css = (document) => document.getElementById(STYLE_ID).textContent;

describe('applyChatColor', () => {
  it('adds a non-interactive tint overlay and an accent bar', () => {
    const { document } = dom();
    applyChatColor(document, { background: 'hsl(10 50% 90%)', accent: 'hsl(10 65% 42%)', dark: false });
    assert.ok(document.getElementById(TINT_ID));
    assert.ok(document.getElementById(BAR_ID));
    assert.match(css(document), /#ccf-tint\s*\{[^}]*background:\s*hsl\(10 50% 90%\)/);
    assert.match(css(document), /#ccf-tint\s*\{[^}]*pointer-events:\s*none/);
    assert.match(css(document), /#ccf-tint\s*\{[^}]*mix-blend-mode:\s*multiply/);
    assert.match(css(document), /#ccf-accent-bar\s*\{[^}]*background:\s*hsl\(10 65% 42%\)/);
  });

  it('uses screen blending in dark mode', () => {
    const { document } = dom();
    applyChatColor(document, { background: 'hsl(10 30% 12%)', accent: 'hsl(10 70% 62%)', dark: true });
    assert.match(css(document), /mix-blend-mode:\s*screen/);
  });

  it('updates in place instead of duplicating', () => {
    const { document } = dom();
    applyChatColor(document, { background: 'red', accent: 'red' });
    applyChatColor(document, { background: 'blue', accent: 'blue' });
    assert.equal(document.querySelectorAll(`#${TINT_ID}`).length, 1);
    assert.equal(document.querySelectorAll(`#${STYLE_ID}`).length, 1);
    assert.match(css(document), /background:\s*blue/);
    assert.doesNotMatch(css(document), /red/);
    assert.equal(document.documentElement.dataset.ccfTinted, 'true');
  });

  it('refuses colour strings that could inject CSS', () => {
    const { document } = dom();
    applyChatColor(document, { background: 'red;} body{display:none', accent: 'blue' });
    assert.doesNotMatch(css(document), /display:none/);
  });

  it('removes everything when given null', () => {
    const { document } = dom();
    applyChatColor(document, { background: 'red', accent: 'red' });
    applyChatColor(document, null);
    assert.equal(document.getElementById(TINT_ID), null);
    assert.equal(document.getElementById(BAR_ID), null);
    assert.equal(document.getElementById(STYLE_ID), null);
    assert.equal(document.documentElement.dataset.ccfTinted, undefined);
  });
});

describe('detectDarkMode', () => {
  it('reads claude.ai data-mode', () => {
    const w = dom();
    w.document.documentElement.setAttribute('data-mode', 'dark');
    assert.equal(detectDarkMode(w.document, w), true);
    w.document.documentElement.setAttribute('data-mode', 'light');
    assert.equal(detectDarkMode(w.document, w), false);
  });

  it('reads a dark class', () => {
    const w = dom();
    w.document.documentElement.classList.add('dark');
    assert.equal(detectDarkMode(w.document, w), true);
  });

  it('falls back to prefers-color-scheme', () => {
    const w = dom();
    const fakeWin = { matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: dark)' }) };
    assert.equal(detectDarkMode(w.document, fakeWin), true);
    assert.equal(detectDarkMode(w.document, {}), false);
  });
});
