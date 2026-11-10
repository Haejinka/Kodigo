import { expect, test } from 'playwright/test';

test('login screen exposes its controls without submitting credentials', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(page.getByPlaceholder('you@kodigo.ph')).toBeVisible();
  await expect(page.getByPlaceholder('Enter password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});
