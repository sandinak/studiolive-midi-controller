# Setup Guide

## Prerequisites

- **macOS 12+** (primary platform), **Windows 10/11**, or **Linux** (x64 or arm64)
- **Node.js 22+** and npm (install via [Homebrew](https://brew.sh): `brew install node`)
  - Node 22 is required to build from source: the upstream `presonus-studiolive-api`
    build imports `styleText` from `node:util`, which Node 18 doesn't provide
- **Python 3.11** if building from source — `node-gyp` needs `distutils` to compile
  the native MIDI module, and Python 3.12 removed it (any Python before 3.12 works;
  3.11 is simply the newest that still ships it)
- **yarn** on `PATH` — the pinned `presonus-studiolive-api` dependency builds itself
  during `npm install` and its build script invokes yarn. `corepack enable` provides
  it. Without it the install fails with `sh: 1: yarn: not found`.
- **On Linux**: `libasound2` at runtime — MIDI goes through ALSA there. The MIDI
  module ships prebuilt binaries, so `libasound2-dev` is only needed in the unlikely
  event it has to compile from source
- **PreSonus StudioLive III** mixer on the same network
- **Logic Pro** or any DAW with MIDI output capability
  - Logic Pro exposes **Logic Pro Virtual Out** automatically — no extra setup needed

## Installation

### From Source

```bash
git clone https://github.com/sandinak/studiolive-midi-controller.git
cd studiolive-midi-controller

# Install dependencies and build
npm install
npm run build

# Run
npm start
```

> `presonus-studiolive-api` is a **pinned git dependency** (`#v1.8.1`) that builds
> itself during install — no sibling checkout is required. It used to be a local
> `file:` dependency, which is what older instructions describe. To develop against a
> local checkout of it, use `make link-local`; `npm install` or `make release` restores
> the pinned tag.

### From a Linux Package

Download from the [Releases](https://github.com/sandinak/studiolive-midi-controller/releases)
page — an **AppImage** (`chmod +x` and run, no installation), a **.deb**
(`sudo apt install ./studiolive-midi-controller_*.deb`), or a **tarball**. x64 and
arm64 builds are published separately; there is no universal Linux binary because
the MIDI module is native code.

### From DMG

1. Download the latest DMG from the [Releases](https://github.com/sandinak/studiolive-midi-controller/releases) page
2. Open the DMG and drag **StudioLive MIDI Controller** to Applications
3. Launch from Applications

## Building Distributable Packages

```bash
# macOS DMG and ZIP (separate x64 and arm64 artifacts)
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

