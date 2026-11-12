import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures';

export async function checkDialogLayout(page: Page, dialog: Locator, info: TestInfo, name: string) {
  const originalViewport = page.viewportSize();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const body = dialog.locator('.modal-scroll');
    for (const end of [false, true]) {
      await body.evaluate((el, bottom) => {
        el.scrollTop = bottom ? el.scrollHeight : 0;
      }, end);
      await expect(dialog.locator('.modal-heading')).toBeInViewport({ ratio: 1 });
      await expect(dialog.locator('.modal-actions')).toBeInViewport({ ratio: 1 });
    }
    await body.evaluate((el) => {
      el.scrollTop = 0;
    });
    if (width === 390 || width === 1440) {
      await settleLayout(page);
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
    }
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}

export async function checkPageLayout(page: Page, info: TestInfo, name: string) {
  const originalViewport = page.viewportSize();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
    await expect(page.getByRole('banner')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390 || width === 1440) {
      await settleLayout(page);
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
    }
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}

async function settleLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
