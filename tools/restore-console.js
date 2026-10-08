/**
 * Restore a backup archive to a console.
 *
 * **Dry run by default.** It prints the plan — every slot it would create and
 * every one it would overwrite — and writes nothing unless `--apply` is passed.
 * Replacing a stored document is irreversible without another backup, so the
 * destructive step has to be asked for explicitly.
 *
 *   node tools/restore-console.js 192.168.21.41 showfile.bak
 *   node tools/restore-console.js 192.168.21.41 showfile.bak --only "Scene/01.X.scene"
 *   node tools/restore-console.js 192.168.21.41 showfile.bak --apply --allow-overwrite
 *
 * The factory channel and FX presets are skipped unless `--factory` is given:
 * they are identical on every console, account for most of the transfer time,
 * and are almost never what a restore is for.
 *
 * Needs a build (`npm run build`).
 */

const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
let reader;
let capture;
let restore;
try {
  reader = require(path.join(DIST, 'main', 'console-backup'));
  capture = require(path.join(DIST, 'main', 'console-backup-capture'));
  restore = require(path.join(DIST, 'main', 'console-backup-restore'));
} catch (err) {
  console.error('Could not load the compiled code. Run `npm run build` first.');
  console.error(`  ${err.message}`);
  process.exit(2);
}

let Client;
try {
  ({ Client } = require('presonus-studiolive-api'));
} catch (err) {
  console.error(`Could not load presonus-studiolive-api: ${err.message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const positional = args.filter((a) => !a.startsWith('--'));
const host = positional.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
const file = positional.find((a) => a !== host);

if (!host || !file) {
  console.error('usage: node tools/restore-console.js <mixer-ip> <backup.bak> [--only PATH] [--factory] [--apply --allow-overwrite]');
  process.exit(2);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const backup = reader.readBackupFile(file);
  console.log(`archive: ${path.basename(file)} — ${backup.entries.length} documents`);

  const client = new Client({ host, port: 53000 }, { autoreconnect: false, logLevel: 'error' });
  console.log(`connecting to ${host}`);
  await client.connect({ clientDescription: 'restore', clientIdentifier: 'restore' });
  await wait(1800);
  console.log(`connected: ${client.state.get('global.mixer_name')}\n`);

  const base = capture.transportFromClient(client);
  const transport = restore.restoreTransportFromClient(base, client);

  const only = opt('only');
  const plan = await restore.planRestore(backup, transport, {
    includeFactoryLibrary: flag('factory'),
    only: only ? [only] : undefined,
  });

  const creates = plan.writes.filter((w) => !w.overwrites);
  const overwrites = plan.writes.filter((w) => w.overwrites);

  console.log(`PLAN: ${plan.writes.length} document(s), ${(plan.totalBytes / 1024).toFixed(0)} KB`);
  if (creates.length) {
    console.log(`\n  create (${creates.length}):`);
    for (const w of creates) console.log(`    ${w.consolePath}`);
  }
  if (overwrites.length) {
    console.log(`\n  OVERWRITE (${overwrites.length}) — these already hold something:`);
    for (const w of overwrites) {
      console.log(`    ${w.consolePath}${w.existingTitle ? `   (currently "${w.existingTitle}")` : ''}`);
    }
  }
  if (plan.skipped.length) {
    const factory = plan.skipped.filter((s) => s.reason === 'factory library').length;
    const other = plan.skipped.filter((s) => s.reason !== 'factory library');
    console.log(`\n  skipped: ${factory} factory library` +
      (other.length ? `, and ${other.length} other:` : ''));
    for (const s of other) console.log(`    ${s.archivePath}: ${s.reason}`);
  }
  if (plan.missingProjects.length) {
    console.log(`\n  BLOCKED: the console has no project directory for ` +
      `${plan.missingProjects.join(', ')} — create it on the console first.`);
  }

  if (!flag('apply')) {
    console.log('\nDry run. Nothing was written.');
    console.log('Pass --apply to write' +
      (overwrites.length ? ', and --allow-overwrite to replace the existing documents above.' : '.'));
    await client.close();
    process.exit(0);
  }

  console.log('\napplying');
  let lastLine = 0;
  const result = await restore.executeRestore(plan, transport, {
    allowOverwrite: flag('allow-overwrite'),
    onProgress: ({ done, total, consolePath }) => {
      const line = `  [${String(done).padStart(3)}/${total}] ${consolePath}`;
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${line}${' '.repeat(Math.max(0, lastLine - line.length))}`);
        lastLine = line.length;
      } else {
        console.log(line);
      }
    },
  });
  if (process.stdout.isTTY) process.stdout.write('\n');

  console.log(`\nwrote ${result.written.length} document(s)`);
  if (result.failures.length) {
    console.log(`failed ${result.failures.length}:`);
    for (const f of result.failures) console.log(`  ${f.consolePath}: ${f.reason}`);
  }

  await client.close();
  process.exit(result.failures.length ? 1 : 0);
})().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
