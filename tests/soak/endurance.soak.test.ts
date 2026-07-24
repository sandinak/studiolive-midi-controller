/**
 * Multi-hour endurance soak.
 *
 * A single long-lived process that continuously exercises every stateful
 * main-process subsystem — mixer reconnect churn, MIDI device replug, MIDI-learn
 * scan churn, the MIDI→mixer translate hot path, mixer event floods, and the
 * unauthenticated-UDP TUIO parser (valid + fuzzed packets) — for a configurable
 * duration, sampling heap / handle / listener metrics on an interval.
 *
 * It is SELF-REPORTING: it writes a live `soak-report.md` plus append-only
 * `soak-metrics.jsonl` and `soak-issues.jsonl` under $SOAK_OUT (default
 * ./soak-results), so a full report is waiting even if nobody is watching. It
 * never throws on an in-loop anomaly — it records the anomaly and keeps going —
 * so one hiccup can't abort an overnight run. The final `expect` reflects
 * overall health for CI, but the report is the real deliverable.
 *
 * Gated behind SOAK_ENDURANCE=1 so the quick `npm run test:soak` skips it.
 * Launch:
 *   SOAK_ENDURANCE=1 SOAK_HOURS=8 node --expose-gc node_modules/jest/bin/jest.js \
 *     --config jest.soak.config.js --runInBand -t endurance
 */

import * as fs from 'fs';
import * as path from 'path';
import { MixerManager } from '../../src/main/mixer-manager';
import { MidiManager } from '../../src/main/midi-manager';
import { MappingEngine } from '../../src/main/mapping-engine';
import { TuioManager } from '../../src/main/tuio-manager';
import type { MidiMapping, MidiMessage } from '../../src/shared/types';
import { SimpleClient } from '../__mocks__/presonus-studiolive-api';

const ENABLED = process.env.SOAK_ENDURANCE === '1';
const runner = ENABLED ? it : it.skip;

const HOURS = parseFloat(process.env.SOAK_HOURS || '8');
const OUT_DIR = path.resolve(process.env.SOAK_OUT || 'soak-results');
const SAMPLE_INTERVAL_MS = parseInt(process.env.SOAK_SAMPLE_MS || '30000', 10);
// Ignore samples in the warmup window when fitting the leak-trend line — early
// lazy allocations aren't a leak.
const WARMUP_MS = 5 * 60 * 1000;
// Sustained post-GC heap growth above this is flagged as a suspected leak.
const LEAK_SLOPE_MB_PER_HR = 5;

interface Sample {
  tSec: number;
  rssMB: number;
  heapMB: number; // post-GC
  heapTotalMB: number;
  externalMB: number;
  handles: number;
  cyclesMixer: number;
  cyclesMidi: number;
  scans: number;
  translateCalls: number;
  levelEvents: number;
  tuioPackets: number;
  errors: number;
}

interface Issue {
  tSec: number;
  kind: string;
  detail: string;
  stack?: string;
}

