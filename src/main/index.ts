// Main Electron process for StudioLive MIDI Controller

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { MidiManager } from './midi-manager';
import { MixerManager } from './mixer-manager';
import { MappingEngine } from './mapping-engine';
import type { DiscoveryType } from 'presonus-studiolive-api';

let mainWindow: BrowserWindow | null = null;
const midiManager = new MidiManager();
const mixerManager = new MixerManager();
const mappingEngine = new MappingEngine();
let discoveredMixers: DiscoveryType[] = [];

function createWindow() {
  // Use .icns for macOS, .png for other platforms
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, '../../assets/icon.icns')
    : path.join(__dirname, '../../assets/icon.png');

  console.log(`Setting app icon to: ${iconPath}`);
  console.log(`Icon file exists: ${require('fs').existsSync(iconPath)}`);

  // On macOS, set the dock icon
  if (process.platform === 'darwin') {
    const { nativeImage } = require('electron');
    const image = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(image);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // For now, just show a simple HTML page
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize the application
async function initializeApp() {

  // Set up MIDI event handlers
  midiManager.on('message', (midiMessage) => {

    // Forward to renderer for UI updates
    if (mainWindow) {
      mainWindow.webContents.send('midi-activity', midiMessage);
    }

    // Translate MIDI to mixer command
    const command = mappingEngine.translateMidiToMixer(midiMessage);
    if (command) {
      console.log(`[MIDI→Mixer] Translated: ${command.action} ${'type' in command.channel ? command.channel.type : ''}/${command.channel.channel ?? ''} value=${command.value ?? 'n/a'}`);

      // Forward to renderer for UI updates
      if (mainWindow) {
        mainWindow.webContents.send('mixer-activity', command);
      }

      // Execute mixer command
      try {
        switch (command.action) {
          case 'volume':
            if (command.value !== undefined && 'type' in command.channel) {
              mixerManager.setVolume(command.channel, command.value);
            }
            break;
          case 'mute':
            if (command.toggle && 'type' in command.channel) {
              mixerManager.toggleMute(command.channel);
            }
            break;
          case 'solo':
            if (command.toggle && 'type' in command.channel) {
              mixerManager.toggleSolo(command.channel);
            }
            break;
          case 'pan':
            if (command.value !== undefined && 'type' in command.channel) {
              mixerManager.setPan(command.channel, command.value);
            }
            break;
          case 'mutegroup':
            if (command.toggle !== undefined && 'channel' in command.channel && typeof command.channel.channel === 'number') {
              // Handle mute group toggle
              const muteGroupNum = command.channel.channel;
              mixerManager.setMuteGroupState(muteGroupNum, command.toggle);
            }
            break;
        }
      } catch (error) {
        console.error(`[MIDI→Mixer] Error executing command:`, error);
      }
    }
  });

  // Set up mixer event handlers
  mixerManager.on('level', (data) => {
    // Forward to renderer for UI fader updates
    if (mainWindow) {
      mainWindow.webContents.send('mixer-level', data);
    }

    // Send MIDI feedback for external mixer changes (only if enabled)
    if (!mappingEngine.getMidiFeedbackEnabled()) {
      return;
    }

    try {
      const mappings = mappingEngine.getMappings();
      const mapping = mappings.find(m =>
        m.mixer.action === 'volume' &&
        ('type' in m.mixer.channel ? (m.mixer.channel.type || 'LINE') : 'LINE') === data.channel.type &&
        (m.mixer.channel.channel || m.mixer.channel) == data.channel.channel
      );

      if (mapping && midiManager.hasOutput()) {
        const percentage = data.value * 100; // Convert 0-1 to 0-100

        if (mapping.midi.type === 'cc') {
          const midiValue = Math.round((percentage / 100) * 127);
          const midiChannel = (mapping.midi.channel - 1) as any; // Convert Logic 1-16 to MIDI 0-15
          midiManager.sendCC(midiChannel, mapping.midi.controller!, midiValue);
        } else if (mapping.midi.type === 'note-value') {
          const noteMin = mapping.midi.noteMin || 24;
          const noteMax = mapping.midi.noteMax || 60;
          const noteRange = noteMax - noteMin;
          const noteNumber = Math.round((percentage / 100) * noteRange) + noteMin;
          const midiChannel = (mapping.midi.channel - 1) as any; // Convert Logic 1-16 to MIDI 0-15
          midiManager.sendNoteOn(midiChannel, noteNumber, 100);
        }
      }
    } catch (error) {
      console.error(`[Mixer→MIDI] Error sending MIDI feedback:`, error);
    }
  });

  mixerManager.on('mute', (data) => {
    // Forward to renderer for UI updates
    if (mainWindow) {
      mainWindow.webContents.send('mixer-mute', data);
    }
  });

  mixerManager.on('solo', (data) => {
    // Forward to renderer for UI updates
    if (mainWindow) {
      mainWindow.webContents.send('mixer-solo', data);
    }
  });

  mixerManager.on('propertyChange', (data) => {
    // Forward property changes (main assignment, input source, etc.) to renderer
    if (mainWindow) {
      mainWindow.webContents.send('mixer-property-change', data);
    }
  });

  // Listen for state-ready event and forward to renderer
  mixerManager.on('state-ready', () => {
    if (mainWindow && mainWindow.webContents) {
      // Wait for the renderer to be ready before sending the event
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', () => {
          mainWindow!.webContents.send('mixer-state-ready');
        });
      } else {
        mainWindow.webContents.send('mixer-state-ready');
      }
    }
  });

  // Load default preset if it exists
  const presetPath = path.join(__dirname, '../../presets/logic-pro-default.json');
  try {
    mappingEngine.loadPreset(presetPath);
    console.log(`[Main] MIDI feedback ${mappingEngine.getMidiFeedbackEnabled() ? 'enabled' : 'disabled'}`);
    // Store the current preset path and notify renderer
    (global as any).currentPresetPath = presetPath;
    if (mainWindow) {
      mainWindow.webContents.send('preset-loaded', {
        name: path.basename(presetPath, '.json'),
        path: presetPath
      });
    }
  } catch (error) {
  }

  // Auto-connect to MIDI device BEFORE mixer (mixer connect can block)
  console.log('[Main] Starting MIDI auto-connect...');
  const devices = midiManager.getAvailableDevices();
  console.log(`[Main] Found ${devices.length} MIDI devices:`, devices);

  // Try preferred MIDI device first (from preset)
  const preferredMidiDevice = mappingEngine.getPreferredMidiDevice();
  let targetDevice: string | null = null;

  if (preferredMidiDevice && devices.includes(preferredMidiDevice)) {
    console.log(`[Main] Using preferred MIDI device: ${preferredMidiDevice}`);
    targetDevice = preferredMidiDevice;
  } else {
    // Fall back to Logic Pro if found, or first available device
    const logicDevice = devices.find(d => d.toLowerCase().includes('logic'));
    targetDevice = logicDevice || devices[0];
    if (targetDevice) {
      console.log(`[Main] Auto-connecting to MIDI device: ${targetDevice}`);
    }
  }

  if (targetDevice) {
    try {
      midiManager.connect(targetDevice);
      console.log(`[Main] Successfully connected to MIDI device: ${targetDevice}`);
    } catch (error) {
      console.error(`[Main] Failed to connect to MIDI device:`, error);
    }
  } else {
    console.log('[Main] No MIDI devices available');
  }

  // Try autodiscovery first, but prefer saved IP from preset
  try {
    const preferredIp = mappingEngine.getPreferredMixerIp();

    if (preferredIp) {
      try {
        // Connect directly to preferred mixer without discovery
        // The mixer will provide its name and model via the state once connected
        console.log(`[Main] Connecting to preferred mixer at ${preferredIp}...`);
        await mixerManager.connect(preferredIp);
        console.log(`[Main] Successfully connected to preferred mixer`);
      } catch (error) {
        console.error(`[Main] Failed to connect to preferred mixer:`, error);
        // Silent fail - will try discovery below
      }
    }

    // If not connected yet, try autodiscovery
    if (!mixerManager.isConnected()) {
      if (discoveredMixers.length === 0) {
        discoveredMixers = await MixerManager.discover(10000);
      }

      if (discoveredMixers.length > 0) {
        // Auto-connect to first discovered mixer
        const mixer = discoveredMixers[0];
        await mixerManager.connect(mixer.ip, mixer.name);
      } else {

        // Fall back to environment variable or default IP
        const mixerIp = process.env.MIXER_IP;
        if (mixerIp) {
          await mixerManager.connect(mixerIp).catch(err => {
            // Silent fail
          });
        } else {
        }
      }
    }
  } catch (error) {
    // Silent fail
  }

}

