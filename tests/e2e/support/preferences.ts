import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export async function openPreferences(page: Page) {
  const toggle = page.locator('.preferences-toggle');
  await expect(toggle).toBeAttached();
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await expect(page.locator('.language-select')).toBeVisible();
}

export async function closePreferences(page: Page) {
  const toggle = page.locator('.preferences-toggle');
  await expect(toggle).toBeAttached();
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'true')
    await toggle.click();
}

export async function selectLanguage(page: Page, locale: string) {
  await openPreferences(page);
  await page.locator('.language-select').selectOption(locale);
  await closePreferences(page);
}
