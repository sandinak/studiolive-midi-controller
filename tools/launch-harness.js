/**
 * Start an Electron harness, headless, on whatever platform is running it.
 *
 * Both harnesses need the same four things handled before Electron starts,
 * which is why this exists rather than invoking `electron main.js` directly.
 *
 *   `--no-sandbox` must be a real command-line argument. Electron validates the
 *   SUID sandbox helper's ownership and mode during startup, before the app's
 *   own `app.commandLine.appendSwitch()` calls are read, so setting it in
 *   main.js is too late — CI aborts with "chrome-sandbox is not configured
 *   correctly" and the process dies with SIGTRAP. Only Linux needs it.
 *
 *   `ELECTRON_RUN_AS_NODE` must be cleared. Editor-integrated terminals (VS
 *   Code's among them) export it, and any Electron inheriting it silently
 *   starts as plain Node instead — `app` comes back undefined and the failure
 *   reads like a bug in main.js.
 *
 *   `SLMC_HEADLESS` is set here rather than left to the caller. It makes the
 *   app create its window with `show: false` and hide its dock icon. On macOS
 *   `show: false` alone is not enough: the app is activated before any window
 *   exists, so a run steals the foreground from whoever is working in that
 *   session. This is not an option a caller can forget.
 *
 *   A display, on Linux. Electron will not start without one — it exits with
 *   "Missing X server or $DISPLAY" — so a run on a headless build host is
 *   wrapped in `xvfb-run`. Chromium's own `--ozone-platform=headless` looks
 *   like the tidier answer and is not: on Electron 44 it segfaults during GL
 *   initialisation, with or without `--disable-gpu`.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const electron = require('electron');

const XVFB_PATHS = ['/usr/bin/xvfb-run', '/usr/local/bin/xvfb-run'];

function findXvfbRun() {
  return XVFB_PATHS.find((p) => fs.existsSync(p)) || null;
}

/**
 * @param {string} mainScript Absolute path to the harness's Electron entry point.
 * @param {string[]} argv Arguments to pass through to it.
 */
module.exports = function launchHarness(mainScript, argv = process.argv.slice(2)) {
  const electronArgs = [];
  if (process.platform === 'linux') electronArgs.push('--no-sandbox');
  electronArgs.push(mainScript, ...argv);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.SLMC_HEADLESS = '1';

  let command = electron;
  let args = electronArgs;

  const headlessLinux = process.platform === 'linux'
    && !process.env.DISPLAY
    && !process.env.WAYLAND_DISPLAY;

  if (headlessLinux) {
    const xvfb = findXvfbRun();
    if (!xvfb) {
      console.error(
        'No display, and xvfb-run is not installed — Electron cannot start on\n'
        + 'Linux without one of them. Install it with:\n\n'
        + '  sudo apt-get install -y xvfb\n',
      );
      process.exit(1);
    }
    // -a picks a free server number, so two runs on one host cannot collide.
    command = xvfb;
    args = ['-a', electron, ...electronArgs];
  }

  spawn(command, args, { stdio: 'inherit', env })
    .on('close', (code) => process.exit(code ?? 1));
};
