/**
 * Inspect a console backup archive.
 *
 * Universal Control's backup captures the console's *stored* document library,
 * not its live state. An archive from a board whose operator never saved a
 * scene therefore contains only the factory library — a successful backup of
 * nothing anybody wanted. That is invisible until you open the file, which is
 * what this does.
 *
 *   node tools/inspect-backup.js StudioLive32R_2026-10-05.bak
 *   node tools/inspect-backup.js --channels backup.bak    per-channel detail
 *   node tools/inspect-backup.js --json backup.bak        machine-readable
 *
 * Needs a build first (`npm run build`) — it uses the compiled reader rather
 * than a second copy of the parsing rules.
 */

const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
let reader;
let config;
try {
  reader = require(path.join(DIST, 'main', 'console-backup'));
  config = require(path.join(DIST, 'shared', 'console-config'));
} catch (err) {
  console.error('Could not load the compiled reader. Run `npm run build` first.');
  console.error(`  ${err.message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('usage: node tools/inspect-backup.js [--channels] [--json] <backup.bak>...');
  process.exit(2);
}

function heading(s) {
  console.log(`\n=== ${s} ${'='.repeat(Math.max(0, 58 - s.length))}`);
}

/** The channel roots worth printing, in the order an engineer reads a console. */
const DETAIL_ROOTS = ['line', 'aux', 'sub', 'fxbus', 'fxreturn', 'main', 'filtergroup'];

function describeChannels(doc) {
  for (const root of DETAIL_ROOTS) {
    const collection = doc[root];
    const numbers = config.channelNumbers(collection);
    if (numbers.length === 0) continue;

    console.log(`\n  ${root} (${numbers.length})`);
    for (const n of numbers) {
      const ch = collection[`ch${n}`] || {};
      // filtergroup uses `name`; everything else uses `username`.
      const label = config.stripLabelPrefix(ch.username) ?? config.stripLabelPrefix(ch.name);
      const colour = config.argbToHex(ch.color);
      const icon = config.parseIconId(ch.iconid);
      const bits = [];
      if (colour) bits.push(colour);
      if (icon) bits.push(icon.category ? `${icon.category}/${icon.name}` : icon.name);
      if (typeof ch.volume === 'number') bits.push(`${ch.volume.toFixed(1)} dB`);
      if (ch.preampgain) bits.push(`gain ${Number(ch.preampgain).toFixed(1)} dB`);
      if (ch.link) bits.push('linked');
      if (ch['48v']) bits.push('48V');
      if (ch.polarity) bits.push('ø');
      if (ch.mute) bits.push('MUTE');
      const bands = config.eqBandCount(ch.eq);
      if (bands) bits.push(`${bands}-band EQ`);

      console.log(
        `    ch${String(n).padEnd(3)} ${String(label ?? '—').padEnd(22)} ${bits.join('  ')}`,
      );
    }
  }
}

let failed = false;

for (const file of files) {
  let backup;
  try {
    backup = reader.readBackupFile(file);
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    failed = true;
    continue;
  }

  const summary = reader.summariseBackup(backup);

  if (flag('json')) {
    console.log(JSON.stringify(summary, null, 2));
    continue;
  }

  heading(path.basename(file));

  const c = summary.counts;
  console.log(`  documents       ${backup.entries.length}` +
    `  (scene ${c.scene}, scn ${c.scn}, cnfg ${c.cnfg}, channel ${c.channel}, fx ${c.fx})`);

  if (summary.channelCounts) {
    const shape = Object.entries(summary.channelCounts)
      .map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  console shape   ${shape}`);
  } else {
    console.log('  console shape   unknown (no document carries channel roots)');
  }

  if (summary.hasUserContent) {
    console.log(`  user content    yes — ${summary.projects.length} project(s)`);
    for (const p of summary.projects) {
      const scenes = p.scenes.length ? p.scenes.join(', ') : 'none';
      console.log(`                    "${p.name}"  scenes: ${scenes}` +
        `${p.hasConfig ? '' : '   [no .cnfg — this project has no `global`]'}`);
    }
  } else {
    // The headline finding, stated plainly, because it is the thing most likely
    // to be mistaken for a working backup.
    console.log('  user content    NONE — factory library only');
    console.log('                    No project was stored on this console, so this');
    console.log('                    archive does not contain its live configuration.');
  }

  if (summary.standaloneScenes.length) {
    console.log(`  scenes          ${summary.standaloneScenes.join(', ')}`);
  }

  if (summary.failures.length) {
    console.log(`  unreadable      ${summary.failures.length}`);
    for (const f of summary.failures) console.log(`                    ${f.path}: ${f.reason}`);
    failed = true;
  }

  if (flag('channels')) {
    // Prefer a project scene: a standalone factory scene is all defaults.
    const entry =
      backup.entries.find((e) => e.kind === 'scn') ||
      backup.entries.find((e) => e.kind === 'scene');
    if (entry) {
      console.log(`\n  --- ${entry.path} ---`);
      describeChannels(entry.document);
    }
  }
}

process.exit(failed ? 1 : 0);
