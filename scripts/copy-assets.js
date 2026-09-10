/**
 * Copy the renderer and icon assets into dist/, stamping the version.
 *
 * This was a chain of `mkdir -p` and `cp` in the npm script, which meant
 * `npm run build` could not run on Windows — the release workflow's Windows
 * job had to duplicate every step by hand in bash, and CI could not run the
 * screenshot harness there at all. Doing it in Node keeps one implementation
 * that works on all three platforms.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

const mkdir = (p) => fs.mkdirSync(p, { recursive: true });

/** Copy a file if it exists; missing optional assets are not an error. */
function copyIfPresent(from, toDir) {
  if (!fs.existsSync(from)) return false;
  mkdir(toDir);
  fs.copyFileSync(from, path.join(toDir, path.basename(from)));
  return true;
}

// --- renderer -------------------------------------------------------------
const rendererDir = path.join(dist, 'renderer');
mkdir(rendererDir);

const rendererHtml = path.join(rendererDir, 'index.html');
fs.copyFileSync(path.join(root, 'src', 'renderer', 'index.html'), rendererHtml);

// Stamp the version into the status bar so the running app reports what was
// actually built rather than whatever was last hard-coded.
const { version } = require(path.join(root, 'package.json'));
fs.writeFileSync(
  rendererHtml,
  fs
    .readFileSync(rendererHtml, 'utf8')
    .replace(/id="status-version">[^<]*/, `id="status-version">${version}`)
);

// --- icons ----------------------------------------------------------------
const iconsSrc = path.join(root, 'assets', 'icons');
const iconsDest = path.join(rendererDir, 'icons');
mkdir(iconsDest);
if (fs.existsSync(iconsSrc)) {
  for (const entry of fs.readdirSync(iconsSrc)) {
    if (/\.(svg|png)$/i.test(entry)) {
      fs.copyFileSync(path.join(iconsSrc, entry), path.join(iconsDest, entry));
    }
  }
}

// --- app icons ------------------------------------------------------------
// icon.icns is macOS-only and absent from some checkouts; both are optional.
const assetsDest = path.join(dist, 'assets');
mkdir(assetsDest);
for (const name of ['icon.icns', 'icon.png']) {
  copyIfPresent(path.join(root, 'assets', name), assetsDest);
}
