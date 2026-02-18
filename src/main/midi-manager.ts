// MIDI Manager - Handles MIDI input from Logic Pro or hardware controllers

import * as easymidi from 'easymidi';
import { EventEmitter } from 'events';
import type { MidiMessage } from '../shared/types';

export class MidiManager extends EventEmitter {
  private input: easymidi.Input | null = null;
  private currentDevice: string | null = null;

  constructor() {
    super();
  }

  /**
   * Get list of available MIDI input devices
   */
  getAvailableDevices(): string[] {
    return easymidi.getInputs();
  }

  /**
   * Connect to a MIDI input device
   */
  connect(deviceName: string): void {
    if (this.input) {
      this.disconnect();
    }

    try {
      this.input = new easymidi.Input(deviceName);
      this.currentDevice = deviceName;

      // Listen for Control Change messages (most common from Logic Pro)
      this.input.on('cc', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'cc',
          channel: msg.channel,
          controller: msg.controller,
          value: msg.value
        };
        this.emit('message', midiMessage);
      });

      // Listen for Note On messages
      this.input.on('noteon', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'note_on',
          channel: msg.channel,
          note: msg.note,
          value: msg.velocity
        };
        this.emit('message', midiMessage);
      });

      // Listen for Note Off messages
      this.input.on('noteoff', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'note_off',
          channel: msg.channel,
          note: msg.note,
          value: msg.velocity
        };
        this.emit('message', midiMessage);
      });

      // Listen for Pitch Bend messages
      this.input.on('pitch', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'pitch_bend',
          channel: msg.channel,
          value: msg.value
        };
        this.emit('message', midiMessage);
      });

      this.emit('connected', deviceName);
      console.log(`✓ Connected to MIDI device: ${deviceName}`);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to connect to MIDI device: ${error}`);
    }
  }

  /**
   * Disconnect from current MIDI device
   */
  disconnect(): void {
    if (this.input) {
      this.input.close();
      this.input = null;
      const device = this.currentDevice;
      this.currentDevice = null;
      this.emit('disconnected', device);
      console.log(`✓ Disconnected from MIDI device: ${device}`);
    }
  }

  /**
   * Get currently connected device name
   */
  getCurrentDevice(): string | null {
    return this.currentDevice;
  }

  /**
   * Check if connected to a device
   */
  isConnected(): boolean {
    return this.input !== null;
  }
}

