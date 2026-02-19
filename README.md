# StudioLive MIDI Controller

A MIDI controller application for PreSonus StudioLive III mixers, designed to work with Logic Pro and other DAWs. Control your mixer faders, mutes, and other parameters using MIDI messages, with full bidirectional communication and visual feedback. Based n the execellt work in [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api) by Andrew Wong (featherbear).

![Version](https://img.shields.io/badge/version-0.9.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

### Core Functionality
- **MIDI->Mixer Control**: Send MIDI from Logic Pro to control mixer faders, receive MIDI feedback when mixer changes
- **Visual Fader Interface**: Interactive faders with real-time position indicators
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
- **Channel Colors & Icons**: Displays channel colors and icons from mixer configuration

### MIDI Modes
1. **Control Change (CC)**: Standard MIDI CC messages (CC7, CC10, CC11, CC102-104)
2. **Note (Trigger)**: Note on/off messages for triggering actions
3. **Note-Value Mode**: Use note velocity as fader value (C1-C4 = 24-60)
4. **None**: Channels can exist without MIDI mappings for visual reference

## Prerequisites
- **macOS** (tested on macOS 12+)
- **PreSonus StudioLive III** mixer on the same network
- **Logic Pro** (or any DAW with MIDI output capability)
  - Logic Pro Virtual MIDI is built-in and always enabled (no configuration needed)

## Installation

### From Source

1. **Install Homebrew** (if not already installed):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. **Install dependencies using Homebrew**:
```bash
brew install node
```

This will install both Node.js and npm. Verify installation:
```bash
node --version  # Should show v18 or higher
npm --version
```

3. **Clone the repository**:
```bash
git clone https://github.com/sandinak/studiolive-midi-controller.git
cd studiolive-midi-controller
```

4. **Install project dependencies**:
```bash
npm install
```

5. **Build the application**:
```bash
npm run build
```

6. **Run the application**:
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

### 1. Connect to Mixer

1. Launch StudioLive MIDI Controller
2. Click the **Mixer** connection status in the sidebar
3. Click **Discover Mixers** to find your StudioLive on the network
4. Click **Connect** next to your mixer
   - **Note**: If your mixer isn't found, you can manually enter the IP address
   - Verify the **Mixer Status** indicator is **green** (connected)

### 2. Connect MIDI Device

1. Click the **MIDI** connection status in the sidebar
2. Select **Logic Pro Virtual In** from the list
3. Click **Connect**
   - **Note**: Logic Pro Virtual MIDI is always enabled - no installation or configuration needed
   - Verify the **MIDI Status** indicator is **green** (connected)

### 3. Configure Logic Pro for Automation

1. Open Logic Pro
2. Create a new **External Instrument** track or open an existing one
3. In the **Library** or **Inspector**, create a new **External MIDI Device**:
   - Click **Setup** in the MIDI Environment
   - Create a new **Multi Instrument** or **Instrument**
   - Set the **MIDI Destination** to **Logic Pro Virtual Out**
4. Set the **MIDI Channel** for the device to **1** (or match your mapping)
5. Press **A** to enable **Automation** mode
6. Create **Volume** automation events on the track

### 4. Create a Mapping

1. In the StudioLive MIDI Controller, **double-click** on a fader (e.g., LINE channel 1)
2. Configure the mapping:
   - **MIDI Type**: Select **CC** (Control Change)
   - **CC Type**: Select **CC7 (Volume)** (default)
   - **Logic Channel**: Set to **1** (must match your Logic Pro MIDI channel)
3. Click **Save** or **Add Mapping**

### 5. Test the Integration

**Test 1: Fader Control (Tool → Mixer)**
- Move the fader in the StudioLive MIDI Controller
- You should see the mixer fader move on the physical mixer

**Test 2: MIDI Control (Logic Pro → Tool → Mixer)**
- Move the fader in Logic Pro (or play automation)
- You should see:
  - The fader update in the StudioLive MIDI Controller
  - The mixer fader move on the physical mixer
  - MIDI events appear in the MIDI Log (click **📊 MIDI Log** to view)

**Test 3: Automation Playback**
- Play your Logic Pro project with volume automation
- You should see:
  - The fader move in the StudioLive MIDI Controller
  - The mixer fader move on the physical mixer
  - Real-time updates synchronized with the automation

### 6. Save Your Profile

- Click **💾 Save** to save your profile
- Profiles include:
  - Mixer IP address
  - MIDI device name
  - All channel mappings
  - Filter state (All/Mapped view)
- Click **📂 Load** to load a saved profile

## Usage Guide

### Fader Controls

- **Drag fader**: Adjust mixer volume (sends MIDI to Logic Pro for recording)
- **Click M button**: Toggle mute
- **Click S button**: Toggle solo (yellow when active)
- **Double-click fader**: Edit mapping (or create if none exists)
- **Right-click fader**: Context menu with options:
  - **✏️ Edit Mapping**: Modify the MIDI mapping
  - **🧹 Clear Channel**: Remove MIDI mapping but keep channel visible
  - **🗑️ Delete**: Remove the mapping entirely
- **Ctrl/Cmd + Click background**: Select multiple faders (click on background, not controls)

### Managing Mappings

**To Create a Mapping:**
1. Double-click on any fader (mapped or unmapped)
2. Configure MIDI settings:
   - **MIDI Type**: CC, Note, Note-Value, or None
   - **CC Type**: CC7 (Volume), CC10 (Pan), CC11 (Expression), etc.
   - **Logic Channel**: 1-16 (must match your Logic Pro MIDI channel)
3. Click **Save** or **Add Mapping**

**To Edit a Mapping:**
1. Double-click on the fader
2. Modify settings as needed
3. Click **Save**

**To Clear a Mapping:**
1. Right-click on the fader
2. Select **🧹 Clear Channel**
3. Confirm the dialog
   - The channel remains visible but has no MIDI mapping (MIDI Type: None)

**To Delete a Mapping:**
1. Right-click on the fader
2. Select **🗑️ Delete**
3. Confirm the dialog
   - The channel is removed from the view (unless in "All" filter mode)

### Toolbar Buttons

- **➕ Add Channel**: Create new channel mapping
- **➖ Remove Selected**: Remove selected channel mappings
- **🗑️ Clear All**: Clear all MIDI mappings (channels remain visible, MAIN channels are preserved)
- **🔍 View: All/Mapped**: Toggle between showing all LINE channels (1-16) or only mapped channels

### Visual Indicators

**Fader Indicators:**
- **M badge (blue)**: Channel is assigned to Main mix
- **LINE/NET/USB badge (gray)**: Input source type

**Change Source Indicators:**
- **Green glow**: Change from MIDI (Logic Pro)
- **Blue glow**: Change from API (mixer or Universal Control)
- **Purple glow**: Change from UI (dragging fader)

**Fader Markers:**
- **Orange line**: Current MIDI value position
- **White line at 75%**: 0dB reference line

**Status Indicators:**
- **Orange dot** (top-right): Unsaved changes
- **Green dot** (sidebar): Connected
- **Red dot** (sidebar): Disconnected

### Stereo Channels

Stereo-linked channels (e.g., channels 11-12) are displayed as dual L/R faders:
- Channel number shows as "11/12" format
- Two narrow faders side-by-side
- Both faders move together and show the same level

### Preferences

Click **⚙️ Preferences** to configure:
- **Fader Smoothing**: Adjust transition speed (0-500ms)
  - Default: 300ms
  - Increase for smoother movement (400-500ms)
  - Decrease for more responsive movement (100-200ms)

### MIDI Log

Click **📊 MIDI Log** to open the MIDI event monitor:
- Shows all MIDI messages with timestamps
- Color-coded by message type:
  - **Green**: Note On
  - **Red**: Note Off
  - **Blue**: Control Change (CC)
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
- **Ensure mixer is on the same network** as your computer
- **Check firewall settings** - allow incoming connections on port 53000
- **Try manually entering mixer IP**:
  1. Click the Mixer connection status
  2. Enter the IP address manually (e.g., 192.168.1.100)
  3. Click Connect
- **Verify mixer status is green** in the sidebar

### MIDI Not Working
- **Logic Pro Virtual MIDI is always enabled** - no installation needed
- **Check MIDI connection status** (green dot = connected) in the sidebar
- **Verify MIDI channel matches**:
  - Logic Pro MIDI channel (in External Instrument)
  - StudioLive MIDI Controller mapping (Logic Channel setting)
- **Check MIDI Log** (📊 MIDI Log button) to see if messages are being received
- **Restart Logic Pro** if needed

### Faders Not Moving from Logic Pro
- **Verify mixer connection** (green dot = connected)
- **Check channel mappings are correct**:
  - MIDI Type should be CC (not None)
  - Logic Channel should match your Logic Pro MIDI channel
- **Verify Logic Pro MIDI output**:
  - External Instrument MIDI destination is set to "Logic Pro Virtual Out"
  - MIDI channel matches your mapping
- **Check MIDI Log** for incoming messages
- **Test with manual fader movement** in Logic Pro (not automation first)

### Faders Not Moving from Tool to Mixer
- **Verify mixer connection** (green dot = connected)
- **Check channel type and number** match the mixer
- **Try reconnecting to the mixer**

### Automation Not Working
- **Press A in Logic Pro** to enable Automation mode
- **Create volume automation events** on the track
- **Verify MIDI output** is set to "Logic Pro Virtual Out"
- **Check that automation is not in Read mode** (should be in Touch, Latch, or Write)

### Jerky Fader Movement
- **Increase fader smoothing** in Preferences (⚙️)
  - Default is 300ms
  - Try 400-500ms for smoother movement
- **Check network latency** if using WiFi (wired connection recommended)

### Stereo Channels Not Working
- **Verify channels are linked** in Universal Control
- **Both L and R faders should appear** side-by-side
- **Channel number shows as "11/12"** format for stereo pairs

### Profile Not Loading
- **Check profile location**: `~/Library/Application Support/studiolive-midi-controller/presets/`
- **Verify JSON format** is valid
- **Try creating a new profile** and saving it first

## Acknowledgments

This project uses the excellent [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api) library by Andrew Wong (featherbear) for communication with PreSonus StudioLive mixers. Thank you for making this project possible!

## License

MIT License - see LICENSE file for details

## Author

**sandinak** - https://github.com/sandinak

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

