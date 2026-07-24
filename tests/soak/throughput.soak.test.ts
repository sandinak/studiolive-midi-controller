/**
 * Throughput soak tests.
 *
 * The two hot paths that run continuously during a live set:
 *   1. MappingEngine.translateMidiToMixer — once per inbound MIDI message
 *      (fader storms, dense controllers).
 *   2. MixerManager event re-emission — once per mixer level/meter update
 *      (~60fps × channel count).
 *
 * These measure sustained ops/sec and assert a *generous* floor. The floor is
 * a regression tripwire (e.g. an accidental O(n) scan slipping into the O(1)
 * lookup), not a tight benchmark — the reported number is the useful output.
 */

import { MappingEngine } from '../../src/main/mapping-engine';
import { MixerManager } from '../../src/main/mixer-manager';
import type { MidiMapping, MidiMessage } from '../../src/shared/types';
import { SimpleClient } from '../__mocks__/presonus-studiolive-api';
import { tryGc, heapUsed, mb, report } from './soak-utils';

describe('soak: throughput', () => {
  it('translateMidiToMixer sustains high throughput and stays O(1) under many mappings', () => {
    const engine = new MappingEngine();

    // A realistic-to-large mapping set: 16 MIDI channels × 8 controllers.
    const CHANNELS = 16;
    const CONTROLLERS = 8;
    for (let ch = 1; ch <= CHANNELS; ch++) {
      for (let c = 0; c < CONTROLLERS; c++) {
        const mapping: MidiMapping = {
          midi: { type: 'cc', channel: ch, controller: c },
          mixer: { action: 'volume', channel: { type: 'LINE', channel: c + 1 } as any, range: [0, 100] },
        };
        engine.addMapping(mapping);
      }
    }

    // Pre-build a mix of hits and misses so the branch predictor / lookup is
    // exercised the way live traffic would exercise it.
    const messages: MidiMessage[] = [];
    for (let i = 0; i < 1000; i++) {
      messages.push({
        type: 'cc',
        channel: (i % CHANNELS) + 1,
        controller: i % (CONTROLLERS + 2), // +2 → some misses
        value: i % 128,
      } as MidiMessage);
    }

    const ITERATIONS = 2_000_000;
    let hits = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERATIONS; i++) {
      const cmd = engine.translateMidiToMixer(messages[i % messages.length]);
      if (cmd) hits++;
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const opsPerSec = ITERATIONS / (elapsedMs / 1000);

    report(
      'translate',
      `${ITERATIONS.toLocaleString()} calls over ${(engine.getMappings().length)} mappings in ${elapsedMs.toFixed(0)}ms ` +
        `→ ${Math.round(opsPerSec).toLocaleString()} ops/sec (${hits} hits)`,
    );

    // Sanity: the lookup actually resolved the hits we expected.
    expect(hits).toBeGreaterThan(0);
    // Regression tripwire — the O(1) map path clears this by ~100×. If someone
    // reintroduces a linear scan per message, throughput collapses below it.
    expect(opsPerSec).toBeGreaterThan(500_000);
  });

  it('mixer level flood is re-emitted without backlog or heap growth', async () => {
    const manager = new MixerManager();
    (manager as any).stateSettleMs = 0;
    await manager.connect('10.0.0.1', 'SL32');

    let received = 0;
    manager.on('level', () => { received++; });

    const client = (manager as any).client as SimpleClient;
    const EVENTS = 1_000_000;

    tryGc();
    const heapBefore = heapUsed();

    const start = process.hrtime.bigint();
    for (let i = 0; i < EVENTS; i++) {
      client.emit('level', { channel: { type: 'LINE', channel: (i % 32) + 1 }, level: i % 100 });
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const opsPerSec = EVENTS / (elapsedMs / 1000);

    // Every event must have been forwarded — no silent drops or backlog.
    expect(received).toBe(EVENTS);

    tryGc();
    const heapGrowth = heapUsed() - heapBefore;
    report(
      'level flood',
      `${EVENTS.toLocaleString()} events in ${elapsedMs.toFixed(0)}ms → ` +
        `${Math.round(opsPerSec).toLocaleString()} ev/sec, post-GC heap growth ${mb(heapGrowth)}`,
    );

    // The manager keeps only fixed-size caches, so a flood must not accumulate
    // heap. Generous ceiling to stay non-flaky across machines.
    if ((global as any).gc) {
      expect(heapGrowth).toBeLessThan(16 * 1024 * 1024);
    }

    await manager.disconnect();
  });
});
