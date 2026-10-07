/**
 * Back up a console directly, without Universal Control.
 *
 * UC's own backup cannot be relied on: it will report success and write a
 * plausible archive while holding no connection to the console at all. This
 * talks to the console itself, downloads every stored document, and writes a
 * UC-compatible `.bak`.
 *
 *   node tools/backup-console.js 192.168.21.41
 *   node tools/backup-console.js 192.168.21.41 -o showfile.bak
 *   node tools/backup-console.js 192.168.21.41 --compare existing.bak
 *
 * Read-only against the console. It only ever downloads.
 *
 * Needs a build (`npm run build`) — it uses the project's own capture code
 * rather than a second copy of the rules.
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
let capture;
let reader;
let zipReader;
try {
  capture = require(path.join(DIST, 'main', 'console-backup-capture'));
  reader = require(path.join(DIST, 'main', 'console-backup'));
  zipReader = require(path.join(DIST, 'main', 'zip-reader'));
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
const opt = (name, short) => {
  const i = args.findIndex((a) => a === `--${name}` || (short && a === short));
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : null;
};
const host = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));

if (!host) {
  console.error('usage: node tools/backup-console.js <mixer-ip> [-o out.bak] [--compare other.bak]');
  process.exit(2);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Index an archive by entry path, for comparison. */
function indexArchive(file) {
  const buf = fs.readFileSync(file);
  const out = new Map();
  for (const entry of zipReader.listZipEntries(buf)) {
    if (!entry.isDirectory) out.set(entry.name, zipReader.readZipEntry(buf, entry));
  }
  return out;
}

(async () => {
  const client = new Client({ host, port: 53000 }, { autoreconnect: false, logLevel: 'error' });

  console.log(`connecting to ${host}`);
  await client.connect({ clientDescription: 'backup', clientIdentifier: 'backup' });
  // The state tree arrives asynchronously after the handshake; the model name is
  // only for the filename, but waiting also lets the connection settle.
  await wait(1800);

  const model = String(client.state.get('global.mixer_name') || 'console');
  console.log(`connected: ${model}`);

  const transport = capture.transportFromClient(client);
  const started = Date.now();
  let lastLine = 0;

  const result = await capture.captureBackup(transport, {
    onProgress: ({ done, total, path: p }) => {
      const label = p.length > 54 ? `…${p.slice(-53)}` : p;
      const line = `  [${String(done).padStart(3)}/${total}] ${label}`;
      if (process.stdout.isTTY) {
        // Rewrite one line rather than scrolling 69 of them. Only when attached
        // to a terminal — a carriage return into a pipe or a log file produces
        // one unreadable line instead.
        process.stdout.write(`\r${line}${' '.repeat(Math.max(0, lastLine - line.length))}`);
        lastLine = line.length;
      } else if (done === total || done % 10 === 0) {
        console.log(line);
      }
    },
  });
  process.stdout.write('\n');

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = model.replace(/[^A-Za-z0-9]+/g, '') || 'console';
  const outFile = opt('output', '-o') || `${slug}_${stamp}.bak`;
  fs.writeFileSync(outFile, result.archive);

  console.log(`\nwrote ${outFile}  (${(result.archive.length / 1024).toFixed(0)} KB, ` +
    `${result.paths.length} documents, ${((Date.now() - started) / 1000).toFixed(1)}s)`);

  if (result.projects.length) {
    console.log(`projects: ${result.projects.join(', ')}`);
  } else {
    // The thing most likely to be mistaken for a working backup.
    console.log('projects: NONE — this console has no stored project, so the archive');
    console.log('          holds only its factory library, not how the board is set up.');
  }

  if (result.failures.length) {
    console.log(`\nfailed to capture ${result.failures.length}:`);
    for (const f of result.failures) console.log(`  ${f.path}: ${f.reason}`);
  }

  if (result.unknownFloatKeys.length) {
    console.log(`\nparameters written as floats but not in the registry: ` +
      `${result.unknownFloatKeys.join(', ')}`);
    console.log('  (harmless here, but FLOAT_KEYS in src/shared/console-json.ts wants updating)');
  }

  // Verify by reading our own output back.
  const summary = reader.summariseBackup(reader.readBackupFile(outFile));
  console.log(`\nverified by re-reading: ${JSON.stringify(summary.counts)}`);
  if (summary.failures.length) console.log(`  unreadable entries: ${summary.failures.length}`);

  const compareTo = opt('compare');
  if (compareTo) {
    console.log(`\ncomparing with ${path.basename(compareTo)}`);
    const mine = indexArchive(outFile);
    const theirs = indexArchive(compareTo);
    const names = new Set([...mine.keys(), ...theirs.keys()]);
    let identical = 0;
    const differing = [];
    const onlyMine = [];
    const onlyTheirs = [];
    for (const name of names) {
      if (!theirs.has(name)) { onlyMine.push(name); continue; }
      if (!mine.has(name)) { onlyTheirs.push(name); continue; }
      if (mine.get(name).equals(theirs.get(name))) identical++;
      else differing.push(name);
    }
    console.log(`  entries: mine ${mine.size}, theirs ${theirs.size}`);
    console.log(`  byte-identical : ${identical}`);
    console.log(`  differing      : ${differing.length}${differing.length ? ' — ' + differing.slice(0, 3).join(', ') : ''}`);
    console.log(`  only in mine   : ${onlyMine.length}${onlyMine.length ? ' — ' + onlyMine.slice(0, 3).join(', ') : ''}`);
    console.log(`  only in theirs : ${onlyTheirs.length}${onlyTheirs.length ? ' — ' + onlyTheirs.slice(0, 3).join(', ') : ''}`);
    // Float formatting differs from UC's in the last decimal places, so compare
    // semantics too — that is the claim that matters.
    let semantic = 0;
    for (const name of differing) {
      try {
        if (JSON.stringify(JSON.parse(mine.get(name).toString())) ===
            JSON.stringify(JSON.parse(theirs.get(name).toString()))) semantic++;
      } catch { /* not JSON; leave it counted as differing */ }
    }
    if (differing.length) {
      console.log(`  of those, semantically identical: ${semantic}/${differing.length}`);
    }
  }

  await client.close();
  process.exit(result.failures.length ? 1 : 0);
})().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
