# Logic Pro 12.x Environment Quick Reference

This is a quick reference for setting up the StudioLive MIDI Controller in Logic Pro 12.x's MIDI Environment.

## Quick Setup Checklist

- [ ] Open MIDI Environment (Hold **Option** + click **Window** menu → **Open MIDI Environment**)
- [ ] Create new layer "StudioLive Mixer"
- [ ] Create Physical Output → `Logic Pro Virtual Out`
- [ ] Create 8 volume faders (CC 1-8)
- [ ] Create 8 mute buttons (CC 16-23)
- [ ] Cable all controls to Physical Output
- [ ] Test each control

## Fader Settings Template

### Volume Faders (CC 1-8)

| Setting | Value |
|---------|-------|
| **Object Type** | Fader |
| **Style** | Vertical |
| **MIDI Message** | Control Change |
| **Channel** | 1 |
| **Controller Number** | 1-8 (one per channel) |
| **Min Value** | 0 |
| **Max Value** | 127 |
| **Output** | Physical Output (Logic Pro Virtual Out) |

### Mute Buttons (CC 16-23)

| Setting | Value |
|---------|-------|
| **Object Type** | Fader |
| **Style** | Button or Toggle |
| **MIDI Message** | Control Change |
| **Channel** | 1 |
| **Controller Number** | 16-23 (one per channel) |
| **Min Value** | 0 |
| **Max Value** | 127 |
| **Output** | Physical Output (Logic Pro Virtual Out) |

## Physical Output Settings

| Setting | Value |
|---------|-------|
| **Object Type** | Physical Output |
| **Port** | Logic Pro Virtual Out |
| **Channel** | 1 |

## Layout Suggestion

```
┌─────────────────────────────────────────────────────────┐
│  StudioLive Mixer Control Panel                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Fader] [Fader] [Fader] [Fader] [Fader] [Fader] ...  │
│    Ch1     Ch2     Ch3     Ch4     Ch5     Ch6         │
│                                                         │
│  [ M ]   [ M ]   [ M ]   [ M ]   [ M ]   [ M ]   ...   │
│  Mute1   Mute2   Mute3   Mute4   Mute5   Mute6         │
│                                                         │
│                                                         │
│  [Physical Output: Logic Pro Virtual Out]              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Cable Connections

All faders and buttons should be cabled to the Physical Output:

```
Fader Ch1 ──┐
Fader Ch2 ──┤
Fader Ch3 ──┤
Fader Ch4 ──┼──> Physical Output (Logic Pro Virtual Out)
Fader Ch5 ──┤
Mute Ch1  ──┤
Mute Ch2  ──┤
Mute Ch3  ──┘
```

## Testing

1. Move a fader in the Environment
2. Check StudioLive Controller app:
   - MIDI activity light should flash green
   - Mixer activity light should flash red
   - Corresponding fader should move in the app
3. Check your physical mixer - the fader should move!

## Troubleshooting

**No MIDI output?**
- Check the Physical Output port is set to "Logic Pro Virtual Out"
- Verify cables are connected from faders to Physical Output
- Make sure StudioLive Controller is connected to "Logic Pro Virtual Out"

**Wrong CC numbers?**
- Double-check the Controller Number in each fader's Inspector
- Volume should be CC 1-8
- Mute should be CC 16-23

**Faders not moving on mixer?**
- Verify the mapping exists in StudioLive Controller app
- Check the channel numbers match
- Look at the console output for errors

## Saving Your Setup

- Save your Logic project to preserve the Environment setup
- Or save as a template: `File` → `Save as Template`
- The Environment will be available in all new projects from that template

## Advanced: Adding More Controls

### Pan (CC 24-31)

Same as volume faders, but:
- **Controller Number**: 24-31
- **Style**: Knob (rotary)
- Create mappings in StudioLive Controller for pan action

### Solo (CC 32-39)

Same as mute buttons, but:
- **Controller Number**: 32-39
- Create mappings in StudioLive Controller for solo action

## Pro Tips

- **Label everything**: Use clear names like "Ch 1 Volume", "Ch 2 Mute"
- **Color code**: Right-click objects to assign colors (e.g., red for mute, blue for volume)
- **Group controls**: Arrange related controls together visually
- **Use automation**: You can automate these Environment faders in your project!
- **Create presets**: Save different Environment setups for different workflows

