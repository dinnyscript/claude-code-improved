const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStorage } = require('../../src/lib/stats.js');
const { getHueOverrides, setHueOverride, clearHueOverride, OVERRIDES_KEY } = require('../../src/lib/overrides.js');

describe('hue overrides', () => {
  it('starts empty', async () => {
    assert.deepEqual(await getHueOverrides(createMemoryStorage()), {});
  });

  it('stores a normalised hue per chat', async () => {
    const s = createMemoryStorage();
    await setHueOverride(s, 'a', 370);
    await setHueOverride(s, 'b', 200);
    assert.deepEqual(await getHueOverrides(s), { a: 10, b: 200 });
    assert.ok(OVERRIDES_KEY in (await s.get(null)));
  });

  it('rejects invalid hues', async () => {
    const s = createMemoryStorage();
    await assert.rejects(() => setHueOverride(s, 'a', 'red'));
  });

  it('clears a single chat override', async () => {
    const s = createMemoryStorage();
    await setHueOverride(s, 'a', 1);
    await setHueOverride(s, 'b', 2);
    await clearHueOverride(s, 'a');
    assert.deepEqual(await getHueOverrides(s), { b: 2 });
  });
});
