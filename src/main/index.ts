// Main Electron process for StudioLive MIDI Controller

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { MidiManager } from './midi-manager';
import { MixerManager } from './mixer-manager';
import { MappingEngine } from './mapping-engine';
import { clampCount } from './ipc-validators';
import { compareVersions, pickLatestVersion } from './update-checker';
import type { DiscoveryType } from 'presonus-studiolive-api';

/** Returns the platform-appropriate directory for storing profiles/presets. */
function getProfilesDir(): string {
  if (process.platform === 'darwin') {
    // ~/Library/Application Support/StudioLive Midi Controller
    return path.join(app.getPath('appData'), 'StudioLive Midi Controller');
  }
  // Windows / Linux: use app's user data directory
  return app.getPath('userData');
}

/** Ensures the profiles directory exists and returns its path. */
function ensureProfilesDir(): string {
  const dir = getProfilesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

let mainWindow: BrowserWindow | null = null;
const midiManager = new MidiManager();
const mixerManager = new MixerManager();
const mappingEngine = new MappingEngine();
let currentPresetPath: string | null = null;

// Skip DCA polling when no DCA channels are mapped (saves CPU)
mixerManager.setDcaMappingsChecker(() =>
  mappingEngine.getMappings().some(m =>
    'type' in m.mixer.channel &&
    (m.mixer.channel as any).type?.toUpperCase() === 'DCA'
  )
);
let discoveredMixers: DiscoveryType[] = [];
let midiReconnectTimer: ReturnType<typeof setInterval> | null = null;
let midiStaleCheckTimer: ReturnType<typeof setInterval> | null = null;
let mixerReconnectTimer: ReturnType<typeof setInterval> | null = null;
let mixerConnecting = false; // Guard against overlapping mixer connect attempts
let mixerConnectGen = 0;     // Incremented on every new connection request; lets user override in-progress attempts
let midiScanCleanup: (() => void) | null = null; // Cleanup fn for multi-port MIDI scan
const MIDI_RECONNECT_MS = 3000;   // Check MIDI every 3 seconds
const MIDI_STALE_CHECK_MS = 2000; // Check for stale/disconnected MIDI devices every 2 seconds
const MIXER_RECONNECT_MS = 3000;  // Check mixer every 3 seconds

function createWindow() {
  // Use app.getAppPath() for reliable icon resolution in both dev and packaged builds
  const appRoot = app.getAppPath();
  const iconPath = process.platform === 'darwin'
    ? path.join(appRoot, 'assets', 'icon.icns')
    : path.join(appRoot, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,        // preload needs Node access for ipcRenderer/shell
    }
  });

  // For now, just show a simple HTML page
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Confirm before quitting
  mainWindow.on('close', (event) => {
    if (mainWindow) {
      event.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Confirm Quit',
        message: 'Are you sure you want to quit StudioLive MIDI Controller?'
      }).then(({ response }) => {
        if (response === 0) {
          // User chose Quit — tear down and exit
          stopReconnectionLoop();
          mainWindow?.removeAllListeners('close');
          mainWindow?.close();
        }
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize the application
async function initializeApp() {

  // Set up MIDI event handlers
  midiManager.on('disconnected', (deviceName: string) => {
    if (mainWindow) {
      mainWindow.webContents.send('midi-device-lost', deviceName);
    }
  });

  midiManager.on('message', (midiMessage) => {

    // Forward to renderer for UI updates
    if (mainWindow) {
      mainWindow.webContents.send('midi-activity', midiMessage);
    }

    // Translate MIDI to mixer command
    const command = mappingEngine.translateMidiToMixer(midiMessage);
    if (command) {


      // Forward to renderer for UI updates
      if (mainWindow) {
        mainWindow.webContents.send('mixer-activity', command);
      }

      // Execute mixer command
      try {
        switch (command.action) {
          case 'volume':
            if (command.value !== undefined && 'type' in command.channel && command.channel.channel !== undefined) {
              mixerManager.setVolume(command.channel, command.value);

              // Check if this channel is stereo-linked and update the paired channel
              try {
                const isLinked = mixerManager.getChannelLink(command.channel.type, command.channel.channel);
                if (isLinked) {
                  // This is the left channel of a stereo pair, also update the right channel
                  const rightChannel = { type: command.channel.type, channel: command.channel.channel + 1 };
                  mixerManager.setVolume(rightChannel, command.value);

                }
              } catch (err) {
                // Silently ignore stereo link errors to avoid crashes
              }
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
        // Silently ignore command errors
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
      const mapping = mappingEngine.findVolumeMapping(data.channel.type, data.channel.channel);

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
      // Silently ignore feedback errors
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

  // Forward INPUT_SIGNAL meter levels to renderer (throttled to ~60fps)
  // Send only the u16 array for input channels — smaller payload, less IPC overhead
  const MG_INPUT_SIGNAL = 0; // MeterGroups.INPUT_SIGNAL
  let lastMeterSend = 0;
  mixerManager.on('meter', (data: any) => {
    const inputLevels = data[MG_INPUT_SIGNAL];
    if (!inputLevels || !mainWindow) return;
    const now = Date.now();
    if (now - lastMeterSend < 16) return;
    lastMeterSend = now;
    mainWindow.webContents.send('mixer-meter', inputLevels);
  });

  // Forward mixer disconnect to renderer so the UI can show the warning stripe immediately
  mixerManager.on('disconnected', () => {
    if (mainWindow) {
      mainWindow.webContents.send('mixer-lost');
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

  // Load default preset: prefer user profiles dir, fall back to bundled preset
  const userPresetPath = path.join(getProfilesDir(), 'logic-pro-default.json');
  const bundledPresetPath = path.join(__dirname, '../../presets/logic-pro-default.json');
  const presetPath = fs.existsSync(userPresetPath) ? userPresetPath : bundledPresetPath;
  try {
    mappingEngine.loadPreset(presetPath);
    // Store the current preset path and notify renderer
    currentPresetPath = presetPath;
    if (mainWindow) {
      const mtime = fs.statSync(presetPath).mtime.toISOString();
      mainWindow.webContents.send('preset-loaded', {
        name: path.basename(presetPath, '.json'),
        path: presetPath,
        mtime
      });
    }
  } catch (error) {
  }

  // Auto-connect to all preferred MIDI devices BEFORE mixer (mixer connect can block)
  const availableMidiDevices = midiManager.getAvailableDevices();
  const preferredMidiDevices = mappingEngine.getPreferredMidiDevices();

  let connectedAny = false;
  for (const preferred of preferredMidiDevices) {
    if (availableMidiDevices.includes(preferred)) {
      try {
        midiManager.connectDevice(preferred);
        connectedAny = true;
        if (mainWindow) {
          mainWindow.webContents.send('connection-restored', { type: 'midi', device: preferred });
        }
      } catch (_error) {
        // Will retry via reconnection loop
      }
    }
  }

  // Fallback: if no preferred devices connected yet, auto-pick Logic or first available
  if (!connectedAny) {
    const logicDevice = availableMidiDevices.find(d => d.toLowerCase().includes('logic'));
    const fallback = logicDevice || availableMidiDevices[0];
    if (fallback) {
      try {
        midiManager.connectDevice(fallback);
        if (mainWindow) {
          mainWindow.webContents.send('connection-restored', { type: 'midi', device: fallback });
        }
      } catch (_error) {
        // Will retry via reconnection loop
      }
    }
  }

  // Start reconnection loop NOW — before the potentially slow mixer connect
  // so MIDI can auto-reconnect while we wait for the mixer
  startReconnectionLoop();

  // Try autodiscovery first, but prefer saved IP from preset
  try {
    const preferredIp = mappingEngine.getPreferredMixerIp();

    if (preferredIp) {
      try {
        await mixerManager.connect(
          preferredIp,
          mappingEngine.getPreferredMixerModel() || undefined,
          mappingEngine.getPreferredMixerDeviceName() || undefined,
          mappingEngine.getPreferredMixerSerial() || undefined
        );
        if (mainWindow) {
          mainWindow.webContents.send('connection-restored', { type: 'mixer', ip: preferredIp });
        }
      } catch (error) {
        // Will retry via reconnection loop or discovery below
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
        await mixerManager.connect(mixer.ip, mixer.name, undefined, mixer.serial);
        if (mainWindow) {
          mainWindow.webContents.send('connection-restored', { type: 'mixer', ip: mixer.ip });
        }
      } else {
        // Fall back to environment variable or default IP
        const mixerIp = process.env.MIXER_IP;
        if (mixerIp) {
          await mixerManager.connect(mixerIp).catch(() => {
            // Silent fail
          });
          if (mixerManager.isConnected() && mainWindow) {
            mainWindow.webContents.send('connection-restored', { type: 'mixer', ip: mixerIp });
          }
        }
      }
    }
  } catch (error) {
    // Silent fail
  }

}

/**
 * Persistent reconnection — separate timers for MIDI and mixer so a
 * slow mixer TCP timeout never blocks MIDI reconnection.
 */
function startReconnectionLoop() {
  // --- MIDI reconnect (fast, synchronous) ---
  // Connect to any preferred device that's available but not yet connected
  if (!midiReconnectTimer) {
    midiReconnectTimer = setInterval(() => {
      const preferred = mappingEngine.getPreferredMidiDevices();
      if (preferred.length === 0) return;
      const available = midiManager.getAvailableDevices();
      for (const device of preferred) {
        if (!midiManager.isDeviceConnected(device) && available.includes(device)) {
          try {
            midiManager.connectDevice(device);
            if (mainWindow) {
              mainWindow.webContents.send('connection-restored', { type: 'midi', device });
            }
          } catch (_err) {
            // Will retry next interval
          }
        }
      }
    }, MIDI_RECONNECT_MS);
  }

  // --- MIDI stale-device check (fast poll to detect physical disconnects) ---
  // getAvailableDevices() reflects OS-level MIDI state; isConnected() evicts devices
  // that have disappeared and emits 'disconnected' so the renderer updates immediately.
  if (!midiStaleCheckTimer) {
    midiStaleCheckTimer = setInterval(() => {
      midiManager.isConnected(); // side effect: evicts stale + emits 'disconnected'
    }, MIDI_STALE_CHECK_MS);
  }

  // --- Mixer reconnect (async, can be slow) ---
  if (!mixerReconnectTimer) {
    mixerReconnectTimer = setInterval(async () => {
      if (mixerConnecting) return; // Previous attempt still in progress
      if (!mixerManager.isConnected()) {
        const preferredIp = mappingEngine.getPreferredMixerIp();
        if (preferredIp) {
          const myGen = ++mixerConnectGen;
          mixerConnecting = true;
          try {
            await mixerManager.connect(
              preferredIp,
              mappingEngine.getPreferredMixerModel() || undefined,
              mappingEngine.getPreferredMixerDeviceName() || undefined,
              mappingEngine.getPreferredMixerSerial() || undefined
            );
            // Only emit restored event if we still own the connection slot
            if (myGen === mixerConnectGen && mainWindow) {
              mainWindow.webContents.send('connection-restored', { type: 'mixer', ip: preferredIp });
            }
          } catch (err) {
            // Will retry next interval
          } finally {
            if (myGen === mixerConnectGen) mixerConnecting = false;
          }
        }
      }
    }, MIXER_RECONNECT_MS);
  }
}

function stopReconnectionLoop() {
  if (midiReconnectTimer) {
    clearInterval(midiReconnectTimer);
    midiReconnectTimer = null;
  }
  if (midiStaleCheckTimer) {
    clearInterval(midiStaleCheckTimer);
    midiStaleCheckTimer = null;
  }
  if (mixerReconnectTimer) {
    clearInterval(mixerReconnectTimer);
    mixerReconnectTimer = null;
  }
}

app.whenReady().then(() => {
  // Set dock icon as early as possible so it takes effect before any window appears
  // Use PNG — nativeImage reliably parses it regardless of ICNS subformat (ic12 etc.)
  if (process.platform === 'darwin') {
    const { nativeImage } = require('electron');
    const pngPath = path.join(app.getAppPath(), 'assets', 'icon.png');
    const dockImage = nativeImage.createFromPath(pngPath);
    if (!dockImage.isEmpty()) {
      app.dock.setIcon(dockImage);
    }
  }

  createWindow();
  initializeApp();
});

app.on('window-all-closed', () => {
  stopReconnectionLoop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (midiScanCleanup) {
    midiScanCleanup();
    midiScanCleanup = null;
  }
  stopReconnectionLoop();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
    startReconnectionLoop();
  }
});

// IPC Handlers for UI communication
ipcMain.handle('get-discovered-mixers', async () => {
  return discoveredMixers;
});

ipcMain.handle('get-preferred-mixer-ip', async () => {
  return mappingEngine.getPreferredMixerIp();
});

ipcMain.handle('discover-mixers', async (event) => {
  discoveredMixers = [];
  const result = await MixerManager.discoverProgressive(10000, (device) => {
    discoveredMixers.push(device);
    // Stream each device to the renderer as it's found
    event.sender.send('discovery-result', device);
  });
  discoveredMixers = result;
  return discoveredMixers;
});

ipcMain.handle('connect-mixer', async (_event, ip: string, model?: string, deviceName?: string, serial?: string) => {
  // User-initiated connections always proceed. Bump the generation so any
  // in-progress auto-reconnect attempt knows it has been superseded.
  const myGen = ++mixerConnectGen;
  mixerConnecting = true;
  try {
    await mixerManager.connect(ip, model, deviceName, serial);
    // If another connection request came in while we were connecting, don't
    // update the preferred mixer — the later request owns that.
    if (myGen !== mixerConnectGen) {
      return { success: false, error: 'Superseded by newer connection request' };
    }
    mappingEngine.setPreferredMixerInfo(ip, model || null, deviceName || null, serial || null);
    return { success: true, ip, model, deviceName, serial };
  } catch (error) {
    if (myGen !== mixerConnectGen) {
      return { success: false, error: 'Superseded by newer connection request' };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  } finally {
    if (myGen === mixerConnectGen) mixerConnecting = false;
  }
});

ipcMain.handle('get-mixer-status', async () => {
  return {
    connected: mixerManager.isConnected(),
    ip: mixerManager.getMixerIp(),
    model: mixerManager.getMixerModel(),
    deviceName: mixerManager.getMixerDeviceName(),
    serial: mixerManager.getMixerSerial(),
    name: mixerManager.getMixerName(), // For backward compatibility
    preferredIp: mappingEngine.getPreferredMixerIp(),
    preferredModel: mappingEngine.getPreferredMixerModel(),
    preferredDeviceName: mappingEngine.getPreferredMixerDeviceName(),
    preferredSerial: mappingEngine.getPreferredMixerSerial()
  };
});

ipcMain.handle('get-midi-devices', async () => {
  midiManager.isConnected(); // validates + evicts stale devices as a side effect
  return {
    inputs: midiManager.getAvailableDevices(),
    outputs: midiManager.getAvailableOutputDevices(),
    connected: midiManager.getConnectedDevices()  // now an array
  };
});

ipcMain.handle('get-midi-status', async () => {
  midiManager.isConnected(); // validates + evicts stale devices as a side effect
  const devices = midiManager.getConnectedDevices();
  return {
    connected: devices.length > 0,
    device: devices[0] || null,   // backward compat
    devices,                       // all connected devices
    preferredDevices: mappingEngine.getPreferredMidiDevices()
  };
});

ipcMain.handle('get-connected-midi-devices', async () => {
  midiManager.isConnected(); // validates + evicts stale devices as a side effect
  return midiManager.getConnectedDevices();
});

ipcMain.handle('connect-midi-device', async (_event, deviceName: string) => {
  try {
    midiManager.connectDevice(deviceName);
    mappingEngine.addPreferredMidiDevice(deviceName);
    return { success: true, device: deviceName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('disconnect-midi-device', async (_event, deviceName: string) => {
  try {
    midiManager.disconnectDevice(deviceName);
    mappingEngine.removePreferredMidiDevice(deviceName);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

// Scan ALL MIDI input ports simultaneously for MIDI learn mode.
// The first CC, Note On, or Pitch Bend received on any port fires midi-scan-captured.
ipcMain.handle('start-midi-scan', async () => {
  // Stop any previous scan first
  if (midiScanCleanup) {
    midiScanCleanup();
    midiScanCleanup = null;
  }

  let fired = false;
  midiScanCleanup = midiManager.scanAllInputs((deviceName, message) => {
    if (fired) return; // Only capture the first signal
    fired = true;

    if (mainWindow) {
      mainWindow.webContents.send('midi-scan-captured', { deviceName, message });
    }

    // Auto-stop after first capture
    if (midiScanCleanup) {
      midiScanCleanup();
      midiScanCleanup = null;
    }
  });

  return { success: true };
});

ipcMain.handle('stop-midi-scan', async () => {
  if (midiScanCleanup) {
    midiScanCleanup();
    midiScanCleanup = null;
  }
  return { success: true };
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
      const mapping = mappingEngine.findVolumeMapping(type, channel);

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
    return mixerManager.getAllChannelNames(type, clampCount(count));
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
    const safeCount = clampCount(count);
    for (let i = 1; i <= safeCount; i++) {
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
    return mixerManager.getAllChannelIcons(type, clampCount(count));
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
    return mixerManager.getAllChannelInputSources(type, clampCount(count));
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
    return mixerManager.getAllAutoFilterGroupNames(clampCount(count, 64));
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

// Stub: renderer invokes this but the API doesn't expose a set method yet
ipcMain.handle('set-channel-main-assign', async () => {
  return { success: false, error: 'Not yet implemented' };
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
    const presetsDir = ensureProfilesDir();
    const presetPath = path.join(presetsDir, `${name.toLowerCase().replace(/\s+/g, '-')}.json`);
    mappingEngine.savePreset(presetPath, name, description);
    return { success: true, path: presetPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('load-preset', async (_event, presetName: string) => {
  try {
    const presetsDir = getProfilesDir();
    const presetPath = path.join(presetsDir, `${presetName.toLowerCase().replace(/\s+/g, '-')}.json`);
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
      defaultPath: ensureProfilesDir(),
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
    currentPresetPath = presetPath;

    const mtime = fs.statSync(presetPath).mtime.toISOString();
    return { success: true, path: presetPath, name: path.basename(presetPath, '.json'), mtime };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('save-preset-dialog', async (_event, currentPath?: string) => {
  try {
    const { dialog } = require('electron');
    const defaultPath = currentPath || path.join(ensureProfilesDir(), 'preset.json');

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
    currentPresetPath = presetPath;

    return { success: true, path: presetPath, name: presetName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-fader-filter', () => {
  return mappingEngine.getFaderFilter();
});

ipcMain.handle('set-fader-filter', (_event, filter: 'all' | 'added' | 'mapped') => {
  mappingEngine.setFaderFilter(filter);
});

ipcMain.handle('get-current-preset-path', async () => {
  return currentPresetPath || null;
});

ipcMain.handle('save-preset-to-path', async (_event, presetPath: string) => {
  try {
    const name = path.basename(presetPath, '.json');
    mappingEngine.savePreset(presetPath, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('set-midi-feedback-enabled', async (_event, enabled: boolean) => {
  mappingEngine.setMidiFeedbackEnabled(enabled);
  return { success: true };
});

ipcMain.handle('get-midi-device-colors', async () => {
  return mappingEngine.getMidiDeviceColors();
});

ipcMain.handle('set-midi-device-color', async (_event, device: string, color: string) => {
  mappingEngine.setMidiDeviceColor(device, color);
  return { success: true };
});

ipcMain.handle('get-level-visibility', async () => {
  return {
    visibility: mappingEngine.getLevelVisibility(),
    peakHold: mappingEngine.getPeakHold()
  };
});

ipcMain.handle('set-level-visibility', async (_event, v: string) => {
  mappingEngine.setLevelVisibility(v as any);
  return { success: true };
});

ipcMain.handle('set-peak-hold', async (_event, v: boolean) => {
  mappingEngine.setPeakHold(v);
  return { success: true };
});

ipcMain.handle('open-docs', async () => {
  const liveUrl = 'https://sandinak.github.io/studiolive-midi-controller/';

  // Try live docs first with a 3-second timeout
  const liveReachable = await new Promise<boolean>((resolve) => {
    const https = require('https');
    const req = https.request(liveUrl, { method: 'HEAD', timeout: 3000 }, (res: any) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
      res.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });

  if (liveReachable) {
    await shell.openExternal(liveUrl);
    return { success: true };
  }

  // Fall back to local copy
  const localPath = path.join(app.getAppPath(), 'docs', 'index.html');
  const err = await shell.openPath(localPath);
  return { success: !err, error: err || 'Docs not available (offline and no local copy)' };
});

ipcMain.handle('get-changelog', async () => {
  try {
    const fs = require('fs');
    const candidates = [
      path.join(app.getAppPath(), 'CHANGELOG.md'),
      path.join(__dirname, '../../CHANGELOG.md'),
      path.join(__dirname, '../../../CHANGELOG.md'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return { success: true, content: fs.readFileSync(p, 'utf8') };
      }
    }
    return { success: false, error: 'CHANGELOG.md not found' };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('check-for-updates', async () => {
  const https = require('https');
  const currentVersion: string = require('../../package.json').version;

  const MAX_RESPONSE_SIZE = 1_048_576; // 1 MB per request

  /** Fetch a GitHub API path and return the parsed JSON, or null on any error. */
  function fetchGitHubJson(apiPath: string): Promise<any> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.github.com',
          path: apiPath,
          method: 'GET',
          headers: { 'User-Agent': 'StudioLive-MIDI-Controller' },
        },
        (res: any) => {
          let data = '';
          let aborted = false;

          res.on('data', (chunk: any) => {
            data += chunk;
            if (data.length > MAX_RESPONSE_SIZE && !aborted) {
              aborted = true;
              req.destroy();
              resolve(null);
            }
          });

          res.on('end', () => {
            if (aborted) return;
            try { resolve(JSON.parse(data)); } catch { resolve(null); }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  try {
    // Fetch releases/latest (for release notes + download URL) AND tags (catches
    // versions pushed as git tags before a formal Release is published on GitHub)
    const [releaseData, tagsData] = await Promise.all([
      fetchGitHubJson('/repos/sandinak/studiolive-midi-controller/releases/latest'),
      fetchGitHubJson('/repos/sandinak/studiolive-midi-controller/tags?per_page=5'),
    ]);

    const { latestVersion, downloadUrl, releaseNotes } = pickLatestVersion(releaseData, tagsData);
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    return {
      success: true,
      currentVersion,
      latestVersion,
      updateAvailable,
      downloadUrl,
      releaseNotes,
    };
  } catch (error) {
    return {
      success: false,
      currentVersion,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

