import { test, expect } from '../support/fixtures';

test('mobile preferences support keyboard changes, dismissal and focus return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const toggle = page.locator('.preferences-toggle');
  const language = page.locator('.language-select');
  const theme = page.locator('.theme-select');
  await expect(language).toBeHidden();
  await expect(theme).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(language).toBeFocused();
  await language.selectOption('en');
  await expect(toggle).toHaveText('Preferences');
  await page.keyboard.press('Tab');
  await expect(theme).toBeFocused();
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(theme).toBeHidden();

  await toggle.click();
  await page.locator('.site-footer').click();
  await expect(language).toBeHidden();
  await toggle.click();
  await page.locator('.site-header nav a').first().focus();
  await expect(language).toBeHidden();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toggle).toBeHidden();
  await expect(language).toBeVisible();
  await expect(theme).toBeVisible();
});
