// MIDI Manager - Handles MIDI input from Logic Pro or hardware controllers

import * as easymidi from 'easymidi';
import { EventEmitter } from 'events';
import type { MidiMessage } from '../shared/types';

export class MidiManager extends EventEmitter {
  private inputs: Map<string, easymidi.Input> = new Map();
  private outputs: Map<string, easymidi.Output> = new Map();

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
   * Connect to a MIDI input device (additive — keeps existing connections)
   */
  connectDevice(deviceName: string): void {
    // Already connected — skip
    if (this.inputs.has(deviceName)) return;

    try {
      const input = new easymidi.Input(deviceName);
      this.inputs.set(deviceName, input);

      // Try to open output on the same device for MIDI feedback
      try {
        const output = new easymidi.Output(deviceName);
        this.outputs.set(deviceName, output);
      } catch (_outputError) {
        // Output unavailable — feedback just won't work for this device
      }

      // Listen for Control Change messages
      input.on('cc', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'cc',
          channel: msg.channel + 1,  // Convert from 0-15 to 1-16
          controller: msg.controller,
          value: msg.value,
          device: deviceName
        };
        this.emit('message', midiMessage);
      });

      // Listen for Note On messages
      input.on('noteon', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'note_on',
          channel: msg.channel + 1,
          note: msg.note,
          value: msg.velocity,
          device: deviceName
        };
        this.emit('message', midiMessage);
      });

      // Listen for Note Off messages
      input.on('noteoff', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'note_off',
          channel: msg.channel + 1,
          note: msg.note,
          value: msg.velocity,
          device: deviceName
        };
        this.emit('message', midiMessage);
      });

      // Listen for Pitch Bend messages
      input.on('pitch', (msg) => {
        const midiMessage: MidiMessage = {
          type: 'pitch_bend',
          channel: msg.channel + 1,
          value: msg.value,
          device: deviceName
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
   * Disconnect from a specific MIDI device
   */
  disconnectDevice(deviceName: string): void {
    const input = this.inputs.get(deviceName);
    if (input) {
      try { input.close(); } catch (_e) { /* ignore */ }
      this.inputs.delete(deviceName);
    }
    const output = this.outputs.get(deviceName);
    if (output) {
      try { output.close(); } catch (_e) { /* ignore */ }
      this.outputs.delete(deviceName);
    }
    this.emit('disconnected', deviceName);
  }

  /**
   * Disconnect from all MIDI devices
   */
  disconnectAll(): void {
    for (const name of [...this.inputs.keys()]) {
      this.disconnectDevice(name);
    }
  }

  /**
   * Get list of all currently connected device names
   */
  getConnectedDevices(): string[] {
    return [...this.inputs.keys()];
  }

  /**
   * Check if a specific device is connected (or any device if name omitted).
   * Also evicts stale devices that are no longer available.
   */
  isConnected(deviceName?: string): boolean {
    const available = this.getAvailableDevices();

    if (deviceName) {
      if (!this.inputs.has(deviceName)) return false;
      if (!available.includes(deviceName)) {
        this.disconnectDevice(deviceName);
        return false;
      }
      return true;
    }

    // Validate all connected devices, evict stale ones
    for (const name of [...this.inputs.keys()]) {
      if (!available.includes(name)) {
        this.disconnectDevice(name);
      }
    }
    return this.inputs.size > 0;
  }

  /**
   * Check if a specific device is connected
   */
  isDeviceConnected(deviceName: string): boolean {
    return this.isConnected(deviceName);
  }

  /**
   * Get the first connected device name (backward compat)
   */
  getCurrentDevice(): string | null {
    const devices = this.getConnectedDevices();
    return devices.length > 0 ? devices[0] : null;
  }

  /**
   * Send a MIDI CC message to all outputs (or a specific device's output)
   */
  sendCC(channel: number, controller: number, value: number, deviceName?: string): void {
    const targets = deviceName
      ? (this.outputs.has(deviceName) ? [this.outputs.get(deviceName)!] : [])
      : [...this.outputs.values()];

    for (const output of targets) {
      try {
        const midiChannel = (channel - 1) as any;
        output.send('cc', { channel: midiChannel, controller, value });
      } catch (_e) { /* silent fail */ }
    }
  }

  /**
   * Send a MIDI Note On message to all outputs (or a specific device's output)
   */
  sendNoteOn(channel: number, note: number, velocity: number, deviceName?: string): void {
    const targets = deviceName
      ? (this.outputs.has(deviceName) ? [this.outputs.get(deviceName)!] : [])
      : [...this.outputs.values()];

    for (const output of targets) {
      try {
        const midiChannel = (channel - 1) as any;
        output.send('noteon', { channel: midiChannel, note, velocity });
      } catch (_e) { /* silent fail */ }
    }
  }

  /**
   * Send a MIDI Note Off message to all outputs (or a specific device's output)
   */
  sendNoteOff(channel: number, note: number, deviceName?: string): void {
    const targets = deviceName
      ? (this.outputs.has(deviceName) ? [this.outputs.get(deviceName)!] : [])
      : [...this.outputs.values()];

    for (const output of targets) {
      try {
        const midiChannel = (channel - 1) as any;
        output.send('noteoff', { channel: midiChannel, note, velocity: 0 });
      } catch (_e) { /* silent fail */ }
    }
  }

  /**
   * Check if any MIDI output is available
   */
  hasOutput(): boolean {
    return this.outputs.size > 0;
  }

  /**
   * Scan ALL available MIDI input ports simultaneously for any incoming message.
   * Used in MIDI learn mode to detect which port a signal comes from.
   * Returns a cleanup function to stop scanning.
   */
  scanAllInputs(callback: (deviceName: string, message: MidiMessage) => void): () => void {
    const scanInputs: easymidi.Input[] = [];
    const deviceNames = this.getAvailableDevices();

    for (const name of deviceNames) {
      try {
        const scanInput = new easymidi.Input(name);

        const wrapCC = (msg: any) => {
          callback(name, { type: 'cc', channel: msg.channel + 1, controller: msg.controller, value: msg.value, device: name });
        };
        const wrapNoteOn = (msg: any) => {
          callback(name, { type: 'note_on', channel: msg.channel + 1, note: msg.note, value: msg.velocity, device: name });
        };
        const wrapPitch = (msg: any) => {
          callback(name, { type: 'pitch_bend', channel: msg.channel + 1, value: msg.value, device: name });
        };

        scanInput.on('cc', wrapCC);
        scanInput.on('noteon', wrapNoteOn);
        scanInput.on('pitch', wrapPitch);

        scanInputs.push(scanInput);
      } catch (_e) {
        // Skip devices that can't be opened
      }
    }

    return () => {
      for (const scanInput of scanInputs) {
        try { scanInput.close(); } catch (_e) { /* ignore */ }
      }
    };
  }
}
