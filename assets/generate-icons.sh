#!/bin/bash

# Script to generate app icons from SVG source
# Requires: librsvg (for rsvg-convert) and iconutil (macOS built-in)

set -e

echo "🎨 Generating application icons..."

# Check if rsvg-convert is installed
if ! command -v rsvg-convert &> /dev/null; then
    echo "❌ rsvg-convert not found. Installing via Homebrew..."
    brew install librsvg
fi

# Convert SVG to high-res PNG
echo "📐 Converting SVG to PNG (1024x1024)..."
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png

# Create iconset directory
echo "📁 Creating iconset directory..."
rm -rf icon.iconset
mkdir icon.iconset

# Generate different sizes for macOS
echo "🔄 Generating icon sizes..."
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png > /dev/null 2>&1
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png > /dev/null 2>&1
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png > /dev/null 2>&1
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png > /dev/null 2>&1
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png > /dev/null 2>&1
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png > /dev/null 2>&1
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png > /dev/null 2>&1
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png > /dev/null 2>&1
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png > /dev/null 2>&1
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png > /dev/null 2>&1

# Convert to icns
echo "🍎 Creating macOS icon (icon.icns)..."
iconutil -c icns icon.iconset

# Clean up iconset directory
rm -rf icon.iconset

echo "✅ Icon generation complete!"
echo ""
echo "Generated files:"
echo "  - icon.svg (source)"
echo "  - icon.png (1024x1024)"
echo "  - icon.icns (macOS)"
echo ""
echo "To use these icons, rebuild the app with: npm run dist"

