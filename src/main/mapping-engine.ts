// Mapping Engine - Translates MIDI messages to mixer commands

import type { MidiMessage, MixerCommand, MidiMapping, MappingPreset } from '../shared/types';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export class MappingEngine extends EventEmitter {
  private mappings: MidiMapping[] = [];
  private currentPreset: string | null = null;

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
      this.emit('preset-loaded', preset);
      console.log(`✓ Loaded preset: ${preset.name} (${preset.mappings.length} mappings)`);
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
      mappings: this.mappings
    };

    try {
      fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2));
      this.currentPreset = name;
      this.emit('preset-saved', preset);
      console.log(`✓ Saved preset: ${name}`);
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
        // Scale MIDI value (0-127) to mixer range
        const [min, max] = mapping.mixer.range || [0, 100];
        const scaledValue = min + (midiMessage.value / 127) * (max - min);
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
}

