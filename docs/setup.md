# Setup Guide

## Prerequisites

- **macOS** (tested on macOS 12+)
- **Node.js 18+** and npm (install via [Homebrew](https://brew.sh): `brew install node`)
- **PreSonus StudioLive III** mixer on the same network
- **Logic Pro** or any DAW with MIDI output capability
  - Logic Pro exposes **Logic Pro Virtual Out** automatically — no extra setup needed

## Installation

### From Source

```bash
# Clone the API library (must be in the same parent directory)
git clone https://github.com/featherbear/presonus-studiolive-api.git

# Clone the main application
git clone https://github.com/sandinak/studiolive-midi-controller.git
cd studiolive-midi-controller

# Install dependencies and build
npm install
npm run build

# Run
npm start
```

> The `presonus-studiolive-api` repository must be cloned alongside `studiolive-midi-controller` in the same parent directory — it is referenced as a local dependency.

### From DMG

1. Download the latest DMG from the [Releases](https://github.com/sandinak/studiolive-midi-controller/releases) page
2. Open the DMG and drag **StudioLive MIDI Controller** to Applications
3. Launch from Applications

## Building Distributable Packages

```bash
# macOS DMG and ZIP (universal binary)
make dist-mac

# Windows installer and portable
make dist-win

# All platforms
make dist-all
```

Output goes to the `release/` directory. See `make help` for all targets.

For macOS code signing issues during testing:
```bash
CSC_IDENTITY_AUTO_DISCOVERY=false make dist-mac
```

## First Launch

### 1. Connect to Your Mixer

1. Launch StudioLive MIDI Controller
2. Click the **Mixer** connection status in the sidebar
3. Click **Discover Mixers** to find your StudioLive on the network
4. Click **Connect** next to your mixer
   - If discovery fails, enter the IP address manually
   - The mixer IP is saved for automatic reconnection

### 2. Connect MIDI

1. Click the **MIDI** connection status in the sidebar
2. Select your MIDI device (e.g., **Logic Pro Virtual Out**)
3. Click **Connect**
   - The MIDI device is saved for automatic reconnection

### 3. Create Your First Mapping

1. Double-click on any fader (e.g., LINE channel 1)
2. Set **MIDI Type** to **CC** (Control Change)
3. Set **CC Type** to **CC7 (Volume)**
4. Set **Logic Channel** to match your DAW's MIDI channel
5. Click **Save**

### 4. Save Your Profile

Click **💾 Save** to persist your configuration. Profiles store mixer IP, MIDI device, and all mappings.

## Logic Pro Configuration

### Quick Start

1. In Logic, create an **External MIDI** track. In the Inspector set **MIDI Out** to **Logic Pro Virtual Out** and choose a unique **MIDI Channel** per mixer channel.
2. Draw **CC 7 (Volume)** automation on the track.
3. In the app, open the MIDI panel and connect to **Logic Pro Virtual Out**.
4. Right-click a fader in the app → **Learn MIDI mapping**, then press Play in Logic and move the fader.

### Environment Setup (Advanced)

For a visual fader panel inside Logic, use the MIDI Environment:

1. Open MIDI Environment: hold **Option** + click **Window** → **Open MIDI Environment**
2. Create a new layer named "StudioLive Mixer"
3. Create a **Physical Output** pointing to **Logic Pro Virtual Out**
4. Create Fader objects (CC 7 per channel, unique MIDI channel each)
5. Cable all controls to the Physical Output

See [Logic Quick Reference](LOGIC_ENVIRONMENT_QUICK_REFERENCE.md) for full settings tables and a step-by-step walkthrough.

### Integration Approaches

| Approach | Pros | Best For |
|----------|------|----------|
| **External MIDI track** ⭐ | Simple, uses standard Logic automation | Most users |
| **MIDI Environment** | Visual fader panel, more CC flexibility | Power users wanting a dedicated panel |
| **Hardware MIDI controller** | Tactile hardware, works alongside Logic | Users with BCF2000, X-Touch, etc. |

