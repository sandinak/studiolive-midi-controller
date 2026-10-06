/**
 * Hardware probe — fills in the rows of docs/testing.md that CI cannot reach.
 *
 * CI has no MIDI interface and no mixer on its network, so everything this
 * checks is invisible to automation. Run it on each platform against a real
 * console:
 *
 *   node tools/hw-probe.js                 discover, then probe what it finds
 *   node tools/hw-probe.js 192.168.21.41   skip discovery, go straight to a mixer
 *   node tools/hw-probe.js --dump-tree     also save the live state tree
 *   node tools/hw-probe.js --dump-tree --anonymise   ...safe to commit
 *
 * Read-only by default. It never writes to the console unless --write is
 * passed, and then only to the channel named by --channel.
 *
 * --dump-tree writes the console's whole published state to a JSON file,
 * redacted (see src/shared/state-redaction.ts). It needs a build, because it
 * uses the project's redactor rather than a second copy of those rules.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const host = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (s) => `  [ok]   ${s}`;
const no = (s) => `  [FAIL] ${s}`;
const info = (s) => `         ${s}`;

function heading(s) {
  console.log(`\n=== ${s} ${'='.repeat(Math.max(0, 58 - s.length))}`);
}

/**
 * Write the console's live state tree to a file.
 *
 * This is the only way to see what a particular console and firmware actually
 * publish. Nothing else in the project has ever captured one: the protocol
 * library's state-tree type was generated from somebody else's console in 2021
 * and is already missing parameters that appear in real documents, and every
 * test fixture here is synthetic. A dump from each model is what the backup work
 * is designed against.
 *
 * The dump is redacted before it touches the disk, not on the way out of it —
 * the raw tree holds the console's serial, its registered owner, its network
 * configuration and its remote-access code, and a file that lands unredacted is
 * a file somebody will attach to an issue. `--anonymise` additionally strips
 * channel labels and scene names, which is required before committing one as a
 * fixture because labels on a working board name the people behind them.
 */