app.whenReady().then(() => {
  createWindow();
  initializeApp();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers for UI communication
ipcMain.handle('get-discovered-mixers', async () => {
  return discoveredMixers;
});

ipcMain.handle('get-preferred-mixer-ip', async () => {
  return mappingEngine.getPreferredMixerIp();
});

ipcMain.handle('discover-mixers', async () => {
  console.log('📞 IPC: discover-mixers called');
  discoveredMixers = await MixerManager.discover(10000);
  console.log(`📤 IPC: Returning ${discoveredMixers.length} discovered mixer(s)`);
  return discoveredMixers;
});

ipcMain.handle('connect-mixer', async (_event, ip: string, model?: string, deviceName?: string) => {
  try {
    await mixerManager.connect(ip, model, deviceName);
    // Save this IP as preferred for future connections
    mappingEngine.setPreferredMixerIp(ip);
    return { success: true, ip, model, deviceName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-mixer-status', async () => {
  return {
    connected: mixerManager.isConnected(),
    ip: mixerManager.getMixerIp(),
    model: mixerManager.getMixerModel(),
    deviceName: mixerManager.getMixerDeviceName(),
    name: mixerManager.getMixerName() // For backward compatibility
  };
});

ipcMain.handle('get-midi-devices', async () => {
  return midiManager.getAvailableDevices();
});

ipcMain.handle('get-midi-status', async () => {
  return {
    connected: midiManager.isConnected(),
    device: midiManager.getCurrentDevice()
  };
});

ipcMain.handle('connect-midi-device', async (_event, deviceName: string) => {
  try {
    midiManager.connect(deviceName);
    // Save MIDI device preference
    mappingEngine.setPreferredMidiDevice(deviceName);
    return { success: true, device: deviceName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

// Mixer control IPC handlers
ipcMain.handle('set-mixer-volume', async (_event, type: string, channel: number, value: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return { success: false, error: 'Not connected to mixer' };
    }
    // Value should be 0-100 for the API
    mixerManager.setVolume({ type: type as any, channel }, value);

    // Send MIDI feedback based on the mapping (only if enabled)
    if (mappingEngine.getMidiFeedbackEnabled()) {
      const mappings = mappingEngine.getMappings();
      const mapping = mappings.find(m =>
        m.mixer.action === 'volume' &&
        ('type' in m.mixer.channel ? (m.mixer.channel.type || 'LINE') : 'LINE') === type &&
        (m.mixer.channel.channel || m.mixer.channel) == channel
      );

      if (mapping && midiManager.hasOutput()) {
        if (mapping.midi.type === 'cc') {
          // Send CC message with scaled value (0-100 -> 0-127)
          const midiValue = Math.round((value / 100) * 127);
          midiManager.sendCC(mapping.midi.channel, mapping.midi.controller!, midiValue);
        } else if (mapping.midi.type === 'note-value') {
          // Send note-on with note number based on value
          const noteMin = mapping.midi.noteMin || 24;
          const noteMax = mapping.midi.noteMax || 60;
          const noteRange = noteMax - noteMin;
          const noteNumber = Math.round(noteMin + (value / 100) * noteRange);
          midiManager.sendNoteOn(mapping.midi.channel, noteNumber, 100);
        }
      }
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-channel-names', async (_event, type: string = 'line', count: number = 16) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    const names = mixerManager.getAllChannelNames(type, count);
    return names;
  } catch (error) {
    return [];
  }
});

ipcMain.handle('get-mixer-level', async (_event, type: string, channel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return null;
    }
    return mixerManager.getLevel({ type: type as any, channel });
  } catch (error) {
    return null;
  }
});

ipcMain.handle('get-channel-colors', async (_event, type: string = 'line', count: number = 16) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    const colors = [];
    for (let i = 1; i <= count; i++) {
      const color = mixerManager.getChannelColor(type, i);
      colors.push({ channel: i, color });
    }
    return colors;
  } catch (error) {
    return [];
  }
});

ipcMain.handle('get-channel-mute', async (_event, type: string, channel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return null;
    }
    return mixerManager.getChannelMute(type, channel);
  } catch (error) {
    return null;
  }
});

ipcMain.handle('get-channel-icons', async (_event, type: string = 'line', count: number = 16) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    return mixerManager.getAllChannelIcons(type, count);
  } catch (error) {
    return [];
  }
});

