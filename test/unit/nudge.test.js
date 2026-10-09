const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createNudger, nudgeMessage } = require('../../src/lib/nudge.js');

const S = 1000;

describe('createNudger', () => {
  it('does not nudge before the threshold', () => {
    const n = createNudger({ nudgeAfterMs: 120 * S });
    assert.equal(n.check(119 * S), null);
  });

  it('nudges once when the staring streak reaches the threshold', () => {
    const n = createNudger({ nudgeAfterMs: 120 * S });
    assert.equal(n.check(120 * S), 1);
    assert.equal(n.check(150 * S), null);
  });

  it('escalates at each further multiple of the threshold', () => {
    const n = createNudger({ nudgeAfterMs: 60 * S });
    assert.equal(n.check(60 * S), 1);
    assert.equal(n.check(119 * S), null);
    assert.equal(n.check(121 * S), 2);
    assert.equal(n.check(200 * S), 3);
  });

  it('re-arms after the streak resets', () => {
    const n = createNudger({ nudgeAfterMs: 60 * S });
    assert.equal(n.check(60 * S), 1);
    assert.equal(n.check(0), null);
    assert.equal(n.check(60 * S), 1);
  });

  it('can be disabled', () => {
    const n = createNudger({ nudgeAfterMs: 60 * S, enabled: false });
    assert.equal(n.check(600 * S), null);
  });

  it('picks up configuration changes', () => {
    const n = createNudger({ nudgeAfterMs: 60 * S });
    n.configure({ nudgeAfterMs: 10 * S });
    assert.equal(n.check(10 * S), 1);
  });
});

describe('nudgeMessage', () => {
  it('suggests switching tasks while Claude is still writing', () => {
    const m = nudgeMessage({ level: 1, state: 'waiting', streakMs: 120 * S });
    assert.match(m.title, /2m/);
    assert.match(m.body, /notif/i);
  });

  it('suggests a next action when idle', () => {
    const m = nudgeMessage({ level: 1, state: 'idle', streakMs: 120 * S });
    assert.match(m.title, /2m/);
    assert.match(m.body, /reply|close|next/i);
  });

  it('gets firmer at higher levels', () => {
    const a = nudgeMessage({ level: 1, state: 'idle', streakMs: 60 * S });
    const b = nudgeMessage({ level: 3, state: 'idle', streakMs: 180 * S });
    assert.notEqual(a.body, b.body);
  });
});

describe('nudgeMessage without completion notifications', () => {
  it('does not promise a notification that will not come', () => {
    for (const level of [1, 2]) {
      const m = nudgeMessage({ level, state: 'waiting', streakMs: 120 * S, notify: false });
      assert.doesNotMatch(m.body, /notif/i);
      assert.match(m.body, /come back|check back|switch/i);
    }
  });
});
