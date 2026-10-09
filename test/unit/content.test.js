const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../src/content/content.js'), 'utf8');

function run(globals) {
  const context = vm.createContext({ window: {}, document: {}, chrome: {}, console, ...globals });
  context.globalThis = context;
  vm.runInContext(source, context);
  return context;
}

describe('content script entry', () => {
  it('starts a controller', () => {
    let started = 0;
    const ctx = run({ CCF: { createController: () => ({ start: async () => started++, destroy() {} }) } });
    assert.equal(started, 1);
    assert.ok(ctx.__ccfController);
  });

  it('replaces a controller orphaned by an extension update instead of bailing out', () => {
    let destroyed = 0;
    let started = 0;
    run({
      __ccfController: { destroy: () => destroyed++ },
      CCF: { createController: () => ({ start: async () => started++, destroy() {} }) },
    });
    assert.equal(destroyed, 1);
    assert.equal(started, 1);
  });
});
