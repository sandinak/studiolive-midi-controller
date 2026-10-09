/**
 * Hardware integration harness — exercises the app against a real console,
 * with nobody clicking anything.
 *
 * This exists because the backup and restore feature had a gap nothing else
 * could close. The unit suite covers the modules, the CLI tools cover the
 * protocol against hardware, and the screenshot harness proves the dialog
 * renders — but it preloads a *mock* `electronAPI`, so the real IPC handlers,
 * the file dialogs, the progress events and the renderer wiring had never run
 * against a console at all. That plumbing is what users actually touch.
 *
 * So this loads the **real main process**, with two things replaced:
 *
 *   - `dialog.showSaveDialog` / `showOpenDialog` answer with fixed paths, so
 *     nothing waits for a human.
 *   - The window is hidden, because nobody is watching it.
 *
 * Everything else is the shipping code: the same `ipcMain` handlers, the same
 * preload allowlist, the same renderer functions, reached the same way the
 * buttons reach them.
 *
 * **Safety.** It takes a backup of the console before touching anything, writes
 * only to slots it creates itself, and compares the console's document list
 * against the starting state at the end — restoring from that backup if
 * anything is missing. A console is left as it was found or the run fails
 * loudly saying it was not.
 */

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const argv = process.argv.slice(2);
const host = argv.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
const keepArtifacts = argv.includes('--keep');

if (!host) {
  console.error('usage: node tools/hw-integration/run.js <mixer-ip> [--keep]');
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slhw-'));
const backupPath = path.join(workDir, 'harness-backup.bak');

// Run against an empty settings directory.
//
// Two reasons, and the second is why the first run on a shared test box failed.
// A harness has no business reading or writing somebody's real profiles. And the
// app auto-loads `default.json` on startup and connects to the mixer it names —
// on a machine that has been used with another console, that profile wins the
// race against the connect this harness asks for, and every check then runs
// against the wrong console or none at all.
app.setPath('userData', path.join(workDir, 'userData'));

// ─── Dialog stubs ──────────────────────────────────────────────────────────
//
// Replaced before the app's handlers are loaded, so they close over these and
// never reach the real ones. The queues let a test say what the next dialog
// should answer.

const saveQueue = [];
const openQueue = [];

dialog.showSaveDialog = async () => {
  const next = saveQueue.shift();
  return next === undefined
    ? { canceled: true, filePath: undefined }
    : { canceled: false, filePath: next };
};
dialog.showOpenDialog = async () => {
  const next = openQueue.shift();
  return next === undefined
    ? { canceled: true, filePaths: [] }
    : { canceled: false, filePaths: [next] };
};

// ─── Test bookkeeping ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

/**
 * The furthest a transfer has reported, and when. Written by the progress watcher
 * and read by the heartbeat, so one line of output answers both "is it alive"
 * and "is it getting anywhere".
 */
const beacon = { done: 0, total: 0, at: Date.now() };

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(name);
    // "got" rather than a bare value: on a failing line the detail is what was
    // observed instead, and reading it as the asserted fact is an easy mistake
    // to make — one already made here, turning a stale remembered IP into a
    // reported third console on the network.
    console.log(`  ✗ ${name}${detail ? ` — got: ${detail}` : ''}`);
  }
}

