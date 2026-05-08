/**
 * MIDI → Mixer Integration Test
 *
 * Tests the full pipeline: simulated MIDI messages → MappingEngine → MixerManager → real mixer.
 * Requires a StudioLive mixer on the network.
 *
 * Run:   MIXER_IP=192.168.21.41 npx jest tests/integration/midi-to-mixer.test.ts --testTimeout=30000
 * Skip:  Tests are auto-skipped if MIXER_IP is not set.
 */

import { MappingEngine } from '../../src/main/mapping-engine';
import { MixerManager } from '../../src/main/mixer-manager';
import type { MidiMessage, MidiMapping, MixerCommand } from '../../src/shared/types';

const MIXER_IP = process.env.MIXER_IP;
const SKIP = !MIXER_IP;

// Conditional describe — skip entire suite if no mixer available
const suiteRunner = SKIP ? describe.skip : describe;

suiteRunner('MIDI → Mixer Integration (live hardware)', () => {
  let engine: MappingEngine;
  let mixer: MixerManager;

  beforeAll(async () => {
    engine = new MappingEngine();
    mixer = new MixerManager();

    // Connect to the real mixer
    await mixer.connect(MIXER_IP!);

    // Wait for state to populate
    await new Promise((r) => setTimeout(r, 2000));
  }, 15000);

  afterAll(async () => {
    try { await mixer?.disconnect(); } catch {}
  }, 10000);

  // ── Helpers ─────────────────────────────────────────────────────────

  function addVolumeMapping(midiChannel: number, cc: number, chType: string, chNum: number, range: [number, number] = [0, 100]): void {
    engine.addMapping({
      midi: { type: 'cc', channel: midiChannel, controller: cc },
      mixer: { action: 'volume', channel: { type: chType, channel: chNum } as any, range },
    });
  }

  function addMuteMapping(midiChannel: number, note: number, chType: string, chNum: number): void {
    engine.addMapping({
      midi: { type: 'note', channel: midiChannel, note },
      mixer: { action: 'mute', channel: { type: chType, channel: chNum } as any },
    });
  }

  function addPanMapping(midiChannel: number, cc: number, chType: string, chNum: number): void {
    engine.addMapping({
      midi: { type: 'cc', channel: midiChannel, controller: cc },
      mixer: { action: 'pan', channel: { type: chType, channel: chNum } as any, range: [-100, 100] },
    });
  }

  function simulateMidi(msg: MidiMessage): MixerCommand | null {
    return engine.translateMidiToMixer(msg);
  }

  function executeCommand(cmd: MixerCommand): void {
    switch (cmd.action) {
      case 'volume':
        mixer.setVolume(cmd.channel as any, cmd.value!);
        break;
      case 'mute':
        if (cmd.toggle) {
          mixer.toggleMute(cmd.channel as any);
        } else {
          mixer.setMute(cmd.channel as any, false);
        }
        break;
      case 'pan':
        mixer.setPan(cmd.channel as any, cmd.value!);
        break;
    }
  }

  async function getLevel(chType: string, chNum: number): Promise<number | null> {
    return mixer.getLevel({ type: chType, channel: chNum } as any);
  }

  async function getMute(chType: string, chNum: number): Promise<boolean | null> {
    return mixer.getChannelMute(chType, chNum);
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ── Tests ───────────────────────────────────────────────────────────

  beforeEach(() => {
    engine.clearMappings();
  });

  describe('CC → Volume', () => {
    it('CC 7 at value 127 sets LINE ch2 to max volume', async () => {
      addVolumeMapping(1, 7, 'LINE', 2);
      const original = await getLevel('LINE', 2);

      const cmd = simulateMidi({ type: 'cc', channel: 1, controller: 7, value: 127 });
      expect(cmd).not.toBeNull();
      expect(cmd!.action).toBe('volume');
      expect(cmd!.value).toBeCloseTo(100, 0);

      executeCommand(cmd!);
      await wait(500);

      const after = await getLevel('LINE', 2);
      expect(after).toBeCloseTo(100, -1);

      // Restore
      if (original != null) {
        mixer.setVolume({ type: 'LINE', channel: 2 } as any, original);
        await wait(300);
      }
    });

    it('CC 7 at value 0 sets LINE ch2 to minimum volume', async () => {
      addVolumeMapping(1, 7, 'LINE', 2);
      const original = await getLevel('LINE', 2);

      const cmd = simulateMidi({ type: 'cc', channel: 1, controller: 7, value: 0 });
      expect(cmd!.value).toBeCloseTo(0, 0);

      executeCommand(cmd!);
      await wait(500);

      const after = await getLevel('LINE', 2);
      expect(after).toBeCloseTo(0, -1);

      // Restore
      if (original != null) {
        mixer.setVolume({ type: 'LINE', channel: 2 } as any, original);
        await wait(300);
      }
    });

    it('CC 7 at value 64 sets ~50% volume', async () => {
      addVolumeMapping(1, 7, 'LINE', 2);
      const original = await getLevel('LINE', 2);

      const cmd = simulateMidi({ type: 'cc', channel: 1, controller: 7, value: 64 });
      expect(cmd!.value).toBeGreaterThan(45);
      expect(cmd!.value).toBeLessThan(55);

      executeCommand(cmd!);
      await wait(500);

      const after = await getLevel('LINE', 2);
      expect(after).toBeGreaterThan(45);
      expect(after).toBeLessThan(55);

      // Restore
      if (original != null) {
        mixer.setVolume({ type: 'LINE', channel: 2 } as any, original);
        await wait(300);
      }
    });

    it('rapid CC sweep (0→127 in steps of 16) all reach the mixer', async () => {
      addVolumeMapping(1, 7, 'LINE', 2);
      const original = await getLevel('LINE', 2);

      const steps = [0, 16, 32, 48, 64, 80, 96, 112, 127];
      for (const val of steps) {
        const cmd = simulateMidi({ type: 'cc', channel: 1, controller: 7, value: val });
        executeCommand(cmd!);
      }
      await wait(800);

      // Final value should be near 100 (CC 127)
      const after = await getLevel('LINE', 2);
      expect(after).toBeGreaterThan(90);

      // Restore
      if (original != null) {
        mixer.setVolume({ type: 'LINE', channel: 2 } as any, original);
        await wait(300);
      }
    });
  });

  describe('Note → Mute toggle', () => {
    it('Note On toggles mute state on LINE ch2', async () => {
      addMuteMapping(1, 60, 'LINE', 2);
      const original = await getMute('LINE', 2);

      // note_on → toggle = true → toggleMute
      const cmd = simulateMidi({ type: 'note_on', channel: 1, note: 60, value: 100 });
      expect(cmd).not.toBeNull();
      expect(cmd!.action).toBe('mute');
      expect(cmd!.toggle).toBe(true);

      executeCommand(cmd!);

      // Poll for mute state change (mixer echo latency can exceed 500ms)
      let after = original;
      for (let i = 0; i < 20; i++) {
        await wait(100);
        after = await getMute('LINE', 2);
        if (after !== original) break;
      }
      expect(after).not.toBe(original);

      // Restore via another toggle
      mixer.toggleMute({ type: 'LINE', channel: 2 } as any);
      await wait(300);
    });

    it('Note On then Note Off results in toggle then untoggle', async () => {
      addMuteMapping(1, 60, 'LINE', 2);
      const original = await getMute('LINE', 2);

      // Note On → toggle
      const cmdOn = simulateMidi({ type: 'note_on', channel: 1, note: 60, value: 100 });
      executeCommand(cmdOn!);

      let afterOn = original;
      for (let i = 0; i < 20; i++) {
        await wait(100);
        afterOn = await getMute('LINE', 2);
        if (afterOn !== original) break;
      }
      expect(afterOn).not.toBe(original);

      // Note Off → setMute false (unmute)
      const cmdOff = simulateMidi({ type: 'note_off', channel: 1, note: 60, value: 0 });
      expect(cmdOff!.toggle).toBe(false);
      // For note-off with toggle=false, we call setMute(false)
      mixer.setMute({ type: 'LINE', channel: 2 } as any, false);

      let afterOff = afterOn;
      for (let i = 0; i < 20; i++) {
        await wait(100);
        afterOff = await getMute('LINE', 2);
        if (afterOff === false) break;
      }
      expect(afterOff).toBe(false);

      // Restore original
      if (original) {
        mixer.setMute({ type: 'LINE', channel: 2 } as any, true);
        await wait(300);
      }
    });
  });

  describe('unmapped MIDI is ignored', () => {
    it('CC on unmapped controller returns null', () => {
      addVolumeMapping(1, 7, 'LINE', 1);
      const cmd = simulateMidi({ type: 'cc', channel: 1, controller: 99, value: 127 });
      expect(cmd).toBeNull();
    });

    it('Note on unmapped note returns null', () => {
      addMuteMapping(1, 60, 'LINE', 1);
      const cmd = simulateMidi({ type: 'note_on', channel: 1, note: 99, value: 100 });
      expect(cmd).toBeNull();
    });

    it('CC on wrong MIDI channel returns null', () => {
      addVolumeMapping(1, 7, 'LINE', 1);
      const cmd = simulateMidi({ type: 'cc', channel: 2, controller: 7, value: 127 });
      expect(cmd).toBeNull();
    });
  });

  describe('multi-channel mapping', () => {
    it('different CCs control different mixer channels simultaneously', async () => {
      addVolumeMapping(1, 1, 'LINE', 1);
      addVolumeMapping(1, 2, 'LINE', 2);
      addVolumeMapping(1, 3, 'LINE', 3);

      const orig1 = await getLevel('LINE', 1);
      const orig2 = await getLevel('LINE', 2);
      const orig3 = await getLevel('LINE', 3);

      // Set all to different levels
      executeCommand(simulateMidi({ type: 'cc', channel: 1, controller: 1, value: 32 })!);   // ~25%
      executeCommand(simulateMidi({ type: 'cc', channel: 1, controller: 2, value: 64 })!);   // ~50%
      executeCommand(simulateMidi({ type: 'cc', channel: 1, controller: 3, value: 96 })!);   // ~75%
      await wait(800);

      const after1 = await getLevel('LINE', 1);
      const after2 = await getLevel('LINE', 2);
      const after3 = await getLevel('LINE', 3);

      expect(after1).toBeGreaterThan(20);
      expect(after1).toBeLessThan(35);
      expect(after2).toBeGreaterThan(45);
      expect(after2).toBeLessThan(55);
      expect(after3).toBeGreaterThan(70);
      expect(after3).toBeLessThan(80);

      // Restore
      if (orig1 != null) mixer.setVolume({ type: 'LINE', channel: 1 } as any, orig1);
      if (orig2 != null) mixer.setVolume({ type: 'LINE', channel: 2 } as any, orig2);
      if (orig3 != null) mixer.setVolume({ type: 'LINE', channel: 3 } as any, orig3);
      await wait(300);
    });
  });

  describe('custom range mapping', () => {
    it('CC with range [20, 80] scales within that range', async () => {
      addVolumeMapping(1, 7, 'LINE', 2, [20, 80]);
      const original = await getLevel('LINE', 2);

      // CC 0 → 20%, CC 127 → 80%
      const cmdMin = simulateMidi({ type: 'cc', channel: 1, controller: 7, value: 0 });
      expect(cmdMin!.value).toBeCloseTo(20, 0);

      const cmdMax = simulateMidi({ type: 'cc', channel: 1, controller: 7, value: 127 });
      expect(cmdMax!.value).toBeCloseTo(80, 0);

      // Send max and verify on mixer
      executeCommand(cmdMax!);
      await wait(500);
      const after = await getLevel('LINE', 2);
      expect(after).toBeGreaterThan(75);
      expect(after).toBeLessThan(85);

      // Restore
      if (original != null) {
        mixer.setVolume({ type: 'LINE', channel: 2 } as any, original);
        await wait(300);
      }
    });
  });

  describe('AUX channel control', () => {
    it('CC controls AUX ch1 volume', async () => {
      addVolumeMapping(1, 10, 'AUX', 1);
      const original = await getLevel('AUX', 1);

      const cmd = simulateMidi({ type: 'cc', channel: 1, controller: 10, value: 90 });
      expect(cmd).not.toBeNull();
      executeCommand(cmd!);
      await wait(500);

      const after = await getLevel('AUX', 1);
      expect(after).toBeGreaterThan(60);

      // Restore
      if (original != null) {
        mixer.setVolume({ type: 'AUX', channel: 1 } as any, original);
        await wait(300);
      }
    });
  });
});
