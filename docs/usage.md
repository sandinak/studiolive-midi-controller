# Usage Guide

## Fader Controls

| Action | Description |
|--------|-------------|
| **Drag fader** | Adjust mixer volume (sends MIDI feedback to DAW) |
| **Click M** | Toggle mute |
| **Click S** | Toggle solo (yellow when active) |
| **Double-click fader** | Edit or create mapping |
| **Right-click fader** | Context menu: Edit, Clear, or Delete mapping |
| **Ctrl/Cmd + Click** | Select multiple faders |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Cmd-S** / **Ctrl-S** | Quick-save to current preset path (opens Save dialog if no path set) |

## Managing Mappings

**Create:** Double-click any fader → set MIDI Type, CC Type, Logic Channel → Save

**Edit:** Double-click a mapped fader → modify settings → Save

**Clear:** Right-click → 🧹 Clear Channel (removes MIDI mapping, keeps channel visible)

**Delete:** Right-click → 🗑️ Delete (removes channel from view entirely)

**View All:** Click **📋 Mappings** in the toolbar to open a table of every mapping with Edit and Delete actions.

## MIDI Modes

| Mode | Description |
|------|-------------|
| **CC** | Standard MIDI Control Change (CC7, CC10, CC11, CC102–104) |
| **Note** | Note on/off for triggering actions |
| **Note-Value** | Note velocity as fader value (C1–C4 range) |
| **None** | Channel visible without MIDI mapping |

## Toolbar

- **➕ Add Channel** — Create new channel mapping
- **➖ Remove Selected** — Remove selected channel mappings
- **🗑️ Clear All** — Clear all MIDI mappings (channels remain visible)
- **🔍 View: All/Mapped** — Toggle between all channels or only mapped channels
- **📋 Mappings** — View, edit, or delete all mappings in a list

## Filter Modes

The filter dropdown supports several views:
- **All** — All LINE channels plus any non-LINE mapped channels
- **Mapped** — Only channels with MIDI mappings
- **DCA groups** — Channels assigned to a specific DCA
- **Auto-filter groups** — Custom channel groupings from the mixer
- **Device** — Only channels mapped to a specific MIDI device

## Multiple MIDI Devices

Multiple MIDI devices can be connected and used simultaneously. Each device maintains its own mappings, allowing different physical controllers to control different channels.

**MIDI Learn:** Press **Learn** in the mapping dialog and move any control on any connected device — the app will automatically detect the device, MIDI channel, and CC/note number.

## MIDI Device Colors

Each MIDI device can be assigned a color:

1. Open the **MIDI** connection panel
2. Click the color swatch next to a device name
3. Choose a color

Mapped faders display a small colored dot badge for the device that controls them. If a mapped device disconnects, the fader border switches to a pulsing dashed red/white animation until the device reconnects.

## Channel Level Display

Configurable in **⚙️ Preferences → Channel Level Display**:

| Mode | Description |
|------|-------------|
| **None** | No level indicator (default) |
| **Indicator** | Colored dot inside the channel number — green/yellow/red based on signal level |
| **Meter** | Vertical VU bar alongside the fader showing real audio levels from the mixer |

When **Meter** mode is active, enable **Peak Hold** to show a white line at the peak level for 3 seconds before it drops.

Meter data comes from the mixer's UDP audio stream, so it reflects actual pre-fader signal levels.

## Visual Indicators

### Change Source Glow
- **Green glow** — Change from MIDI (DAW)
- **Blue glow** — Change from API (mixer / Universal Control)
- **Purple glow** — Change from UI (dragging fader in app)

### Fader Markers
- **Orange line** — Current MIDI value position
- **White line at 75%** — 0 dB reference

### Badges
- **M badge (blue)** — Channel assigned to Main mix
- **LINE/NET/USB badge** — Input source type
- **Colored dot** — MIDI device color badge (when device color is assigned)

### Connection Status Buttons
- **Solid color** — Connected
- **Striped red/black** — Disconnected (but was previously configured) — reconnect is active

### Status Indicators
- **Orange dot** (top-right) — Unsaved changes
- **Green dot** (sidebar) — Connected
- **Red dot** (sidebar) — Disconnected

## Stereo Channels

Stereo-linked channels are displayed as dual L/R faders:
- Channel number shows as "11/12" format
- Two narrow faders side-by-side
- Both faders move together

Stereo linking is configured on the mixer itself (in Universal Control). The app detects and displays links automatically.

## Mute Groups

Mute groups from the mixer are accessible via the toolbar. Toggling a mute group mutes or unmutes all assigned channels simultaneously.

## Profiles

Profiles are saved as JSON in:
```
~/Library/Application Support/studiolive-midi-controller/presets/
```

Each profile stores:
- Mixer IP address
- MIDI device names and preferred devices list
- MIDI device color assignments
- Channel level display preference
- All channel mappings
- MIDI feedback enabled/disabled

Use **💾 Save** / **📂 Load** in the toolbar, or **Cmd-S** for quick-save.

## Preferences

Click **⚙️ Preferences** to configure:
- **Fader Smoothing** — Transition speed (0–500 ms, default 300 ms)
- **Channel Level Display** — None / Indicator / Meter
- **Peak Hold** — Hold peak marker for 3 seconds (Meter mode only)

## MIDI Log

Click **📊 MIDI Log** to monitor real-time MIDI events:
- **Green** — Note On
- **Red** — Note Off
- **Blue** — Control Change

## Auto-Reconnection

The app automatically retries connections to your configured MIDI devices (every 3 s) and mixer (every 3 s). When a device disconnects unexpectedly, the corresponding connection button switches to a striped red/black background immediately, and reconnection is attempted automatically. Status is shown in the sidebar and logged on each connect/disconnect.

When manually disconnecting a MIDI device that has active mappings, you will be prompted to clear those mappings.

## Troubleshooting

### Mixer Not Found
- Ensure the mixer is on the same network / subnet
- Check firewall — allow port 53000
- Try entering the mixer IP manually

### MIDI Not Working
- Verify MIDI connection status (green dot in sidebar)
- Confirm MIDI channels match between DAW and mapping
- Check the **MIDI Log** for incoming messages
- Restart your DAW if needed

### Faders Not Moving (DAW → Mixer)
- Verify both mixer and MIDI are connected (green dots)
- Check mapping: MIDI Type should be CC, channel must match
- Ensure DAW MIDI output is set to the correct virtual port

### Faders Not Moving (App → Mixer)
- Verify mixer connection
- Check channel type and number match the mixer

### Automation Not Working
- Press **A** in Logic Pro to enable Automation
- Verify automation mode is Touch, Latch, or Write (not Read)

### Jerky Fader Movement
- Increase fader smoothing in Preferences (try 400–500 ms)
- Use wired network instead of WiFi

### Profile Not Loading
- Check location: `~/Library/Application Support/studiolive-midi-controller/presets/`
- Verify JSON is valid
- Try creating and saving a new profile first