function dumpTree(client, counts) {
  heading('STATE TREE');

  let redactStateDump;
  try {
    ({ redactStateDump } = require(path.join(__dirname, '..', 'dist', 'shared', 'state-redaction')));
  } catch (err) {
    console.log(no('--dump-tree needs a build; run `npm run build` first'));
    console.log(info(err.message));
    return;
  }

  // dumpState() is marked @internal in the library, which is accurate: it is a
  // debugging hook, and the shape it returns is not part of the public contract.
  // That is acceptable for a probe and would not be for shipped code.
  let raw;
  try {
    raw = client.dumpState();
  } catch (err) {
    console.log(no(`could not dump state: ${err.message}`));
    return;
  }

  const anonymise = flag('anonymise');
  const { dump, report } = redactStateDump(raw, { anonymise });

  const tree = dump && dump.internal ? dump.internal : dump;
  const roots = Object.keys(tree || {}).sort();
  console.log(info(`roots (${roots.length}): ${roots.join(', ')}`));

  // Leaf count is the figure that matters for a restore: it is how many
  // parameter writes a full replay would be.
  const leaves = (node) =>
    node && typeof node === 'object'
      ? Object.values(node).reduce((n, v) => n + leaves(v), 0)
      : 1;
  console.log(info(`leaf parameters: ${leaves(tree)}`));

  // Which parameters publish a range — only preamp gain was known to.
  const ranged = [];
  const findRanges = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'range' && value && typeof value === 'object') ranged.push(trail.join('/'));
      else findRanges(value, [...trail, key]);
    }
  };
  findRanges(tree, []);
  console.log(info(`parameters publishing a range: ${ranged.length}`));
  if (ranged.length) console.log(info(`  e.g. ${ranged.slice(0, 6).join(', ')}`));

  const model = (client.state.get('global.mixer_name') || 'console')
    .toString().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'console';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = opt('dump-tree', '').startsWith('--') || !opt('dump-tree', '')
    ? `state-dump-${model}${anonymise ? '-anon' : ''}-${stamp}.json`
    : opt('dump-tree', '');

  try {
    fs.writeFileSync(file, JSON.stringify(dump, null, 1));
  } catch (err) {
    console.log(no(`could not write ${file}: ${err.message}`));
    return;
  }

  console.log(ok(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`));
  console.log(info(`removed roots:   ${report.removedRoots.join(', ') || 'none'}`));
  console.log(info(`redacted fields: ${report.redactedPaths.length}`));
  if (!anonymise) {
    console.log(info('channel labels and scene names are PRESENT — pass --anonymise'));
    console.log(info('before committing this as a fixture or attaching it to an issue'));
  }
  if (counts && counts.LINE) {
    console.log(info(`console shape: ${JSON.stringify(counts)}`));
  }
}

async function probeMidi() {
  heading('MIDI');
  let easymidi;
  try {
    easymidi = require('easymidi');
  } catch (err) {
    console.log(no(`could not load easymidi: ${err.message}`));
    console.log(info('the native module failed to load — that is the finding'));
    return false;
  }

  // Backend differs per platform: CoreMIDI, WinMM, ALSA. Enumeration is the
  // first thing that has never run on Windows or Linux.
  const inputs = easymidi.getInputs();
  const outputs = easymidi.getOutputs();
  console.log(ok(`easymidi loaded (${process.platform})`));
  console.log(info(`inputs  (${inputs.length}): ${inputs.join(', ') || '(none)'}`));
  console.log(info(`outputs (${outputs.length}): ${outputs.join(', ') || '(none)'}`));

  if (!inputs.length) {
    console.log(info('no inputs — attach a controller, or a virtual port (loopMIDI on Windows)'));
    return true;
  }

  // Opening a port is the part that actually exercises the backend.
  try {
    const input = new easymidi.Input(inputs[0]);
    console.log(ok(`opened input "${inputs[0]}"`));
    if (flag('listen')) {
      console.log(info('listening 15s — move a fader or press a pad...'));
      let seen = 0;
      for (const ev of ['cc', 'noteon', 'noteoff', 'program', 'pitch']) {
        input.on(ev, (m) => {
          seen++;
          if (seen <= 12) console.log(info(`  ${ev} ${JSON.stringify(m)}`));
        });
      }
      await wait(15000);
      console.log(seen ? ok(`received ${seen} messages`) : no('no messages received'));
    }
    input.close();
    console.log(ok('closed input cleanly'));
  } catch (err) {
    console.log(no(`opening input failed: ${err.message}`));
  }
  return true;
}

async function probeMixer() {
  heading('MIXER');
  const { Client } = require('presonus-studiolive-api');

  let target = host;
  if (!target) {
    console.log(info('discovering (10s)...'));
    const found = await Client.discover(10000);
    if (!found.length) {
      console.log(no('discovery found nothing'));
      console.log(info('on a VM this usually means NAT networking — bridged is required'));
      return;
    }
    for (const m of found) {
      console.log(ok(`${m.model || m.name} "${m.deviceName || '?'}" at ${m.ip} (serial ${m.serial})`));
    }
    target = found[0].ip;
  }

  const c = new Client({ host: target, port: 53000 }, { autoreconnect: false });
  const started = Date.now();
  await c.connect({ clientDescription: 'hw-probe', clientIdentifier: 'probe' });
  await wait(2500);
  console.log(ok(`connected to ${target} in ${Date.now() - started}ms`));

  const counts = c.channelCounts || {};
  console.log(info(`channel counts: ${JSON.stringify(counts)}`));
  if (counts.LINE > 16) {
    console.log(info(`${counts.LINE} LINE channels — this console exercises fader stacking`));
  }

  const range = c.getParameterRange('line/ch1/preampgain');
  console.log(info(`preamp gain range: ${range ? JSON.stringify(range) : 'not published'}`));

  const sample = Math.min(counts.LINE || 16, 4);
  for (let i = 1; i <= sample; i++) {
    const name = c.state.get(`line.ch${i}.username`) || c.state.get(`line.ch${i}.name`);
    const icon = c.state.get(`line.ch${i}.iconid`) || '(no icon)';
    const gain = c.getPreampGain({ type: 'LINE', channel: i });
    console.log(info(`  ch${String(i).padEnd(2)} ${String(name).padEnd(16)} ${String(icon).padEnd(22)} gain ${gain === null ? '?' : gain.toFixed(1) + ' dB'}`));
  }

  const presets = await c.getChannelPresets().catch(() => []);
  console.log(info(`channel presets on console: ${presets.length}`));

  if (flag('dump-tree')) dumpTree(c, counts);

  // Optional, explicitly opt-in, and restored afterwards.
  if (flag('write')) {
    const ch = Number(opt('channel', 0));
    if (!ch) {
      console.log(no('--write needs --channel <n>; refusing to guess'));
    } else {
      const sel = { type: 'LINE', channel: ch };
      const before = c.getSwitch(sel, 'polarity');
      console.log(info(`write test on ch${ch}: polarity is ${before}`));
      c.setSwitch(sel, 'polarity', !before);
      await wait(1200);
      const flipped = c.getSwitch(sel, 'polarity');
      console.log(flipped === !before ? ok('switch write applied') : no('switch write had no effect'));
      c.setSwitch(sel, 'polarity', before);
      await wait(1200);
      console.log(c.getSwitch(sel, 'polarity') === before ? ok('restored') : no('RESTORE FAILED'));
    }
  }

  await c.close();
  console.log(ok('disconnected cleanly'));
}

(async () => {
  heading('HOST');
  console.log(info(`${os.type()} ${os.release()} ${os.arch()} | node ${process.versions.node}`));
  console.log(info(`hostname: ${os.hostname()}`));

  await probeMidi();
  await probeMixer().catch((e) => console.log(no(`mixer probe failed: ${e.message}`)));
  console.log('');
  process.exit(0);
})();
