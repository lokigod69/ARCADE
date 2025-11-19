#!/usr/bin/env node
/// <reference types="node" />
/// <reference lib="dom" />

/**
 * Runs an automated health scan using Playwright against the dev server.
 * Generates docs/health-report.md and docs/health-report.json.
 * Use --write to update games.manifest.json statuses (broken only).
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Page } from 'playwright';
import manifestData from '../games.manifest.json' assert { type: 'json' };

type GameStatus = 'working' | 'broken' | 'missing-assets' | 'unknown' | 'flaky';

interface HealthResult {
  id: string;
  title: string;
  ready: boolean;
  avgFps: number | null;
  firstPaint: number | null;
  errors: number;
  stalled: boolean;
  noMotion: boolean;
  noResponse: boolean;
  status: GameStatus;
  previousStatus: GameStatus;
  note: string;
}

interface HealthWindow {
  ready: boolean;
  metrics: Array<{
    fps?: number;
    frameTimeMs?: number;
    frameSamples?: number;
    firstPaintMs?: number | null;
    devicePixelRatio?: number | null;
  }>;
  nativeSize: { width: number; height: number } | null;
  devicePixelRatio: number;
  errors: number;
}

interface ManifestControl {
  device: string;
  input: string;
  action: string;
}

interface ManifestGame {
  id: string;
  title: string;
  status: GameStatus;
  controls?: {
    movement?: ManifestControl[];
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const ROOT = join(__dirname, '..');
const DEFAULT_REPORT_MD = join(ROOT, 'docs', 'health-report.md');
const DEFAULT_REPORT_JSON = join(ROOT, 'docs', 'health-report.json');
const MANIFEST_PATH = join(ROOT, 'games.manifest.json');

interface CliOptions {
  writeChanges: boolean;
  reportPath?: string;
  markdownPath?: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { writeChanges: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      options.writeChanges = true;
      continue;
    }

    const [flag, valueFromEquals] = arg.split('=');
    const consume = () => {
      const next = argv[index + 1];
      if (valueFromEquals) {
        return valueFromEquals;
      }
      if (next && !next.startsWith('--')) {
        index += 1;
        return next;
      }
      throw new Error(`Missing value for ${flag}`);
    };

    if (flag === '--report') {
      options.reportPath = resolve(process.cwd(), consume());
    } else if (flag === '--markdown') {
      options.markdownPath = resolve(process.cwd(), consume());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

let cli: CliOptions;
try {
  cli = parseCliArgs(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[health-scan] failed to parse arguments:', message);
  process.exitCode = 1;
  process.exit();
}
const writeChanges = cli.writeChanges;
const baseUrl = process.env.DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const readinessTimeout = Number(process.env.ARCADE_READY_TIMEOUT ?? '10000');

const manifest = manifestData as {
  games: Array<ManifestGame>;
};

async function isReachable(url: string): Promise<boolean> {
  const browser = await chromium.launch({
    args: [
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
    await browser.close();
    return true;
  } catch (error) {
    await browser.close();
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ECONNREFUSED')) {
      return false;
    }
    throw error;
  }
}

interface FrameSignature {
  width: number;
  height: number;
  luminances: number[];
}

interface AnimationActivity {
  tickCount: number;
  elapsedMs: number;
}

async function initialiseHealthProbe(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __healthScan: HealthWindow }).__healthScan = {
      ready: false,
      metrics: [],
      nativeSize: null,
      devicePixelRatio: window.devicePixelRatio || 1,
      errors: 0
    };
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== window.origin) return;
      const data = event.data;
      if (!data || data.source !== 'arcade-bridge') return;
      const health = (window as unknown as { __healthScan: HealthWindow }).__healthScan;
      switch (data.type) {
        case 'arcade:ready':
          health.ready = true;
          if (data.payload?.canvasSize) {
            health.nativeSize = data.payload.canvasSize;
          }
          if (data.payload?.devicePixelRatio) {
            health.devicePixelRatio = data.payload.devicePixelRatio;
          }
          break;
        case 'arcade:metrics':
          health.metrics.push(data.payload ?? {});
          if (data.payload?.devicePixelRatio) {
            health.devicePixelRatio = data.payload.devicePixelRatio;
          }
          break;
        case 'arcade:error':
          health.errors += 1;
          break;
        default:
          break;
      }
    });
  });
}

function selectFirstMovementKey(game: ManifestGame): string | null {
  const movement = game.controls?.movement;
  if (!movement || movement.length === 0) return null;
  const rawInput = movement[0]?.input;
  if (!rawInput) return null;

  const firstSegment = rawInput
    .split('|')[0]
    .split(/\bor\b/i)[0]
    .split('/')[0]
    .split(',')[0]
    .trim();
  if (!firstSegment) return null;

  const token = firstSegment.replace(/\s+/g, ' ');
  const upper = token.toUpperCase();

  if (upper.startsWith('ARROW')) {
    if (upper.includes('LEFT')) return 'ArrowLeft';
    if (upper.includes('RIGHT')) return 'ArrowRight';
    if (upper.includes('UP')) return 'ArrowUp';
    if (upper.includes('DOWN')) return 'ArrowDown';
  }

  const arrowMap: Record<string, string> = {
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    UP: 'ArrowUp',
    DOWN: 'ArrowDown'
  };
  if (arrowMap[upper]) return arrowMap[upper];

  if (/^[A-Z]$/.test(upper)) return upper.toLowerCase();
  if (upper === 'SPACE' || upper === 'SPACEBAR') return 'Space';

  return null;
}

async function captureCanvasSignature(page: Page, downscaleWidth = 128): Promise<FrameSignature | null> {
  return page.evaluate(({ targetWidth }) => {
    try {
      const iframe = document.querySelector('iframe');
      if (!iframe || !(iframe instanceof HTMLIFrameElement)) return null;
      const doc = iframe.contentDocument;
      if (!doc) return null;
      const canvas = doc.querySelector('canvas');
      if (!canvas) return null;
      const sourceContext = canvas.getContext('2d');
      if (!sourceContext) return null;
      const intrinsicWidth = canvas.width || Math.round(canvas.getBoundingClientRect().width);
      const intrinsicHeight = canvas.height || Math.round(canvas.getBoundingClientRect().height);
      if (!intrinsicWidth || !intrinsicHeight) return null;

      const scale = Math.min(1, targetWidth / intrinsicWidth);
      const width = Math.max(1, Math.round(intrinsicWidth * scale));
      const height = Math.max(1, Math.round(intrinsicHeight * scale));

      const buffer = doc.createElement('canvas');
      buffer.width = width;
      buffer.height = height;
      const bufferContext = buffer.getContext('2d');
      if (!bufferContext) return null;
      bufferContext.drawImage(canvas, 0, 0, width, height);
      const imageData = bufferContext.getImageData(0, 0, width, height).data;
      const luminances: number[] = new Array(width * height);
      for (let i = 0; i < luminances.length; i += 1) {
        const idx = i * 4;
        const r = imageData[idx];
        const g = imageData[idx + 1];
        const b = imageData[idx + 2];
        luminances[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }

      return { width, height, luminances };
    } catch {
      return null;
    }
  }, { targetWidth: downscaleWidth });
}

function computeSignatureDelta(a: FrameSignature | null, b: FrameSignature | null): number | null {
  if (!a || !b) return null;
  if (a.width !== b.width || a.height !== b.height) return null;
  const length = a.luminances.length;
  if (length === 0 || length !== b.luminances.length) return null;
  let total = 0;
  for (let i = 0; i < length; i += 1) {
    total += Math.abs(a.luminances[i] - b.luminances[i]);
  }
  return total / (length * 255);
}

async function probeCanvasDimensions(page: Page): Promise<{ width: number; height: number } | null> {
  return page.evaluate(() => {
    try {
      const iframe = document.querySelector('iframe');
      if (!iframe || !(iframe instanceof HTMLIFrameElement)) return null;
      const doc = iframe.contentDocument;
      if (!doc) return null;
      const canvas = doc.querySelector('canvas');
      if (!canvas) return null;
      const width = canvas.width || Math.round(canvas.getBoundingClientRect().width);
      const height = canvas.height || Math.round(canvas.getBoundingClientRect().height);
      if (!width || !height) return null;
      return { width, height };
    } catch {
      return null;
    }
  });
}

async function measureAnimationActivity(page: Page): Promise<AnimationActivity | null> {
  return page.evaluate(async () => {
    const iframe = document.querySelector('iframe');
    if (!iframe || !(iframe instanceof HTMLIFrameElement)) return null;
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) return null;

    return new Promise<AnimationActivity>((resolve) => {
      let ticks = 0;
      const start = frameWindow.performance.now();

      const step = () => {
        ticks += 1;
        const elapsed = frameWindow.performance.now() - start;
        if (elapsed >= 2000) {
          resolve({ tickCount: ticks, elapsedMs: elapsed });
          return;
        }
        frameWindow.requestAnimationFrame(step);
      };

      frameWindow.requestAnimationFrame(step);
    });
  });
}

async function main() {
  const jsonTargets = cli.reportPath ? [cli.reportPath] : [DEFAULT_REPORT_JSON];
  const markdownTargets = cli.markdownPath ? [cli.markdownPath] : [DEFAULT_REPORT_MD];

  console.log('[health-scan] checking dev server at %s', baseUrl);
  const reachable = await isReachable(baseUrl);
  if (!reachable) {
    console.error('[health-scan] Dev server is not reachable. Start it with "pnpm dev".');
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await initialiseHealthProbe(page);

  const results: HealthResult[] = [];

  for (const game of manifest.games) {
    if (game.status === 'missing-assets') {
      results.push({
        id: game.id,
        title: game.title,
        ready: false,
        avgFps: null,
        firstPaint: null,
        errors: 0,
        stalled: true,
        noMotion: true,
        noResponse: true,
        status: game.status,
        previousStatus: game.status,
        note: 'Excluded (missing assets)'
      });
      continue;
    }

    console.log('[health-scan] probing %s', game.id);

    page.removeAllListeners('pageerror');
    page.removeAllListeners('console');

    let consoleErrorCount = 0;
    page.on('pageerror', () => {
      consoleErrorCount += 1;
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrorCount += 1;
      }
    });

    await page.goto(`${baseUrl}/game/${game.id}?healthscan=1`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();

    const readyPromise = page
      .waitForFunction(
        () => (window as unknown as { __healthScan?: HealthWindow }).__healthScan?.ready === true,
        { timeout: readinessTimeout }
      )
      .catch(() => null);

    if (await readyPromise) {
      await page.waitForTimeout(500);
    }

    let ready = Boolean(await readyPromise);

    if (!ready) {
      const fallbackCanvas = await probeCanvasDimensions(page);
      ready = Boolean(fallbackCanvas);
    }

    if (ready) {
      await page.waitForTimeout(500);
    }

    const health = await page.evaluate<HealthWindow | undefined>(
      () => (window as unknown as { __healthScan?: HealthWindow }).__healthScan
    );

    const metrics = health?.metrics ?? [];
    const fpsSamples = metrics
      .map((sample) => sample.fps)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    let avgFps =
      fpsSamples.length > 0
        ? Number(
            (fpsSamples.reduce((acc, value) => acc + value, 0) / fpsSamples.length).toFixed(2)
          )
        : null;
    const firstPaintSample = metrics.find(
      (sample) => typeof sample.firstPaintMs === 'number' && Number.isFinite(sample.firstPaintMs)
    );
    const firstPaint = firstPaintSample?.firstPaintMs ?? null;
    const totalErrors = (health?.errors ?? 0) + consoleErrorCount;

    let animationActivity: AnimationActivity | null = null;
    if (ready) {
      animationActivity = await measureAnimationActivity(page);
      if (animationActivity && animationActivity.elapsedMs > 0) {
        avgFps = Number(
          (animationActivity.tickCount / (animationActivity.elapsedMs / 1000)).toFixed(2)
        );
      }
    }

    let noMotion = false;
    let noResponse = false;
    let signatureA: FrameSignature | null = null;
    let signatureB: FrameSignature | null = null;

    if (ready) {
      signatureA = await captureCanvasSignature(page);
      await page.waitForTimeout(500);
      signatureB = await captureCanvasSignature(page);
      const motionDelta = computeSignatureDelta(signatureA, signatureB);
      const tickCount = animationActivity?.tickCount ?? 0;
      if ((motionDelta != null && motionDelta < 0.01) || tickCount <= 30) {
        noMotion = true;
      }

      const movementKey = selectFirstMovementKey(game);
      if (movementKey && signatureB) {
        try {
          await page.keyboard.press(movementKey, { delay: 20 });
          await page.waitForTimeout(300);
          const signatureC = await captureCanvasSignature(page);
          const responseDelta = computeSignatureDelta(signatureB, signatureC);
          if (responseDelta != null && responseDelta < 0.01) {
            noResponse = true;
          }
        } catch {
          noResponse = true;
        }
      }
    }

    const stalled = !ready;

    const issues: string[] = [];
    if (stalled) {
      issues.push(`arcade:ready not observed within ${readinessTimeout / 1000}s`);
    }
    if (totalErrors > 3) {
      issues.push(`High error count (${totalErrors})`);
    }
    if (noMotion) {
      issues.push('No motion detected (frame delta < 1% or rAF ticks <= 30)');
    }
    if (noResponse) {
      issues.push('No basic input response (<1% delta after simulated movement key)');
    }

    const shouldMarkBroken = stalled || noMotion || noResponse || totalErrors > 3;
    const derivedStatus: GameStatus = shouldMarkBroken ? 'broken' : game.status;
    const note = issues.length > 0 ? issues.join('; ') : 'Pass';

    results.push({
      id: game.id,
      title: game.title,
      ready,
      avgFps,
      firstPaint,
      errors: totalErrors,
      stalled,
      noMotion,
      noResponse,
      status: derivedStatus,
      previousStatus: game.status,
      note
    });
  }

  await browser.close();

  const reportLines = [
    '# Automated Health Report',
    '',
    `Base URL: ${baseUrl}`,
    '',
    '| Game | Ready | Avg FPS | Errors | Stalled | No Motion | No Response | Status | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map((result) => {
      const cells = [
        result.title,
            result.ready ? 'Yes' : 'No',
        result.avgFps != null ? result.avgFps.toFixed(2) : 'n/a',
        result.errors.toString(),
        result.stalled ? 'Yes' : 'No',
        result.noMotion ? 'Yes' : 'No',
        result.noResponse ? 'Yes' : 'No',
        result.status,
        result.note
      ].map((value) => value.replace(/\|/g, '\\|'));
      return `| ${cells.join(' | ')} |`;
    }),
    ''
  ];

  for (const target of markdownTargets) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, reportLines.join('\n'), 'utf8');
  }

  const jsonPayload = JSON.stringify({ generatedAt: new Date().toISOString(), games: results }, null, 2);
  for (const target of jsonTargets) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, jsonPayload);
  }

  console.log(
    '[health-scan] wrote markdown to %s and json to %s',
    markdownTargets.join(', '),
    jsonTargets.join(', ')
  );

  if (writeChanges) {
    let manifestChanged = false;
    results.forEach((result) => {
      if (result.status === 'broken' && result.previousStatus !== 'broken') {
        const target = manifest.games.find((entry) => entry.id === result.id);
        if (target) {
          target.status = 'broken';
          manifestChanged = true;
        }
      }
    });

    if (manifestChanged) {
      await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      console.log('[health-scan] updated games.manifest.json with broken statuses');
    } else {
      console.log('[health-scan] no manifest updates required');
    }
  }
}

main().catch((error) => {
  console.error('[health-scan] unexpected failure:', error);
  process.exitCode = 1;
});
