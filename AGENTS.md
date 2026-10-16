# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

A Home Assistant dashboard plugin (a "Lovelace resource") that adds touch swipe navigation
between dashboard views, with an animated liquid bubble as live feedback. Everything ships as one
plain ES2022 script: `animated-swipe-navigation.js`. There is no build step and there are no
runtime dependencies. Keep it that way.

## Layout

| Path                           | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `animated-swipe-navigation.js` | The plugin. The only file users install.                                  |
| `tests/`                       | Playwright tests (`*.spec.mjs`) and helpers.                              |
| `.hass/`                       | Config for the disposable Home Assistant used by the tests.               |
| `docker-compose.yml`           | Runs that Home Assistant, with this repo mounted at `/config/www/plugin`. |
| `.github/workflows/`           | Lint, tests, HACS validation, release.                                    |

## Commands

```sh
npm ci
npm run check        # eslint + prettier --check
npm run hass:up      # start the test Home Assistant on :8123 (HASS_PORT to change)
npm test             # Playwright (HASS_URL to point elsewhere)
npm run hass:down
```

Run `npm run check` and `npm test` before considering a change done. Behavior changes need a
test. The suite drives real touch events through the Chrome DevTools Protocol
(`tests/helpers/touch.mjs`), because Playwright's touchscreen API can only tap.

## How the plugin works

- Listens for touch events on `window` in the capture phase. A gesture becomes "horizontal"
  once it moves `DECIDE_PX` mostly sideways. Vertical gestures are left to the browser.
- Reads its options from the dashboard config (`panel.lovelace.config.animated_swipe_nav`) at
  the start of each gesture. Dashboards without the block are untouched.
- Navigates with `history.pushState` + a `location-changed` event, which is how the Home
  Assistant frontend navigates internally.
- The bubble lives in `document.body`: a container with an SVG "goo" filter (blur + alpha
  threshold) holding a wall strip, a mound and a ball, plus a separate crisp `ha-icon`.
  `render()` positions everything from a single pull-progress value `p` (0..1).

## Invariants (each one fixes a real bug, and each has a test)

- **Navigate immediately on release.** Delaying navigation until an exit animation ends makes a
  quick second swipe compute its target from the old view.
- **Claim sideways moves before deciding.** `preventDefault` sideways-leaning moves under
  `DECIDE_PX`; otherwise the browser starts its own pan and fires `pointercancel`, and the
  swipe is lost. Do **not** treat `pointercancel` as the end of a gesture.
- **Also listen on the touched element.** Touch events stick to their original target. If a view
  switch removes it mid-drag, events stop reaching `window`. `pointerup` is a further backup.
- **Follow direction reversals.** Navigation uses the final direction, so the bubble must move
  to the other wall when the finger crosses its starting point.
- **Let exit animations finish.** The bubble (`bub`) outlives the gesture (`g`), so the neck
  can drain and the bounce can finish after release. Invalidate stale fades via `popId`.
- **Clip horizontal overflow while dragging.** A shifted view otherwise widens the page
  (scrollbar and jitter).
- **Position with the `translate` property, animate with `scale`.** Individual transform
  properties compose in a fixed order; mixing them up makes the bounce swing elements around.

## Conventions

- Prettier formatting (100 columns), ESLint recommended rules.
- Keep comments concise. A comment should explain why the code is written the way it is, not
  repeat what the code does (unless that's unobvious). If code doesn't need a comment, don't
  write one.
- [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, ...).
- Update `CHANGELOG.md` under _Unreleased_ for user-visible changes.
- Don't add dependencies to the plugin. Dev dependencies need a good reason.
