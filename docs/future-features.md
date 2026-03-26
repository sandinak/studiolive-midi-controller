# Future Feature Ideas

This document tracks feature ideas for future implementation.

## Drag and Drop Fader Reordering

**Status:** Planned for future release

**Description:**
Allow users to reorder faders by dragging and dropping them to customize the layout beyond the default channel type grouping.

**Implementation Notes:**

### 1. User Interface
- Add drag handles or make entire fader container draggable
- Visual feedback during drag (ghost image, drop zones)
- Smooth animations when faders reorder
- Prevent dragging across container boundaries (regular vs main)

### 2. Data Model
- Add `faderOrder` property to `MappingPreset` interface
  ```typescript
  faderOrder?: {
    regular: string[];  // Array of fader IDs in custom order
    main: string[];     // Array of fader IDs in custom order
  }
  ```
- Fader ID format: `${channelType}-${channelNum}` (e.g., "LINE-1", "AUX-3")

### 3. Rendering Logic
- Check if custom order exists in preset
- If yes, render faders in custom order
- If no, use default ordering (LINE, SUB, FX in regular; AUX, MAIN in main container)
- Maintain numeric sorting within each type when no custom order

### 4. Drag and Drop Events
```javascript
// On fader container
faderElement.draggable = true;
faderElement.addEventListener('dragstart', handleDragStart);
faderElement.addEventListener('dragover', handleDragOver);
faderElement.addEventListener('drop', handleDrop);
faderElement.addEventListener('dragend', handleDragEnd);
```

### 5. State Management
- Store custom order in MappingEngine
- Save/load with preset
- Provide reset to default order option
- Mark config as changed when order is modified

### 6. Edge Cases
- Handle filter changes (all vs mapped) with custom order
- Handle adding/removing faders with custom order
- Handle channel type changes
- Preserve order when reloading preset

### 7. UI Controls
- Add "Reset Order" button to toolbar
- Show indicator when using custom order vs default
- Consider adding "Lock Order" toggle to prevent accidental changes

**Priority:** Medium
**Complexity:** Medium-High
**Estimated Effort:** 4-6 hours

---

## Other Future Ideas

### Fader Groups
- Create custom groups of faders (e.g., "Drums", "Vocals")
- Collapse/expand groups
- Group-level controls (mute all, solo all)
- Drag-and-drop between groups
- Save group definitions in preset

### Snapshot System
- Save/recall mixer states
- Quick A/B comparison
- Scene management for different songs/setups

### Keyboard Shortcuts
- Arrow keys to select faders
- Space to mute/unmute selected channel
- Number keys for quick channel selection

---

## FOH Mute Button

**Description:**
A single button that mutes every channel routed to the Main (L/R) mix without touching AUX send levels or monitor mixes. Useful for FOH engineers who need a hard cut between songs or during announcements without disrupting stage monitor or in-ear mixes.

**Implementation Notes:**
- Query `line.chN.lr` state to identify all Main-assigned channels
- Store their pre-mute states so the button acts as a toggle (restore on release)
- Optionally include AUX/FX channels that are assigned to Main
- Surface as a persistent toolbar button with clear ACTIVE/INACTIVE styling
- Map to a MIDI note/CC so a hardware button can trigger it
- Consider an optional "duck" mode (lower by X dB instead of hard mute) for smoother transitions

**Priority:** High
**Complexity:** Low-Medium

---

## Submix Controls

**Description:**
View and control AUX send levels per input channel, AUX master faders, and FX bus send levels — currently only the Main mix fader view is exposed. Essential for monitor engineers and IEM mixes.

**Implementation Notes:**
- Add a "Send" panel alongside the fader strip showing per-channel AUX/FX send knobs or mini-faders
- AUX master faders (aux.chN.volume) shown in the main fader area when an AUX mix is selected
- Map MIDI CCs to individual AUX send levels (channel × AUX combination)
- Send-on-fader mode: optionally scale all AUX sends proportionally when main fader moves
- Preset stores send-level mappings separately from main-mix mappings
- Read `line.chN.aux1`, `.aux2` … paths from mixer state for current send values

**Priority:** High
**Complexity:** High

---

## Mix View Selector

**Description:**
A toolbar dropdown or button bank to switch the fader panel between different mix perspectives — Main L/R, AUX 1, AUX 2 … AUX N, FX A–D — showing the appropriate send levels or master fader for the selected mix. Mirrors the "Mix" button on the physical console.

**Implementation Notes:**
- Toolbar control with options: Main, AUX 1–N, FX A–D
- When an AUX mix is selected, fader positions reflect that AUX's send level for each channel
- Mute/solo buttons switch meaning (mute-in-mix vs channel mute)
- Selected mix stored in session state (not preset) — resets to Main on reload
- MIDI mapping: assign a MIDI note to each mix view for hands-free switching
- Visual indicator showing which mix is active (colored label / tab highlight)

**Priority:** High
**Complexity:** High

---

## Additional Ideas

### Channel Strip Expanded View
- Click/expand a fader to show preamp gain, gate, compressor ratio, EQ band values
- Read-only initially (display from mixer state); make writable in a later iteration
- Useful for quick checks without opening Universal Control

### Fader Ganging / VCA-style Groups
- User-defined fader groups (separate from mixer DCA groups)
- Moving one fader in the group offsets all others by the same delta
- Useful for ganging a stereo pair or a submix that isn't using a DCA

### AUX Send Mapping (per-channel)
- Map individual MIDI CCs to per-channel AUX send levels
- Lets an IEM engineer use a single MIDI controller to manage one artist's mix

### Talkback Control
- Map a MIDI note to talkback activation (hold-to-talk or toggle)
- Display talkback state in UI

### Scene / Snapshot Recall
- Trigger mixer scene recalls from the app UI or a MIDI button
- Browse and recall projects/scenes stored on the mixer without leaving the app

### Multi-Mixer Support
- Connect to two mixers simultaneously (e.g., FOH console + monitor console or stage box)
- Separate fader panels per mixer, switchable in the sidebar

### Web / Tablet UI
- Expose a local HTTP server so a tablet browser can show a simplified fader view
- Useful for a quick-and-dirty second screen without a full Electron install

### OSC Input / Output
- Accept OSC messages as an alternative to MIDI (useful with TouchOSC, Lemur, etc.)
- Emit OSC feedback for fader/mute/solo changes

