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
// A container's /dev/shm is often too small for Chromium's allocations, so
// point it elsewhere on Linux. The other flag headless Linux needs,
// --no-sandbox, cannot be set here — Electron validates the SUID sandbox
// helper before these switches are read — so tools/screenshot/run.js passes it
// on the command line instead. Launch through that, not this file directly.
//
// If the sandbox flag is missing, the failure surfaces confusingly as a shared
// memory error ("Creating shared memory in /dev/shm/... failed: No such
// process") rather than as a sandbox complaint — chasing /dev/shm permissions
// is a dead end. Launching through run.js is the fix.
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-dev-shm-usage');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scenes named on the command line, e.g. `npm run shots -- toolbar`.
 * Sliced relative to this file's own position in argv rather than a fixed
 * index: run.js prepends Chromium flags on Linux, which would otherwise shift
 * the script path into the scene list and select nothing.
 */
const selfIndex = process.argv.findIndex((a) => a.endsWith('main.js'));
const wanted = process.argv.slice(selfIndex + 1).filter((a) => !a.startsWith('-'));
const selected = wanted.length ? SCENES.filter((s) => wanted.includes(s.name)) : SCENES;

async function capture(win, scene) {
  // Reset to a clean main window between scenes so one scene's open modal
  // can't leak into the next one's shot.
  await win.webContents.executeJavaScript(`
    document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.context-menu.show').forEach(m => m.classList.remove('show'));
    document.getElementById('__shotAnnotations')?.remove();
    window.scrollTo(0, 0);
  `);
  await sleep(120);

  // A scene can undo state an earlier one left behind (app mode, say) before
  // its own setup runs.
  if (scene.reset) {
    await win.webContents.executeJavaScript(`(async () => { ${scene.reset} })()`, true);
    await sleep(150);
  }

  if (scene.setup) {
    await win.webContents.executeJavaScript(`(async () => { ${scene.setup} })()`, true);
  }
  await sleep(scene.settle ?? 400);

  // Numbered callout badges, for the annotated shot the docs site pairs with a
  // legend. Drawn into the page rather than added in an image editor so the
  // annotated screenshot regenerates with everything else instead of drifting
  // a few versions behind — which is exactly what happened to the old one.
  if (scene.annotate) {
    await win.webContents.executeJavaScript(`(() => {
      const marks = ${JSON.stringify(scene.annotate)};
      const layer = document.createElement('div');
      layer.id = '__shotAnnotations';
      layer.style.cssText =
        'position:fixed;inset:0;z-index:99999;pointer-events:none';
      for (const m of marks) {
        const el = document.querySelector(m.selector);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const badge = document.createElement('div');
        badge.textContent = m.n;
        // Anchored to a fraction along the target so a callout can sit over
        // the part of a wide region it actually refers to.
        const x = r.left + r.width * (m.x ?? 0.5) + (m.dx ?? 0);
        const y = r.top + r.height * (m.y ?? 0.5) + (m.dy ?? 0);
        badge.style.cssText =
          'position:absolute;width:34px;height:34px;border-radius:50%;' +
          'display:flex;align-items:center;justify-content:center;' +
          'background:#2e7d5b;color:#fff;font:700 17px/1 system-ui,sans-serif;' +
          'box-shadow:0 2px 10px rgba(0,0,0,.65);border:2px solid #7fd1ad;' +
          'left:' + Math.round(x - 17) + 'px;top:' + Math.round(y - 17) + 'px';
        layer.appendChild(badge);
      }
      document.body.appendChild(layer);
    })()`);
    await sleep(120);
  }

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
