# StudioLive MIDI Controller

MIDI control for Fender(PreSonus) StudioLive III mixers. Map DAW faders and automation to your mixer's physical faders over the network — built on [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api) by Andrew Wong; and builds on the ideas in https://github.com/featherbear/presonus-studiolive-api-midi-integration.git to provide a visual interface for mapping and monitoring. This tool is not meant as a replacment for Universal Connect, but more an adjunct to it to allow users to control the mixer from their DAW, control surfaces, or other MIDI controllers.  

![Version](https://img.shields.io/badge/version-1.2.1-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

- **MIDI ↔ Mixer control** — CC, Note, and Note-Value modes with real-time feedback
- **Visual fader interface** — drag faders, mute, solo, with change-source color coding
- **All channel types** — LINE, AUX, FX, SUB, MAIN, DCA, mute groups
- **Stereo linking** — automatic detection and paired fader display
- **Auto-discovery** — finds mixers on the local network
- **Persistent reconnection** — automatically reconnects to configured MIDI and mixer
- **Profile management** — save/load complete configurations
- **Filter modes** — view all, mapped only, DCA groups, or custom groups
- **Channel labels, colors & icons** — set based on mixer configuration

## Quick Start

```bash
# Clone both repos side-by-side
git clone https://github.com/featherbear/presonus-studiolive-api.git
git clone https://github.com/sandinak/studiolive-midi-controller.git
cd studiolive-midi-controller

# Install, build, run
npm install && npm run build && npm start
```
Or download the latest DMG from [Releases](https://github.com/sandinak/studiolive-midi-controller/releases).

## Documentation

| Guide | Description |
|-------|-------------|
| [Setup](docs/setup.md) | Prerequisites, installation, building, first launch, Logic Pro configuration |
| [Usage](docs/usage.md) | Fader controls, mappings, visual indicators, troubleshooting |
| [Logic Environment Reference](docs/LOGIC_ENVIRONMENT_QUICK_REFERENCE.md) | Detailed Logic Pro MIDI Environment settings |
| [Building](docs/building.md) | Creating distributable DMG and Windows packages |
| [Changelog](CHANGELOG.md) | Release history |

## Acknowledgments

Built on the excellent [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api) by Andrew Wong (featherbear).

## Disclaimer

Not affiliated with or endorsed by PreSonus or Fender. StudioLive is a trademark of PreSonus.

## License

MIT — see [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome — please open a Pull Request or issue on [GitHub](https://github.com/sandinak/studiolive-midi-controller).
