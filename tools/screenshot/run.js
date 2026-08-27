/**
 * Launcher for the screenshot harness.
 *
 * Two things have to be handled before Electron starts, which is why this
 * exists rather than invoking `electron main.js` directly:
 *
 *   --no-sandbox must be a real command-line argument. Electron validates the
 *   SUID sandbox helper's ownership and mode during startup, before the app's
 *   own app.commandLine.appendSwitch() calls are read, so setting it in
 *   main.js is too late — CI aborts with "chrome-sandbox is not configured
 *   correctly" and the process dies with SIGTRAP. Only Linux needs it.
 *
 *   ELECTRON_RUN_AS_NODE must be cleared. Editor-integrated terminals (VS
 *   Code's among them) export it, and any Electron inheriting it silently
 *   starts as plain Node instead — `app` comes back undefined and the failure
 *   reads like a bug in main.js.
 */

const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const args = [];
if (process.platform === 'linux') args.push('--no-sandbox');
args.push(path.join(__dirname, 'main.js'), ...process.argv.slice(2));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

spawn(electron, args, { stdio: 'inherit', env })
  .on('close', (code) => process.exit(code ?? 1));