describe('soak: endurance', () => {
  runner('runs for SOAK_HOURS, self-reporting heap/handle/leak health', async () => {
    const hours = HOURS;
    jest.setTimeout(hours * 3600 * 1000 + 5 * 60 * 1000);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const reportPath = path.join(OUT_DIR, 'soak-report.md');
    const metricsPath = path.join(OUT_DIR, 'soak-metrics.jsonl');
    const issuesPath = path.join(OUT_DIR, 'soak-issues.jsonl');
    const stopPath = path.join(OUT_DIR, 'STOP');
    // Fresh run — truncate the append-only logs.
    fs.writeFileSync(metricsPath, '');
    fs.writeFileSync(issuesPath, '');

    const startMs = Date.now();
    const deadlineMs = startMs + hours * 3600 * 1000;
    const startedAtIso = new Date(startMs).toISOString();

    const samples: Sample[] = [];
    const issues: Issue[] = [];

    // Counters
    let cyclesMixer = 0;
    let cyclesMidi = 0;
    let scans = 0;
    let translateCalls = 0;
    let levelEvents = 0;
    let tuioPackets = 0;
    let errors = 0;
    let leakReported = false; // one-shot: record a suspected-leak issue once

    const elapsedSec = () => Math.round((Date.now() - startMs) / 1000);

    const recordIssue = (kind: string, detail: string, stack?: string) => {
      const issue: Issue = { tSec: elapsedSec(), kind, detail, stack };
      issues.push(issue);
      try { fs.appendFileSync(issuesPath, JSON.stringify(issue) + '\n'); } catch {}
    };

    // Any async reject / uncaught error becomes a recorded issue, not a crash.
    const onRejection = (reason: any) =>
      recordIssue('unhandledRejection', String(reason?.message ?? reason), reason?.stack);
    const onUncaught = (err: any) =>
      recordIssue('uncaughtException', String(err?.message ?? err), err?.stack);
    process.on('unhandledRejection', onRejection);
    process.on('uncaughtException', onUncaught);

    const gc = (global as any).gc as (() => void) | undefined;
    const cleanHeap = () => { if (gc) { gc(); gc(); } return process.memoryUsage().heapUsed; };
    const handleCount = () => {
      const fn = (process as any).getActiveResourcesInfo as (() => string[]) | undefined;
      return fn ? fn().length : -1;
    };
    const MB = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;

    // ---- Persistent subsystems (created once, live for the whole run) ----
    const mixer = new MixerManager();
    (mixer as any).stateSettleMs = 0;
    mixer.on('level', () => {});         // persistent consumers, registered once
    mixer.on('disconnected', () => {});
    const mixerBaselineListeners =
      mixer.listenerCount('level') + mixer.listenerCount('disconnected');

    const midi = new MidiManager();
    const engine = new MappingEngine();
    const tuio = new TuioManager(); // never .start() — we call handlePacket directly

    // A representative mapping set for the translate hot path.
    for (let ch = 1; ch <= 16; ch++) {
      for (let c = 0; c < 8; c++) {
        engine.addMapping({
          midi: { type: 'cc', channel: ch, controller: c },
          mixer: { action: 'volume', channel: { type: 'LINE', channel: c + 1 } as any, range: [0, 100] },
        } as MidiMapping);
      }
    }
    const translateMsgs: MidiMessage[] = [];
    for (let i = 0; i < 512; i++) {
      translateMsgs.push({ type: 'cc', channel: (i % 16) + 1, controller: i % 10, value: i % 128 } as MidiMessage);
    }

    // Baselines for invariant checks.
    const midiScanInput = 'Mock Input 1';

    // ---- OSC/TUIO packet builders (valid + fuzz) ----
    const buildTuioBundle = (id: number, x: number, y: number): Buffer => {
      const msg = (address: string, tags: string, args: Buffer): Buffer => {
        const pad4 = (s: string) => { const b = Buffer.from(s + '\0'); const p = Buffer.alloc(Math.ceil(b.length / 4) * 4); b.copy(p); return p; };
        return Buffer.concat([pad4(address), pad4(tags), args]);
      };
      const setArgs = Buffer.alloc(20);
      setArgs.writeInt32BE(id, 0);
      setArgs.writeFloatBE(x, 4);
      setArgs.writeFloatBE(y, 8);
      setArgs.writeFloatBE(0, 12);
      setArgs.writeFloatBE(0, 16);
      const setMsg = msg('/tuio/2Dcur', ',siffff', Buffer.concat([pad4Str('set'), setArgs]));
      const aliveArgs = Buffer.alloc(4); aliveArgs.writeInt32BE(id, 0);
      const aliveMsg = msg('/tuio/2Dcur', ',si', Buffer.concat([pad4Str('alive'), aliveArgs]));
      const bundle = (msgs: Buffer[]): Buffer => {
        const parts: Buffer[] = [Buffer.from('#bundle\0'), Buffer.alloc(8)];
        for (const m of msgs) { const sz = Buffer.alloc(4); sz.writeInt32BE(m.length, 0); parts.push(sz, m); }
        return Buffer.concat(parts);
      };
      return bundle([setMsg, aliveMsg]);
    };
    function pad4Str(s: string): Buffer { const b = Buffer.from(s + '\0'); const p = Buffer.alloc(Math.ceil(b.length / 4) * 4); b.copy(p); return p; }

    // ---- Metric sampling + report writing ----
    const linregSlopePerHr = (): number | null => {
      const pts = samples.filter(s => s.tSec * 1000 >= WARMUP_MS).map(s => [s.tSec / 3600, s.heapMB] as const);
      if (pts.length < 3) return null;
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p[0], 0);
      const sy = pts.reduce((a, p) => a + p[1], 0);
      const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
      const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
      const denom = n * sxx - sx * sx;
      if (Math.abs(denom) < 1e-9) return null;
      return (n * sxy - sx * sy) / denom; // MB per hour
    };

    const writeReport = (final: boolean) => {
      const now = Date.now();
      const elapsedH = ((now - startMs) / 3600000).toFixed(2);
      const last = samples[samples.length - 1];
      const first = samples.find(s => s.tSec * 1000 >= WARMUP_MS) ?? samples[0];
      const slope = linregSlopePerHr();
      const leakSuspected = slope !== null && slope > LEAK_SLOPE_MB_PER_HR;
      const status = final
        ? (issues.length === 0 && !leakSuspected ? '✅ COMPLETE — HEALTHY' : '⚠️ COMPLETE — SEE ISSUES')
        : '⏳ RUNNING';

      const lines: string[] = [];
      lines.push(`# StudioLive MIDI Controller — Endurance Soak Report`);
      lines.push('');
      lines.push(`**Status:** ${status}`);
      lines.push(`**Started:** ${startedAtIso}`);
      lines.push(`**Last update:** ${new Date(now).toISOString()}`);
      lines.push(`**Elapsed:** ${elapsedH}h of ${hours}h target`);
      lines.push('');
      lines.push(`## Verdict`);
      if (final && issues.length === 0 && !leakSuspected) {
        lines.push(`No leaks, no leaked handles, no recorded errors across the full run. All invariants held every sample.`);
      } else {
        if (leakSuspected) lines.push(`- 🔴 **Suspected heap leak:** post-GC heap trending **+${slope!.toFixed(2)} MB/hr** (threshold ${LEAK_SLOPE_MB_PER_HR}).`);
        if (issues.length) lines.push(`- 🔴 **${issues.length} issue(s) recorded** — see below and \`soak-issues.jsonl\`.`);
        if (!leakSuspected && issues.length === 0) lines.push(`Healthy so far — no issues recorded.`);
      }
      lines.push('');
      lines.push(`## Work completed`);
      lines.push('');
      lines.push(`| Subsystem | Count |`);
      lines.push(`|---|---|`);
      lines.push(`| Mixer connect/disconnect cycles | ${cyclesMixer.toLocaleString()} |`);
      lines.push(`| MIDI device replug cycles | ${cyclesMidi.toLocaleString()} |`);
      lines.push(`| MIDI-learn scan cycles | ${scans.toLocaleString()} |`);
      lines.push(`| MIDI→mixer translate calls | ${translateCalls.toLocaleString()} |`);
      lines.push(`| Mixer level events | ${levelEvents.toLocaleString()} |`);
      lines.push(`| TUIO packets parsed (incl. fuzz) | ${tuioPackets.toLocaleString()} |`);
      lines.push(`| Recorded errors/anomalies | ${errors + issues.length} |`);
      lines.push('');
      if (last) {
        lines.push(`## Current resource state`);
        lines.push('');
        lines.push(`| Metric | Value |`);
        lines.push(`|---|---|`);
        lines.push(`| RSS | ${last.rssMB} MB |`);
        lines.push(`| Heap used (post-GC) | ${last.heapMB} MB |`);
        lines.push(`| Heap total | ${last.heapTotalMB} MB |`);
        lines.push(`| External | ${last.externalMB} MB |`);
        lines.push(`| Active handles | ${last.handles} |`);
        if (first && last !== first) {
          lines.push(`| Heap Δ since warmup | ${(last.heapMB - first.heapMB >= 0 ? '+' : '')}${(last.heapMB - first.heapMB).toFixed(1)} MB over ${((last.tSec - first.tSec) / 3600).toFixed(2)}h |`);
        }
        if (slope !== null) lines.push(`| Heap trend | ${slope >= 0 ? '+' : ''}${slope.toFixed(2)} MB/hr |`);
        lines.push('');
      }
      if (issues.length) {
        lines.push(`## Issues (${issues.length})`);
        lines.push('');
        for (const is of issues.slice(0, 50)) {
          lines.push(`- **[t+${is.tSec}s] ${is.kind}** — ${is.detail}`);
          if (is.stack) lines.push(`  \n  \`\`\`\n  ${is.stack.split('\n').slice(0, 4).join('\n  ')}\n  \`\`\``);
        }
        lines.push('');
      }
      lines.push(`## Heap trajectory (samples)`);
      lines.push('');
      lines.push(`\`\`\``);
      lines.push(`   t(h)   heap(MB)  rss(MB)  handles`);
      const show = samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 40)) === 0);
      for (const s of show) {
        lines.push(`  ${(s.tSec / 3600).toFixed(2).padStart(5)}  ${String(s.heapMB).padStart(8)}  ${String(s.rssMB).padStart(7)}  ${String(s.handles).padStart(7)}`);
      }
      lines.push(`\`\`\``);
      lines.push('');
      lines.push(`_Raw per-sample data in \`soak-metrics.jsonl\`; anomalies in \`soak-issues.jsonl\`._`);
      fs.writeFileSync(reportPath, lines.join('\n'));
    };

    const sample = () => {
      const mem = process.memoryUsage();
      const heap = cleanHeap();
      const s: Sample = {
        tSec: elapsedSec(),
        rssMB: MB(mem.rss),
        heapMB: MB(heap),
        heapTotalMB: MB(mem.heapTotal),
        externalMB: MB(mem.external),
        handles: handleCount(),
        cyclesMixer, cyclesMidi, scans, translateCalls, levelEvents, tuioPackets,
        errors: errors + issues.length,
      };
      samples.push(s);
      try { fs.appendFileSync(metricsPath, JSON.stringify(s) + '\n'); } catch {}

      // Invariant: idle mixer must hold no pollers, and our own listeners steady.
      const own = mixer.listenerCount('level') + mixer.listenerCount('disconnected');
      if (own !== mixerBaselineListeners) {
        recordIssue('listener-leak', `mixer own-listeners ${own} != baseline ${mixerBaselineListeners}`);
      }
      if ((midi as any).inputs.size !== 0 || (midi as any).outputs.size !== 0) {
        recordIssue('midi-map-leak', `inputs=${(midi as any).inputs.size} outputs=${(midi as any).outputs.size} after batch (expected 0)`);
      }
      if (tuio['activeCursors'] && (tuio as any).activeCursors.size > 64) {
        recordIssue('tuio-cursor-growth', `activeCursors=${(tuio as any).activeCursors.size} (>64)`);
      }
      // Surface a sustained heap climb into the issues log (once) so the
      // supervising monitor is woken to investigate before the run ends.
      if (!leakReported && Date.now() - startMs > WARMUP_MS * 2) {
        const sl = linregSlopePerHr();
        if (sl !== null && sl > LEAK_SLOPE_MB_PER_HR) {
          leakReported = true;
          recordIssue('suspected-leak', `post-GC heap trending +${sl.toFixed(2)} MB/hr (threshold ${LEAK_SLOPE_MB_PER_HR})`);
        }
      }
      writeReport(false);
    };

    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    let lastSampleAt = 0;

    // ---- Main loop ----
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() >= deadlineMs) break;
      if (fs.existsSync(stopPath)) { recordIssue('stopped', 'STOP file present — exiting early'); break; }

      try {
        // 1) Mixer reconnect churn with mid-session activity.
        for (let i = 0; i < 40; i++) {
          await mixer.connect('10.0.0.1', 'SL32');
          const client = (mixer as any).client as SimpleClient;
          for (let e = 0; e < 25; e++) {
            client.emit('level', { channel: { type: 'LINE', channel: (e % 32) + 1 }, level: e % 100 });
            levelEvents++;
          }
          client.emit('mute', { channel: { type: 'LINE', channel: 1 }, status: (i & 1) === 0 });
          await mixer.disconnect();
          cyclesMixer++;
          // Invariant right after teardown — the compounding-leak tripwire.
          if ((mixer as any).muteGroupPollInterval !== null || (mixer as any).dcaLevelPollInterval !== null) {
            recordIssue('poller-leak', `pollers not cleared after disconnect (cycle ${cyclesMixer})`);
          }
          if ((mixer as any).client !== null) {
            recordIssue('client-leak', `client not nulled after disconnect (cycle ${cyclesMixer})`);
          }
        }

        // 2) MIDI device replug churn.
        for (let i = 0; i < 200; i++) {
          midi.connectDevice(midiScanInput);
          midi.disconnectDevice(midiScanInput);
          cyclesMidi++;
        }

        // 3) MIDI-learn scan churn (temp listeners must fully unwind).
        for (let i = 0; i < 100; i++) {
          const stop = midi.scanAllInputs(() => {});
          stop();
          scans++;
        }

        // 4) Translate hot path.
        for (let i = 0; i < 50_000; i++) {
          engine.translateMidiToMixer(translateMsgs[i % translateMsgs.length]);
          translateCalls++;
        }

        // 5) TUIO: valid bundles then fuzzed/truncated buffers (unauth UDP parser).
        for (let i = 0; i < 500; i++) {
          (tuio as any).handlePacket(buildTuioBundle(i % 10, Math.random(), Math.random()));
          tuioPackets++;
        }
        // Fuzz — must never throw or grow unbounded.
        for (let i = 0; i < 500; i++) {
          const len = 1 + Math.floor(Math.random() * 64);
          const buf = Buffer.alloc(len);
          for (let b = 0; b < len; b++) buf[b] = Math.floor(Math.random() * 256);
          if (i % 3 === 0) buf[0] = 0x23; // sometimes look like a bundle
          (tuio as any).handlePacket(buf);
          tuioPackets++;
        }
      } catch (err: any) {
        errors++;
        recordIssue('loop-exception', String(err?.message ?? err), err?.stack);
      }

      // Clear jest.fn() call history. The mocks record every call in
      // `.mock.calls` forever — a test-harness artifact that would otherwise
      // masquerade as a heap leak (the real easymidi/API functions keep no such
      // history). clearAllMocks resets usage data only; it preserves the mock
      // implementations (mockResolvedValue etc.), so behavior is unchanged. Any
      // *real* production retention still shows through — this frees only jest's
      // own bookkeeping, never objects our code holds.
      jest.clearAllMocks();

      // Sample on the configured wall-clock interval.
      if (Date.now() - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        sample();
        lastSampleAt = Date.now();
      }
      // Keep CPU moderate over the long haul (soak = duration, not max throughput).
      await sleep(50);
    }

    // Final sample + report.
    sample();
    writeReport(true);

    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onUncaught);
    try { midi.disconnectAll(); } catch {}
    try { await mixer.disconnect(); } catch {}

    // Health gate for CI: the report always exists regardless.
    const slope = linregSlopePerHr();
    expect(issues).toEqual([]);
    if (slope !== null) expect(slope).toBeLessThan(LEAK_SLOPE_MB_PER_HR);
  });
});
