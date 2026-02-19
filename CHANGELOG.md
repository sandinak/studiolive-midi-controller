# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-02-19

### Added
- Makefile for streamlined build and development workflow
- BUILD.md documentation for creating distributable packages
- Support for building DMG installers for macOS (x64 and arm64)
- Support for building Windows installers (NSIS and portable)
- Comprehensive build targets for development and distribution

### Changed
- Updated README.md with correct attribution for presonus-studiolive-api library
- Improved project structure and build process

### Security
- Fixed minimatch ReDoS vulnerability (CVE-2026-26996) in presonus-studiolive-api dependency
- Contributed security fix upstream via PR #60

### Fixed
- Resolved 6 high severity vulnerabilities in dependency chain

## [Unreleased]

### Planned
- Custom application icons
- Additional MIDI mapping modes
- Enhanced visual feedback options
- Profile import/export improvements

---

[0.9.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v0.9.0

