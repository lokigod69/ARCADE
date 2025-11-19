# Checks Pipeline

The project exposes three pnpm commands for validation:

1. `pnpm discover`  
   Generates a dry-run manifest from the HTML games under `public/` and prints the JSON preview.  
   Use this to confirm slugs, entry paths, and engine detection.

2. `pnpm discover:verify` (requires `pnpm dev` running)  
   Performs GET requests against the Vite dev server for every discovered entry and prints a tabular report.  
   Any non-2xx response is surfaced immediately so you can diagnose runtime issues.

3. `pnpm check`  
   - Reads `games.manifest.json` and compares it with the discovery output.  
   - Ensures every manifest entry resolves to an actual HTML file and vice versa.  
   - Calls the same verification routine as `pnpm discover:verify` to confirm the dev server responds.  
   - Warns about missing thumbnails when a manifest entry specifies `thumbnail` but the file is absent.  
   - Exits non-zero if the dev server is unreachable or if manifest/discovery drift is detected.

Run these commands locally (and in CI) before publishing or deploying. A failing check indicates a routing, manifest, or asset regression that should be resolved prior to release.
