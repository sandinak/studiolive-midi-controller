// Mixer Manager - Wraps the StudioLive API for easier control

import { SimpleClient as StudioLiveClient } from 'presonus-studiolive-api/simple';
import { Client } from 'presonus-studiolive-api';
import type { ChannelSelector, DiscoveryType } from 'presonus-studiolive-api';
import { EventEmitter } from 'events';

export class MixerManager extends EventEmitter {
  private client: StudioLiveClient | null = null;
  private mixerIp: string | null = null;
  private mixerModel: string | null = null;
  private mixerDeviceName: string | null = null;
  private muteGroupPollInterval: NodeJS.Timeout | null = null;
  private lastMuteGroupStates: boolean[] = [false, false, false, false, false, false, false, false];
  private dcaLevelPollInterval: NodeJS.Timeout | null = null;
  private lastDcaLevels: (number | null)[] = [null, null, null, null, null, null, null, null];
  private hasDcaMappingsCallback: (() => boolean) | null = null;

  constructor() {
    super();
  }

  /**
   * Connect to the StudioLive mixer
   */
  async connect(ipAddress: string, model?: string, deviceName?: string): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    try {
      // Constructor takes an object with host and port
      this.client = new StudioLiveClient({ host: ipAddress, port: 53000 });
      this.mixerIp = ipAddress;
      this.mixerModel = model || null;
      this.mixerDeviceName = deviceName || null;

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

      // Listen for property changes (main assignment, input source, etc.)
      this.client.on('propertyChange', (data: any) => {
        // Forward property changes to the renderer
        this.emit('propertyChange', data);
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

            // If state has data, update mixer info from state and emit state-ready event
            if (testName || testVolume !== null) {
              // Try to get device name and model from mixer state
              try {
                // Try multiple possible paths for device name
                let deviceName = (this.client as any).state.get('device.name');
                if (!deviceName) {
                  deviceName = (this.client as any).state.get('global.name');
                }
                if (!deviceName) {
                  deviceName = (this.client as any).state.get('global.devicename');
                }

                const model = (this.client as any).state.get('device.model');

                if (deviceName && !this.mixerDeviceName) {
                  this.mixerDeviceName = deviceName;
                }
                if (model && !this.mixerModel) {
                  this.mixerModel = model;
                }
              } catch (error) {
                // Ignore errors reading device info
              }

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

      // Log channel counts from the API for diagnostics
      const counts = (this.client as any).channelCounts;

      // Start polling mute group states to detect changes from the mixer
      this.startMuteGroupPolling();

      // Start polling DCA fader levels (not included in MS/FaderPosition packets)
      this.startDCALevelPolling();

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
      // Stop polling
      this.stopMuteGroupPolling();
      this.stopDCALevelPolling();

      // Method is 'close' not 'disconnect'
      await this.client.close();
      this.client = null;
      const ip = this.mixerIp;
      this.mixerIp = null;
      this.mixerModel = null;
      this.mixerDeviceName = null;
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

    // setChannelVolumeLinear is async - must catch the promise rejection
    this.client.setChannelVolumeLinear(channel, value).catch((error: Error) => {
      const channelStr = 'type' in channel ? `${channel.type}/${channel.channel}` : JSON.stringify(channel);
      const counts = (this.client as any)?.channelCounts;
      // Silently ignore volume errors — will retry on next MIDI message
    });
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
   * Get current mixer model name
   */
  getMixerModel(): string | null {
    return this.mixerModel;
  }

  /**
   * Get current mixer device name (user-assigned name)
   */
  getMixerDeviceName(): string | null {
    return this.mixerDeviceName;
  }

  /**
   * Get current mixer name (for backward compatibility)
   * Returns device name if available, otherwise model
   */
  getMixerName(): string | null {
    return this.mixerDeviceName || this.mixerModel;
  }

  /**
   * DEPRECATED: Old getMixerName implementation
   * First tries to get from mixer state, falls back to stored name
   */
  getMixerNameFromState(): string | null {
    // Try to get the device name from the mixer state
    if (this.client && (this.client as any).state) {
      try {
        const deviceName = (this.client as any).state.get('device.name');
        if (deviceName && typeof deviceName === 'string') {
          return deviceName;
        }
      } catch (error) {
        // Ignore error, fall back to stored name
      }
    }
    // Fall back to stored device name or model
    return this.mixerDeviceName || this.mixerModel;
  }

  /**
   * Discover mixers on the network
   * @param timeout Discovery timeout in milliseconds (default: 10000ms)
   * @returns Array of discovered devices
   */
  static async discover(timeout = 10000): Promise<DiscoveryType[]> {
    const devices = await Client.discover(timeout);
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
      // Map DCA to filtergroup (where manual DCA group names are stored)
      // Note: autofiltergroup contains auto-generated groups based on icons (~Drums, ~Guitars, etc.)
      let statePath = type.toLowerCase();
      let propertyName = 'username';

      if (statePath === 'dca') {
        statePath = 'filtergroup';
        // filtergroup uses 'name' property (not 'username')
        propertyName = 'name';
      } else if (statePath === 'autofilter') {
        statePath = 'autofiltergroup';
        // autofiltergroup uses 'name' property (not 'username')
        propertyName = 'name';
      }

      // Access state: line.ch1.username, aux.ch1.username, filtergroup.ch1.name, etc.
      const path = `${statePath}.ch${channel}.${propertyName}`;

      let name = (this.client as any).state?.get(path);

      // Strip channel number prefix if present (e.g., "1:Piano" -> "Piano")
      if (name && typeof name === 'string') {
        const match = name.match(/^\d+:(.+)$/);
        if (match) {
          name = match[1];
        }
        // Remove the ~ prefix from DCA group names
        if (type.toLowerCase() === 'dca' && name.startsWith('~')) {
          name = name.substring(1);
        }
      }

      const result = name || `Ch ${channel}`;

      return result;
    } catch (error) {
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
      let mute = (this.client as any).state?.get(path);

      if (mute === null || mute === undefined) {
        return null;
      }

      // Handle Buffer values (convert to float first)
      if (mute instanceof Buffer) {
        mute = mute.readFloatLE(0);
      }

      const result = mute > 0;
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get channel solo state from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Solo state (true/false) or null if not available
   */
  getChannelSolo(type: string, channel: number): boolean | null {
    if (!this.client) {
      return null;
    }
    try {
      const path = `${type.toLowerCase()}.ch${channel}.solo`;
      let solo = (this.client as any).state?.get(path);

      if (solo === null || solo === undefined) {
        return null;
      }

      // Handle Buffer values (convert to float first)
      if (solo instanceof Buffer) {
        solo = solo.readFloatLE(0);
      }

      return solo > 0;
    } catch (error) {
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

    // Only LINE channels support stereo linking
    if (type.toUpperCase() !== 'LINE') {
      return false;
    }

    try {
      const path = `${type.toLowerCase()}.ch${channel}.link`;
      let link = (this.client as any).state?.get(path);

      if (link === null || link === undefined) {
        return null;
      }

      // Handle Buffer values (convert to float first)
      if (link instanceof Buffer) {
        link = link.readFloatLE(0);
      }

      // Link is true if value > 0
      return link > 0;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get channel main assign state from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Main assign state (true/false) or null if not available
   */
  getChannelMainAssign(type: string, channel: number): boolean | null {
    if (!this.client) {
      return null;
    }
    try {
      const path = `${type.toLowerCase()}.ch${channel}.lr`;
      const lr = (this.client as any).state?.get(path);
      return lr !== null && lr !== undefined ? Boolean(lr) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get channel input source from mixer state
   * @param type Channel type (e.g., 'line', 'aux', 'fxreturn')
   * @param channel Channel number (1-based)
   * @returns Input source number (0-3) or null if not available
   * Note: The mixer returns a float value (0.0, 0.333, 0.667, 1.0) which maps to:
   * 0.0 = Analog (0), 0.333 = Network (1), 0.667 = USB (2), 1.0 = SD Card (3)
   */
  getChannelInputSource(type: string, channel: number): number | null {
    if (!this.client) {
      return null;
    }
    try {
      const path = `${type.toLowerCase()}.ch${channel}.inputsrc`;
      const inputsrc = (this.client as any).state?.get(path);

      if (inputsrc === null || inputsrc === undefined) {
        return null;
      }

      // Convert float value (0.0 to 1.0) to discrete input source number (0-3)
      // Based on actual mixer output:
      // 0.0 = Analog, 0.333 = Network, 0.667 = USB, 1.0 = SD Card
      const floatValue = Number(inputsrc);
      let discreteValue: number;

      if (floatValue < 0.2) {
        discreteValue = 0; // Analog (0.0)
      } else if (floatValue < 0.5) {
        discreteValue = 1; // Network (0.333)
      } else if (floatValue < 0.85) {
        discreteValue = 2; // USB (0.667)
      } else {
        discreteValue = 3; // SD Card (1.0)
      }

      return discreteValue;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all channel input sources for a given type
   * @param type Channel type (default: 'line')
   * @param count Number of channels to fetch (default: 16)
   * @returns Array of channel info with channel number and input source
   */
  getAllChannelInputSources(type: string = 'line', count: number = 16): { channel: number; inputsrc: number | null }[] {
    const sources = [];
    for (let i = 1; i <= count; i++) {
      const inputsrc = this.getChannelInputSource(type, i);
      sources.push({
        channel: i,
        inputsrc: inputsrc
      });
    }
    return sources;
  }

  /**
   * Get LINE channels assigned to a DCA group (manual filter group)
   * @param dcaChannel DCA group number (1-8)
   * @returns Array of LINE channel numbers assigned to this DCA group
   */
  getDCAGroupAssignments(dcaChannel: number): number[] {
    if (!this.client) {
      return [];
    }

    try {
      const assignments: number[] = [];

      // Check each LINE channel (1-64) to see if it's assigned to this DCA
      // The filtergroup.ch{N}.line{M} property indicates if LINE channel M is assigned to DCA N
      for (let lineChannel = 1; lineChannel <= 64; lineChannel++) {
        const path = `filtergroup.ch${dcaChannel}.line${lineChannel}`;
        const assigned = (this.client as any).state?.get(path);

        // If the value is truthy (1, true, etc.), the channel is assigned
        if (assigned) {
          assignments.push(lineChannel);
        }
      }

      return assignments;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get LINE channels assigned to an auto-filter group (icon-based group)
   * @param autoGroupChannel Auto-filter group number (1-8)
   * @returns Array of LINE channel numbers assigned to this auto-filter group
   */
  getAutoFilterGroupAssignments(autoGroupChannel: number): number[] {
    if (!this.client) {
      return [];
    }

    try {
      const assignments: number[] = [];

      // Check each LINE channel (1-64) to see if it's assigned to this auto-filter group
      // The autofiltergroup.ch{N}.line{M} property indicates if LINE channel M is assigned to auto-group N
      for (let lineChannel = 1; lineChannel <= 64; lineChannel++) {
        const path = `autofiltergroup.ch${autoGroupChannel}.line${lineChannel}`;
        const assigned = (this.client as any).state?.get(path);

        // If the value is truthy (1, true, etc.), the channel is assigned
        if (assigned) {
          assignments.push(lineChannel);
        }
      }

      return assignments;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all auto-filter group names
   * @param count Number of auto-filter groups to fetch (default: 8)
   * @returns Array of auto-filter group info with channel number and name
   */
  getAllAutoFilterGroupNames(count: number = 8): { channel: number; name: string }[] {
    const names = [];
    for (let i = 1; i <= count; i++) {
      // Auto-filter groups use 'name' property in autofiltergroup
      let name = this.getChannelName('autofilter', i);

      // Remove the ~ prefix from auto-filter group names
      if (name && name.startsWith('~')) {
        name = name.substring(1);
      }

      names.push({
        channel: i,
        name: name || `Auto ${i}`
      });
    }
    return names;
  }

  /**
   * Get mute group state
   * @param groupNum Mute group number (1-8)
   * @returns Mute group state (true if active, false if inactive)
   */
  getMuteGroupState(groupNum: number): boolean {
    if (!this.client || groupNum < 1 || groupNum > 8) {
      return false;
    }
    try {
      // Use the same path format as when setting (with slash)
      const path = `mutegroup/mutegroup${groupNum}`;
      let state = (this.client as any).state?.get(path);

      // State can be either a number or a Buffer
      // If it's a Buffer, read it as a float
      if (state instanceof Buffer) {
        state = state.readFloatLE(0);
      }

      // State is a float: 1.0 = active, 0.0 = inactive
      return state > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Set mute group state
   * @param groupNum Mute group number (1-8)
   * @param active True to activate mute group, false to deactivate
   */
  setMuteGroupState(groupNum: number, active: boolean): void {
    if (!this.client || groupNum < 1 || groupNum > 8) {
      throw new Error('Invalid mute group number or not connected');
    }
    try {
      const path = `mutegroup/mutegroup${groupNum}`;
      const value = active ? 1.0 : 0.0;

      // Use the same pattern as setMute() - send packet directly to mixer
      const MessageCode = { ParamValue: 'PV' };
      const toFloat = (v: number) => {
        const buffer = Buffer.allocUnsafe(4);
        buffer.writeFloatLE(v, 0);
        return buffer;
      };

      (this.client as any)._sendPacket(
        MessageCode.ParamValue,
        Buffer.concat([Buffer.from(`${path}\x00\x00\x00`), toFloat(value)])
      );

      // Also update local state so getMuteGroupState() returns the correct value immediately
      (this.client as any).state?.set(path, value);
    } catch (error) {
      throw new Error(`Failed to set mute group ${groupNum} state: ${error}`);
    }
  }

  /**
   * Toggle mute group state
   * @param groupNum Mute group number (1-8)
   */
  toggleMuteGroup(groupNum: number): void {
    const currentState = this.getMuteGroupState(groupNum);
    this.setMuteGroupState(groupNum, !currentState);
  }

  /**
   * Get mute group custom name
   * @param groupNum Mute group number (1-8)
   * @returns Custom name or default name
   */
  getMuteGroupName(groupNum: number): string {
    if (!this.client || groupNum < 1 || groupNum > 8) {
      return `M${groupNum}`;
    }
    try {
      const path = `mutegroup.mutegroup${groupNum}username`;
      const name = (this.client as any).state?.get(path);
      return name && name.trim() !== '' ? name : `M${groupNum}`;
    } catch (error) {
      return `M${groupNum}`;
    }
  }

  /**
   * Get all mute group names
   * @returns Array of mute group info with group number and name
   */
  getAllMuteGroupNames(): { group: number; name: string; active: boolean }[] {
    const groups = [];
    for (let i = 1; i <= 8; i++) {
      groups.push({
        group: i,
        name: this.getMuteGroupName(i),
        active: this.getMuteGroupState(i)
      });
    }
    return groups;
  }

  /**
   * Get which channels are assigned to a mute group
   * @param groupNum Mute group number (1-8)
   * @returns Array of channel assignments { type: string, channel: number }
   */
  getMuteGroupAssignments(groupNum: number): Array<{ type: string; channel: number }> {
    if (!this.client || groupNum < 1 || groupNum > 8) {
      return [];
    }

    try {
      const state = (this.client as any).state;

      // Get the mutes property - it's a bit string where each '1' indicates a channel is assigned
      const path = `mutegroup.mutegroup${groupNum}mutes`;
      const mutesValue = state?.get(path);

      if (!mutesValue || typeof mutesValue !== 'string') {
        return [];
      }

      // Parse the bit string to extract channel assignments
      // The string is a series of 0s and 1s, where each position represents a LINE channel
      // Position 0 = LINE 1, Position 1 = LINE 2, etc.
      const assignments: Array<{ type: string; channel: number }> = [];

      for (let i = 0; i < mutesValue.length; i++) {
        if (mutesValue[i] === '1') {
          // Channel numbers are 1-based, so add 1 to the index
          assignments.push({ type: 'LINE', channel: i + 1 });
        }
      }

      return assignments;
    } catch (error) {
      return [];
    }
  }

  /**
   * Start polling mute group states to detect changes from the mixer
   * Since the Client library doesn't emit events for mute group changes,
   * we need to poll the state periodically
   */
  private startMuteGroupPolling(): void {
    this.stopMuteGroupPolling();

    // Initialize last states
    for (let groupNum = 1; groupNum <= 8; groupNum++) {
      this.lastMuteGroupStates[groupNum - 1] = this.getMuteGroupState(groupNum);
    }

    // Poll every 200ms (5 times per second)
    this.muteGroupPollInterval = setInterval(() => {
      if (!this.client) {
        this.stopMuteGroupPolling();
        return;
      }

      for (let groupNum = 1; groupNum <= 8; groupNum++) {
        const currentState = this.getMuteGroupState(groupNum);
        const lastState = this.lastMuteGroupStates[groupNum - 1];

        if (currentState !== lastState) {
          this.lastMuteGroupStates[groupNum - 1] = currentState;
          this.emit('propertyChange', {
            path: `mutegroup/mutegroup${groupNum}`,
            value: currentState ? 1.0 : 0.0
          });
        }
      }
    }, 200);
  }

  /**
   * Stop polling mute group states
   */
  private stopMuteGroupPolling(): void {
    if (this.muteGroupPollInterval) {
      clearInterval(this.muteGroupPollInterval);
      this.muteGroupPollInterval = null;
    }
  }

  /**
   * Start polling DCA fader levels to detect changes from the physical mixer.
   * The PreSonus API's MS (FaderPosition) packet does NOT include DCA/filtergroup data,
   * so we poll the state (updated by PV messages) and emit level events when changes are detected.
   */
  /**
   * Register a callback that returns true if any DCA channel is currently mapped.
   * When provided, the DCA poll skips processing when no DCA mappings exist,
   * saving CPU when the user has no DCA faders configured.
   */
  setDcaMappingsChecker(fn: () => boolean): void {
    this.hasDcaMappingsCallback = fn;
  }

  private startDCALevelPolling(): void {
    this.stopDCALevelPolling();

    // Initialize last known levels
    for (let i = 1; i <= 8; i++) {
      const level = this.getLevel({ type: 'DCA' as any, channel: i });
      this.lastDcaLevels[i - 1] = level !== null && level !== undefined ? this.normalizeDcaLevel(level) : null;
    }

    // Poll every 100ms (10 times per second) for responsive fader tracking
    this.dcaLevelPollInterval = setInterval(() => {
      if (!this.client) {
        this.stopDCALevelPolling();
        return;
      }

      // Skip expensive loop when no DCA channels are mapped
      if (this.hasDcaMappingsCallback && !this.hasDcaMappingsCallback()) return;

      for (let i = 1; i <= 8; i++) {
        const rawLevel = this.getLevel({ type: 'DCA' as any, channel: i });
        if (rawLevel === null || rawLevel === undefined) continue;

        const normalizedLevel = this.normalizeDcaLevel(rawLevel);
        const lastLevel = this.lastDcaLevels[i - 1];

        // Emit level event if the value changed (with small tolerance for float precision)
        if (lastLevel === null || Math.abs(normalizedLevel - lastLevel) > 0.1) {
          this.lastDcaLevels[i - 1] = normalizedLevel;

          this.emit('level', {
            channel: {
              type: 'DCA',
              channel: i,
            },
            level: normalizedLevel,
            type: 'level',
          });
        }
      }
    }, 100);
  }

  /**
   * Stop polling DCA fader levels
   */
  private stopDCALevelPolling(): void {
    if (this.dcaLevelPollInterval) {
      clearInterval(this.dcaLevelPollInterval);
      this.dcaLevelPollInterval = null;
    }
  }

  /**
   * Normalize DCA level to 0-100 range.
   * PV packets from the mixer send values as 0.0–1.0 floats.
   * Values > 1.0 are treated as already in the 0-100 range and clamped.
   */
  private normalizeDcaLevel(value: number): number {
    if (value <= 1.0) {
      // PV float 0-1 → 0-100, rounded to 1 decimal to avoid float drift
      return Math.round(value * 1000) / 10;
    }
    return Math.min(100, Math.max(0, value));
  }
}

