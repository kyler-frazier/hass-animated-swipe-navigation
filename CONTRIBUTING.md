# Contributing

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Reporting bugs

Please use the [bug report form](https://github.com/kyler-frazier/hass-animated-swipe-navigation/issues/new/choose)
and include your Home Assistant version, device and browser or app, and the relevant part of your
dashboard configuration. A screen recording helps a lot for gesture issues.

## Development setup

Requirements: Node.js 22+ and Docker.

```sh
npm ci
npx playwright install chromium
npm run hass:up   # disposable Home Assistant at http://localhost:8123 (user: test / test)
```

The plugin file is mounted straight into that Home Assistant, so after editing
`animated-swipe-navigation.js` just reload the page. Test dashboards live in
`.hass/config/dashboards/`. Use Chrome DevTools' device mode to try gestures with a mouse.

If port 8123 is taken (for example by your own Home Assistant), run
`HASS_PORT=8124 npm run hass:up` and `HASS_URL=http://localhost:8124 npm test`.

## Before opening a pull request

```sh
npm run check   # lint + formatting
npm test        # Playwright suite (needs `npm run hass:up`)
```

- Add or update tests for behavior changes. See `tests/helpers/touch.mjs` for gesture helpers.
- Add a line to `CHANGELOG.md` under _Unreleased_.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

[AGENTS.md](AGENTS.md) describes how the plugin works and the invariants changes must keep.

## Releasing (maintainers)

1. Move the _Unreleased_ changelog entries under a new version heading.
2. Create a GitHub release with a `vX.Y.Z` tag. The release workflow stamps the version into
   the script and attaches it to the release, which is what HACS installs.
