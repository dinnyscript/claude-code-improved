// Builds dist/claude-chat-focus/ (the unpacked extension, without dev files)
// and, when the `zip` CLI is available, dist/claude-chat-focus.zip for the Chrome Web Store.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'claude-chat-focus');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const entry of ['manifest.json', 'icons', 'src', 'LICENSE']) {
  fs.cpSync(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true });
}
console.log(`Unpacked extension: ${path.relative(ROOT, OUT)}`);

try {
  execFileSync('zip', ['-qr', path.join(DIST, 'claude-chat-focus.zip'), '.'], { cwd: OUT });
  console.log(`Zip: ${path.relative(ROOT, path.join(DIST, 'claude-chat-focus.zip'))}`);
} catch {
  console.log('`zip` not found; skipped creating the .zip');
}
