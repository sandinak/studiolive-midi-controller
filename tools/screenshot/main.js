/**
 * Documentation screenshot harness.
 *
 * Launches the real renderer (dist/renderer/index.html) against the synthetic
 * mixer in fixtures.js, drives it through a list of scenes, and writes PNGs to
 * docs/images/. No mixer, no MIDI interface, and no network are involved, so
 * the same command produces the same images on macOS, Windows, or a headless
 * Linux box under xvfb-run.
 *
 *   npm run shots                 # every scene
 *   npm run shots -- main-window  # just the named scene(s)
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const SCENES = require('./scenes');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'dist', 'renderer', 'index.html');
const OUT_DIR = path.join(ROOT, 'docs', 'images');

// Captures come out at 1:1 with the window's CSS pixels — 1420px wide, which
// is wide enough for GitHub to downscale cleanly. Deliberately not forcing a
// device scale factor: macOS ignores the switch for offscreen windows while a
// Linux runner honours it, and images that change size by platform are worse
// than images that are merely 1x.
// The harness never touches audio or MIDI hardware; silence the subsystems
// that would otherwise complain on a headless runner.
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
// Headless Linux is where this runs unattended. CI runners have no user
// namespace for Chromium's sandbox, and a container's /dev/shm is often too
// small, so both switches are set on Linux generally rather than gated on CI —
// `xvfb-run npm run shots` then behaves the same on a build host as on a
// runner. This tool only ever loads a local file it just built, so dropping the
// sandbox costs nothing.
//
// These are not sufficient inside an unprivileged LXC container: its seccomp
// filter makes Chromium's shared-memory setup fail with ESRCH no matter which
// directory it is pointed at, and the page never loads. Run the harness in a
// VM or on a CI runner, or give the container a relaxed seccomp profile.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scenes named on the command line, e.g. `npm run shots -- toolbar`. */
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const selected = wanted.length ? SCENES.filter((s) => wanted.includes(s.name)) : SCENES;

async function capture(win, scene) {
  // Reset to a clean main window between scenes so one scene's open modal
  // can't leak into the next one's shot.
  await win.webContents.executeJavaScript(`
    document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.context-menu.show').forEach(m => m.classList.remove('show'));
    window.scrollTo(0, 0);
  `);
  await sleep(120);

  if (scene.setup) {
    await win.webContents.executeJavaScript(`(async () => { ${scene.setup} })()`, true);
  }
  await sleep(scene.settle ?? 400);

  // A scene either grabs the whole window or the bounding box of a selector.
  let rect;
  if (scene.clip) {
    rect = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(scene.clip)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const pad = ${scene.pad ?? 0};
      // crop.children:N ends the box just past the Nth child, so a
      // "first four channel strips" shot never clips a strip in half.
      const n = ${scene.crop && scene.crop.children ? scene.crop.children : 0};
      const nth = n ? el.children[n - 1] : null;
      const right = nth ? nth.getBoundingClientRect().right : r.right;
      return {
        x: Math.max(0, Math.round(r.left - pad)),
        y: Math.max(0, Math.round(r.top - pad)),
        width: Math.round(right - r.left + pad * 2),
        height: Math.round(r.height + pad * 2),
      };
    })()`);
    if (!rect) throw new Error(`scene "${scene.name}": selector ${scene.clip} not found`);
    // crop.width / crop.height cap the box in absolute pixels.
    if (scene.crop) {
      if (scene.crop.width) rect.width = Math.min(rect.width, scene.crop.width);
      if (scene.crop.height) rect.height = Math.min(rect.height, scene.crop.height);
    }
  }

  const image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
  const file = path.join(OUT_DIR, `${scene.name}.png`);
  fs.writeFileSync(file, image.toPNG());
  const { width, height } = image.getSize();
  console.log(`  ✓ ${scene.name}.png  ${width}×${height}`);
}

async function run() {
  if (!fs.existsSync(RENDERER)) {
    console.error(`✗ ${path.relative(ROOT, RENDERER)} not found — run "npm run build" first.`);
    app.exit(1);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    width: 1420,
    height: 900,
    show: false,
    backgroundColor: '#0b0d0c',
    webPreferences: {
      preload: path.join(__dirname, 'fixtures.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is sandboxed, so hand it the values it can't read itself.
      additionalArguments: [`--shot-app-version=${require(path.join(ROOT, 'package.json')).version}`],
    },
  });

  // Surface renderer errors — a silent blank screenshot is worse than a crash.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`  [renderer] ${message}`);
  });

  await win.loadFile(RENDERER);

  // The renderer normally populates itself after a mixer connects. Nothing
  // connects here, so kick the same load path the app uses once state is ready.
  await win.webContents.executeJavaScript(`(async () => {
    if (typeof loadFaders === 'function') await loadFaders();
    if (typeof updateStatus === 'function') await updateStatus();
    if (typeof loadMappings === 'function') await loadMappings();
  })()`, true).catch((e) => console.error(`  [init] ${e.message}`));
  await sleep(1200);

  console.log(`Capturing ${selected.length} scene(s) → docs/images/`);
  let failed = 0;
  for (const scene of selected) {
    try {
      await capture(win, scene);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${scene.name}: ${err.message}`);
    }
  }

  app.exit(failed ? 1 : 0);
}

app.whenReady().then(run).catch((err) => {
  console.error(err);
  app.exit(1);
});
