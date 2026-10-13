/**
 * Launcher for the screenshot harness.
 *
 * The startup handling — sandbox flag, ELECTRON_RUN_AS_NODE, headless mode and
 * a display on Linux — is shared with the hardware harness and lives in
 * tools/launch-harness.js.
 */

const path = require('path');
const launchHarness = require('../launch-harness');

launchHarness(path.join(__dirname, 'main.js'));
