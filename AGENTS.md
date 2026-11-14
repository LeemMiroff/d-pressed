# D-PRESSED runtime guidance

## Viewport and window scaling

The game uses a logical world of 120 x 240 units. `src/main.js` owns the only viewport scaling path.

- Pixi is initialized with `resizeTo: window` and `autoDensity: true`.
- The canvas keeps `width: 100%` and `height: 100%` in `src/style.css`.
- `resizeViewport()` computes one integer scale from `app.screen`, sets `viewport.scale`, centers the viewport, and applies the same scale and position to `uiRoot`.
- `worldHeight` is derived as `app.screen.height / scale`.
- `portalManager.resizeWorld(worldHeight)` runs before `game.resizeWorld(worldHeight)`.
- `game.resizeWorld()` performs the reset and starts the hub. Do not call `startInitialHub()` again from `main.js`.

## Do not reintroduce the small-window regression

- Do not add fixed pixel dimensions to `canvas`, `#app`, or the game viewport.
- Do not set `worldRoot.scale` to a screen-dependent value. Scale `viewport` and `uiRoot` together.
- Do not manually call `app.renderer.resize()` while `resizeTo: window` is enabled.
- Do not add a second resize or hub initialization path.
- Do not call `game.resizeWorld()` more than once per resize event. It regenerates the route and resets gameplay state.
- Keep the viewport centered from `app.screen.width` and `app.screen.height`.

## Production assets and settings

Vite serves files from `public`. Runtime assets and `settings.json` must exist under `public/`, otherwise the Netlify build can show a blank screen or silently use default settings. After changing source assets or settings, run `npm run build` and inspect `dist/` before creating the deployment ZIP.

## Verification after viewport changes

Run `npm run build`. Check the game at a narrow window, a wide window, and after a browser resize. The logical game area must remain visible and centered, with the UI aligned to the same viewport.
