# StudioLive MIDI Controller - Setup Overview (Logic Pro 12.x)

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Logic Pro                               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Environment Window (⌘8)                                 │  │
│  │                                                           │  │
│  │  [Fader CC1] [Fader CC2] [Fader CC3] ... [Fader CC8]   │  │
│  │  [Mute CC16] [Mute CC17] [Mute CC18] ... [Mute CC23]   │  │
│  │                                                           │  │
│  │  All connected to:                                        │  │
│  │  [Physical Output: Logic Pro Virtual Out]                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ MIDI CC Messages
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              StudioLive MIDI Controller (Electron App)          │
│                                                                 │
│  ┌─────────────────┐      ┌──────────────────────────────────┐ │
│  │  MIDI Manager   │      │  Mapping Engine                  │ │
│  │                 │      │                                  │ │
│  │  Listens to:    │─────▶│  CC 1-8  → Volume Ch 1-8        │ │
│  │  "Logic Pro     │      │  CC 16-23 → Mute Ch 1-8         │ │
│  │   Virtual Out"  │      │                                  │ │
│  └─────────────────┘      └──────────────────────────────────┘ │
│                                      │                          │
│                                      │ Mixer Commands           │
│                                      ▼                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Mixer Manager (StudioLive API)                         │   │
│  │                                                          │   │
│  │  - setChannelVolumeLinear(channel, value)              │   │
│  │  - toggleMute(channel)                                  │   │
│  │  - setSolo(channel, state)                             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Network (TCP/UDP)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              PreSonus StudioLive Mixer                          │
│                                                                 │
│  [Ch1] [Ch2] [Ch3] [Ch4] [Ch5] [Ch6] [Ch7] [Ch8] ...          │
│                                                                 │
│  Physical faders move in response to MIDI control!             │
└─────────────────────────────────────────────────────────────────┘
```

## Signal Flow

1. **User moves a fader in Logic Pro's Environment**
2. **Logic sends MIDI CC message** via "Logic Pro Virtual Out"
3. **StudioLive Controller receives MIDI** via MIDI Manager
4. **Mapping Engine translates** MIDI CC to mixer command
5. **Mixer Manager sends command** to StudioLive mixer over network
6. **Physical mixer fader moves!**

## Three Setup Approaches

### 1. Environment (Recommended) ⭐

**Pros:**
- Most flexible and powerful
- Dedicated control panel in Logic
- Can automate mixer movements
- Visual feedback
- No external hardware needed

**Cons:**
- Requires initial setup time
- Need to learn Environment basics

**Best for:** Users who want full control and don't mind a one-time setup

### 2. Smart Controls

**Pros:**
- Easier to set up
- Built into Logic's interface
- Good for simple mappings

**Cons:**
- Limited to available Smart Controls
- Less visual feedback
- Harder to manage many controls

**Best for:** Quick setup with fewer controls

### 3. Physical MIDI Controller + Controller Assignments

**Pros:**
- Tactile hardware control
- Can use existing MIDI controller
- Familiar workflow

**Cons:**
- Requires physical MIDI hardware
- Controller Assignments can be complex
- Need to re-transmit MIDI to virtual port

**Best for:** Users with existing MIDI controllers

## Quick Start Recommendation

**For most users, we recommend the Environment approach:**

1. Follow [LOGIC_PRO_SETUP.md](../LOGIC_PRO_SETUP.md) - Step 1, Approach A
2. Use [LOGIC_ENVIRONMENT_QUICK_REFERENCE.md](LOGIC_ENVIRONMENT_QUICK_REFERENCE.md) for exact settings
3. Create 8 faders (CC 1-8) for volume
4. Create 8 buttons (CC 16-23) for mute
5. Test and expand as needed

**Time investment:** 15-30 minutes for initial setup
**Payoff:** Permanent, reusable mixer control panel in Logic Pro

## Files Reference

- **[LOGIC_PRO_SETUP.md](../LOGIC_PRO_SETUP.md)** - Complete step-by-step guide
- **[LOGIC_ENVIRONMENT_QUICK_REFERENCE.md](LOGIC_ENVIRONMENT_QUICK_REFERENCE.md)** - Quick settings reference
- **[README.md](../README.md)** - Main project documentation

## Support

If you run into issues:
1. Check the Troubleshooting section in LOGIC_PRO_SETUP.md
2. Verify MIDI activity lights in the app
3. Check console output for error messages
4. Make sure mixer is on the same network