ipcMain.handle('get-channel-link', async (_event, type: string, channel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return null;
    }
    return mixerManager.getChannelLink(type, channel);
  } catch (error) {
    return null;
  }
});

ipcMain.handle('get-channel-input-sources', async (_event, type: string = 'line', count: number = 16) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    return mixerManager.getAllChannelInputSources(type, count);
  } catch (error) {
    return [];
  }
});

ipcMain.handle('get-dca-group-assignments', async (_event, dcaChannel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    return mixerManager.getDCAGroupAssignments(dcaChannel);
  } catch (error) {
    return [];
  }
});

ipcMain.handle('get-autofilter-group-assignments', async (_event, autoGroupChannel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    return mixerManager.getAutoFilterGroupAssignments(autoGroupChannel);
  } catch (error) {
    return [];
  }
});

ipcMain.handle('get-autofilter-group-names', async (_event, count: number = 8) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    return mixerManager.getAllAutoFilterGroupNames(count);
  } catch (error) {
    return [];
  }
});

// Mute group handlers
ipcMain.handle('get-mute-group-names', async () => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    return mixerManager.getAllMuteGroupNames();
  } catch (error) {
    return [];
  }
});

ipcMain.handle('toggle-mute-group', async (_event, groupNum: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return { success: false, error: 'Not connected to mixer' };
    }
    mixerManager.toggleMuteGroup(groupNum);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-mute-group-state', async (_event, groupNum: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return false;
    }
    return mixerManager.getMuteGroupState(groupNum);
  } catch (error) {
    return false;
  }
});

