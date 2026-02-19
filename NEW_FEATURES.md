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

### MIDI Learn Mode
- Click fader, move MIDI control to auto-assign
- Visual feedback during learn mode
- Timeout after X seconds

### Keyboard Shortcuts
- Arrow keys to select faders
- Space to mute/unmute
- Number keys for quick channel selection
- Cmd/Ctrl+S to save preset

### Multiple MIDI Devices
- Connect to multiple MIDI devices
- Device selection dropdown
- Support for MIDI over USB and network


