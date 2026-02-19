// Mapping Engine - Translates MIDI messages to mixer commands

import type { MidiMessage, MixerCommand, MidiMapping, MappingPreset } from '../shared/types';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export class MappingEngine extends EventEmitter {
  private mappings: MidiMapping[] = [];
  private currentPreset: string | null = null;
  private preferredMixerIp: string | null = null;
  private preferredMidiDevice: string | null = null;
  private faderFilter: 'all' | 'mapped' = 'all';

  constructor() {
    super();
  }

  /**
   * Load a mapping preset from file
   */
  loadPreset(presetPath: string): void {
    try {
      const data = fs.readFileSync(presetPath, 'utf-8');
      const preset: MappingPreset = JSON.parse(data);
      this.mappings = preset.mappings;
      this.currentPreset = preset.name;
      this.preferredMixerIp = preset.mixerIp || null;
      this.preferredMidiDevice = preset.midiDevice || null;
      this.faderFilter = preset.faderFilter || 'all';
      if (this.preferredMixerIp) {
      }
      if (this.preferredMidiDevice) {
      }
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
      midiDevice: this.preferredMidiDevice || undefined,
      faderFilter: this.faderFilter,
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
      this.emit('preset-saved', preset);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to save preset: ${error}`);
    }
  }

  /**
   * Add a new mapping
   */
  addMapping(mapping: MidiMapping): void {
    this.mappings.push(mapping);
    this.emit('mapping-added', mapping);
  }

  /**
   * Remove a mapping by index
   */
  removeMapping(index: number): void {
    if (index >= 0 && index < this.mappings.length) {
      const removed = this.mappings.splice(index, 1)[0];
      this.emit('mapping-removed', removed);
    }
  }

  /**
   * Clear all mappings
   */
  clearMappings(): void {
    this.mappings = [];
    this.emit('mappings-cleared');
  }

  /**
   * Get all current mappings
   */
  getMappings(): MidiMapping[] {
    return [...this.mappings];
  }

  /**
   * Translate a MIDI message to a mixer command
   */
  translateMidiToMixer(midiMessage: MidiMessage): MixerCommand | null {
    // Find matching mapping
    const mapping = this.mappings.find(m => {
      if (m.midi.type === 'cc' && midiMessage.type === 'cc') {
        return m.midi.channel === midiMessage.channel &&
               m.midi.controller === midiMessage.controller;
      } else if (m.midi.type === 'note' && (midiMessage.type === 'note_on' || midiMessage.type === 'note_off')) {
        return m.midi.channel === midiMessage.channel &&
               m.midi.note === midiMessage.note;
      } else if (m.midi.type === 'note-value' && midiMessage.type === 'note_on') {
        // Note-value mode: match channel and check if note is in range
        return m.midi.channel === midiMessage.channel &&
               midiMessage.note !== undefined &&
               (m.midi as any).noteMin !== undefined &&
               (m.midi as any).noteMax !== undefined &&
               midiMessage.note >= (m.midi as any).noteMin &&
               midiMessage.note <= (m.midi as any).noteMax;
      }
      return false;
    });

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

        // Check if this is note-value mode
        if (mapping.midi.type === 'note-value' && midiMessage.note !== undefined) {
          const noteMin = (mapping.midi as any).noteMin || 24;
          const noteMax = (mapping.midi as any).noteMax || 60;
          const noteRange = noteMax - noteMin;

          // Map note number to 0-100 range
          // Formula: ((noteNumber - noteMin) / (noteMax - noteMin)) * 100
          scaledValue = ((midiMessage.note - noteMin) / noteRange) * 100;

          // Clamp to 0-100
          scaledValue = Math.max(0, Math.min(100, scaledValue));

        } else {
          // Standard CC or note mode: scale MIDI value (0-127) to mixer range
          const [min, max] = mapping.mixer.range || [0, 100];
          scaledValue = min + (midiMessage.value / 127) * (max - min);
        }

        command.value = scaledValue;
        break;
      }
      case 'mute':
      case 'solo': {
        // Toggle on note_on or CC value > 0
        command.toggle = midiMessage.type === 'note_on' || midiMessage.value > 0;
        break;
      }
    }

    return command;
  }

  /**
   * Get current preset name
   */
  getCurrentPreset(): string | null {
    return this.currentPreset;
  }

  /**
   * Get preferred mixer IP
   */
  getPreferredMixerIp(): string | null {
    return this.preferredMixerIp;
  }

  /**
   * Set preferred mixer IP (will be saved with preset)
   */
  setPreferredMixerIp(ip: string): void {
    this.preferredMixerIp = ip;
  }

  /**
   * Get preferred MIDI device
   */
  getPreferredMidiDevice(): string | null {
    return this.preferredMidiDevice;
  }

  /**
   * Set preferred MIDI device (will be saved with preset)
   */
  setPreferredMidiDevice(device: string): void {
    this.preferredMidiDevice = device;
  }

  /**
   * Get fader filter state
   */
  getFaderFilter(): 'all' | 'mapped' {
    return this.faderFilter;
  }

  /**
   * Set fader filter state (will be saved with preset)
   */
  setFaderFilter(filter: 'all' | 'mapped'): void {
    this.faderFilter = filter;
  }
}

