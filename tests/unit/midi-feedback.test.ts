import { buildLevelFeedback } from '../../src/main/midi-feedback';
import type { MidiMapping } from '../../src/shared/types';

function ccMapping(channel = 1, controller = 7): MidiMapping {
  return {
    midi: { type: 'cc', channel, controller },
    mixer: { action: 'volume', channel: { type: 'LINE', channel: 1 } as any },
  };
}

function noteValueMapping(channel = 1, noteMin?: number, noteMax?: number): MidiMapping {
  return {
    midi: { type: 'note-value', channel, noteMin, noteMax },
    mixer: { action: 'volume', channel: { type: 'LINE', channel: 1 } as any },
  };
}

describe('buildLevelFeedback', () => {
  // ---- Regression: the mixer `level` event carries no `value` field ----
  // index.ts used to read data.value (undefined) and multiply by 100, so every
  // mixer-originated fader move fed back NaN. The API emits `level` on a 0-100
  // scale (MS.ts divides the raw u16 by 655.35), which is what we take here.
  describe('regression — scale and NaN handling', () => {
    it('treats the input as 0-100, not 0-1', () => {
      // 100% must map to the top of the CC range, not 1/100th of it.
      expect(buildLevelFeedback(ccMapping(), 100)).toEqual({
        type: 'cc', channel: 1, controller: 7, value: 127,
      });
    });

    it('returns null rather than emitting NaN when the level is undefined', () => {
      expect(buildLevelFeedback(ccMapping(), undefined as any)).toBeNull();
    });

    it('returns null rather than emitting NaN when the level is NaN', () => {
      expect(buildLevelFeedback(ccMapping(), NaN)).toBeNull();
    });
  });

  // ---- Regression: MIDI channel must stay 1-16 ----
  // index.ts used to pre-convert to 0-15 before calling MidiManager.sendCC,
  // which decrements again — so Logic channel 1 went out as wire channel -1.
  describe('regression — MIDI channel numbering', () => {
    it('returns the Logic 1-16 channel unconverted for cc', () => {
      expect(buildLevelFeedback(ccMapping(1), 50)!.channel).toBe(1);
      expect(buildLevelFeedback(ccMapping(16), 50)!.channel).toBe(16);
    });

    it('returns the Logic 1-16 channel unconverted for note-value', () => {
      expect(buildLevelFeedback(noteValueMapping(1), 50)!.channel).toBe(1);
      expect(buildLevelFeedback(noteValueMapping(16), 50)!.channel).toBe(16);
    });
  });

  // ---- CC mappings ----
  describe('cc mappings', () => {
    it('scales 0% to CC value 0', () => {
      expect(buildLevelFeedback(ccMapping(), 0)).toEqual({
        type: 'cc', channel: 1, controller: 7, value: 0,
      });
    });

    it('scales 50% to the middle of the CC range', () => {
      expect(buildLevelFeedback(ccMapping(), 50)!.value).toBe(64);
    });

    it('carries the controller number through', () => {
      expect(buildLevelFeedback(ccMapping(3, 42), 100)).toEqual({
        type: 'cc', channel: 3, controller: 42, value: 127,
      });
    });

    it('clamps levels above 100', () => {
      expect(buildLevelFeedback(ccMapping(), 150)!.value).toBe(127);
    });

    it('clamps negative levels', () => {
      expect(buildLevelFeedback(ccMapping(), -20)!.value).toBe(0);
    });

    it('returns null when the mapping has no controller number', () => {
      const m = ccMapping();
      delete m.midi.controller;
      expect(buildLevelFeedback(m, 50)).toBeNull();
    });

    it('honours controller 0 rather than treating it as missing', () => {
      expect(buildLevelFeedback(ccMapping(1, 0), 100)!).toMatchObject({ controller: 0 });
    });
  });

  // ---- note-value mappings ----
  describe('note-value mappings', () => {
    it('maps 0% to the low end of the note range', () => {
      expect(buildLevelFeedback(noteValueMapping(1, 24, 60), 0)).toEqual({
        type: 'note-on', channel: 1, note: 24, velocity: 100,
      });
    });

    it('maps 100% to the high end of the note range', () => {
      expect(buildLevelFeedback(noteValueMapping(1, 24, 60), 100)!.note).toBe(60);
    });

    it('maps 50% to the middle of the note range', () => {
      expect(buildLevelFeedback(noteValueMapping(1, 24, 60), 50)!.note).toBe(42);
    });

    it('defaults to the 24-60 range when unspecified', () => {
      expect(buildLevelFeedback(noteValueMapping(1), 0)!.note).toBe(24);
      expect(buildLevelFeedback(noteValueMapping(1), 100)!.note).toBe(60);
    });

    it('honours noteMin 0 rather than falling back to the default', () => {
      // A `|| 24` fallback would silently ignore a legitimate noteMin of 0.
      expect(buildLevelFeedback(noteValueMapping(1, 0, 100), 0)!.note).toBe(0);
    });

    it('returns null for a degenerate range instead of emitting NaN', () => {
      // noteMax - noteMin === 0 would divide by zero.
      expect(buildLevelFeedback(noteValueMapping(1, 48, 48), 50)).toBeNull();
    });

    it('returns null for an inverted range', () => {
      expect(buildLevelFeedback(noteValueMapping(1, 60, 24), 50)).toBeNull();
    });
  });

  // ---- Mapping types that carry no position ----
  describe('non-positional mappings', () => {
    it.each(['note', 'note-on', 'note-off', 'note-toggle'] as const)(
      'returns null for %s mappings', (type) => {
        const m: MidiMapping = {
          midi: { type, channel: 1, note: 60 },
          mixer: { action: 'volume', channel: { type: 'LINE', channel: 1 } as any },
        };
        expect(buildLevelFeedback(m, 50)).toBeNull();
      },
    );
  });
});
