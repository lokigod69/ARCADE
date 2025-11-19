#!/usr/bin/env node

/**
 * Arcade validation pipeline:
 * 1. Discover HTML games under public/
 * 2. Verify dev server responses (requires pnpm dev running)
 * 3. Ensure manifest alignment with discovery
 * 4. Confirm thumbnails exist when declared (else rely on placeholder)
 * 5. Run enhanced health scan for playable verification
 */

import { access, readFile } from 'node:fs/promises';
import { constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDryRunManifest, verifyEntries } from './discover-games.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'games.manifest.json');

const errors = [];
const warnings = [];

function reportStatus() {
  if (warnings.length > 0) {
    console.log('\n[check] warnings:');
    warnings.forEach((message) => console.log(`  - ${message}`));
  }

  if (errors.length > 0) {
    console.error('\n[check] failures:');
    errors.forEach((message) => console.error(`  - ${message}`));
    process.exitCode = 1;
  } else {
    console.log('\n[check] all validations passed.');
  }
}

async function ensureFileExists(pathname) {
  try {
    await access(pathname, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('[check] reading games.manifest.json');
  const manifestRaw = await readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const manifestGames = manifest.games ?? [];
  const playableManifestGames = manifestGames.filter(
    (game) => game.status !== 'missing-assets' && game.status !== 'broken'
  );

  console.log('[check] discovering games under public/');
  const dryRunManifest = await buildDryRunManifest();
  const discoveryIds = new Set(dryRunManifest.map((game) => game.id));

  // Manifest vs discovery parity
  manifestGames.forEach((game) => {
    if (!discoveryIds.has(game.id)) {
      errors.push(`Manifest entry "${game.id}" does not have a matching HTML file in public/`);
    }
  });

  dryRunManifest.forEach((game) => {
    const match = manifestGames.find((entry) => entry.id === game.id);
    if (!match) {
      errors.push(`Discovered HTML "${game.entry}" lacks a manifest entry (slug ${game.id})`);
      return;
    }
    if (match.entry !== game.entry) {
      errors.push(
        `Manifest entry "${match.id}" points to "${match.entry}" but discovery saw "${game.entry}"`
      );
    }
  });

  console.log('[check] verifying dev server responses (requires pnpm dev)');
  const verification = await verifyEntries(dryRunManifest);
  const unreachable = verification.filter((result) => result.outcome !== 'ok');
  if (unreachable.length === verification.length) {
    errors.push(
      'Dev server did not respond. Start it with "pnpm dev" before running "pnpm check".'
    );
  } else {
    unreachable
      .filter((entry) => entry.outcome !== 'network-error')
      .forEach((entry) => {
        errors.push(
          `Dev server returned ${entry.statusCode ?? entry.outcome} for ${entry.entry}. Check for runtime errors.`
        );
      });
  }

  console.log('[check] evaluating thumbnails');
  for (const game of playableManifestGames) {
    if (!game.thumbnail) continue;
    const thumbnailPath = join(ROOT, 'public', game.thumbnail);
    const exists = await ensureFileExists(thumbnailPath);
    if (!exists) {
      warnings.push(
        `Thumbnail missing for ${game.id}. Capture one via Dev Tools and place it at ${relative(
          ROOT,
          thumbnailPath
        )}.`
      );
    }
  }

  console.log('[check] running health scan for playable verification');
  const tmpDir = join(ROOT, '.tmp');
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  const healthReport = join(tmpDir, 'health.json');
  const healthScan = spawnSync('pnpm', [
    'exec',
    'tsx',
    join('scripts', 'health-scan.ts'),
    '--report',
    healthReport
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DEV_SERVER_URL: process.env.DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
    }
  });

  if (healthScan.status !== 0) {
    errors.push('[health] Health scan exited with a non-zero status. See log above.');
  } else {
    try {
      const raw = readFileSync(healthReport, 'utf8');
      const parsed = JSON.parse(raw);
      const games = Array.isArray(parsed?.games) ? parsed.games : [];

      const offenders = games
        .filter((game) => game?.status === 'working')
        .map((game) => {
          const flags = [];
          if (!game.ready) flags.push('not-ready');
          if (game.stalled) flags.push('stalled');
          if (game.noMotion) flags.push('no-motion');
          if (game.noResponse) flags.push('no-response');
          return { id: game.id, flags };
        })
        .filter((entry) => entry.flags.length > 0);

      if (offenders.length > 0) {
        const header = ['Game', 'Flags'];
        const rows = offenders.map((entry) => [entry.id, entry.flags.join(', ')]);
        const widths = header.map((col, index) =>
          Math.max(col.length, ...rows.map((row) => String(row[index]).length))
        );

        const formatRow = (row) =>
          row
            .map((cell, index) => String(cell).padEnd(widths[index]))
            .join(' | ');

        const table = [
          formatRow(header),
          widths.map((width) => '-'.repeat(width)).join('-+-'),
          ...rows.map((row) => formatRow(row))
        ].join('\n');

        errors.push(`Health scan flagged playable titles:\n${table}`);
      } else {
        console.log('[check] Health scan: all playable titles healthy');
      }
    } catch (error) {
      errors.push(
        `[health] Failed to read health scan output: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const brokenVisible = playableManifestGames.filter((game) => game.status === 'broken');
  if (brokenVisible.length > 0) {
    errors.push(
      `Broken titles are still included in the playable list: ${brokenVisible
        .map((game) => game.id)
        .join(', ')}`
    );
  }

  reportStatus();
}

main().catch((error) => {
  console.error('[check] unexpected failure:', error);
  process.exitCode = 1;
});