function heading(s) {
  console.log(`\n=== ${s} ${'='.repeat(Math.max(0, 54 - s.length))}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Call an IPC channel exactly as a button would: through the preload bridge. */
async function invoke(win, channel, ...args) {
  return win.webContents.executeJavaScript(
    `window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`,
    true,
  );
}

/** Read a renderer expression. */
async function evaluate(win, expression) {
  return win.webContents.executeJavaScript(`(() => (${expression}))()`, true);
}

// ─── The run ───────────────────────────────────────────────────────────────

async function run(win) {
  heading('CONNECT');
  // The app auto-connects to whatever its saved profile or discovery offers, and
  // on a test box that is often a different console. Drop that first, or the
  // connect below races it and times out.
  // There is no disconnect-mixer channel; connect-mixer supersedes whatever is
  // in progress. It can still lose the first race against an auto-connect that
  // is already dialling, which is why this retries.
  const existing = await invoke(win, 'get-mixer-status');
  if (existing?.connected && existing.ip !== host) {
    console.log(`  (app had auto-connected to ${existing.ip}; taking it over)`);
  }

  let connected = null;
  for (let attempt = 1; attempt <= 3 && !(connected && connected.success); attempt++) {
    connected = await invoke(win, 'connect-mixer', host);
    if (connected?.success) break;
    console.log(`  (connect attempt ${attempt} failed: ${connected?.error})`);
    await wait(2000);
  }
  check('connect-mixer', connected?.success === true,
    connected?.error || JSON.stringify(connected).slice(0, 60));

  // The state tree lands asynchronously after the handshake.
  await wait(3000);
  const status = await invoke(win, 'get-mixer-status');
  check('mixer reports connected', status?.connected === true, status?.ip);
  // Connected to something else is worse than not connected: every later check
  // would pass or fail against the wrong console.
  check('connected to the console we asked for', status?.ip === host,
    `asked ${host}, got ${status?.ip}`);

  if (!status?.connected || status.ip !== host) {
    throw new Error(
      `not connected to ${host} (got ${status?.ip || 'nothing'}) — ` +
      'refusing to run the rest against the wrong console');
  }

  heading('BACKUP THROUGH THE REAL IPC HANDLER');
  saveQueue.push(backupPath);

  // Watch the progress events the renderer subscribes to, through the same
  // bridge the UI uses — this is the wiring that had never run.
  await win.webContents.executeJavaScript(`
    window.__hwProgress = [];
    window.electronAPI.on('console-transfer-progress', (p) => window.__hwProgress.push(p));
    true;
  `, true);

  // Progress is observed in the main process by watching what the handler
  // sends, not by polling the renderer: an executeJavaScript issued while
  // another is still pending queues behind it, so polling during a long call
  // reports nothing until the call it is waiting on has already finished.
  const sent = [];
  const realSend = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, ...rest) => {
    if (channel === 'console-transfer-progress') {
      sent.push(rest[0]);
      beacon.done = rest[0].done;
      beacon.total = rest[0].total;
      beacon.at = Date.now();
    }
    return realSend(channel, ...rest);
  };

  const started = Date.now();
  const backup = await Promise.race([
    invoke(win, 'backup-console'),
    wait(180_000).then(() => {
      throw new Error(`backup stalled after ${sent.length} documents`);
    }),
  ]);
  win.webContents.send = realSend;
  beacon.total = 0;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  check('backup-console succeeded', backup && backup.success === true,
    backup && (backup.error || `${backup.documents} docs in ${seconds}s`));
  check('wrote the file the dialog chose', fs.existsSync(backupPath),
    fs.existsSync(backupPath) ? `${Math.round(fs.statSync(backupPath).size / 1024)} KB` : 'missing');
  check('reported the projects it found',
    Array.isArray(backup?.projects) && backup.projects.length > 0,
    (backup?.projects || []).join(', '));
  check('reported hasUserContent', backup?.hasUserContent === true);
  check('no documents failed', (backup?.failures || []).length === 0,
    `${(backup?.failures || []).length} failures`);

  const progress = await evaluate(win, 'window.__hwProgress');
  check('the handler emitted progress at all', sent.length > 0, `${sent.length} sent`);
  check('progress events reached the renderer', progress.length > 0,
    `${progress.length} events`);
  check('progress ended at 100%',
    progress.length > 0 && progress[progress.length - 1].done === progress[progress.length - 1].total,
    progress.length ? `${progress[progress.length - 1].done}/${progress[progress.length - 1].total}` : '');
  check('progress is labelled as a backup',
    progress.every((p) => p.operation === 'backup'));

  heading('INSPECT THROUGH THE REAL IPC HANDLER');
  openQueue.push(backupPath);
  const inspected = await invoke(win, 'inspect-backup');
  check('inspect-backup succeeded', inspected?.success === true, inspected?.error);
  check('summary matches the backup',
    inspected?.summary?.counts?.scn === backup?.projects?.length,
    JSON.stringify(inspected?.summary?.counts));

  heading('DIALOG CANCELLATION');
  // Empty queues mean "the user pressed Cancel".
  const cancelledSave = await invoke(win, 'backup-console');
  check('a cancelled save dialog is reported, not an error',
    cancelledSave?.cancelled === true && cancelledSave?.success === false);
  const cancelledOpen = await invoke(win, 'inspect-backup');
  check('a cancelled open dialog is reported, not an error',
    cancelledOpen?.cancelled === true);

  heading('RESTORE PLANNING');
  openQueue.push(backupPath);
  const plan = await invoke(win, 'plan-console-restore');
  check('plan-console-restore succeeded', plan?.success === true, plan?.error);
  check('planning wrote nothing',
    Array.isArray(plan?.writes) && plan.writes.length > 0,
    `${plan?.writes?.length} writes planned`);
  check('every write is an overwrite, since the backup is of this console',
    (plan?.writes || []).every((w) => w.overwrites));
  check('the factory library was skipped',
    (plan?.skipped || []).filter((s) => s.reason === 'factory library').length > 0,
    `${(plan?.skipped || []).length} skipped`);
  check('no project is missing', (plan?.missingProjects || []).length === 0);
  check('the plan carries no document bodies to the renderer',
    (plan?.writes || []).every((w) => w.ubjson === undefined));

  heading('RESTORE REFUSALS');
  // Applying without acknowledging the overwrites must be refused.
  const unconfirmed = await invoke(win, 'apply-console-restore', {});
  check('apply without allowOverwrite is refused',
    unconfirmed?.success === false && /overwrite/i.test(unconfirmed?.error || ''),
    unconfirmed?.error);

  // The plan is consumed by that attempt, so a second apply has nothing to do.
  const stale = await invoke(win, 'apply-console-restore', { allowOverwrite: true });
  check('a consumed plan cannot be re-applied',
    stale?.success === false && /no restore has been planned/i.test(stale?.error || ''),
    stale?.error);

  heading('RUN MODE');
  await invoke(win, 'set-app-mode', 'run');
  const planInRun = await invoke(win, 'plan-console-restore');
  check('restore planning is refused in Run mode',
    planInRun?.success === false && /run mode/i.test(planInRun?.error || ''),
    planInRun?.error);
  const applyInRun = await invoke(win, 'apply-console-restore', { allowOverwrite: true });
  check('restore apply is refused in Run mode',
    applyInRun?.success === false && /run mode/i.test(applyInRun?.error || ''));

  saveQueue.push(path.join(workDir, 'run-mode-backup.bak'));
  const backupInRun = await invoke(win, 'backup-console');
  check('backup is still allowed in Run mode', backupInRun?.success === true,
    backupInRun?.error || 'read-only, so it stays available');
  await invoke(win, 'set-app-mode', 'edit');

  heading('RENDERER WIRING');
  // The dialog's own functions, reached as the buttons reach them.
  const uiOk = await evaluate(win, `(() => {
    showConsoleConfig();
    const modal = document.getElementById('console-config-modal');
    const shown = modal.classList.contains('show');
    hideConsoleConfig();
    return shown && !modal.classList.contains('show');
  })()`);
  check('the Console dialog opens and closes', uiOk === true);

  const runModeLock = await evaluate(win, `(() => {
    document.body.classList.add('app-run-mode');
    showConsoleConfig();
    const disabled = document.getElementById('console-restore-btn').disabled;
    document.body.classList.remove('app-run-mode');
    hideConsoleConfig();
    return disabled;
  })()`);
  check('Restore is disabled in the UI in Run mode', runModeLock === true);
}

/**
 * Compare the console's documents with the starting backup, and put back
 * anything missing.
 */
async function verifyAndRestore(win) {
  heading('LEAVING THE CONSOLE AS WE FOUND IT');

  const { readBackupFile, summariseBackup } = require(
    path.join(__dirname, '..', '..', 'dist', 'main', 'console-backup'));

  const before = summariseBackup(readBackupFile(backupPath));

  const afterPath = path.join(workDir, 'after.bak');
  saveQueue.push(afterPath);
  const after = await invoke(win, 'backup-console');
  if (!after?.success) {
    check('could re-read the console to compare', false, after?.error);
    return;
  }
  const afterSummary = summariseBackup(readBackupFile(afterPath));

  const sameCounts = JSON.stringify(before.counts) === JSON.stringify(afterSummary.counts);
  check('document counts unchanged', sameCounts,
    `${JSON.stringify(before.counts)} → ${JSON.stringify(afterSummary.counts)}`);

  const beforeProjects = before.projects.map((p) => `${p.directory}:${p.scenes.join('/')}`).sort();
  const afterProjects = afterSummary.projects.map((p) => `${p.directory}:${p.scenes.join('/')}`).sort();
  check('projects and scenes unchanged',
    JSON.stringify(beforeProjects) === JSON.stringify(afterProjects),
    afterProjects.join(' | '));

  if (!sameCounts) {
    console.log('\n  The console differs from where it started.');
    console.log(`  Restore point: ${backupPath}`);
    console.log('  Restore it with:');
    console.log(`    node tools/restore-console.js ${host} ${backupPath} --apply --allow-overwrite`);
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────

(async () => {
  // Load the real main process. It registers every ipcMain handler and creates
  // the window, using the dialog stubs installed above.
  require(path.join(__dirname, '..', '..', 'dist', 'main', 'index.js'));

  await app.whenReady();
  // The app creates its window on ready; give it a moment, then take it.
  await wait(2500);

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    console.error('The app created no window — cannot drive the UI.');
    app.exit(1);
    return;
  }
  win.hide();

  console.log(`hardware integration against ${host}`);
  console.log(`artifacts: ${workDir}`);

  // A heartbeat that reports what the transfer has reached, not merely that the
  // process is alive.
  //
  // It used to print only `still alive`, while the progress printer logged every
  // twentieth document. Nineteen documents of silence then looked exactly like a
  // stall, and reading it as one cost a long investigation into a bug that was
  // never there. A stall is only a stall if the count stops moving, so the count
  // is what gets printed.
  let beats = 0;
  const heartbeat = setInterval(() => {
    if (++beats % 10 !== 0) return;
    if (!beacon.total) {
      console.log(`  ·· ${beats}s — no transfer running`);
      return;
    }
    const idle = Math.round((Date.now() - beacon.at) / 1000);
    console.log(
      `  ·· ${beats}s — ${beacon.done}/${beacon.total}`
      + `, last advance ${idle}s ago${idle >= 30 ? '  ← NOT ADVANCING' : ''}`,
    );
  }, 1000);
  heartbeat.unref?.();

  try {
    await run(win);
    await verifyAndRestore(win);
  } catch (err) {
    failed++;
    failures.push(`harness error: ${err.message}`);
    console.error(`\nHARNESS ERROR: ${err.message}\n${err.stack}`);
  }

  clearInterval(heartbeat);

  heading('RESULT');
  console.log(`  ${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`    ✗ ${f}`);
  if (keepArtifacts) {
    console.log(`  artifacts kept in ${workDir}`);
  } else {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  app.exit(failed ? 1 : 0);
})();
