// Mapping Engine - Translates MIDI messages to mixer commands

import type { MidiMessage, MixerCommand, MidiMapping, MappingPreset } from '../shared/types';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export class MappingEngine extends EventEmitter {
  private mappings: MidiMapping[] = [];
  private currentPreset: string | null = null;
  private currentPresetPath: string | null = null;
  private preferredMixerIp: string | null = null;
  private preferredMidiDevices: string[] = [];
  private faderFilter: 'all' | 'mapped' = 'all';
  private midiFeedbackEnabled: boolean = true;

  // O(1) lookup structures — rebuilt on every mappings mutation
  private midiLookup: Map<string, MidiMapping> = new Map();
  private noteValueMappings: MidiMapping[] = [];   // range-based — must linear-scan
  private volumeLookup: Map<string, MidiMapping> = new Map();

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Lookup table management
  // ---------------------------------------------------------------------------

  /**
   * Rebuild all O(1) lookup structures from the current mappings array.
   * Must be called whenever this.mappings changes.
   */
  private rebuildLookup(): void {
    this.midiLookup.clear();
    this.noteValueMappings = [];
    this.volumeLookup.clear();

    for (const m of this.mappings) {
      // ---- MIDI lookup (for translateMidiToMixer) ----
      const device = m.midi.device ?? '';

      if (m.midi.type === 'cc') {
        // Key includes device so per-device mappings don't overwrite global ones
        const key = `cc-${device}-${m.midi.channel}-${m.midi.controller}`;
        this.midiLookup.set(key, m);
      } else if (
        m.midi.type === 'note' ||
        m.midi.type === 'note-on' ||
        m.midi.type === 'note-off' ||
        m.midi.type === 'note-toggle'
      ) {
        const key = `note-${device}-${m.midi.channel}-${m.midi.note}`;
        this.midiLookup.set(key, m);
      } else if (m.midi.type === 'note-value') {
        // Range-based — cannot use a single Map key; kept in a separate small list
        this.noteValueMappings.push(m);
      }

      // ---- Volume lookup (for MIDI feedback on level events) ----
      if (m.mixer.action === 'volume' && 'type' in m.mixer.channel) {
        const chType = ((m.mixer.channel as any).type || 'LINE').toUpperCase();
        const chNum  = (m.mixer.channel as any).channel;
        if (chNum !== undefined) {
          this.volumeLookup.set(`${chType}-${chNum}`, m);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Preset management
  // ---------------------------------------------------------------------------

  /**
   * Load a mapping preset from file
   */
  loadPreset(presetPath: string): void {
    try {
      // Reject oversized files before reading
      const MAX_PRESET_SIZE = 5_242_880; // 5 MB
      const stat = fs.statSync(presetPath);
      if (stat.size > MAX_PRESET_SIZE) {
        throw new Error(`Preset file too large: ${stat.size} bytes`);
      }

      const data = fs.readFileSync(presetPath, 'utf-8');
      const preset: MappingPreset = JSON.parse(data);

      // Basic schema validation
      if (!preset || typeof preset !== 'object') {
        throw new Error('Invalid preset: not an object');
      }
      if (!Array.isArray(preset.mappings)) {
        throw new Error('Invalid preset: mappings must be an array');
      }
      if (typeof preset.name !== 'string' || !preset.name) {
        throw new Error('Invalid preset: name is required');
      }

      this.mappings = preset.mappings;
      this.currentPreset = preset.name;
      this.currentPresetPath = presetPath;
      this.preferredMixerIp = preset.mixerIp || null;
      // Support both new midiDevices array and legacy midiDevice string
      if (preset.midiDevices && preset.midiDevices.length > 0) {
        this.preferredMidiDevices = preset.midiDevices;
      } else if (preset.midiDevice) {
        this.preferredMidiDevices = [preset.midiDevice];
      } else {
        this.preferredMidiDevices = [];
      }
      this.faderFilter = preset.faderFilter || 'all';
      this.midiFeedbackEnabled = preset.midiFeedbackEnabled !== undefined ? preset.midiFeedbackEnabled : true;

      this.rebuildLookup();
      this.emit('preset-loaded', preset);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to load preset: ${error}`);
    }
  }

  /**
   * Save current mappings as a preset
   */
  savePreset(presetPath: string, name: string, description?: string): void {
    const preset: MappingPreset = {
      name,
      version: '1.0',
      description,
      mixerIp: this.preferredMixerIp || undefined,
      midiDevices: this.preferredMidiDevices.length > 0 ? this.preferredMidiDevices : undefined,
      faderFilter: this.faderFilter,
      midiFeedbackEnabled: this.midiFeedbackEnabled,
      mappings: this.mappings
    };

    try {
      // Ensure presets directory exists
      const presetsDir = path.dirname(presetPath);
      if (!fs.existsSync(presetsDir)) {
        fs.mkdirSync(presetsDir, { recursive: true });
      }

      fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2));
      this.currentPreset = name;
      this.currentPresetPath = presetPath;
      this.emit('preset-saved', preset);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to save preset: ${error}`);
    }
  }

  /**
   * Auto-save current preset (if one is loaded)
   */
  autoSavePreset(): void {
    if (this.currentPresetPath && this.currentPreset) {
      try {
        this.savePreset(this.currentPresetPath, this.currentPreset);
        console.log(`✓ Auto-saved preset: ${this.currentPreset}`);
      } catch (error) {
        console.error('Failed to auto-save preset:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping CRUD
  // ---------------------------------------------------------------------------

  /**
   * Add a new mapping
   */
  addMapping(mapping: MidiMapping): void {
    this.mappings.push(mapping);
    this.rebuildLookup();
    this.emit('mapping-added', mapping);
  }

  /**
   * Remove a mapping by index
   */
  removeMapping(index: number): void {
    if (index >= 0 && index < this.mappings.length) {
      const removed = this.mappings.splice(index, 1)[0];
      this.rebuildLookup();
      this.emit('mapping-removed', removed);
    }
  }

  /**
   * Update a mapping by index
   */
  updateMapping(index: number, mapping: MidiMapping): void {
    if (index >= 0 && index < this.mappings.length) {
      this.mappings[index] = mapping;
      this.rebuildLookup();
      this.emit('mapping-updated', mapping);
    }
  }

  /**
   * Clear all mappings
   */
  clearMappings(): void {
    this.mappings = [];
    this.rebuildLookup();
    this.emit('mappings-cleared');
  }

  /**
   * Get all current mappings.
   * Returns the internal array directly — callers must not mutate it.
   * (IPC sends a structured-clone copy automatically; internal callers only read.)
   */
  getMappings(): MidiMapping[] {
    return this.mappings;
  }

  /**
   * Find the volume mapping for a given channel type + number in O(1).
   * Used for MIDI feedback when the mixer reports a level change.
   */
  findVolumeMapping(channelType: string, channelNumber: number): MidiMapping | undefined {
    return this.volumeLookup.get(`${channelType.toUpperCase()}-${channelNumber}`);
  }

  // ---------------------------------------------------------------------------
  // MIDI → Mixer translation
  // ---------------------------------------------------------------------------

  /**
   * Translate a MIDI message to a mixer command.
   * Uses pre-built Maps for O(1) lookup on CC and note messages.
   */
  translateMidiToMixer(midiMessage: MidiMessage): MixerCommand | null {
    let mapping: MidiMapping | undefined;
    const msgDevice = midiMessage.device ?? '';

    if (midiMessage.type === 'cc') {
      // Try device-specific mapping first, then global (empty device)
      mapping =
        this.midiLookup.get(`cc-${msgDevice}-${midiMessage.channel}-${midiMessage.controller}`) ??
        this.midiLookup.get(`cc--${midiMessage.channel}-${midiMessage.controller}`);

    } else if (midiMessage.type === 'note_on' || midiMessage.type === 'note_off') {
      // Try device-specific, then global
      mapping =
        this.midiLookup.get(`note-${msgDevice}-${midiMessage.channel}-${midiMessage.note}`) ??
        this.midiLookup.get(`note--${midiMessage.channel}-${midiMessage.note}`);

      // Note-value range mappings — still need a linear scan (small list)
      if (!mapping && midiMessage.type === 'note_on' && midiMessage.note !== undefined) {
        mapping = this.noteValueMappings.find(m => {
          if (m.midi.device && m.midi.device !== msgDevice) return false;
          return (
            m.midi.channel === midiMessage.channel &&
            midiMessage.note! >= ((m.midi as any).noteMin ?? 0) &&
            midiMessage.note! <= ((m.midi as any).noteMax ?? 127)
          );
        });
      }
    }

    if (!mapping) {
      return null;
    }

    // Build mixer command
    const command: MixerCommand = {
      action: mapping.mixer.action,
      channel: mapping.mixer.channel
    };

    // Handle different action types
    switch (mapping.mixer.action) {
      case 'volume':
      case 'pan': {
        let scaledValue: number;

        if (mapping.midi.type === 'note-value' && midiMessage.note !== undefined) {
          const noteMin = (mapping.midi as any).noteMin || 24;
          const noteMax = (mapping.midi as any).noteMax || 60;
          const noteRange = noteMax - noteMin;
          scaledValue = ((midiMessage.note - noteMin) / noteRange) * 100;
          scaledValue = Math.max(0, Math.min(100, scaledValue));
        } else {
          const [min, max] = mapping.mixer.range || [0, 100];
          scaledValue = min + (midiMessage.value / 127) * (max - min);
        }

        command.value = scaledValue;
        break;
      }
      case 'mute':
      case 'solo': {
        let shouldActivate = false;

        if (mapping.midi.type === 'cc') {
          const threshold = (mapping.midi as any).threshold !== undefined ? (mapping.midi as any).threshold : 64;
          shouldActivate = midiMessage.value >= threshold;
        } else {
          shouldActivate = midiMessage.type === 'note_on';
        }

        if ((mapping.midi as any).invert) {
          shouldActivate = !shouldActivate;
        }

        command.toggle = shouldActivate;
        break;
      }
    }

    return command;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getCurrentPreset(): string | null {
    return this.currentPreset;
  }

  getPreferredMixerIp(): string | null {
    return this.preferredMixerIp;
  }

  setPreferredMixerIp(ip: string): void {
    this.preferredMixerIp = ip;
    console.log(`✓ Set preferred mixer IP: ${ip}`);
    this.autoSavePreset();
  }

  getPreferredMidiDevices(): string[] {
    return [...this.preferredMidiDevices];
  }

  addPreferredMidiDevice(device: string): void {
    if (!this.preferredMidiDevices.includes(device)) {
      this.preferredMidiDevices.push(device);
      console.log(`✓ Added preferred MIDI device: ${device}`);
      this.autoSavePreset();
    }
  }

  removePreferredMidiDevice(device: string): void {
    const before = this.preferredMidiDevices.length;
    this.preferredMidiDevices = this.preferredMidiDevices.filter(d => d !== device);
    if (this.preferredMidiDevices.length < before) {
      console.log(`✓ Removed preferred MIDI device: ${device}`);
      this.autoSavePreset();
    }
  }

  /** Backward compat — returns first preferred device */
  getPreferredMidiDevice(): string | null {
    return this.preferredMidiDevices.length > 0 ? this.preferredMidiDevices[0] : null;
  }

  /** Backward compat — adds to list */
  setPreferredMidiDevice(device: string): void {
    this.addPreferredMidiDevice(device);
  }

  getFaderFilter(): 'all' | 'mapped' {
    return this.faderFilter;
  }

  setFaderFilter(filter: 'all' | 'mapped'): void {
    this.faderFilter = filter;
  }

  getMidiFeedbackEnabled(): boolean {
    return this.midiFeedbackEnabled;
  }

  setMidiFeedbackEnabled(enabled: boolean): void {
    this.midiFeedbackEnabled = enabled;
    console.log(`✓ Set MIDI feedback: ${enabled ? 'enabled' : 'disabled'}`);
    this.autoSavePreset();
  }
}
