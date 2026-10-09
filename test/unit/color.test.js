const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hashString, chatHue, chatPalette, normalizeHue } = require('../../src/lib/color.js');

describe('hashString', () => {
  it('is deterministic', () => {
    assert.equal(hashString('abc'), hashString('abc'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'hello world', 'x'.repeat(1000)]) {
      const h = hashString(s);
      assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `${s} -> ${h}`);
    }
  });

  it('differs for different inputs', () => {
    assert.notEqual(hashString('chat-1'), hashString('chat-2'));
  });
});

describe('chatHue', () => {
  it('is stable for a chat id and within [0, 360)', () => {
    const h = chatHue('0b6c1f2e-1111-4a4a-9e9e-123456789abc');
    assert.equal(h, chatHue('0b6c1f2e-1111-4a4a-9e9e-123456789abc'));
    assert.ok(h >= 0 && h < 360);
  });

  it('spreads different chats across the colour wheel', () => {
    const buckets = new Set();
    for (let i = 0; i < 60; i++) {
      buckets.add(Math.floor(chatHue(`chat-${i}-${i * 7919}`) / 30));
    }
    assert.ok(buckets.size >= 10, `only ${buckets.size} of 12 hue buckets used`);
  });

  it('uses an override when one is given', () => {
    assert.equal(chatHue('anything', 200), 200);
  });
});

describe('normalizeHue', () => {
  it('wraps hues into [0, 360)', () => {
    assert.equal(normalizeHue(370), 10);
    assert.equal(normalizeHue(-10), 350);
    assert.equal(normalizeHue(360), 0);
  });

  it('returns null for non-numbers', () => {
    assert.equal(normalizeHue('red'), null);
    assert.equal(normalizeHue(undefined), null);
    assert.equal(normalizeHue(NaN), null);
  });
});

describe('chatPalette', () => {
  it('returns a light pastel background in light mode', () => {
    const p = chatPalette('chat-a', { dark: false, intensity: 1 });
    assert.match(p.background, /^hsl\(\d+(\.\d+)? \d+% (8\d|9\d)%\)$/);
    assert.match(p.accent, /^hsl\(/);
    assert.equal(p.hue, chatHue('chat-a'));
  });

  it('returns a dark background in dark mode', () => {
    const p = chatPalette('chat-a', { dark: true, intensity: 1 });
    assert.match(p.background, /^hsl\(\d+(\.\d+)? \d+% (1\d|[0-9])%\)$/);
  });

  it('scales saturation with intensity', () => {
    const sat = (p) => Number(p.background.split(' ')[1].replace('%', ''));
    const low = chatPalette('chat-a', { intensity: 0.2 });
    const high = chatPalette('chat-a', { intensity: 1 });
    assert.ok(sat(low) < sat(high));
  });

  it('clamps intensity into [0, 1]', () => {
    assert.deepEqual(chatPalette('c', { intensity: 5 }), chatPalette('c', { intensity: 1 }));
    assert.deepEqual(chatPalette('c', { intensity: -1 }), chatPalette('c', { intensity: 0 }));
  });

  it('honours a hue override', () => {
    assert.equal(chatPalette('chat-a', { hueOverride: 120 }).hue, 120);
  });
});
