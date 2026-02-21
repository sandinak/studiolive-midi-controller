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

## Channel Level Meters

**Status:** Planned for future release

**Description:**
Add real-time audio level meters next to each fader to provide visual feedback of signal levels, similar to hardware mixers.

**Implementation Notes:**

### 1. Backend (Metering Service)
- Subscribe to UDP metering stream from mixer (port 53000)
- Parse meter packets using existing `MeterServer.ts` code
- Forward meter updates to renderer via IPC events
- Handle meter subscription lifecycle (start on connect, stop on disconnect)
- Throttle updates to 15-20fps to reduce CPU load

### 2. Frontend (Meter Display)
- Add vertical meter bar (8-10px wide) to left of each fader
- Simple single-color bar (green) for minimal version
- Optional enhancements:
  - Color gradient (green → yellow → red based on level)
  - Peak hold indicator (small horizontal line)
  - Clip indicator (red flash at 0dB)
- Use CSS transforms for GPU-accelerated animation
- Batch DOM updates with `requestAnimationFrame`

### 3. Layout Adjustments
- Option A: Increase fader channel width from 75px to 85px
- Option B: Place meter inside existing space (reduce padding)
- Ensure meters don't interfere with existing controls

### 4. Performance Optimizations
- Throttle updates to 15-20fps (not 60fps)
- Only update meters for visible channels
- Use CSS transforms instead of direct DOM manipulation
- Batch all meter updates in single animation frame
- Debounce meter updates during rapid changes

### 5. User Preferences
- Optional: Add toggle to enable/disable meters
- Optional: Adjust meter update rate (15/30/60 fps)
- Optional: Choose meter style (minimal/gradient/peak-hold)

### 6. Performance Impact Estimate
- **Network**: +50-100 KB/s (UDP packets) - Very Low
- **CPU**: +2-3% on modern hardware - Low
- **Memory**: +50KB for meter data cache - Negligible
- **UI Responsiveness**: Minimal impact with throttling

**Priority:** Medium
**Complexity:** Medium
**Estimated Effort:** 4-6 hours
- Minimal version (single color, 15fps): 4 hours
- Full version (gradient, peak hold, 30fps): 6 hours
- With preferences toggle: +1 hour

**Recommended Approach:** Start with minimal version, iterate based on performance

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


