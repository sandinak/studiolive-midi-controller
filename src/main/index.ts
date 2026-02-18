// Main Electron process for StudioLive MIDI Controller

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { MidiManager } from './midi-manager';
import { MixerManager } from './mixer-manager';
import { MappingEngine } from './mapping-engine';

let mainWindow: BrowserWindow | null = null;
const midiManager = new MidiManager();
const mixerManager = new MixerManager();
const mappingEngine = new MappingEngine();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
function initializeApp() {
  console.log('=== StudioLive MIDI Controller ===\n');

  // Set up MIDI event handlers
  midiManager.on('message', (midiMessage) => {
    console.log('MIDI:', midiMessage);
    
    // Translate MIDI to mixer command
    const command = mappingEngine.translateMidiToMixer(midiMessage);
    if (command) {
      console.log('→ Mixer command:', command);
      
      // Execute mixer command
      try {
        switch (command.action) {
          case 'volume':
            if (command.value !== undefined) {
              mixerManager.setVolume(command.channel, command.value);
            }
            break;
          case 'mute':
            if (command.toggle) {
              mixerManager.toggleMute(command.channel);
            }
            break;
          case 'solo':
            if (command.toggle) {
              mixerManager.toggleSolo(command.channel);
            }
            break;
          case 'pan':
            if (command.value !== undefined) {
              mixerManager.setPan(command.channel, command.value);
            }
            break;
        }
      } catch (error) {
        console.error('Error executing mixer command:', error);
      }
    }
  });

  // Set up mixer event handlers
  mixerManager.on('level', (data) => {
    console.log('Mixer level change:', data);
  });

  mixerManager.on('mute', (data) => {
    console.log('Mixer mute change:', data);
  });

  mixerManager.on('solo', (data) => {
    console.log('Mixer solo change:', data);
  });

  // Load default preset if it exists
  const presetPath = path.join(__dirname, '../../presets/logic-pro-default.json');
  try {
    mappingEngine.loadPreset(presetPath);
  } catch (error) {
    console.log('No default preset found, starting with empty mappings');
  }

  // Auto-connect to mixer (you can change this IP)
  const mixerIp = process.env.MIXER_IP || '192.168.1.100';
  console.log(`\nAttempting to connect to mixer at ${mixerIp}...`);
  mixerManager.connect(mixerIp).catch(err => {
    console.error('Failed to connect to mixer:', err.message);
    console.log('You can set MIXER_IP environment variable to specify the mixer IP');
  });

  // List available MIDI devices
  const devices = midiManager.getAvailableDevices();
  console.log('\nAvailable MIDI devices:');
  devices.forEach((device, index) => {
    console.log(`  ${index + 1}. ${device}`);
  });

  // Auto-connect to first available MIDI device (or Logic Pro if found)
  const logicDevice = devices.find(d => d.toLowerCase().includes('logic'));
  const targetDevice = logicDevice || devices[0];
  
  if (targetDevice) {
    console.log(`\nConnecting to MIDI device: ${targetDevice}`);
    try {
      midiManager.connect(targetDevice);
    } catch (error) {
      console.error('Failed to connect to MIDI device:', error);
    }
  } else {
    console.log('\nNo MIDI devices found. Please connect a MIDI device or start Logic Pro.');
  }

  console.log('\n✓ Application initialized');
  console.log('Waiting for MIDI input...\n');
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

