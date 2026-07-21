// MIDI feedback — builds the outbound MIDI message for a mixer level change.
//
// Two call sites need this: the mixer's `level` event (fader moved on the
// console or in Universal Control) and the renderer's own fader drag. They
// used to carry their own copies of the scaling maths and drifted apart —
// one double-converted the MIDI channel, the other read a field the API
// doesn't emit. Both now go through here so they cannot disagree again.

import type { MidiMapping } from '../shared/types';

/**
 * An outbound MIDI feedback message.
 * `channel` is 1-16 (Logic numbering) — MidiManager converts to wire 0-15,
 * so callers must NOT pre-decrement it.
 */
export type FeedbackMessage =
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'note-on'; channel: number; note: number; velocity: number };

/** Default note range for `note-value` mappings that don't specify one. */
const DEFAULT_NOTE_MIN = 24;
const DEFAULT_NOTE_MAX = 60;

/**
 * Build the MIDI feedback message for a channel level change.
 *
 * `percentage` is 0-100. Both sources report on that scale: the API's `level`
 * event divides the raw u16 by 655.35 (see MS.ts in presonus-studiolive-api),
 * and MixerManager.normalizeDcaLevel returns 0-100 for polled DCA faders.
 *
 * Returns null when the mapping can't produce a message — a non-feedback
 * mapping type, a missing CC controller, or a degenerate note range.
 */
export function buildLevelFeedback(
  mapping: MidiMapping,
  percentage: number,
): FeedbackMessage | null {
  if (!Number.isFinite(percentage)) return null;
  const pct = Math.min(100, Math.max(0, percentage));

  if (mapping.midi.type === 'cc') {
    // A CC mapping without a controller number can't address anything.
    if (mapping.midi.controller === undefined) return null;
    return {
      type: 'cc',
      channel: mapping.midi.channel,
      controller: mapping.midi.controller,
      value: Math.round((pct / 100) * 127),
    };
  }

  if (mapping.midi.type === 'note-value') {
    const noteMin = mapping.midi.noteMin ?? DEFAULT_NOTE_MIN;
    const noteMax = mapping.midi.noteMax ?? DEFAULT_NOTE_MAX;
    const noteRange = noteMax - noteMin;
    // An empty or inverted range would yield NaN / a note below the floor.
    if (noteRange <= 0) return null;
    return {
      type: 'note-on',
      channel: mapping.midi.channel,
      note: Math.round((pct / 100) * noteRange) + noteMin,
      velocity: 100,
    };
  }

  // Trigger-style note mappings (note / note-on / note-off / note-toggle)
  // carry no position, so a level change has nothing to feed back.
  return null;
}
