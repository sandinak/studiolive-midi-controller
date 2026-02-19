// Mixer Manager - Wraps the StudioLive API for easier control

import { SimpleClient as StudioLiveClient } from 'presonus-studiolive-api/simple';
import { Client } from 'presonus-studiolive-api';
import type { ChannelSelector, DiscoveryType } from 'presonus-studiolive-api';
import { EventEmitter } from 'events';

export class MixerManager extends EventEmitter {
  private client: StudioLiveClient | null = null;
  private mixerIp: string | null = null;
  private mixerName: string | null = null;

  constructor() {
    super();
  }

  /**
   * Connect to the StudioLive mixer
   */
  async connect(ipAddress: string, mixerName?: string): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    try {
      // Constructor takes an object with host and port
      this.client = new StudioLiveClient({ host: ipAddress, port: 53000 });
      this.mixerIp = ipAddress;
      this.mixerName = mixerName || null;

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

      // Listen for connected event to know when state is ready
      this.client.on('connected', () => {
        // Wait a moment for state to fully populate, then emit state-ready event
        setTimeout(() => {
          if ((this.client as any).state) {
            const testName = (this.client as any).state.get('line.ch1.username');
            const testVolume = (this.client as any).state.get('line.ch1.volume');

            // If state has data, emit state-ready event
            if (testName || testVolume !== null) {
              this.emit('state-ready');
            }
          }
        }, 1000);
      });

      await this.client.connect();

      // Give the state a moment to populate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Test if we can read state
      const testName = (this.client as any).state?.get('line.ch1.username');
      const testVolume = (this.client as any).state?.get('line.ch1.volume');

      this.emit('connected', ipAddress);
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
      this.mixerName = null;
      this.emit('disconnected', ip);
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

  /**
   * Get current mixer name
   * First tries to get from mixer state, falls back to stored name
   */
  getMixerName(): string | null {
    // Try to get the device name from the mixer state
    if (this.client && (this.client as any).state) {
      try {
        const deviceName = (this.client as any).state.get('device.name');
        if (deviceName && typeof deviceName === 'string') {
          return deviceName;
        }
      } catch (error) {
        console.warn('Failed to get device name from state:', error);
      }
    }
    // Fall back to stored name
    return this.mixerName;
  }

  /**
   * Discover mixers on the network
   * @param timeout Discovery timeout in milliseconds (default: 5000ms)
   * @returns Array of discovered devices
   */
  static async discover(timeout = 5000): Promise<DiscoveryType[]> {
    const devices = await Client.discover(timeout);
    devices.forEach((device, index) => {
    });
    return devices;
  }

  /**
   * Get channel name from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Channel name or null if not available
   */
  getChannelName(type: string, channel: number): string | null {
    if (!this.client) {
      return null;
    }
    try {
      // Access state: line.ch1.username, aux.ch1.username, etc.
      const path = `${type.toLowerCase()}.ch${channel}.username`;

      let name = (this.client as any).state?.get(path);

      // Strip channel number prefix if present (e.g., "1:Piano" -> "Piano")
      if (name && typeof name === 'string') {
        const match = name.match(/^\d+:(.+)$/);
        if (match) {
          name = match[1];
        }
      }

      const result = name || `Ch ${channel}`;
      return result;
    } catch (error) {
      console.warn(`Failed to get channel name for ${type}.ch${channel}:`, error);
      return `Ch ${channel}`;
    }
  }

  /**
   * Get all channel names for a given type
   * @param type Channel type (default: 'line')
   * @param count Number of channels to fetch (default: 16)
   * @returns Array of channel info with channel number and name
   */
  getAllChannelNames(type: string = 'line', count: number = 16): { channel: number; name: string }[] {
    const names = [];
    for (let i = 1; i <= count; i++) {
      const name = this.getChannelName(type, i) || `Ch ${i}`;
      names.push({
        channel: i,
        name: name
      });
    }
    return names;
  }

  /**
   * Get current level of a channel (0-100)
   */
  getLevel(channel: ChannelSelector): number | null {
    if (!this.client) {
      return null;
    }
    try {
      return this.client.getLevel(channel);
    } catch (error) {
      console.warn(`Failed to get level for channel ${JSON.stringify(channel)}:`, error);
      return null;
    }
  }

  /**
   * Get channel color from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Channel color (hex string) or null if not available
   */
  getChannelColor(type: string, channel: number): string | null {
    if (!this.client) {
      return null;
    }
    try {
      const path = `${type.toLowerCase()}.ch${channel}.color`;
      const color = (this.client as any).state?.get(path);

      // If color is a number (RGB), convert to hex
      if (typeof color === 'number') {
        const hex = '#' + color.toString(16).padStart(6, '0');
        return hex;
      }

      // Only return if it's a valid string, otherwise return null
      if (typeof color === 'string' && color.length > 0) {
        return color;
      }

      return null;
    } catch (error) {
      console.warn(`Failed to get channel color for ${type}.ch${channel}:`, error);
      return null;
    }
  }

  /**
   * Get channel mute state from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Mute state (true/false) or null if not available
   */
  getChannelMute(type: string, channel: number): boolean | null {
    if (!this.client) {
      return null;
    }
    try {
      const path = `${type.toLowerCase()}.ch${channel}.mute`;
      const mute = (this.client as any).state?.get(path);
      return mute !== null ? Boolean(mute) : null;
    } catch (error) {
      console.warn(`Failed to get channel mute for ${type}.ch${channel}:`, error);
      return null;
    }
  }

  /**
   * Get channel icon from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Channel icon ID or null if not available
   */
  getChannelIcon(type: string, channel: number): string | null {
    if (!this.client) {
      return null;
    }
    try {
      const path = `${type.toLowerCase()}.ch${channel}.iconid`;
      const iconId = (this.client as any).state?.get(path);
      return iconId || null;
    } catch (error) {
      console.warn(`Failed to get channel icon for ${type}.ch${channel}:`, error);
      return null;
    }
  }

  /**
   * Get all channel icons for a given type
   * @param type Channel type (default: 'line')
   * @param count Number of channels to fetch (default: 16)
   * @returns Array of channel info with channel number and icon ID
   */
  getAllChannelIcons(type: string = 'line', count: number = 16): { channel: number; icon: string | null }[] {
    const icons = [];
    for (let i = 1; i <= count; i++) {
      const icon = this.getChannelIcon(type, i);
      icons.push({
        channel: i,
        icon: icon
      });
    }
    return icons;
  }

  /**
   * Get channel stereo link status from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Link status (true/false) or null if not available
   */
  getChannelLink(type: string, channel: number): boolean | null {
    if (!this.client) {
      return null;
    }
    try {
      const path = `${type.toLowerCase()}.ch${channel}.link`;
      const link = (this.client as any).state?.get(path);
      return link !== null ? Boolean(link) : null;
    } catch (error) {
      console.warn(`Failed to get channel link for ${type}.ch${channel}:`, error);
      return null;
    }
  }
}

