# Logic Pro Setup Guide

This guide will walk you through setting up **Logic Pro 12.x** to control your PreSonus StudioLive mixer via MIDI.

## Overview

The StudioLive MIDI Controller receives MIDI messages from Logic Pro and translates them into mixer commands. This allows you to use Logic Pro's faders, knobs, and buttons to control your physical mixer.

## Prerequisites

- **Logic Pro 12.x** installed and running
- StudioLive MIDI Controller application running
- Your PreSonus StudioLive mixer connected to the same network

## Step 1: Enable MIDI Output in Logic Pro

Since Logic Pro doesn't have a "Generic" MIDI device option in modern versions, we have **three approaches** to send MIDI CC messages to the StudioLive Controller:

### Approach A: Use Logic's MIDI Environment (Recommended - Most Flexible)

This creates a custom control panel within Logic Pro that sends MIDI CC messages.

1. **Open the MIDI Environment Window**
   - Hold **Option** (⌥) and click the **Window** menu
   - Select **Open MIDI Environment**
   - (Note: In Logic Pro 12, `⌘8` opens Project Audio, not Environment)

2. **Create a New Environment Layer**
   - Click the layer dropdown (top-left) and select `New` → `Mixer`
   - Name it "StudioLive Control"

3. **Create MIDI Faders**
   - In the Environment, click `New` → `Fader`
   - In the Fader's Inspector (left side), configure:
     - **Output**: Select `Logic Pro Virtual Out` (or create a new MIDI output)
     - **MIDI Message**: `Control Change`
     - **Channel**: `1`
     - **Controller Number**: `1` (for first fader)
     - **Min Value**: `0`
     - **Max Value**: `127`

4. **Repeat for Each Channel**
   - Create 8 faders for volume (CC 1-8)
   - Create 8 buttons/faders for mute (CC 16-23)
   - Arrange them visually to look like a mixer

5. **Save the Environment**
   - Your custom control panel is now ready!

### Approach B: Use Smart Controls (Easier, Less Flexible)

1. **Open Smart Controls**
   - Press `B` or go to `View` → `Show Smart Controls`

2. **Enter Edit Mode**
   - Click the `i` button in the Smart Controls header

3. **Configure Each Knob/Fader**
   - Click a control's parameter dropdown
   - Select `MIDI CC`
   - Set the CC number (1-8 for volume, 16-23 for mute)
   - Set the MIDI destination to `Logic Pro Virtual Out`

### Approach C: Use Controller Assignments (For Existing Hardware)

If you have a physical MIDI controller with faders:

1. **Open Controller Assignments**
   - Press `⌘K` or go to `Mix` → `Controller Assignments`

2. **Select "User" Mode**
   - Click the "User" tab at the top

3. **Learn Mode**
   - Click "Learn Mode"
   - Move a fader on your controller
   - Logic will detect the CC message

4. **Configure Output**
   - Set the destination to send to `Logic Pro Virtual Out`
   - This re-transmits the CC to our app

## Step 2: Select MIDI Input in StudioLive Controller

1. **Open the StudioLive MIDI Controller application**

2. **Click "Select MIDI Input"** in the MIDI section of the sidebar

3. **Select "Logic Pro Virtual Out"** from the list of available devices

4. **Click "Connect"**

5. You should see the MIDI status change to "Connected" with device "Logic Pro Virtual Out"

## Step 3: Configure MIDI Output Routing

Regardless of which approach you chose above, you need to ensure MIDI is being sent out:

1. **Create or Select a MIDI Output**
   - Go to `Logic Pro` → `Settings` → `MIDI` → `MIDI Environment`
   - Or in the Environment window, look for "Physical Output"
   - Make sure you have an output configured

2. **For Environment Faders:**
   - Each fader should have its cable connected to the output
   - The output should be set to `Logic Pro Virtual Out`

3. **For Smart Controls:**
   - In the Smart Control inspector, set the MIDI destination
   - Choose `Logic Pro Virtual Out` as the output port

4. **Test MIDI Output**
   - Move a fader/control
   - You should see MIDI activity in the StudioLive Controller app

## Step 4: Default MIDI CC Mappings

The default "Logic Pro Default" preset uses these MIDI CC mappings:

### Volume Controls (CC 1-8)
- **CC 1** → Channel 1 Volume
- **CC 2** → Channel 2 Volume
- **CC 3** → Channel 3 Volume
- **CC 4** → Channel 4 Volume
- **CC 5** → Channel 5 Volume
- **CC 6** → Channel 6 Volume
- **CC 7** → Channel 7 Volume
- **CC 8** → Channel 8 Volume

### Mute Controls (CC 16-23)
- **CC 16** → Channel 1 Mute (toggle)
- **CC 17** → Channel 2 Mute (toggle)
- **CC 18** → Channel 3 Mute (toggle)
- **CC 19** → Channel 4 Mute (toggle)
- **CC 20** → Channel 5 Mute (toggle)
- **CC 21** → Channel 6 Mute (toggle)
- **CC 22** → Channel 7 Mute (toggle)
- **CC 23** → Channel 8 Mute (toggle)

## Step 5: Test the Connection

1. **Move a fader in Logic Pro** that you've mapped to CC 1-8

