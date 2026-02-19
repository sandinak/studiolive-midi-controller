// MIDI Manager - Handles MIDI input from Logic Pro or hardware controllers

import * as easymidi from 'easymidi';
import { EventEmitter } from 'events';
import type { MidiMessage } from '../shared/types';

export class MidiManager extends EventEmitter {
  private input: easymidi.Input | null = null;
  private output: easymidi.Output | null = null;
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
   * Get list of available MIDI output devices
   */
  getAvailableOutputDevices(): string[] {
    return easymidi.getOutputs();
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

      // Try to open output on the same device for MIDI feedback
      try {
        this.output = new easymidi.Output(deviceName);
      } catch (outputError) {
        console.warn(`Could not open MIDI output on ${deviceName}:`, outputError);
        this.output = null;
      }

      // Listen for Control Change messages (most common from Logic Pro)
      this.input.on('cc', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'cc',
          channel: msg.channel + 1,  // Convert from 0-15 to 1-16
          controller: msg.controller,
          value: msg.value
        };
        this.emit('message', midiMessage);
      });

      // Listen for Note On messages
      this.input.on('noteon', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'note_on',
          channel: msg.channel + 1,  // Convert from 0-15 to 1-16
          note: msg.note,
          value: msg.velocity
        };
        this.emit('message', midiMessage);
      });

      // Listen for Note Off messages
      this.input.on('noteoff', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'note_off',
          channel: msg.channel + 1,  // Convert from 0-15 to 1-16
          note: msg.note,
          value: msg.velocity
        };
        this.emit('message', midiMessage);
      });

      // Listen for Pitch Bend messages
      this.input.on('pitch', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'pitch_bend',
          channel: msg.channel + 1,  // Convert from 0-15 to 1-16
          value: msg.value
        };
        this.emit('message', midiMessage);
      });

      this.emit('connected', deviceName);
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
    }
    if (this.output) {
      this.output.close();
      this.output = null;
    }
    const device = this.currentDevice;
    this.currentDevice = null;
    if (device) {
      this.emit('disconnected', device);
    }
  }

  /**
   * Send a MIDI CC message
   */
  sendCC(channel: number, controller: number, value: number): void {
    if (!this.output) {
      console.warn('No MIDI output available');
      return;
    }
    try {
      // MIDI channels are 0-15 in easymidi, but 1-16 in our UI
      const midiChannel = (channel - 1) as any;
      this.output.send('cc', { channel: midiChannel, controller, value });
    } catch (error) {
      console.error('Failed to send MIDI CC:', error);
    }
  }

  /**
   * Send a MIDI Note On message
   */
  sendNoteOn(channel: number, note: number, velocity: number): void {
    if (!this.output) {
      console.warn('No MIDI output available');
      return;
    }
    try {
      // MIDI channels are 0-15 in easymidi, but 1-16 in our UI
      const midiChannel = (channel - 1) as any;
      this.output.send('noteon', { channel: midiChannel, note, velocity });
    } catch (error) {
      console.error('Failed to send MIDI Note On:', error);
    }
  }

  /**
   * Send a MIDI Note Off message
   */
  sendNoteOff(channel: number, note: number): void {
    if (!this.output) {
      console.warn('No MIDI output available');
      return;
    }
    try {
      // MIDI channels are 0-15 in easymidi, but 1-16 in our UI
      const midiChannel = (channel - 1) as any;
      this.output.send('noteoff', { channel: midiChannel, note, velocity: 0 });
    } catch (error) {
      console.error('Failed to send MIDI Note Off:', error);
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
    console.log('[MidiManager] isConnected check:');
    console.log('  - this.input:', this.input !== null);
    console.log('  - this.currentDevice:', this.currentDevice);

    if (!this.input || !this.currentDevice) {
      return false;
    }

    // Verify the device is still available
    const availableDevices = this.getAvailableDevices();
    console.log('  - Available devices:', availableDevices);
    console.log('  - Device in list:', availableDevices.includes(this.currentDevice));

    if (!availableDevices.includes(this.currentDevice)) {
      console.warn(`MIDI device ${this.currentDevice} is no longer available`);
      this.disconnect();
      return false;
    }

    return true;
  }

  /**
   * Check if MIDI output is available
   */
  hasOutput(): boolean {
    return this.output !== null;
  }
}

