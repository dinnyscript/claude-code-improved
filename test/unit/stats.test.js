const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  emptyTotals,
  addDelta,
  summarizeDay,
  recentDays,
  pruneOldDays,
  statsKey,
  createMemoryStorage,
} = require('../../src/lib/stats.js');

const S = 1000;
const MIN = 60 * S;

describe('statsKey', () => {
  it('namespaces day keys', () => {
    assert.equal(statsKey('2026-10-09'), 'stats:2026-10-09');
  });
});

describe('addDelta', () => {
  it('creates a day and chat entry on first write', async () => {
    const storage = createMemoryStorage();
    await addDelta(storage, '2026-10-09', 'chat-1', { activeMs: 5 * S, idleMs: 2 * S }, { title: 'Fix bug', now: 123 });
    const data = await storage.get('stats:2026-10-09');
    assert.deepEqual(data['stats:2026-10-09'].chats['chat-1'], {
      ...emptyTotals(),
      activeMs: 5 * S,
      idleMs: 2 * S,
      title: 'Fix bug',
      lastSeen: 123,
    });
  });

  it('accumulates repeated deltas', async () => {
    const storage = createMemoryStorage();
    await addDelta(storage, '2026-10-09', 'chat-1', { activeMs: 5 * S });
    await addDelta(storage, '2026-10-09', 'chat-1', { activeMs: 5 * S, waitingMs: 1 * S });
    const day = (await storage.get('stats:2026-10-09'))['stats:2026-10-09'];
    assert.equal(day.chats['chat-1'].activeMs, 10 * S);
    assert.equal(day.chats['chat-1'].waitingMs, 1 * S);
  });

  it('ignores negative and non-numeric fields', async () => {
    const storage = createMemoryStorage();
    await addDelta(storage, '2026-10-09', 'c', { activeMs: -5, idleMs: 'x', bogus: 7 });
    const chat = (await storage.get('stats:2026-10-09'))['stats:2026-10-09'].chats.c;
    assert.equal(chat.activeMs, 0);
    assert.equal(chat.idleMs, 0);
    assert.equal('bogus' in chat, false);
  });

  it('keeps the previous title when none is given', async () => {
    const storage = createMemoryStorage();
    await addDelta(storage, 'd', 'c', { activeMs: 1 }, { title: 'First' });
    await addDelta(storage, 'd', 'c', { activeMs: 1 });
    assert.equal((await storage.get('stats:d'))['stats:d'].chats.c.title, 'First');
  });

  it('serialises concurrent writes without losing updates', async () => {
    const storage = createMemoryStorage({ latencyMs: 2 });
    await Promise.all(Array.from({ length: 20 }, () => addDelta(storage, 'd', 'c', { activeMs: 1 })));
    assert.equal((await storage.get('stats:d'))['stats:d'].chats.c.activeMs, 20);
  });
});

describe('summarizeDay', () => {
  it('sums totals and ranks chats by staring time', () => {
    const day = {
      chats: {
        a: { ...emptyTotals(), activeMs: 10 * MIN, idleMs: 1 * MIN, title: 'A' },
        b: { ...emptyTotals(), activeMs: 1 * MIN, idleMs: 5 * MIN, waitingMs: 5 * MIN, title: 'B' },
      },
    };
    const s = summarizeDay(day);
    assert.equal(s.totals.activeMs, 11 * MIN);
    assert.equal(s.totals.idleMs, 6 * MIN);
    assert.equal(s.totals.waitingMs, 5 * MIN);
    assert.equal(s.totals.staringMs, 11 * MIN);
    assert.deepEqual(s.chats.map((c) => c.chatId), ['b', 'a']);
    assert.equal(s.chats[0].staringMs, 10 * MIN);
    assert.equal(s.focusScore, 50);
  });

  it('handles a missing day', () => {
    const s = summarizeDay(undefined);
    assert.equal(s.totals.activeMs, 0);
    assert.deepEqual(s.chats, []);
    assert.equal(s.focusScore, null);
  });
});

describe('recentDays', () => {
  it('returns the last N day summaries oldest first, filling gaps', async () => {
    const storage = createMemoryStorage();
    await addDelta(storage, '2026-10-08', 'c', { activeMs: 1 * MIN });
    await addDelta(storage, '2026-10-09', 'c', { idleMs: 2 * MIN });
    const days = await recentDays(storage, 3, new Date(2026, 9, 9, 12));
    assert.deepEqual(days.map((d) => d.day), ['2026-10-07', '2026-10-08', '2026-10-09']);
    assert.equal(days[0].totals.activeMs, 0);
    assert.equal(days[1].totals.activeMs, 1 * MIN);
    assert.equal(days[2].totals.staringMs, 2 * MIN);
  });
});

describe('pruneOldDays', () => {
  it('removes stats older than the retention window', async () => {
    const storage = createMemoryStorage();
    await addDelta(storage, '2026-09-01', 'c', { activeMs: 1 });
    await addDelta(storage, '2026-10-08', 'c', { activeMs: 1 });
    await storage.set({ unrelated: true });
    const removed = await pruneOldDays(storage, 30, new Date(2026, 9, 9));
    assert.deepEqual(removed, ['stats:2026-09-01']);
    const all = await storage.get(null);
    assert.deepEqual(Object.keys(all).sort(), ['stats:2026-10-08', 'unrelated']);
  });
});