2. **Watch the StudioLive Controller app:**
   - The MIDI activity light should flash green
   - The Mixer activity light should flash red
   - The corresponding fader in the "Faders" tab should move
   - Your physical mixer's fader should move

3. **Check the console output** for MIDI and mixer messages

## Step 6: Create Custom Mappings

You can create custom mappings in the StudioLive Controller app:

1. **Click "Create New"** in the Mapping section

2. **Configure the MIDI input:**
   - Type: CC or Note
   - Channel: 1-16
   - Controller/Note number

3. **Configure the mixer output:**
   - Action: Volume, Mute, Solo, or Pan
   - Channel: 1-32 (depending on your mixer)

4. **Click "Add Mapping"**

5. **Save your preset** by clicking "Save Preset" in the sidebar

## Troubleshooting

### MIDI Not Connecting
- Make sure Logic Pro is running
- Check that "Logic Pro Virtual Out" appears in the MIDI device list
- Try refreshing the MIDI device list
- Restart both Logic Pro and the StudioLive Controller

### Mixer Not Responding
- Verify your mixer is on the same network
- Check the mixer IP address is correct
- Try using the "Find Mixer" feature to auto-discover
- Check your mixer's network settings

### Faders Not Moving
- Verify the MIDI CC numbers match your mappings
- Check that the mapping exists in the "Mappings" tab
- Watch the activity indicators to see if MIDI is being received
- Check the console for error messages

### Wrong Channels Being Controlled
- Double-check your MIDI CC to channel mappings
- Verify the channel numbers in your mappings
- Make sure you're using the correct preset

## Advanced: Detailed Environment Setup (Recommended Method)

The Environment approach gives you the most control and creates a dedicated mixer panel in Logic Pro.

**📋 Quick Reference:** See [docs/LOGIC_ENVIRONMENT_QUICK_REFERENCE.md](docs/LOGIC_ENVIRONMENT_QUICK_REFERENCE.md) for a condensed setup guide and settings table.

### Step-by-Step Environment Setup:

1. **Open the MIDI Environment Window**
   - Hold **Option** (⌥) and click the **Window** menu
   - Select **Open MIDI Environment**

2. **Create a New Layer**
   - Click the layer dropdown (top-left corner)
   - Select `New` → `Layer`
   - Name it "StudioLive Mixer"

3. **Create a Physical Output**
   - Click `New` → `Physical Output`
   - In the Inspector (left panel), set:
     - **Port**: `Logic Pro Virtual Out`
     - **Channel**: `1`

4. **Create Your First Volume Fader**
   - Click `New` → `Fader`
   - In the Inspector, configure:
     - **Name**: "Ch 1 Volume"
     - **Style**: `Vertical` (looks like a mixer fader)
     - **Output**: Cable it to the Physical Output you created
     - **MIDI Message**: `Control Change`
     - **Channel**: `1`
     - **Controller Number**: `1`
     - **Min**: `0`
     - **Max**: `127`

5. **Cable the Fader to Output**
   - Click the fader's output cable (small triangle on right)
   - Drag it to the Physical Output object
   - You should see a cable connecting them

6. **Test the Fader**
   - Move the fader up and down
   - Watch the StudioLive Controller app for MIDI activity
   - The mixer fader should move!

7. **Create More Faders**
   - Duplicate the fader (Option-drag or Copy/Paste)
   - For each new fader, change:
     - **Name**: "Ch 2 Volume", "Ch 3 Volume", etc.
     - **Controller Number**: 2, 3, 4, 5, 6, 7, 8

8. **Create Mute Buttons**
   - Click `New` → `Fader` (we'll make it a button)
   - In the Inspector:
     - **Name**: "Ch 1 Mute"
     - **Style**: `Button` or `Toggle`
     - **Output**: Cable to Physical Output
     - **MIDI Message**: `Control Change`
     - **Channel**: `1`
     - **Controller Number**: `16`
     - **Min**: `0`
     - **Max**: `127`
   - Duplicate for channels 2-8 (CC 17-23)

9. **Arrange Your Mixer**
   - Drag faders and buttons to arrange them visually
   - Put volume faders in a row
   - Put mute buttons below each fader
   - Make it look like a real mixer!

10. **Save Your Setup**
    - Save your Logic project
    - The Environment setup is saved with the project
    - You can also save it as a template for future projects

### Using Your Environment Mixer:

- Keep the Environment window open while working
- Move faders to control your StudioLive mixer in real-time
- You can even automate these faders in your Logic project!
- The automation will be recorded and can control your mixer during playback

## Tips

- **Start simple**: Begin with just a few fader mappings and test thoroughly
- **Use consistent CC numbers**: Keep volume on CC 1-8, mute on CC 16-23, etc.
- **Save presets**: Create different presets for different workflows
- **Label your controls**: Use clear names in Logic Pro so you remember what controls what
- **Test incrementally**: Add one mapping at a time and test before adding more

## Next Steps

- Explore the visual faders in the "Faders" tab
- Create custom presets for different mixing scenarios
- Map additional controls like pan, solo, and effects sends
- Use Logic Pro's automation to record mixer movements

Enjoy controlling your StudioLive mixer from Logic Pro! 🎛️🎹

