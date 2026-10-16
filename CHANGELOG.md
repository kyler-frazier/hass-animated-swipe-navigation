# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `opacity` option for the whole bubble (default `0.75`).
- `shadow_color` and `view_fade` options, so every color and opacity is configurable.

### Changed

- Softer default look: darker grey bubble (`#272a2f`, `#383b42` once the swipe will navigate)
  at 75% opacity, instead of turning the theme's primary color.

## [0.1.1] - 2026-10-15

### Fixed

- Stutter on the first swipe after the app or page loads.

## [0.1.0] - 2026-10-15

### Added

- Touch swipe navigation between dashboard views, enabled per dashboard with `animated_swipe_nav`.
- Liquid bubble feedback that is pulled out of the screen edge, shows the destination view's
  icon, and snaps free with a bounce once the swipe will navigate.
- Options: `enable`, `wrap`, `swipe_amount`, `skip_tabs`, `skip_subviews`, `skip_hidden`,
  `liquid`, `haptics` and colors.
- Right-to-left language support and reduced-motion support.

[Unreleased]: https://github.com/kyler-frazier/hass-animated-swipe-navigation/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/kyler-frazier/hass-animated-swipe-navigation/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kyler-frazier/hass-animated-swipe-navigation/releases/tag/v0.1.0
