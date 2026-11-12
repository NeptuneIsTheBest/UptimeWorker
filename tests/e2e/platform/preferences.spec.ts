import { test, expect } from '../support/fixtures';
import { selectLanguage } from '../support/preferences';

for (const width of [390, 1440]) {
  test(`language switching waits for delayed app startup at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let releaseStartup!: () => void;
    const startupReady = new Promise<void>((resolve) => {
      releaseStartup = resolve;
    });
    await page.route('**/src/web/main.tsx', async (route) => {
      await startupReady;
      await route.continue();
    });

    const toggle = page.locator('.preferences-toggle');
    const language = page.locator('.language-select');
    try {
      await page.goto('/', { waitUntil: 'commit' });
      await expect(page.locator('#root')).toBeEmpty();
      const changingLanguage = selectLanguage(page, 'en');
      // Keep startup blocked while the helper begins checking the unmounted header.
      await expect(toggle).toHaveCount(0);
      releaseStartup();
      await changingLanguage;
    } finally {
      releaseStartup();
    }

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(language).toHaveValue('en');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    if (width === 390) {
      await expect(toggle).toBeVisible();
      await expect(language).toBeHidden();
    } else {
      await expect(toggle).toBeHidden();
      await expect(language).toBeVisible();
    }
  });
}

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
