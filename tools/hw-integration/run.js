/**
 * Launcher for the hardware integration harness.
 *
 * The startup handling — sandbox flag, ELECTRON_RUN_AS_NODE, headless mode and
 * a display on Linux — is shared with the screenshot harness and lives in
 * tools/launch-harness.js.
 *
 *   node tools/hw-integration/run.js 192.168.21.41
 *   node tools/hw-integration/run.js 192.168.21.41 --keep   leave artifacts
 */

const path = require('path');
const launchHarness = require('../launch-harness');

launchHarness(path.join(__dirname, 'main.js'));
