import { expect, test } from 'playwright/test';

test('login screen exposes its controls without submitting credentials', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(page.getByPlaceholder('you@kodigo.ph')).toBeVisible();
  await expect(page.getByPlaceholder('Enter password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});

test('deployed app shell reopens the login screen offline without caching API paths', async ({ page, context }) => {
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const cachedPaths = await page.evaluate(async () => {
    const shellCaches = (await caches.keys()).filter((name) => name.startsWith('kodigo-shell-'));
    const requests = await Promise.all(shellCaches.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cachedPaths).toContain('/index.html');
  expect(cachedPaths.some((pathname) => /^\/assets\/.+\.(js|css)$/.test(pathname))).toBe(true);
  expect(cachedPaths.some((pathname) => /\/(auth|rest|storage|realtime|functions)\/v1\//.test(pathname))).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
});
