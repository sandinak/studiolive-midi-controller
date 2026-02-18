// Mixer Manager - Wraps the StudioLive API for easier control

import { SimpleClient as StudioLiveClient } from 'presonus-studiolive-api/simple';
import type { ChannelSelector } from 'presonus-studiolive-api';
import { EventEmitter } from 'events';

export class MixerManager extends EventEmitter {
  private client: StudioLiveClient | null = null;
  private mixerIp: string | null = null;

  constructor() {
    super();
  }

  /**
   * Connect to the StudioLive mixer
   */
  async connect(ipAddress: string): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    try {
      // Constructor takes an object with host and port
      this.client = new StudioLiveClient({ host: ipAddress, port: 53000 });
      this.mixerIp = ipAddress;

      // Set up event listeners
      this.client.on('level', (data) => {
        this.emit('level', data);
      });

      this.client.on('mute', (data) => {
        this.emit('mute', data);
      });

      this.client.on('solo', (data) => {
        this.emit('solo', data);
      });

      // Event is 'closed' not 'close'
      this.client.on('closed', () => {
        this.emit('disconnected');
      });

      await this.client.connect();
      this.emit('connected', ipAddress);
      console.log(`✓ Connected to mixer at ${ipAddress}`);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to connect to mixer: ${error}`);
    }
  }

  /**
   * Disconnect from the mixer
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      // Method is 'close' not 'disconnect'
      await this.client.close();
      this.client = null;
      const ip = this.mixerIp;
      this.mixerIp = null;
      this.emit('disconnected', ip);
      console.log(`✓ Disconnected from mixer at ${ip}`);
    }
  }

  /**
   * Set channel volume (0-100 linear scale)
   */
  setVolume(channel: ChannelSelector, value: number): void {
    if (!this.client) {
      throw new Error('Not connected to mixer');
    }
    this.client.setChannelVolumeLinear(channel, value);
  }

  /**
   * Toggle mute on a channel
   */
  toggleMute(channel: ChannelSelector): void {
    if (!this.client) {
      throw new Error('Not connected to mixer');
    }
    this.client.toggleMute(channel);
  }

  /**
   * Set mute state
   */
  setMute(channel: ChannelSelector, muted: boolean): void {
    if (!this.client) {
      throw new Error('Not connected to mixer');
    }
    this.client.setMute(channel, muted);
  }

  /**
   * Toggle solo on a channel
   */
  toggleSolo(channel: ChannelSelector): void {
    if (!this.client) {
      throw new Error('Not connected to mixer');
    }
    this.client.toggleSolo(channel);
  }

  /**
   * Set solo state
   */
  setSolo(channel: ChannelSelector, soloed: boolean): void {
    if (!this.client) {
      throw new Error('Not connected to mixer');
    }
    this.client.setSolo(channel, soloed);
  }

  /**
   * Set pan (-100 to 100, where 0 is center)
   */
  setPan(channel: ChannelSelector, value: number): void {
    if (!this.client) {
      throw new Error('Not connected to mixer');
    }
    this.client.setPan(channel, value);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Get current mixer IP
   */
  getMixerIp(): string | null {
    return this.mixerIp;
  }
}

