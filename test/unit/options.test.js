const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { fillForm, readForm, statsToCsv } = require('../../src/lib/options-view.js');
const { DEFAULT_SETTINGS, SETTINGS_SCHEMA } = require('../../src/lib/settings.js');

const html = fs.readFileSync(path.join(__dirname, '../../src/options/options.html'), 'utf8');

function form() {
  const { document } = new JSDOM(html).window;
  return document.getElementById('settings-form');
}

describe('options form', () => {
  it('has an input for every setting', () => {
    const f = form();
    for (const key of Object.keys(SETTINGS_SCHEMA)) assert.ok(f.elements[key], `missing input for ${key}`);
  });

  it('round-trips settings', () => {
    const f = form();
    const custom = { ...DEFAULT_SETTINGS, colorsEnabled: false, idleAfterSec: 45, colorIntensity: 0.3, nudgeAfterSec: 300 };
    fillForm(f, custom);
    assert.deepEqual(readForm(f), custom);
  });

  it('normalises out-of-range input', () => {
    const f = form();
    fillForm(f, DEFAULT_SETTINGS);
    f.elements.idleAfterSec.value = '1';
    assert.equal(readForm(f).idleAfterSec, 5);
  });
});

describe('statsToCsv', () => {
  it('exports one row per day and chat in minutes', () => {
    const csv = statsToCsv({
      'stats:2026-10-09': { chats: { b: { activeMs: 60000, idleMs: 30000, title: 'Say "hi", ok' } } },
      'stats:2026-10-08': { chats: { a: { waitingMs: 120000 } } },
      hueOverrides: {},
    });
    assert.equal(
      csv,
      [
        'day,chat_id,title,active_min,waiting_min,idle_min,hidden_min',
        '2026-10-08,a,"",0.0,2.0,0.0,0.0',
        '2026-10-09,b,"Say ""hi"", ok",1.0,0.0,0.5,0.0',
      ].join('\n') + '\n'
    );
  });

  it('neutralises spreadsheet formulas in titles', () => {
    const csv = statsToCsv({ 'stats:2026-10-09': { chats: { a: { title: '=HYPERLINK("x")' } } } });
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  });
});
