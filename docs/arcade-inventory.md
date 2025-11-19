# Arcade Inventory (draft)

| Slug ID | Title | Entry | Engine | Orientation | Status | Flaky? | Controls Snapshot | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| afterglow | Afterglow | afterglow.html | canvas-2d | 800x600 landscape | working | not observed | Mouse move/hold aim, Space ignite, P pause, R reset | Self-contained canvas loop; no external assets detected. |
| brick-breaker | Brick Breaker | brick-breaker.html | canvas-2d | 800x600 landscape | working | not observed | A/D or Left/Right move, Space add ball, P pause, R reset | Control tooltip now uses ASCII Left/Right text; otherwise inline assets only. |
| chromacode | Chromacode | chromacode.html | canvas-2d | 800x600 landscape | working | not observed | Space/Enter shift spectrum, Mouse click shift, P pause, R reset | Large monolithic script with ECS-style pattern; watch for CPU spikes on low-end devices. |
| cosmic-runner | Cosmic Runner | cosmic-runner.html | canvas-2d | 800x600 landscape | working | not observed | W/S or Up/Down move, Space shoot, Shift boost, P pause, R restart | Uses localStorage key `cosmicRunnerHighScore`; heavy particle effects on collisions. |
| duality-rift | Duality Rift | duality-rift.html | canvas-2d | 900x600 landscape | working | not observed | Left/Right or A/D move, Up/Space jump, Shift flip, P/Esc pause | Keyboard listeners on window; UI strings show corrupted dash glyphs. |
| gravity-flip | Gravity Flip | gravity-flip.html | canvas-2d | 800x600 landscape | working | not observed | Click or Space flip, P pause, R reset | Persists `gravityFlipHighScore`; gravity indicator now shows Down/Up text after cleanup. |
| impulse | Impulse | impulse.html | canvas-2d | 800x600 landscape | working | not observed | WASD/arrow thrust, Shift brake, Space/mouse pulse, H help, P pause, R reset | Particle-heavy; rotation hints converted to ASCII Left/Right; localStorage `impulseHighScore`. |
| lunar-tide | Lunar Tide | lunar-tide.html | canvas-2d | 800x600 landscape | working | not observed | Hold Space or click tug tide, P pause, R reset | Uses press-and-hold loop; no thumbnails yet. |
| magic-mushrooms | Magic Mushrooms | magic mushrooms.html | unknown | unknown | missing-assets | n/a | n/a | File contains merge guidance text only; game excluded from launcher until assets restored. |
| origami-rift | Origami Rift | origami-rift.html | canvas-2d | 800x600 landscape | working | not observed | Click/tap fold, P pause, R reset | All UI inline; requires letterboxing to avoid stretch. |
| pixel-pong | Pixel Pong | pixel-pong.html | canvas-2d | 800x400 landscape | working | not observed | W/S or Up/Down move, Space start/pause, R reset | Control tooltip now references Up/Down explicitly; no external assets. |
| reality-shift-runner | Reality Shift Runner | reality-shift-runner.html | canvas-2d | 800x600 landscape | working | not observed | Left/Right or A/D move, Space/Up jump, Esc pause, Z alt jump | Feature probe guards missing canvas; script comments cleaned of stray control glyphs. |
| space-invaders | Space Invaders | space-invaders.html | canvas-2d | 800x600 landscape | working | not observed | A/D or Left/Right move, Space shoot, P pause, R reset | Ammo UI now defaults to &infin; symbol; localStorage `spaceInvadersHighScore`. |
| temporal-twin | Temporal Twin | temporal-twin.html | canvas-2d | 800x600 landscape | working | not observed | Left/Right move, Space anchor, P pause, R reset | Boss HUD toggles via DOM; no external dependencies. |
| vroom | Vroom | Vroom.html | canvas-2d | 800x600 landscape | working | not observed | Up/Down accelerate/brake, Left/Right lane change, Enter start/restart | Uses DOM overlays; lacks dedicated pause binding. |

**Legend**
- Status reflects static review only; no runtime execution performed.
- "Flaky?" column records intermittent load behaviour; "not observed" indicates no issues spotted during static review.
