const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { isGenerating, createCompletionWatcher, GENERATING_SELECTORS } = require('../../src/lib/generation.js');

const S = 1000;

describe('isGenerating', () => {
  function doc(html) {
    return new JSDOM(`<body>${html}</body>`).window.document;
  }

  it('detects a streaming message', () => {
    assert.equal(isGenerating(doc('<div data-is-streaming="true">hi</div>')), true);
  });

  it('detects the stop button', () => {
    assert.equal(isGenerating(doc('<button aria-label="Stop response">x</button>')), true);
  });

  it('is false for a finished conversation', () => {
    assert.equal(isGenerating(doc('<div data-is-streaming="false">done</div><button aria-label="Send message"></button>')), false);
  });

  it('accepts custom selectors', () => {
    assert.equal(isGenerating(doc('<i class="spin"></i>'), ['.spin']), true);
  });

  it('survives invalid selectors', () => {
    assert.equal(isGenerating(doc('<i class="spin"></i>'), ['::::bad', '.spin']), true);
  });

  it('exports a non-empty default selector list', () => {
    assert.ok(GENERATING_SELECTORS.length > 0);
  });
});

describe('createCompletionWatcher', () => {
  it('reports start and a settled completion', () => {
    const w = createCompletionWatcher({ settleMs: 1500 });
    assert.equal(w.update(true, 0), 'started');
    assert.equal(w.update(true, 1 * S), null);
    assert.equal(w.update(false, 2 * S), null); // not settled yet
    assert.equal(w.update(false, 3 * S), null);
    assert.equal(w.update(false, 3.5 * S), 'completed');
    assert.equal(w.update(false, 10 * S), null);
  });

  it('does not report completion for a brief flicker', () => {
    const w = createCompletionWatcher({ settleMs: 1500 });
    w.update(true, 0);
    w.update(false, 1 * S);
    assert.equal(w.update(true, 2 * S), null); // resumed, not a new start
    assert.equal(w.update(false, 3 * S), null);
    assert.equal(w.update(false, 5 * S), 'completed');
  });

  it('reports how long the response took', () => {
    const w = createCompletionWatcher({ settleMs: 1000 });
    w.update(true, 10 * S);
    w.update(false, 40 * S);
    w.update(false, 41 * S);
    assert.equal(w.lastDurationMs(), 30 * S);
  });

  it('never completes without a start', () => {
    const w = createCompletionWatcher();
    assert.equal(w.update(false, 0), null);
    assert.equal(w.update(false, 100 * S), null);
  });
});
