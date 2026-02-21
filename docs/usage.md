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

## Managing Mappings

**Create:** Double-click any fader → set MIDI Type, CC Type, Logic Channel → Save

**Edit:** Double-click a mapped fader → modify settings → Save

**Clear:** Right-click → 🧹 Clear Channel (removes MIDI mapping, keeps channel visible)

**Delete:** Right-click → 🗑️ Delete (removes channel from view entirely)

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

## Filter Modes

The filter dropdown supports several views:
- **All** — All LINE channels plus any non-LINE mapped channels
- **Mapped** — Only channels with MIDI mappings
- **DCA groups** — Channels assigned to a specific DCA
- **Auto-filter groups** — Custom channel groupings from the mixer

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
- MIDI device name
- All channel mappings
- MIDI feedback enabled/disabled

Use **💾 Save** / **📂 Load** in the toolbar to manage profiles.

## Preferences

Click **⚙️ Preferences** to configure:
- **Fader Smoothing** — Transition speed (0–500 ms, default 300 ms)

## MIDI Log

Click **📊 MIDI Log** to monitor real-time MIDI events:
- **Green** — Note On
- **Red** — Note Off
- **Blue** — Control Change

## Auto-Reconnection

The app automatically retries connections to your configured MIDI device (every 3 s) and mixer (every 10 s). Connection status is shown in the sidebar and logged on success.

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

