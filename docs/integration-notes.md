# Integration Notes (draft)

## Tooling snapshot
- Vite + React + TypeScript with Tailwind CSS already drive the existing shell (`src/App.tsx`).
- Node 20.x with pnpm is the baseline toolchain; `pnpm dev`, `pnpm build`, `pnpm preview`, and `pnpm lint` map to current Vite flows.
- All arcade games live as standalone HTML bundles under `public/` and run without additional build steps.
- `lucide-react` is the only shared UI dependency discovered so far.

## Iframe wrapper contract
- **Mount flow**: `/game/:id` resolves a manifest entry and renders `<iframe src="/<entry>">`.
- **Injected helper**: once the iframe loads, the parent injects a helper that:
  - Listens for `message` events.
  - Wraps `console.*` and `window.onerror` to forward payloads to the parent.
  - Hooks `requestAnimationFrame` to produce FPS samples.
- **PostMessage channels** (origin locked to same host):
  - Parent -> Game: `arcade:focus`, `arcade:blur`, `arcade:pause`, `arcade:resume`.
  - Game -> Parent: `arcade:ready`, `arcade:metrics`, `arcade:console`, `arcade:error`, `arcade:pause-state`, `arcade:highscores`.
  - Metrics payloads are throttled to roughly 10Hz using a 60-frame moving average to avoid per-frame spam.
- **Escape protocol**: when Escape is pressed and the iframe has focus, the parent sends `arcade:pause` and navigates back to `/`. If the game consumes Escape, the helper still emits `arcade:pause-state` so the parent stays in sync.
- **Focus/blur**: entering the iframe sends `arcade:focus`. Route changes or launcher overlays send `arcade:blur` (and optionally `arcade:pause`).
- **Privacy**: all telemetry stays local to the browser session; no network calls.

## PostMessage payload examples
- arcade:ready -> { canvasSize: { width: number, height: number } }
- arcade:metrics -> { fps: number, frameTimeMs: number, frameSamples: number, canvasSize: { width: number, height: number } | null, firstPaintMs: number | null }
- arcade:console -> { level: log | info | warn | error, args: unknown[] }
- arcade:error -> { message: string, source?: string, line?: number, column?: number, stack?: string | null }
- arcade:pause-state -> { state: arcade:focus | arcade:blur | arcade:pause | arcade:resume }
- arcade:highscores -> { entries: Array<{ key: string, value: string | null }> }


## Letterboxing and sizing
- Do not resize in-game canvases. Each game reports `nativeWidth` and `nativeHeight` via `arcade:ready`.
- Compute `scale = min(hostWidth / nativeWidth, hostHeight / nativeHeight)`.
- Render dimensions: `renderWidth = nativeWidth * scale`, `renderHeight = nativeHeight * scale`.
- Letterbox bars: horizontal padding `(hostWidth - renderWidth) / 2`, vertical padding `(hostHeight - renderHeight) / 2`.
- Apply scale via CSS transforms on the iframe container so focus behaviour remains intact.

## Cross-cutting observations
- Games assume ownership of global keyboard listeners; isolating them in iframes prevents conflicts with the React shell.
- Canvas sizes are hard-coded (typically 800x600). Letterboxing is required for responsive layouts.
- High scores persist via localStorage keys: `cosmicRunnerHighScore`, `gravityFlipHighScore`, `impulseHighScore`, `spaceInvadersHighScore`. Dev Tools should surface these read-only.
- No external assets are referenced; everything is rendered procedurally, so thumbnails must be generated separately.

## One-shot fixes before integration
- Leave `magic mushrooms.html` excluded until the real game files resurface.
- Clean mojibake in control tooltips by replacing corrupted glyphs with ASCII text or HTML entities (`&larr;`, `&rarr;`, `&infin;`, etc.).
- Keep slugs manifest-only; filenames remain unchanged but routing must handle spaces safely.
- Add visibility guards inside games (or via helper) so loops pause when `document.hidden` is true.

## Health check approach (pre-flight)
- Load each entry through the Vite dev server (`http://localhost:5173/<entry>`) to catch missing files.
- Monitor browser consoles for `TypeError`/`ReferenceError` triggered by missing DOM nodes.
- Use the helper's arcade:metrics output to watch FPS trends.
- Ensure the iframe gains focus on click; some games call `preventDefault` on Space and can otherwise steal focus.
- Verify no audio autoplay attempts are made (none detected so far).
- Dev Tools will query `arcade:highscores` to display any exposed localStorage values.

## Mojibake cleanup plan
- Catalogue every tooltip/control hint with corrupted glyphs.
- Replace with ASCII text or HTML entities in a single follow-up content pass per title.
- Note each change in `docs/arcade-inventory.md` so QA can cross-check behaviour.

