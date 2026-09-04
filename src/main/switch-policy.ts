/**
 * Policy for the channel controls that can do damage.
 *
 * These decisions are made in two places — the IPC handlers behind the channel
 * menu, and the MIDI command executor — and a controller sending the wrong note
 * must be refused on exactly the same terms as a stray click. Keeping the rules
 * here rather than inline in both call sites is what stops the two drifting
 * apart, and makes them testable without standing up an Electron app.
 */

import { asChannelSwitch, RUN_MODE_BLOCKED_SWITCHES, type ChannelSwitchId } from './ipc-validators';

export type AppMode = 'edit' | 'run';

export type PolicyDecision =
  | { allowed: true; switchName: ChannelSwitchId }
  | { allowed: false; error: string };

/**
 * Whether a switch may be written right now.
 *
 * Phantom power can damage ribbon microphones, and an accidental polarity flip
 * on a summed source is a silent way to gut the low end mid-set, so both are
 * refused while the interface is locked for performance. The processor
 * switches stay available: bypassing a compressor during a show is a normal
 * thing to want, and it is instantly reversible.
 */
export function decideSwitchWrite(mode: AppMode, name: unknown): PolicyDecision {
  const switchName = asChannelSwitch(name);
  if (!switchName) {
    return { allowed: false, error: `Unknown channel switch: ${String(name)}` };
  }
  if (mode === 'run' && RUN_MODE_BLOCKED_SWITCHES.includes(switchName)) {
    return {
      allowed: false,
      error: `${switchName} cannot be changed in Run mode — switch to Edit mode first`,
    };
  }
  return { allowed: true, switchName };
}

/**
 * Whether preamp gain may be written right now.
 *
 * Gain is a setup control — you ride the fader, not the preamp — and it is the
 * one change in this group that can produce feedback, so it is Edit-mode only.
 * A non-finite request is refused rather than passed to the mixer.
 */
export function decideGainWrite(
  mode: AppMode,
  decibels: unknown
): { allowed: true; decibels: number } | { allowed: false; error: string } {
  if (mode === 'run') {
    return { allowed: false, error: 'Preamp gain cannot be changed in Run mode' };
  }
  // Accept only the two shapes that mean anything here, rather than coercing
  // whatever arrives: Number(null), Number('') and Number([]) are all 0, so a
  // missing or malformed value would otherwise be accepted and quietly set the
  // gain to the bottom of the range instead of being refused.
  const isNumeric =
    typeof decibels === 'number' ||
    (typeof decibels === 'string' && decibels.trim() !== '');
  if (!isNumeric) {
    return { allowed: false, error: 'Gain must be a number' };
  }
  const value = Number(decibels);
  if (!Number.isFinite(value)) {
    return { allowed: false, error: 'Gain must be a number' };
  }
  return { allowed: true, decibels: value };
}

/** Whether a console channel preset may be recalled right now. */
export function decidePresetRecall(
  mode: AppMode,
  presetFile: unknown
): { allowed: true; presetFile: string } | { allowed: false; error: string } {
  if (mode === 'run') {
    return { allowed: false, error: 'Channel presets cannot be recalled in Run mode' };
  }
  if (typeof presetFile !== 'string' || !presetFile.endsWith('.channel')) {
    return { allowed: false, error: 'Invalid channel preset' };
  }
  return { allowed: true, presetFile };
}

/** Normalise whatever the renderer reports as the current mode. */
export function asAppMode(value: unknown): AppMode {
  return value === 'run' ? 'run' : 'edit';
}
