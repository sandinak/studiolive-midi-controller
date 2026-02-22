// Shared types for MIDI Controller

import type { ChannelSelector } from 'presonus-studiolive-api';

export interface MidiMessage {
  type: 'cc' | 'note_on' | 'note_off' | 'pitch_bend';
  channel: number;
  controller?: number;  // For CC messages
  note?: number;        // For note messages
  value: number;
  device?: string;      // Source MIDI device name
}

export interface MixerCommand {
  action: 'volume' | 'mute' | 'solo' | 'pan' | 'mutegroup';
  channel: ChannelSelector | { channel: number };  // mutegroup uses { channel: number }
  value?: number;       // For volume/pan
  toggle?: boolean;     // For mute/solo/mutegroup
}

export interface MidiMapping {
  midi: {
    type: 'cc' | 'note' | 'note-on' | 'note-off' | 'note-toggle' | 'note-value';
    channel: number;
    controller?: number;  // For CC messages
    note?: number;        // For note trigger messages
    noteMin?: number;     // For note-value mode: minimum note number
    noteMax?: number;     // For note-value mode: maximum note number
    threshold?: number;   // For CC boolean controls: threshold value (0-127, default 64)
    invert?: boolean;     // For boolean controls: invert the logic
    device?: string;      // Optional: only match messages from this device (absent = any device)
  };
  mixer: {
    action: 'volume' | 'mute' | 'solo' | 'pan' | 'mutegroup';
    channel: ChannelSelector | { channel: number };  // mutegroup uses { channel: number }
    range?: [number, number];  // Min/max for scaling
  };
}

export interface MappingPreset {
  name: string;
  version: string;
  description?: string;
  mixerIp?: string;         // Preferred mixer IP address
  mixerModel?: string;      // Remembered mixer model (e.g. "StudioLive 32")
  mixerDeviceName?: string; // Remembered mixer device name (user-assigned label)
  mixerSerial?: string;     // Remembered mixer serial number
  midiDevice?: string;    // Legacy: single preferred MIDI device (backward compat)
  midiDevices?: string[]; // Preferred MIDI device names (multi-device)
  midiDeviceColors?: Record<string, string>;  // Per-device colors e.g. { "Launchkey 49": "#ff6600" }
  faderFilter?: 'all' | 'added' | 'mapped';  // Fader filter state
  midiFeedbackEnabled?: boolean;  // MIDI feedback enabled state
  levelVisibility?: 'none' | 'indicator' | 'meter';  // Channel level display mode
  peakHold?: boolean;  // Peak hold for meter mode
  mappings: MidiMapping[];
}

export interface ConnectionStatus {
  mixer: {
    connected: boolean;
    ip?: string;
    error?: string;
  };
  midi: {
    connected: boolean;
    deviceName?: string;
    error?: string;
  };
}
