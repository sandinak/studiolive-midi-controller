/**
 * Leak / lifecycle soak tests.
 *
 * These target the failure modes that only surface over a long live session —
 * a mixer that drops and reconnects on flaky WiFi for hours, a controller that
 * is plugged and unplugged repeatedly, a fader that streams for the length of a
 * set. Each test drives thousands of cycles and asserts that nothing the app
 * owns grows without bound: no leaked pollers, no orphaned listeners, no maps
 * that fail to drain, and a heap that stays flat.
 *
 * All mocked — no hardware. Run via `npm run test:soak`.
 */

import { MixerManager } from '../../src/main/mixer-manager';
import { MidiManager } from '../../src/main/midi-manager';
import { SimpleClient } from '../__mocks__/presonus-studiolive-api';
import { tryGc, heapUsed, activeHandleCount, mb, report } from './soak-utils';

describe('soak: leak / lifecycle', () => {
  // ---------------------------------------------------------------------------
  // Mixer reconnect churn — the #1 long-session risk. Every connect() builds a
  // fresh client and starts two pollers; every disconnect() must tear them down.
  // ---------------------------------------------------------------------------
  it('mixer connect/disconnect churn leaks no timers, listeners, or heap', async () => {
    const CYCLES = 3000;
    const manager = new MixerManager();
    (manager as any).stateSettleMs = 0; // skip the 500ms real-mixer settle wait

    // A persistent consumer, registered once — mirrors how index.ts wires the
    // manager. Its listener count must not change across churn.
    const onLevel = () => {};
    const onDisconnected = () => {};
    manager.on('level', onLevel);
    manager.on('disconnected', onDisconnected);
    const baselineOwnListeners =
      manager.listenerCount('level') + manager.listenerCount('disconnected');

    // Warm up a few cycles so lazy allocations settle before we baseline heap.
    for (let i = 0; i < 50; i++) {
      await manager.connect('10.0.0.1', 'SL32');
      await manager.disconnect();
    }
    const hadGc = tryGc();
    const handlesBefore = activeHandleCount();
    const heapBefore = heapUsed();

    for (let i = 0; i < CYCLES; i++) {
      await manager.connect('10.0.0.1', 'SL32');
      // Mid-session activity so the pollers and event path actually run.
      const client = (manager as any).client as SimpleClient;
      client.emit('level', { channel: { type: 'LINE', channel: 1 }, level: 50 });
      client.emit('mute', { channel: { type: 'LINE', channel: 1 }, status: true });
      await manager.disconnect();

      // Pollers must be cleared after every disconnect — a single missed
      // clearInterval here is a real, compounding leak in production.
      expect((manager as any).muteGroupPollInterval).toBeNull();
      expect((manager as any).dcaLevelPollInterval).toBeNull();
      expect((manager as any).client).toBeNull();
    }

    // Our own listeners were never duplicated or dropped.
    expect(
      manager.listenerCount('level') + manager.listenerCount('disconnected'),
    ).toBe(baselineOwnListeners);

    const heapAfter = heapUsed();
    tryGc();
    const heapAfterGc = heapUsed();
    const handlesAfter = activeHandleCount();

    report('mixer churn', `${CYCLES} cycles, heap ${mb(heapBefore)} → ${mb(heapAfterGc)} (post-GC)`);
    if (handlesBefore >= 0) {
      report('mixer churn', `active handles ${handlesBefore} → ${handlesAfter}`);
      // No timers/sockets should be left holding the loop open.
      expect(handlesAfter).toBeLessThanOrEqual(handlesBefore + 1);
    }

    if (hadGc) {
      // Generous ceiling — this is a leak tripwire, not a tight budget. A real
      // per-cycle leak over 3000 cycles blows past this by orders of magnitude.
      const growth = heapAfterGc - heapBefore;
      report('mixer churn', `post-GC heap growth ${mb(growth)}`);
      expect(growth).toBeLessThan(24 * 1024 * 1024); // < 24MB
    } else {
      report('mixer churn', 'GC not exposed — heap assertion skipped (run via npm run test:soak)');
    }
  });

  // ---------------------------------------------------------------------------
  // MIDI device churn — controller replug / OS MIDI graph flapping.
  // ---------------------------------------------------------------------------
  it('midi device connect/disconnect churn drains input/output maps', () => {
    const CYCLES = 5000;
    const midi = new MidiManager();
    const device = 'Mock Input 1';

    for (let i = 0; i < CYCLES; i++) {
      midi.connectDevice(device);
      midi.disconnectDevice(device);
    }

    // Everything must be released — no accumulated Input/Output instances.
    expect((midi as any).inputs.size).toBe(0);
    expect((midi as any).outputs.size).toBe(0);
    expect(midi.getConnectedDevices()).toEqual([]);
    expect(midi.hasOutput()).toBe(false);
    report('midi churn', `${CYCLES} connect/disconnect cycles, maps drained to 0`);
  });

  // ---------------------------------------------------------------------------
  // MIDI-learn scan churn — start/stop scan repeatedly. Each scan opens temp
  // listeners / scan-only inputs and returns a cleanup fn that must fully undo
  // them, or listeners pile up on the shared Input instances.
  // ---------------------------------------------------------------------------
  it('repeated MIDI scans clean up every temporary listener', () => {
    const CYCLES = 2000;
    const midi = new MidiManager();
    midi.connectDevice('Mock Input 1'); // a persistent input the scan reuses

    const input = (midi as any).inputs.get('Mock Input 1');
    const baseline = input.listenerCount('cc') + input.listenerCount('noteon') + input.listenerCount('pitch');

    for (let i = 0; i < CYCLES; i++) {
      const stop = midi.scanAllInputs(() => {});
      stop();
    }

    const after = input.listenerCount('cc') + input.listenerCount('noteon') + input.listenerCount('pitch');
    expect(after).toBe(baseline);
    report('midi scan churn', `${CYCLES} scans, listeners on shared input steady at ${after}`);

    midi.disconnectAll();
  });
});
