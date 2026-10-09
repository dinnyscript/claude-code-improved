// Static checks on the extension packaging: every referenced file exists and
// classic scripts are loaded after the modules they depend on.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function depsOf(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...src.matchAll(/require\('\.\/([\w-]+\.js)'\)/g)].map((m) => path.posix.join(path.posix.dirname(file), m[1]));
}

function assertLoadOrder(scripts) {
  scripts.forEach((file, i) => {
    for (const dep of depsOf(file)) {
      const at = scripts.indexOf(dep);
      assert.ok(at !== -1 && at < i, `${file} needs ${dep} loaded before it`);
    }
  });
}

function htmlScripts(rel) {
  const { document } = new JSDOM(fs.readFileSync(path.join(ROOT, rel), 'utf8')).window;
  return [...document.querySelectorAll('script[src]')].map((s) =>
    path.posix.normalize(path.posix.join(path.posix.dirname(rel), s.getAttribute('src')))
  );
}

describe('manifest.json', () => {
  it('is a Manifest V3 extension with the permissions it needs and no more', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'notifications', 'storage']);
    assert.deepEqual(manifest.host_permissions, ['https://claude.ai/*']);
  });

  it('references files that exist', () => {
    const files = [
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      manifest.action.default_popup,
      manifest.options_ui.page,
      manifest.background.service_worker,
      ...manifest.content_scripts.flatMap((c) => c.js),
    ];
    for (const f of files) assert.ok(exists(f), `missing ${f}`);
  });

  it('loads content-script modules in dependency order', () => {
    assertLoadOrder(manifest.content_scripts[0].js);
  });

  it('service worker imports existing modules in dependency order', () => {
    const swPath = manifest.background.service_worker;
    const src = fs.readFileSync(path.join(ROOT, swPath), 'utf8');
    const imports = [...src.matchAll(/'(\.\.\/lib\/[\w-]+\.js)'/g)].map((m) =>
      path.posix.normalize(path.posix.join(path.posix.dirname(swPath), m[1]))
    );
    assert.ok(imports.length > 0);
    for (const f of imports) assert.ok(exists(f), `missing ${f}`);
    assertLoadOrder(imports);
  });

  for (const page of ['src/popup/popup.html', 'src/options/options.html']) {
    it(`${page} loads existing scripts in dependency order`, () => {
      const scripts = htmlScripts(page);
      for (const f of scripts) assert.ok(exists(f), `missing ${f}`);
      assertLoadOrder(scripts);
    });
  }
});