ipcMain.handle('get-mute-group-assignments', async (_event, groupNum: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return [];
    }
    return mixerManager.getMuteGroupAssignments(groupNum);
  } catch (error) {
    return [];
  }
});

ipcMain.handle('toggle-mute', async (_event, type: string, channel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return { success: false, error: 'Not connected to mixer' };
    }
    mixerManager.toggleMute({ type: type as any, channel });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-channel-solo', async (_event, type: string, channel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return null;
    }
    return mixerManager.getChannelSolo(type, channel);
  } catch (error) {
    return null;
  }
});

ipcMain.handle('get-channel-main-assign', async (_event, type: string, channel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return null;
    }
    return mixerManager.getChannelMainAssign(type, channel);
  } catch (error) {
    return null;
  }
});

ipcMain.handle('toggle-solo', async (_event, type: string, channel: number) => {
  try {
    if (!mixerManager.isConnected()) {
      return { success: false, error: 'Not connected to mixer' };
    }
    mixerManager.toggleSolo({ type: type as any, channel });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

// Mapping management IPC handlers
ipcMain.handle('get-mappings', async () => {
  return mappingEngine.getMappings();
});

ipcMain.handle('get-current-preset', async () => {
  return mappingEngine.getCurrentPreset();
});

ipcMain.handle('add-mapping', async (_event, mapping) => {
  mappingEngine.addMapping(mapping);
  return { success: true };
});

ipcMain.handle('update-mapping', async (_event, index: number, mapping) => {
  mappingEngine.updateMapping(index, mapping);
  return { success: true };
});

ipcMain.handle('remove-mapping', async (_event, index: number) => {
  mappingEngine.removeMapping(index);
  return { success: true };
});

ipcMain.handle('save-preset', async (_event, name: string, description?: string) => {
  try {
    const presetPath = path.join(__dirname, `../../presets/${name.toLowerCase().replace(/\s+/g, '-')}.json`);
    mappingEngine.savePreset(presetPath, name, description);
    return { success: true, path: presetPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('load-preset', async (_event, presetName: string) => {
  try {
    const presetPath = path.join(__dirname, `../../presets/${presetName.toLowerCase().replace(/\s+/g, '-')}.json`);
    mappingEngine.loadPreset(presetPath);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('load-preset-dialog', async () => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Load Preset',
      defaultPath: path.join(__dirname, '../../presets'),
      filters: [
        { name: 'Preset Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'No file selected' };
    }

    const presetPath = result.filePaths[0];
    mappingEngine.loadPreset(presetPath);

    // Store the current preset path
    (global as any).currentPresetPath = presetPath;

    return { success: true, path: presetPath, name: path.basename(presetPath, '.json') };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('save-preset-dialog', async (_event, currentPath?: string) => {
  try {
    const { dialog } = require('electron');
    const defaultPath = currentPath || path.join(__dirname, '../../presets/preset.json');

    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save Preset',
      defaultPath: defaultPath,
      filters: [
        { name: 'Preset Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'No file selected' };
    }

    const presetPath = result.filePath;
    const presetName = path.basename(presetPath, '.json');
    mappingEngine.savePreset(presetPath, presetName);

    // Store the current preset path
    (global as any).currentPresetPath = presetPath;

    return { success: true, path: presetPath, name: presetName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-fader-filter', () => {
  return mappingEngine.getFaderFilter();
});

ipcMain.handle('set-fader-filter', (_event, filter: 'all' | 'mapped') => {
  mappingEngine.setFaderFilter(filter);
});

ipcMain.handle('get-current-preset-path', async () => {
  return (global as any).currentPresetPath || null;
});

ipcMain.handle('set-midi-feedback-enabled', async (_event, enabled: boolean) => {
  mappingEngine.setMidiFeedbackEnabled(enabled);
  return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const https = require('https');
    const currentVersion = require('../../package.json').version;

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/sandinak/studiolive-midi-controller/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'StudioLive-MIDI-Controller'
        }
      };

      const req = https.request(options, (res: any) => {
        let data = '';

        res.on('data', (chunk: any) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const latestVersion = release.tag_name?.replace(/^v/, '') || currentVersion;
            const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

            resolve({
              success: true,
              currentVersion,
              latestVersion,
              updateAvailable,
              downloadUrl: release.html_url,
              releaseNotes: release.body
            });
          } catch (error) {
            resolve({
              success: false,
              currentVersion,
              error: 'Failed to parse release data'
            });
          }
        });
      });

      req.on('error', (error: any) => {
        resolve({
          success: false,
          currentVersion,
          error: error.message
        });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({
          success: false,
          currentVersion,
          error: 'Request timeout'
        });
      });

      req.end();
    });
  } catch (error) {
    const currentVersion = require('../../package.json').version;
    return {
      success: false,
      currentVersion,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Helper function to compare semantic versions
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

