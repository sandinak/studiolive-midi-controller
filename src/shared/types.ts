// Shared types for MIDI Controller

import type { ChannelSelector } from 'presonus-studiolive-api';

export interface MidiMessage {
  type: 'cc' | 'note_on' | 'note_off' | 'pitch_bend';
  channel: number;
  controller?: number;  // For CC messages
  note?: number;        // For note messages
  value: number;
}

export interface MixerCommand {
  action: 'volume' | 'mute' | 'solo' | 'pan';
  channel: ChannelSelector;
  value?: number;       // For volume/pan
  toggle?: boolean;     // For mute/solo
}

export interface MidiMapping {
  midi: {
    type: 'cc' | 'note' | 'note-value';
    channel: number;
    controller?: number;  // For CC messages
    note?: number;        // For note trigger messages
    noteMin?: number;     // For note-value mode: minimum note number
    noteMax?: number;     // For note-value mode: maximum note number
  };
  mixer: {
    action: 'volume' | 'mute' | 'solo' | 'pan';
    channel: ChannelSelector;
    range?: [number, number];  // Min/max for scaling
  };
}

export interface MappingPreset {
  name: string;
  version: string;
  description?: string;
  mixerIp?: string;  // Preferred mixer IP address
  midiDevice?: string;  // Preferred MIDI device name
  faderFilter?: 'all' | 'mapped';  // Fader filter state
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

