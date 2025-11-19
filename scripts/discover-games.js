#!/usr/bin/env node

/**
 * Draft scaffold for discovering standalone game HTML files.
 * Emits a dry-run manifest to stdout and, when invoked with `--verify`,
 * attempts to hit the Vite dev server (http://localhost:5173 by default)
 * to ensure each entry responds.
 *
 * This script does not mutate any files.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');

const args = new Set(process.argv.slice(2));
const shouldVerify = args.has('--verify');
const DEV_SERVER_URL = process.env.DEV_SERVER_URL ?? 'http://127.0.0.1:5173';

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\.html$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCaseFromSlug(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function detectEngine(source) {
  if (/Phaser/i.test(source)) return 'phaser';
  if (/three\.js/i.test(source) || /THREE\./.test(source)) return 'three';
  if (/new\s+p5\(/i.test(source)) return 'p5';
  if (/getContext\(['"]webgl/.test(source)) return 'webgl';
  if (/getContext\(['"]2d/.test(source)) return 'canvas-2d';
  return 'unknown';
}

async function inspectFile(entryName) {
  const fullPath = join(PUBLIC_DIR, entryName);
  const source = await readFile(fullPath, 'utf8');
  const engine = await detectEngine(source);
  return { source, engine };
}

async function listCandidateGames() {
  const entries = await readdir(PUBLIC_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.html')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function buildDryRunManifest() {
  const candidates = await listCandidateGames();
  const manifest = [];

  for (const entryName of candidates) {
    const slug = slugify(entryName);
    const title = titleCaseFromSlug(slug);
    const { engine } = await inspectFile(entryName);
    manifest.push({
      id: slug,
      title,
      entry: entryName,
      engine,
      orientation: 'landscape',
      status: 'unknown'
    });
  }

  return manifest;
}

async function verifyEntries(manifest) {
  const results = [];

  for (const game of manifest) {
    const url = `${DEV_SERVER_URL}/${game.entry}`;
    let outcome = 'unknown';
    let statusCode = null;
    try {
      const response = await fetch(url, { method: 'GET' });
      statusCode = response.status;
      outcome = response.ok ? 'ok' : 'error';
    } catch (error) {
      outcome = error?.code ?? 'network-error';
    }
    results.push({
      id: game.id,
      entry: game.entry,
      url,
      outcome,
      statusCode
    });
  }

  return results;
}

export { buildDryRunManifest, verifyEntries, listCandidateGames };

async function main() {
  console.log('[discover-games] scanning public/ for standalone HTML games (dry run)');

  try {
    const manifest = await buildDryRunManifest();

    console.log('[discover-games] manifest preview (slug, entry, engine guess)');
    manifest.forEach((game) => {
      console.log(`- ${game.id} -> ${game.entry} (${game.engine})`);
    });

    const manifestObject = {
      generatedAt: new Date().toISOString(),
      basePath: basename(PUBLIC_DIR),
      games: manifest
    };

    console.log('\n[discover-games] dry-run manifest JSON:');
    console.log(JSON.stringify(manifestObject, null, 2));

    if (shouldVerify) {
      console.log('\n[discover-games] verification report (GET requests against', DEV_SERVER_URL, ')');
      const verification = await verifyEntries(manifest);
      verification.forEach((result) => {
        console.log(
          `- ${result.id.padEnd(18)} :: ${String(result.outcome).padEnd(12)} :: ${result.statusCode ?? 'n/a'} :: ${result.url}`
        );
      });
    }
  } catch (error) {
    console.error('Failed to scan games:', error);
    process.exitCode = 1;
  }
}

if (process.argv[1] === __filename) {
  main();
}
