/**
 * Launcher for the hardware integration harness.
 *
 * Same two startup problems as the screenshot runner, for the same reasons:
 * `--no-sandbox` has to be a real argv entry on Linux because Electron checks
 * the SUID helper before the app reads its own switches, and
 * ELECTRON_RUN_AS_NODE has to be cleared because editor terminals export it and
 * an Electron that inherits it starts as plain Node with `app` undefined.
 *
 *   node tools/hw-integration/run.js 192.168.21.41
 *   node tools/hw-integration/run.js 192.168.21.41 --keep   leave artifacts
 */

const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const args = [];
if (process.platform === 'linux') args.push('--no-sandbox');
args.push(path.join(__dirname, 'main.js'), ...process.argv.slice(2));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Headless, always, and not as a flag the caller can forget: an Electron that
// activates steals the foreground from whoever is working in that session.
env.SLMC_HEADLESS = '1';

spawn(electron, args, { stdio: 'inherit', env })
  .on('close', (code) => process.exit(code ?? 1));
