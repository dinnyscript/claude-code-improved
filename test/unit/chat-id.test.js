const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseChatId } = require('../../src/lib/chat-id.js');

describe('parseChatId', () => {
  it('extracts the id from a chat URL', () => {
    assert.equal(
      parseChatId('https://claude.ai/chat/0b6c1f2e-1111-4a4a-9e9e-123456789abc'),
      '0b6c1f2e-1111-4a4a-9e9e-123456789abc'
    );
  });

  it('ignores query strings, hashes and trailing slashes', () => {
    assert.equal(parseChatId('https://claude.ai/chat/abc-123/?foo=1#bar'), 'abc-123');
  });

  it('returns null for pages that are not a specific chat', () => {
    assert.equal(parseChatId('https://claude.ai/new'), null);
    assert.equal(parseChatId('https://claude.ai/recents'), null);
    assert.equal(parseChatId('https://claude.ai/project/xyz'), null);
    assert.equal(parseChatId('https://claude.ai/'), null);
  });

  it('returns null for other hosts', () => {
    assert.equal(parseChatId('https://example.com/chat/abc'), null);
  });

  it('returns null for garbage input', () => {
    assert.equal(parseChatId('not a url'), null);
    assert.equal(parseChatId(undefined), null);
  });

  it('only accepts id-like path segments', () => {
    assert.equal(parseChatId('https://claude.ai/chat/__proto__'), null);
    assert.equal(parseChatId('https://claude.ai/chat/a%20b'), null);
    assert.equal(parseChatId('https://claude.ai/chat/0b6c1f2e-1111-4a4a-9e9e-123456789abc'), '0b6c1f2e-1111-4a4a-9e9e-123456789abc');
  });
});

describe('isTrackableChatKey', () => {
  const { isTrackableChatKey, OTHER_CHAT } = require('../../src/lib/chat-id.js');
  it('accepts chat ids and the shared bucket, nothing else', () => {
    assert.equal(isTrackableChatKey('abc-123'), true);
    assert.equal(isTrackableChatKey(OTHER_CHAT), true);
    assert.equal(isTrackableChatKey('__proto__'), false);
    assert.equal(isTrackableChatKey(''), false);
    assert.equal(isTrackableChatKey(42), false);
    assert.equal(isTrackableChatKey('x'.repeat(101)), false);
  });
});
