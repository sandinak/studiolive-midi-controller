# Application Icons

## Optional Icon Files

To add custom application icons, create the following files in this directory:

- `icon.icns` - macOS icon file (512x512 or 1024x1024 recommended)
- `icon.ico` - Windows icon file (256x256 recommended)
- `icon.png` - Source PNG file (1024x1024 recommended)

## Creating Icons

### From PNG to ICNS (macOS):
```bash
# Create iconset directory
mkdir icon.iconset

# Generate different sizes
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png

# Convert to icns
iconutil -c icns icon.iconset
```

### From PNG to ICO (Windows):
Use an online converter or ImageMagick:
```bash
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

## Design Suggestions

The icon should combine MIDI and audio mixing symbols, such as:
- MIDI cable/connector
- Audio fader/mixer
- PreSonus or StudioLive branding elements (if permitted)

## Note

The application will build successfully without custom icons. Electron will use default icons if these files are not present.
