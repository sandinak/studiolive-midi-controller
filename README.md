# StudioLive MIDI Controller

A powerful MIDI controller application for PreSonus StudioLive III mixers, designed to work seamlessly with Logic Pro and other DAWs. Control your mixer faders, mutes, and other parameters using MIDI messages, with full bidirectional communication and visual feedback.

![Version](https://img.shields.io/badge/version-0.9.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

### Core Functionality
- **Bidirectional MIDI Control**: Send MIDI from Logic Pro to control mixer faders, receive MIDI feedback when mixer changes
- **Visual Fader Interface**: Universal Control-style faders with real-time position indicators
- **Channel Management**: Support for all StudioLive channel types (LINE, AUX, FX, SUB, MAIN, DCA, etc.)
- **MIDI Mapping**: Flexible mapping system supporting CC, Note, and Note-Value modes
- **Profile Management**: Save and load complete configurations including mixer IP, MIDI device, and all mappings

### Advanced Features
- **MIDI Value Indicators**: Visual indicators showing MIDI value vs actual mixer value
- **Stereo Channel Detection**: Automatic detection and labeling of stereo-linked channels
- **Change Source Indicators**: Color-coded glows showing whether changes came from MIDI, API, or UI
- **MIDI Log Window**: Real-time MIDI event monitoring with timestamps
- **Filter Modes**: Toggle between showing all channels or only mapped channels
- **Fader Smoothing**: Configurable smoothing for natural fader movements
- **Auto-Discovery**: Automatic mixer discovery on local network
- **Channel Colors & Icons**: Displays channel colors and icons from Universal Control

### MIDI Modes
1. **Control Change (CC)**: Standard MIDI CC messages (CC7, CC10, CC11, CC102-104)
2. **Note (Trigger)**: Note on/off messages for triggering actions
3. **Note-Value Mode**: Use note velocity as fader value (C1-C4 = 24-60)
4. **None**: Channels can exist without MIDI mappings

## Prerequisites

- **macOS** (tested on macOS 12+)
- **Node.js** 18+ and npm
- **PreSonus StudioLive III** mixer on the same network
- **Logic Pro** (or any DAW with MIDI output capability)
- **Logic Pro Virtual Out** MIDI device configured

## Installation

### From Source

1. Clone the repository:
```bash
git clone https://github.com/sandinak/studiolive-midi-controller.git
cd studiolive-midi-controller
```

2. Install dependencies:
```bash
npm install
```

3. Build the application:
```bash
npm run build
```

4. Run the application:
```bash
npm start
```

### From DMG

1. Download the latest DMG from the releases page
2. Open the DMG file
3. Drag "StudioLive MIDI Controller" to your Applications folder
4. Launch from Applications

## Building a DMG

To create a distributable DMG installer:

```bash
npm install  # Install electron-builder if not already installed
npm run dist
```

The DMG will be created in the `dist` directory.

## Quick Start

### 1. Configure Logic Pro MIDI

1. Open Logic Pro
2. Go to **Logic Pro > Control Surfaces > Setup**
3. Click **New > Install**
4. Select **Logic Pro Virtual Out** as your MIDI output device

### 2. Connect to Mixer

1. Launch StudioLive MIDI Controller
2. Click the **Mixer** connection status in the header
3. Click **Discover Mixers** to find your StudioLive on the network
4. Click **Connect** next to your mixer

### 3. Connect MIDI Device

1. Click the **MIDI** connection status in the header
2. Select **Logic Pro** from the list
3. Click **Connect**

### 4. Create Channel Mappings

**Option 1: Use Default Mappings**
- Click **➕ Add Channel**
- Select channel type and number
- Default MIDI settings will be auto-configured (CC7 for channels 1-16, CC102 for 17-32, etc.)

**Option 2: Custom Mapping**
- Click **➕ Add Channel**
- Configure mixer channel (Type, Number, Action)
- Configure MIDI settings (Type, CC/Note, Logic Channel)
- Click **Add Mapping**

### 5. Save Your Configuration

- Click **💾 Save** to save your profile
- Profiles include mixer IP, MIDI device, and all mappings
- Click **📂 Load** to load a saved profile

## Usage Guide

### Fader Controls

- **Drag fader**: Adjust mixer volume
- **Click M button**: Toggle mute
- **Double-click fader**: Edit mapping (or create if none exists)
- **Right-click fader**: Context menu (Edit, Duplicate, Delete)
- **Ctrl/Cmd + Click**: Select multiple faders

### Toolbar Buttons

- **➕ Add Channel**: Create new channel mapping
- **➖ Remove Selected**: Remove selected channel mappings
- **🗑️ Clear All**: Clear all MIDI mappings (faders remain visible)
- **🔍 Show: All/Mapped**: Toggle between showing all LINE channels or only mapped channels

### Visual Indicators

- **Green glow**: Change from MIDI
- **Blue glow**: Change from API (mixer or Universal Control)
- **Purple glow**: Change from UI (dragging fader)
- **Orange line with arrows**: Current MIDI value position
- **White line at 75%**: 0dB reference line
- **ST badge**: Stereo-linked channel
- **Orange dot**: Unsaved changes

### Preferences

Click **⚙️ Preferences** to configure:
- **Fader Smoothing**: Adjust transition speed (0-500ms)

### MIDI Log

Click **📊 MIDI Log** to open the MIDI event monitor:
- Shows all MIDI messages with timestamps
- Color-coded by message type (CC, Note On, Note Off)
- Click **Clear** to clear the log
- Click **Close** to hide the window

## Configuration Files

Profiles are saved as JSON files in:
```
~/Library/Application Support/studiolive-midi-controller/presets/
```

Each profile contains:
- Mixer IP address
- MIDI device name
- All channel mappings

## Troubleshooting

### Mixer Not Discovered
- Ensure mixer is on the same network
- Check firewall settings
- Try manually entering mixer IP

### MIDI Not Working
- Verify Logic Pro Virtual Out is configured
- Check MIDI connection status (green dot = connected)
- Restart Logic Pro if needed

### Faders Not Moving
- Check mixer connection (green dot = connected)
- Verify channel mappings are correct
- Check MIDI Log for incoming messages

### Jerky Fader Movement
- Increase fader smoothing in Preferences
- Default is 300ms, try 400-500ms for smoother movement

## Acknowledgments

This project uses the excellent [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api) library by Andrew Wong (featherbear) for communication with PreSonus StudioLive mixers. Thank you for making this project possible!

## License

MIT License - see LICENSE file for details

## Author

**sandinak**

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

