/**
 * Hardware probe — fills in the rows of docs/testing.md that CI cannot reach.
 *
 * CI has no MIDI interface and no mixer on its network, so everything this
 * checks is invisible to automation. Run it on each platform against a real
 * console:
 *
 *   node tools/hw-probe.js                 discover, then probe what it finds
 *   node tools/hw-probe.js 192.168.21.41   skip discovery, go straight to a mixer
 *
 * Read-only by default. It never writes to the console unless --write is
 * passed, and then only to the channel named by --channel.
 */

const os = require('os');

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
