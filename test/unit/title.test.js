const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decorateTitle, stripStatus, STATUS_PREFIX } = require('../../src/lib/title.js');

describe('decorateTitle', () => {
  it('adds a generating marker', () => {
    assert.equal(decorateTitle('My chat - Claude', 'generating'), `${STATUS_PREFIX.generating}My chat - Claude`);
  });

  it('adds a done marker', () => {
    assert.equal(decorateTitle('My chat - Claude', 'done'), `${STATUS_PREFIX.done}My chat - Claude`);
  });

  it('replaces an existing marker rather than stacking', () => {
    const once = decorateTitle('T', 'generating');
    assert.equal(decorateTitle(once, 'done'), `${STATUS_PREFIX.done}T`);
  });

  it('removes markers when status is none', () => {
    assert.equal(decorateTitle(decorateTitle('T', 'done'), 'none'), 'T');
  });
});

describe('stripStatus', () => {
  it('is a no-op for clean titles', () => {
    assert.equal(stripStatus('Claude'), 'Claude');
  });
});
