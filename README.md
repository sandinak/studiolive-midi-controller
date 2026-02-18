# StudioLive MIDI Controller

Control your PreSonus StudioLive III mixer using MIDI input from Logic Pro (or any MIDI controller).

## Features

- 🎛️ **MIDI to Mixer Control** - Map MIDI CC messages to mixer parameters
- 🎹 **Logic Pro Integration** - Use Logic Pro as a control surface
- 📝 **Preset System** - Save and load custom MIDI mappings
- 🔄 **Real-time Feedback** - Monitor mixer state changes
- ⚡ **Low Latency** - Direct network communication with mixer

## Prerequisites

- **Node.js** 18+ and npm
- **PreSonus StudioLive III** mixer (16, 16R, 24R, or compatible model)
- **Logic Pro** (or any MIDI controller/software)
- Mixer and computer on the same network

## Installation

1. Clone this repository:
```bash
git clone https://github.com/YOUR_USERNAME/studiolive-midi-controller.git
cd studiolive-midi-controller
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Usage

### Quick Start

1. **Find your mixer's IP address** (check mixer's network settings)

2. **Set the mixer IP** (optional, defaults to 192.168.1.100):
```bash
export MIXER_IP=192.168.1.50
```

3. **Run the application**:
```bash
npm run dev
```

The app will:
- Auto-connect to your mixer
- Auto-detect and connect to MIDI devices (prefers Logic Pro)
- Load the default Logic Pro preset
- Display a status window

### Logic Pro Setup

1. **Enable MIDI Output** in Logic Pro:
   - Go to **Logic Pro > Control Surfaces > Setup**
   - Click **New > Install**
   - Select a generic MIDI controller (e.g., "Mackie Control")
   - Or create a custom control surface

2. **Configure MIDI CC Mappings**:
   - Assign faders to CC 1-8 for channel volumes
   - Assign buttons to CC 16-23 for mute toggles
   - Or customize the preset file (see below)

3. **Enable MIDI Output**:
   - Make sure Logic Pro is sending MIDI to the virtual MIDI port

## Configuration

### Default Mappings

The default preset (`presets/logic-pro-default.json`) maps:

| MIDI CC | Function | Mixer Channel |
|---------|----------|---------------|
| CC 1-8  | Volume   | LINE 1-8      |
| CC 16-19| Mute     | LINE 1-4      |

### Custom Presets

Edit `presets/logic-pro-default.json` or create a new preset file:

```json
{
  "name": "My Custom Preset",
  "version": "1.0",
  "description": "Custom MIDI mapping",
  "mappings": [
    {
      "midi": {
        "type": "cc",
        "channel": 1,
        "controller": 1
      },
      "mixer": {
        "action": "volume",
        "channel": {
          "type": "LINE",
          "channel": 1
        },
        "range": [0, 100]
      }
    }
  ]
}
```

**Supported Actions:**
- `volume` - Channel fader (0-100)
- `mute` - Mute toggle
- `solo` - Solo toggle
- `pan` - Pan control (-100 to 100)

**Channel Types:**
- `LINE` - Line inputs
- `TAPE` - Tape/USB returns
- `FX` - FX returns
- `MAIN` - Main mix

## Development

### Project Structure

```
studiolive-midi-controller/
├── src/
│   ├── main/
│   │   ├── index.ts           # Electron main process
│   │   ├── midi-manager.ts    # MIDI input handling
│   │   ├── mixer-manager.ts   # StudioLive API wrapper
│   │   └── mapping-engine.ts  # MIDI-to-mixer translation
│   ├── renderer/
│   │   └── index.html         # UI
│   └── shared/
│       └── types.ts           # Shared TypeScript types
├── presets/
│   └── logic-pro-default.json # Default mappings
└── package.json
```

### Scripts

- `npm run build` - Compile TypeScript
- `npm run dev` - Build and run in development mode
- `npm start` - Run the built application

## Troubleshooting

### Mixer Connection Issues

- Verify mixer IP address is correct
- Ensure mixer and computer are on same network
- Check firewall settings (port 53000)

### MIDI Not Working

- Check MIDI device is connected and recognized
- Verify Logic Pro MIDI output is enabled
- Check console output for MIDI messages

## Dependencies

- [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api)
- [easymidi](https://github.com/dinchak/node-easymidi)
- [Electron](https://www.electronjs.org/)

## License

MIT

