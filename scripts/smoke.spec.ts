import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';

const SCREENSHOT_PIXEL_PONG = resolve('docs', 'screenshots', 'pixel-pong-embed.png');
const SCREENSHOT_BRICK_BREAKER = resolve(
  'docs',
  'screenshots',
  'brick-breaker-overlay-toggled.png'
);

async function ensureDirectory(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function waitForGameCanvas(page: Page): Promise<FrameLocator> {
  const iframeHandle = await page.waitForSelector('iframe', { state: 'attached', timeout: 30_000 });
  let frame = await iframeHandle?.contentFrame();
  const start = Date.now();
  while (!frame) {
    if (Date.now() - start > 30_000) {
      throw new Error('Embedded game frame did not resolve');
    }
    await page.waitForTimeout(50);
    frame = await iframeHandle?.contentFrame();
  }
  await frame.waitForSelector('canvas', { state: 'visible', timeout: 30_000 });
  return page.frameLocator('iframe');
}

test.describe.configure({ mode: 'serial' });

test('Pixel Pong fills viewport without scrollbars and captures screenshot', async ({ page }) => {
  await page.goto('/game/pixel-pong');
  const frame = await waitForGameCanvas(page);

  const scrollMetrics = await page.evaluate(() => {
    const doc = document.scrollingElement;
    if (!doc) return null;
    return {
      width: { scroll: doc.scrollWidth, client: doc.clientWidth },
      height: { scroll: doc.scrollHeight, client: doc.clientHeight }
    };
  });

  expect(scrollMetrics).not.toBeNull();
  expect(scrollMetrics!.width.scroll).toBeLessThanOrEqual(scrollMetrics!.width.client + 1);
  expect(scrollMetrics!.height.scroll).toBeLessThanOrEqual(scrollMetrics!.height.client + 1);

  const hostMetrics = await page.evaluate(() => {
    const iframe = document.querySelector('iframe');
    const host = document.querySelector('main .relative.flex');
    if (!iframe || !host) return null;
    const iframeRect = iframe.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const centerDeltaX = Math.abs(iframeRect.left + iframeRect.width / 2 - (hostRect.left + hostRect.width / 2));
    const centerDeltaY = Math.abs(iframeRect.top + iframeRect.height / 2 - (hostRect.top + hostRect.height / 2));
    return {
      iframeWidth: iframeRect.width,
      iframeHeight: iframeRect.height,
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      centerDeltaX,
      centerDeltaY
    };
  });

  expect(hostMetrics).not.toBeNull();
  expect(hostMetrics!.iframeWidth).toBeLessThanOrEqual(hostMetrics!.hostWidth + 1);
  expect(hostMetrics!.iframeHeight).toBeLessThanOrEqual(hostMetrics!.hostHeight + 1);
  expect(hostMetrics!.centerDeltaX).toBeLessThanOrEqual(2);
  expect(hostMetrics!.centerDeltaY).toBeLessThanOrEqual(2);

  const canvasMetrics = await frame.locator('canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(canvasMetrics.width).toBeLessThanOrEqual((viewport?.width ?? canvasMetrics.width) + 1);
  expect(canvasMetrics.height).toBeLessThanOrEqual((viewport?.height ?? canvasMetrics.height) + 1);

  await ensureDirectory(SCREENSHOT_PIXEL_PONG);
  await page.screenshot({ path: SCREENSHOT_PIXEL_PONG, fullPage: true });
});

type RenderOptions = {
  reopenOverlay?: boolean;
};

async function runAfterglowEscapeAttempt(page: Page, options: RenderOptions = {}) {
  await page.goto('/game/afterglow');
  let frame = await waitForGameCanvas(page);
  const dismissButton = page.getByRole('button', { name: /dismiss tutorial overlay/i });

  if (await dismissButton.isVisible()) {
    await dismissButton.click();
    if (options.reopenOverlay) {
      await page.evaluate(() => {
        window.localStorage.removeItem('arcade:tutorialDismissed:afterglow');
      });
    }
  }

  if (options.reopenOverlay) {
    await page.reload();
    frame = await waitForGameCanvas(page);
    if (await dismissButton.isVisible()) {
      await dismissButton.click();
    }
  }

  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 }
  ];

  for (const size of viewports) {
    await page.setViewportSize(size);
    await frame.locator('canvas').first().waitFor({ state: 'visible' });
  }

  await frame.locator('canvas').click();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/$/);
}

test('Afterglow Escape navigates home reliably after overlay interactions', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('arcade:tutorialDismissed:afterglow');
  });

  await runAfterglowEscapeAttempt(page, { reopenOverlay: true });

  // Return to game and verify Escape works again without reopening overlay.
  await page.goto('/');
  await runAfterglowEscapeAttempt(page);
});

test('Brick Breaker help overlay auto-hides, toggles, and captures screenshot', async ({ page }) => {
  await page.goto('/game/brick-breaker');
  const frame = await waitForGameCanvas(page);
  const tooltip = frame.locator('#controls-tooltip');
  await expect(tooltip).toBeVisible();

  await frame.locator('canvas').click();
  await expect(tooltip).toHaveClass(/is-hidden/);

  await page.keyboard.press('H');
  await expect(tooltip).not.toHaveClass(/is-hidden/);

  await ensureDirectory(SCREENSHOT_BRICK_BREAKER);
  await page.screenshot({ path: SCREENSHOT_BRICK_BREAKER, fullPage: true });

  await page.keyboard.press('H');
  await expect(tooltip).toHaveClass(/is-hidden/);
});
